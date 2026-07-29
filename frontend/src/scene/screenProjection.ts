import type { OrthographicCamera } from 'three'

/**
 * Screen pixels ↔ world units, for the board's orthographic top-down camera.
 *
 * Only sound because that camera is orthographic *and* axis-aligned: the mapping from
 * screen to the board plane is then a uniform scale plus a translation, with no
 * perspective term and no rotation. That is what lets the drawer be laid out in pixels
 * and still be drawn by the same camera as the board — recompute its world transform
 * each frame and it stays pinned to the screen while the board pans and zooms beneath.
 *
 * Under a perspective or rotated camera none of this holds, and the drawer would need
 * its own viewport and camera instead (docs/tech-spec.md).
 */

/** World units covered by one screen pixel. */
export function unitsPerPixel(camera: OrthographicCamera, canvasHeight: number): number {
  if (canvasHeight <= 0) return 1
  return (camera.top - camera.bottom) / camera.zoom / canvasHeight
}

/** Inverse of {@link screenToBoard}: where a board-plane point lands on screen. */
export function boardToScreen(
  camera: OrthographicCamera,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  z: number,
): { x: number, y: number } {
  const upp = unitsPerPixel(camera, canvasHeight)
  return {
    x: canvasWidth / 2 + (x - camera.position.x) / upp,
    y: canvasHeight / 2 + (z - camera.position.z) / upp,
  }
}

/**
 * The point on the board plane under a screen position.
 *
 * Screen-down is world +Z: the camera's up vector is `-Z`, so y increasing downward
 * moves into positive Z.
 */
export function screenToBoard(
  camera: OrthographicCamera,
  canvasWidth: number,
  canvasHeight: number,
  screenX: number,
  screenY: number,
): { x: number, z: number } {
  const upp = unitsPerPixel(camera, canvasHeight)
  return {
    x: camera.position.x + (screenX - canvasWidth / 2) * upp,
    z: camera.position.z + (screenY - canvasHeight / 2) * upp,
  }
}
