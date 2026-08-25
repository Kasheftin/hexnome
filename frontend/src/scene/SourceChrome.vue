<script setup lang="ts">
/**
 * The shared source: a column of lots down the left, under the title — one slot per plate the round
 * deals, so the count comes from the `platesPerRound` setting.
 *
 * This is the pick-from area. Each lot holds one face-down plate with loose tiles heaped on it, and
 * on your turn you draft out of here into your drawer.
 *
 * Drawn in the canvas rather than as DOM, for the same reason as the drawer: the lots hold live 3D
 * plates and tiles, so an opaque DOM panel would cover its own contents. Laid out in **screen
 * pixels** and converted to world units each frame, so the column stays put and stays the same size
 * while the board pans and zooms beneath it (scene/sourceLayout.ts).
 *
 * A column rather than a row because the plates side by side would be wider than the board and would
 * fight the drawer for the bottom of the screen. Vertical also matches what it is: a stack you work
 * down, newest on top.
 */
import { useLoop, useTresContext } from '@tresjs/core'
import {
  DoubleSide,
  Euler,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type OrthographicCamera,
  type Plane,
} from 'three'
import { onBeforeUnmount, onMounted, watch, watchEffect } from 'vue'
import {
  createChromePanelMaterial,
  setChromePanelSize,
  setChromePanelTone,
  snapPanelRect,
} from './chromePanel'
import {
  SOURCE_CHROME_Y,
  SOURCE_LOT_GAP_PX,
  SOURCE_SCRIM_COLOR,
  SOURCE_SCRIM_OPACITY,
  SOURCE_SCRIM_Y,
} from './constants'
import { registerGrabbable } from './grabbables'
import { screenToBoard, unitsPerPixel } from './screenProjection'
import type { DrawerShape } from './drawerLayout'
import { columnRect, resetSourceScroll, sourceClipPlanes, updateSourceClip } from './sourceScroll'
import { useSourceLayout } from './useSourceLayout'

/**
 * `lots` is fixed for a game's lifetime — it comes from the `platesPerRound` setting, which cannot change
 * mid-game — so the bays are built once in `onMounted` rather than watched.
 */
const props = defineProps<{
  /** The drawer's seats: the source column stops above the panel, whose width follows them. */
  drawer: DrawerShape
  lots: number
  /** Is the source draftable right now? Only during a `taking` turn. */
  live: boolean
}>()

const { scene, camera, sizes, renderer } = useTresContext()
const { onBeforeRender } = useLoop()
const layout = useSourceLayout(() => props.lots, () => props.drawer)

/*
 * Publish the column's rectangle for the DOM scrollbar to match itself to (scene/sourceScroll.ts).
 *
 * From a watcher on the layout rather than from `onBeforeRender`: the layout is a computed over the
 * canvas size, so it changes on a resize and not on a frame. Publishing per frame would write the same
 * object sixty times a second for no one's benefit.
 */
watchEffect(() => {
  const l = layout.value
  columnRect.value = {
    left: l.left,
    top: l.top,
    width: l.width,
    height: l.height,
    contentHeight: l.contentHeight,
    lotCount: l.lotCount,
    pitch: l.lotHeight + SOURCE_LOT_GAP_PX,
  }
})

const FLAT = new Euler(-Math.PI / 2, 0, 0)

/** The column, styled as a `.chrome-panel` like the drawer tray and the DOM chrome. */
const panelMaterial = createChromePanelMaterial()
const panel = new Mesh(new PlaneGeometry(1, 1), panelMaterial)
panel.rotation.copy(FLAT)
panel.renderOrder = 10

/**
 * One bay per lot, nested in the column the way the drawer's plate bays are nested in its tray.
 * Two translucent slate layers stack to something darker than one, so the recess comes for free.
 */
const bays: Mesh[] = []
const bayGeometry = new PlaneGeometry(1, 1)
const bayMaterial = createChromePanelMaterial({ clipping: true })
/*
 * The bays scroll with the lots, so they clip with them. The panel and the scrim do not: they are the
 * frame the lots move behind, and clipping them to themselves would do nothing.
 */
bayMaterial.clippingPlanes = sourceClipPlanes as Plane[]

/**
 * The scrim: one quad over the whole column, drawn while the source is not draftable.
 *
 * A quad rather than a per-item overlay because what is being dimmed is the **area**, not any object
 * in it. Per-item overlays would have to be created and destroyed as the source restocks, would have
 * to be kept out of the raycast, and would collide with the per-tile draft markers that use exactly
 * that mechanism to say something narrower. A scrim has none of those problems and does not care what
 * is underneath it.
 *
 * `depthWrite: false` so it never occludes anything by depth — its only job is to tint. Depth
 * *testing* stays on, which is what lets a carried tile pass over it; see `SOURCE_SCRIM_Y`.
 */
