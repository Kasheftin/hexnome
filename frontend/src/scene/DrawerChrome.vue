<script setup lang="ts">
/**
 * The drawer: a floating panel of 16 slots at the bottom of the screen.
 *
 * Drawn in the canvas rather than as DOM. The slots hold live 3D tiles, and a DOM panel
 * sits *over* the canvas — so an opaque DOM drawer would cover its own contents. Keeping
 * the whole thing in 3D also means the tiles in it are the same meshes, materials and
 * lighting as the tiles on the board, with nothing duplicated.
 *
 * Laid out in **screen pixels** and converted to world units each frame, so the drawer
 * stays put and stays the same size while the board pans and zooms beneath it. Legal
 * only because the board camera is orthographic and axis-aligned — see
 * scene/screenProjection.ts.
 */
import { useLoop, useTresContext } from '@tresjs/core'
import {
  DoubleSide,
  Euler,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  type OrthographicCamera,
} from 'three'
import { onBeforeUnmount, onMounted, watch } from 'vue'
import {
  DRAWER_CHROME_Y,
  DRAWER_SLOT_PX,
  DRAWER_TILE_FILL,
  HIGHLIGHT_COLORS,
} from './constants'
import {
  createChromePanelMaterial,
  setChromePanelSize,
  setChromePanelTone,
  snapPanelRect,
} from './chromePanel'
import { registerGrabbable } from './grabbables'
import { screenToBoard, unitsPerPixel } from './screenProjection'
import type { DrawerShape } from './drawerLayout'
import { useDrawerLayout } from './useDrawerLayout'

const props = defineProps<{
  /** How many seats the drawer has — a game setting, so the panel's size follows it. */
  drawer: DrawerShape
  /** Tile slot the held tile would drop into, or null. */
  targetSlot: number | null
  /** Plate slot the held plate would drop into, or null. */
  targetPlateSlot: number | null
  targetValid: boolean
  /** Is the drawer being acted on right now — dragging out of it, or picking payment from it? */
  live: boolean
}>()

const { scene, camera, sizes } = useTresContext()
const { onBeforeRender } = useLoop()
const layout = useDrawerLayout(() => props.drawer)

const FLAT = new Euler(-Math.PI / 2, 0, 0)

/**
 * Slot ring radius in pixels — the same fraction of a slot the tiles use.
 *
 * A *nominal* size: the geometry is built once at this radius and scaled to world units every frame,
 * so the drawer's fit factor rides on that existing multiply rather than needing the rings rebuilt
 * whenever the window changes.
 */
const RING_PX = (DRAWER_SLOT_PX / 2) * DRAWER_TILE_FILL

/**
 * The tray, styled as a `.chrome-panel` so it belongs to the same family as the header and the
 * help card over in the DOM — 1px border, 4px radius, translucent slate.
 */
const panelMaterial = createChromePanelMaterial()
const panel = new Mesh(new PlaneGeometry(1, 1), panelMaterial)
panel.rotation.copy(FLAT)
panel.renderOrder = 10

/** One ring per slot, plus one highlight ring reused for whichever slot is targeted. */
const rings: Mesh[] = []
const ringGeometry = new RingGeometry(RING_PX * 0.93, RING_PX, 6, 1, Math.PI / 2)
const ringMaterial = new MeshBasicMaterial({
  color: '#3f4a52',
  transparent: true,
  opacity: 0.85,
  side: DoubleSide,
})

const highlight = new Mesh(
  new RingGeometry(RING_PX * 0.82, RING_PX * 1.06, 6, 1, Math.PI / 2),
  new MeshBasicMaterial({ transparent: true, opacity: 0.9, side: DoubleSide }),
)
highlight.rotation.copy(FLAT)
highlight.renderOrder = 13

/**
 * Plate bays, drawn as plain rounded rectangles rather than hex outlines: a plate is a
 * seven-cell flower, so a hexagonal socket would misdescribe what goes there.
 *
 * Same panel styling as the tray, which is what makes them read as bays recessed into it: two
 * translucent slate layers stack to something darker than one, so the depth comes for free rather
 * than from a second hand-picked grey.
 */
const bays: Mesh[] = []
const bayGeometry = new PlaneGeometry(1, 1)
const bayMaterial = createChromePanelMaterial()
const bayHighlight = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({
  transparent: true,
  opacity: 0.22,
  side: DoubleSide,
}))
bayHighlight.rotation.copy(FLAT)
bayHighlight.renderOrder = 13

/**
 * The tray lights up while you are placing, and rests otherwise.
 *
 * Never dimmed, unlike the source: the drawer is your own hand, and it stays readable whether or not
 * it is your turn. Only the bays and rings inside it are structural, so the tone rides on the tray
 * alone.
 */
watch(() => props.live, live => {
  setChromePanelTone(panelMaterial, live ? 'active' : 'resting')
}, { immediate: true })

let unregister: (() => void) | null = null

