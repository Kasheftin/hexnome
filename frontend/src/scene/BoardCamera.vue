<script setup lang="ts">
/**
 * The board camera: orthographic, straight down, pan and zoom, no orbit.
 *
 * Orthographic rather than perspective so symbols on tiles stay the same size and
 * shape wherever they sit, and so world→screen stays affine — which is what lets the
 * DOM chrome line up with 3D regions. Zero tilt because any tilt `t` compresses the
 * board's Z axis by `cos(t)` and visibly squashes the hexagons. See docs/tech-spec.md.
 *
 * Built imperatively and registered with TresJS rather than declared as
 * `<TresOrthographicCamera>`, because the frustum is recomputed on every resize and
 * zoom, and driving that through reactive `args` would recreate the camera each time.
 *
 * **Controls:** left-drag on empty board pans; left-drag on a tile is left to the tile
 * (see scene/grabbables.ts); middle- and right-drag always pan; the wheel zooms.
 * There are no scrollbars — the canvas fills the window and never overflows.
 *
 * Panning and zooming are both clamped so the ragged edge of the board can never come
 * into view.
 */
import { useTresContext } from '@tresjs/core'
import { OrthographicCamera, Raycaster, Vector2, Vector3 } from 'three'
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { BOARD_HALF_COLS, BOARD_HALF_ROWS } from '@hexnome/rules/board'
import {
  hexRectangleBounds,
  insetBounds,
  type WorldBounds,
} from '@hexnome/rules/hex'
import {
  BOARD_TILT_DEG,
  CAMERA_DISTANCE,
  HEX_SIZE,
  PAN_MARGIN_CELLS,
  VIEW_HEIGHT_DEFAULT,
  VIEW_HEIGHT_MAX,
  VIEW_HEIGHT_MIN,
} from './constants'
import { hitsGrabbable } from './grabbables'

const { camera, renderer, sizes } = useTresContext()

const tilt = (BOARD_TILT_DEG * Math.PI) / 180
const cosTilt = Math.cos(tilt)

/**
 * Screen-up in world space. Set explicitly rather than left to `lookAt`: at zero tilt
 * the view direction is parallel to +Y and `lookAt` with `up = +Y` is degenerate, so
 * three only recovers via an internal nudge. This is the vector lookAt derives for any
 * non-zero tilt, and it is well defined at zero.
 */
const upVector = new Vector3(0, Math.sin(tilt), -cosTilt)

const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 4)
const target = new Vector3(0, 0, 0)
let viewHeight = VIEW_HEIGHT_DEFAULT

/**
 * How far the camera target may travel: the cell-centre bounds, pulled in by a few
 * cells so the outermost ring never appears on screen.
 */
const panBounds: WorldBounds = insetBounds(
  hexRectangleBounds(BOARD_HALF_COLS, BOARD_HALF_ROWS, HEX_SIZE),
  PAN_MARGIN_CELLS,
  HEX_SIZE,
)

const raycaster = new Raycaster()
const ndc = new Vector2()

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * The most the camera may show without the viewport reaching past `panBounds`.
 *
 * Zoom has to be clamped as well as pan: if the view were allowed to grow taller or
 * wider than the board, no amount of pan clamping could keep the edge off screen.
 */
function maxViewHeight(): number {
  const aspect = sizes.aspectRatio.value || 1
  const byWidth = (panBounds.maxX - panBounds.minX) / aspect
  const byHeight = panBounds.maxZ - panBounds.minZ
  return Math.max(VIEW_HEIGHT_MIN, Math.min(VIEW_HEIGHT_MAX, byWidth, byHeight))
}