const scrim = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({
  color: SOURCE_SCRIM_COLOR,
  transparent: true,
  opacity: SOURCE_SCRIM_OPACITY,
  side: DoubleSide,
  depthWrite: false,
}))
scrim.rotation.copy(FLAT)
scrim.renderOrder = 20
// Never a pick target: it covers the lots, and a ray stopping here would make the source undraftable.
scrim.raycast = () => {}

/**
 * The source is **dimmed unless it is your turn to draft**, which is most of the time.
 *
 * It is the one area on the table nobody may touch outside a `taking` turn, and nothing about the
 * lots themselves says so — a heap of tiles looks equally grabbable whatever the phase. Dimming the
 * whole area, contents included, says it before a player tries.
 *
 * The bays only ever go dim or resting: lighting each of them as well as the column would put four
 * bright outlines on screen to make one point.
 */
watch(() => props.live, live => {
  setChromePanelTone(panelMaterial, live ? 'active' : 'dim')
  setChromePanelTone(bayMaterial, live ? 'resting' : 'dim')
  scrim.visible = !live
}, { immediate: true })

let unregister: (() => void) | null = null

onMounted(() => {
  /*
   * Per-material clipping is off by default and silently ignored without this — `clippingPlanes` on a
   * material does nothing until the renderer is told to look for them. (The renderer's *own*
   * `clippingPlanes` work regardless, but those would clip the whole scene, board included.)
   */
  const gl = renderer.instance as { localClippingEnabled?: boolean } | undefined
  if (gl) gl.localClippingEnabled = true

  scene.value.add(panel)
  scene.value.add(scrim)
  // The column swallows presses: pressing an empty lot must not pan the board behind it.
  unregister = registerGrabbable(panel)

  for (let lot = 0; lot < layout.value.lotCount; lot++) {
    const bay = new Mesh(bayGeometry, bayMaterial)
    bay.rotation.copy(FLAT)
    bay.renderOrder = 11
    bays.push(bay)
    scene.value.add(bay)
  }
})

onBeforeRender(() => {
  const cam = camera.activeCamera.value as OrthographicCamera | undefined
  if (!cam || !cam.isOrthographicCamera) return

  const w = sizes.width.value
  const h = sizes.height.value
  const upp = unitsPerPixel(cam, h)
  const l = layout.value

  // Snapped to the pixel grid so the 1px border stays as crisp as the DOM panels' — see
  // chromePanel.ts, which explains why that is not automatic.
  const column = snapPanelRect(l.left + l.width / 2, l.top + l.height / 2, l.width, l.height)
  const centre = screenToBoard(cam, w, h, column.x, column.y)
  panel.position.set(centre.x, SOURCE_CHROME_Y, centre.z)
  panel.scale.set(column.width * upp, column.height * upp, 1)
  setChromePanelSize(panelMaterial, column.width, column.height)

  // The same rectangle, so the dim stops exactly where the column does — no halo past the border,
  // and no bright margin inside it.
  scrim.position.set(centre.x, SOURCE_SCRIM_Y, centre.z)
  scrim.scale.copy(panel.scale)

  /*
   * Point the clipping planes at the column, for everything that scrolls inside it — the bays here and
   * the plates and tiles in `TableauView`. Updated even when nothing overflows, so the band is always
   * current the moment a resize starts one scrolling.
   */
  const zTop = screenToBoard(cam, w, h, l.left, l.top).z
  const zBottom = screenToBoard(cam, w, h, l.left, l.top + l.height).z
  updateSourceClip(zTop, zBottom)

  // Every bay is the same size, so they share one material and one pixel size; only the centres
  // differ, and each is snapped on its own.
  const bayWPx = Math.round(l.lotWidth)
  const bayHPx = Math.round(l.lotHeight)
  setChromePanelSize(bayMaterial, bayWPx, bayHPx)
  const bayW = bayWPx * upp
  const bayH = bayHPx * upp

  for (let lot = 0; lot < bays.length; lot++) {
    const bay = bays[lot]
    if (!bay) continue
    const c = l.lotCentre(lot)
    // `lotCentre` is content space; the scroll is applied here, at the moment of drawing.
    const rect = snapPanelRect(c.x, c.y - l.scrollTop, bayWPx, bayHPx)
    const p = screenToBoard(cam, w, h, rect.x, rect.y)
    bay.position.set(p.x, SOURCE_CHROME_Y + 0.005, p.z)
    bay.scale.set(bayW, bayH, 1)
  }
})

onBeforeUnmount(() => {
  // Or a second game opens at the previous one's scroll position, against a stale rectangle.
  resetSourceScroll()
  unregister?.()
  unregister = null
  for (const bay of bays) scene.value?.remove(bay)
  bays.length = 0
  scene.value?.remove(scrim)
  scrim.geometry.dispose()
  ;(scrim.material as MeshBasicMaterial).dispose()
  scene.value?.remove(panel)
  panel.geometry.dispose()
  panelMaterial.dispose()
  bayGeometry.dispose()
  bayMaterial.dispose()
})
</script>

<template>
  <TresGroup />
</template>