onMounted(() => {
  scene.value.add(panel)
  // The drawer swallows presses: pressing its empty area must not pan the board behind.
  unregister = registerGrabbable(panel)

  for (let slot = 0; slot < layout.value.plateSlotCount; slot++) {
    const bay = new Mesh(bayGeometry, bayMaterial)
    bay.rotation.copy(FLAT)
    bay.renderOrder = 11
    bays.push(bay)
    scene.value.add(bay)
  }
  scene.value.add(bayHighlight)

  for (let slot = 0; slot < layout.value.slotCount; slot++) {
    const ring = new Mesh(ringGeometry, ringMaterial)
    ring.rotation.copy(FLAT)
    ring.renderOrder = 12
    rings.push(ring)
    scene.value.add(ring)
  }

  scene.value.add(highlight)
})

onBeforeRender(() => {
  const cam = camera.activeCamera.value as OrthographicCamera | undefined
  if (!cam || !cam.isOrthographicCamera) return

  const w = sizes.width.value
  const h = sizes.height.value
  const upp = unitsPerPixel(cam, h)
  const l = layout.value

  // Panel: a pixel-sized rectangle placed at its screen centre, snapped to the pixel grid so its
  // 1px border comes out as crisp as the DOM panels' rather than straddling two rows.
  const tray = snapPanelRect(l.left + l.width / 2, l.top + l.height / 2, l.width, l.height)
  const centre = screenToBoard(cam, w, h, tray.x, tray.y)
  panel.position.set(centre.x, DRAWER_CHROME_Y, centre.z)
  panel.scale.set(tray.width * upp, tray.height * upp, 1)
  // The shader draws its border in pixel space, so it needs the size in pixels rather than the
  // world scale above. Zoom changes the scale and leaves this alone — which is the point.
  setChromePanelSize(panelMaterial, tray.width, tray.height)

  for (let slot = 0; slot < rings.length; slot++) {
    const ring = rings[slot]
    if (!ring) continue
    const c = l.slotCentre(slot)
    const p = screenToBoard(cam, w, h, c.x, c.y)
    ring.position.set(p.x, DRAWER_CHROME_Y + 0.01, p.z)
    // Built at nominal pixel scale, so one uniform scale carries both the world conversion and the
    // panel's fit factor — a shrunken drawer needs shrunken rings or they spill their slots.
    ring.scale.setScalar(upp * l.scale)
  }

  // Every bay is the same size, so they share one material and one pixel size. Only their centres
  // differ, and each is snapped independently — rounding the shared size once would still leave
  // individual bays off the grid.
  const bayWPx = Math.round(l.plateSlotWidth - 6 * l.scale)
  const bayHPx = Math.round(l.plateSlotHeight - 4)
  setChromePanelSize(bayMaterial, bayWPx, bayHPx)
  const bayW = bayWPx * upp
  const bayH = bayHPx * upp
  for (let slot = 0; slot < bays.length; slot++) {
    const bay = bays[slot]
    if (!bay) continue
    const c = l.plateSlotCentre(slot)
    const rect = snapPanelRect(c.x, c.y, bayWPx, bayHPx)
    const p = screenToBoard(cam, w, h, rect.x, rect.y)
    bay.position.set(p.x, DRAWER_CHROME_Y + 0.005, p.z)
    bay.scale.set(bayW, bayH, 1)
  }

  const plateTarget = props.targetPlateSlot
  bayHighlight.visible = plateTarget !== null
  if (plateTarget !== null) {
    const c = l.plateSlotCentre(plateTarget)
    const p = screenToBoard(cam, w, h, c.x, c.y)
    bayHighlight.position.set(p.x, DRAWER_CHROME_Y + 0.02, p.z)
    bayHighlight.scale.set(bayW, bayH, 1)
    ;(bayHighlight.material as MeshBasicMaterial).color.set(
      props.targetValid ? HIGHLIGHT_COLORS.valid : HIGHLIGHT_COLORS.invalid,
    )
  }

  const target = props.targetSlot
  highlight.visible = target !== null
  if (target !== null) {
    const c = l.slotCentre(target)
    const p = screenToBoard(cam, w, h, c.x, c.y)
    highlight.position.set(p.x, DRAWER_CHROME_Y + 0.02, p.z)
    highlight.scale.setScalar(upp)
    const material = highlight.material as MeshBasicMaterial
    material.color.set(props.targetValid ? HIGHLIGHT_COLORS.valid : HIGHLIGHT_COLORS.invalid)
  }
})

onBeforeUnmount(() => {
  unregister?.()
  unregister = null
  for (const ring of rings) scene.value?.remove(ring)
  rings.length = 0
  for (const bay of bays) scene.value?.remove(bay)
  bays.length = 0
  scene.value?.remove(bayHighlight)
  bayGeometry.dispose()
  bayMaterial.dispose()
  bayHighlight.geometry.dispose()
  ;(bayHighlight.material as MeshBasicMaterial).dispose()
  scene.value?.remove(panel)
  scene.value?.remove(highlight)
  panel.geometry.dispose()
  panelMaterial.dispose()
  ringGeometry.dispose()
  ringMaterial.dispose()
  highlight.geometry.dispose()
  ;(highlight.material as MeshBasicMaterial).dispose()
})
</script>

<template>
  <TresGroup />
</template>