/** Keep the visible rectangle inside `panBounds`; centre on an axis too small to pan. */
function clampTarget(): void {
  const aspect = sizes.aspectRatio.value || 1
  const halfH = viewHeight / 2
  const halfW = halfH * aspect

  const minX = panBounds.minX + halfW
  const maxX = panBounds.maxX - halfW
  target.x = minX > maxX ? (panBounds.minX + panBounds.maxX) / 2 : clamp(target.x, minX, maxX)

  // At zero tilt the visible world height along Z is exactly `viewHeight`.
  const minZ = panBounds.minZ + halfH
  const maxZ = panBounds.maxZ - halfH
  target.z = minZ > maxZ ? (panBounds.minZ + panBounds.maxZ) / 2 : clamp(target.z, minZ, maxZ)
}

function place(): void {
  cam.position.set(
    target.x,
    target.y + CAMERA_DISTANCE * cosTilt,
    target.z + CAMERA_DISTANCE * Math.sin(tilt),
  )
  cam.up.copy(upVector)
  cam.lookAt(target)
  cam.updateMatrixWorld()
}

function applyFrustum(): void {
  const aspect = sizes.aspectRatio.value || 1
  viewHeight = clamp(viewHeight, VIEW_HEIGHT_MIN, maxViewHeight())
  const w = viewHeight * aspect
  cam.left = -w / 2
  cam.right = w / 2
  cam.top = viewHeight / 2
  cam.bottom = -viewHeight / 2
  cam.updateProjectionMatrix()
  clampTarget()
  place()
}

/** World units per screen pixel along the camera's own axes. */
function unitsPerPixel(): number {
  return viewHeight / (sizes.height.value || 1)
}

let panning = false
let lastX = 0
let lastY = 0

function canvasEl(): HTMLCanvasElement | null {
  return renderer.instance?.domElement ?? null
}

/** Does this press land on something that wants the drag for itself? */
function pressedOnGrabbable(clientX: number, clientY: number): boolean {
  const active = camera.activeCamera.value
  const el = canvasEl()
  if (!active || !el) return false
  const rect = el.getBoundingClientRect()
  ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  raycaster.setFromCamera(ndc, active)
  return hitsGrabbable(raycaster)
}

function onPointerDown(e: PointerEvent): void {
  const isPanButton = e.button === 1 || e.button === 2
  // Left-drag pans only over empty board; on a tile the tile takes it.
  if (!isPanButton && (e.button !== 0 || pressedOnGrabbable(e.clientX, e.clientY))) return

  panning = true
  lastX = e.clientX
  lastY = e.clientY
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
}

function onPointerMove(e: PointerEvent): void {
  if (!panning) return
  const upp = unitsPerPixel()
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY

  // Move the target opposite the cursor so the board appears to follow it.
  // Screen-vertical is foreshortened on the board plane by cos(tilt), hence the
  // divide — without it, vertical panning drifts against the cursor at any tilt.
  target.x -= dx * upp
  target.z -= (dy * upp) / cosTilt
  clampTarget()
  place()
}

function onPointerUp(): void {
  panning = false
  window.removeEventListener('pointermove', onPointerMove)
}

function onWheel(e: WheelEvent): void {
  e.preventDefault()
  viewHeight = clamp(
    viewHeight * Math.exp(e.deltaY * 0.0012),
    VIEW_HEIGHT_MIN,
    maxViewHeight(),
  )
  applyFrustum()
}

function onContextMenu(e: MouseEvent): void {
  // Right-drag is a pan gesture; the browser menu would interrupt it.
  e.preventDefault()
}

let canvas: HTMLCanvasElement | null = null

onMounted(() => {
  camera.registerCamera(cam, true)
  applyFrustum()

  canvas = canvasEl()
  if (canvas) {
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContextMenu)
  }
})

watch([sizes.width, sizes.height], applyFrustum)

onBeforeUnmount(() => {
  canvas?.removeEventListener('pointerdown', onPointerDown)
  canvas?.removeEventListener('wheel', onWheel)
  canvas?.removeEventListener('contextmenu', onContextMenu)
  window.removeEventListener('pointermove', onPointerMove)
  camera.deregisterCamera(cam)
})
</script>

<template>
  <!-- The camera is registered imperatively above; this group is just a valid root. -->
  <TresGroup />
</template>
