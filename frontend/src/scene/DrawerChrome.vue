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
import { onBeforeUnmount, onMounted } from 'vue'
import {
  DRAWER_CHROME_Y,
  DRAWER_SLOT_PX,
  DRAWER_TILE_FILL,
  HIGHLIGHT_COLORS,
  PLATE_SLOT_PX,
} from './constants'
import { registerGrabbable } from './grabbables'
import { screenToBoard, unitsPerPixel } from './screenProjection'
import { useDrawerLayout } from './useDrawerLayout'

const props = defineProps<{
  /** Tile slot the held tile would drop into, or null. */
  targetSlot: number | null
  /** Plate slot the held plate would drop into, or null. */
  targetPlateSlot: number | null
  targetValid: boolean
}>()

const { scene, camera, sizes } = useTresContext()
const { onBeforeRender } = useLoop()
const layout = useDrawerLayout()

const FLAT = new Euler(-Math.PI / 2, 0, 0)

/** Slot ring radius in pixels — the same fraction of a slot the tiles use. */
const RING_PX = (DRAWER_SLOT_PX / 2) * DRAWER_TILE_FILL

const panel = new Mesh(
  new PlaneGeometry(1, 1),
  new MeshBasicMaterial({ color: '#0e1216', transparent: true, opacity: 0.88, side: DoubleSide }),
)
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
 */
const bays: Mesh[] = []
const bayGeometry = new PlaneGeometry(1, 1)
const bayMaterial = new MeshBasicMaterial({
  color: '#181d22',
  transparent: true,
  opacity: 0.95,
  side: DoubleSide,
})
const bayHighlight = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({
  transparent: true,
  opacity: 0.22,
  side: DoubleSide,
}))
bayHighlight.rotation.copy(FLAT)
bayHighlight.renderOrder = 13

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

  // Panel: a pixel-sized rectangle placed at its screen centre.
  const centre = screenToBoard(cam, w, h, l.left + l.width / 2, l.top + l.height / 2)
  panel.position.set(centre.x, DRAWER_CHROME_Y, centre.z)
  panel.scale.set(l.width * upp, l.height * upp, 1)

  for (let slot = 0; slot < rings.length; slot++) {
    const ring = rings[slot]
    if (!ring) continue
    const c = l.slotCentre(slot)
    const p = screenToBoard(cam, w, h, c.x, c.y)
    ring.position.set(p.x, DRAWER_CHROME_Y + 0.01, p.z)
    // Rings are built at pixel scale, so one uniform scale converts them to world.
    ring.scale.setScalar(upp)
  }

  const bayW = (PLATE_SLOT_PX - 6) * upp
  const bayH = (l.plateSlotHeight - 4) * upp
  for (let slot = 0; slot < bays.length; slot++) {
    const bay = bays[slot]
    if (!bay) continue
    const c = l.plateSlotCentre(slot)
    const p = screenToBoard(cam, w, h, c.x, c.y)
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
  ;(panel.material as MeshBasicMaterial).dispose()
  ringGeometry.dispose()
  ringMaterial.dispose()
  highlight.geometry.dispose()
  ;(highlight.material as MeshBasicMaterial).dispose()
})
</script>

<template>
  <TresGroup />
</template>
