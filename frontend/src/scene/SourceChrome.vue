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
import { Euler, Mesh, PlaneGeometry, type OrthographicCamera } from 'three'
import { onBeforeUnmount, onMounted } from 'vue'
import { createChromePanelMaterial, setChromePanelSize, snapPanelRect } from './chromePanel'
import { SOURCE_CHROME_Y } from './constants'
import { registerGrabbable } from './grabbables'
import { screenToBoard, unitsPerPixel } from './screenProjection'
import { useSourceLayout } from './useSourceLayout'

/**
 * `lots` is fixed for a game's lifetime — it comes from the `platesPerRound` setting, which cannot change
 * mid-game — so the bays are built once in `onMounted` rather than watched.
 */
const props = defineProps<{ lots: number }>()

const { scene, camera, sizes } = useTresContext()
const { onBeforeRender } = useLoop()
const layout = useSourceLayout(() => props.lots)

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
const bayMaterial = createChromePanelMaterial()

let unregister: (() => void) | null = null

onMounted(() => {
  scene.value.add(panel)
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
    const rect = snapPanelRect(c.x, c.y, bayWPx, bayHPx)
    const p = screenToBoard(cam, w, h, rect.x, rect.y)
    bay.position.set(p.x, SOURCE_CHROME_Y + 0.005, p.z)
    bay.scale.set(bayW, bayH, 1)
  }
})

onBeforeUnmount(() => {
  unregister?.()
  unregister = null
  for (const bay of bays) scene.value?.remove(bay)
  bays.length = 0
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
