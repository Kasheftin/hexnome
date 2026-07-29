import type { Object3D, Raycaster } from 'three'

/**
 * Objects that claim a left-press for themselves, so the board does not pan
 * underneath them.
 *
 * Left-drag has two meanings: on a tile it moves the tile, on empty board it pans the
 * view. Something has to decide which, and it cannot be decided by whoever happens to
 * receive the event first — TresJS's own raycast and the camera's canvas listener both
 * fire for the same pointerdown, in an order neither of them controls.
 *
 * So the camera asks this registry directly: raycast the registered objects, and pan
 * only on a miss. Both sides use the same camera and the same pointer position, so
 * they always agree. The board plates are deliberately *not* registered — pressing a
 * plate is how you grab empty board to pan it.
 */

const registry = new Set<Object3D>()

/** Register an object; returns the function to unregister it. */
export function registerGrabbable(object: Object3D): () => void {
  registry.add(object)
  return () => {
    registry.delete(object)
  }
}

/** True if the ray hits any registered object. */
export function hitsGrabbable(raycaster: Raycaster): boolean {
  if (registry.size === 0) return false
  return raycaster.intersectObjects([...registry], true).length > 0
}
