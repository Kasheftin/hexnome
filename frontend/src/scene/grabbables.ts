import type { Object3D, Raycaster } from 'three'

/**
 * Objects that claim a left-press for themselves, so the board does not pan underneath them.
 *
 * Left-drag has two meanings: on something you can pick up it moves that thing, on the board it pans
 * the view. Something has to decide which, and it cannot be decided by whoever happens to receive the
 * event first — TresJS's own raycast and the camera's canvas listener both fire for the same
 * pointerdown, in an order neither of them controls.
 *
 * So the camera asks this registry directly: raycast what is registered, and pan only on a miss. Both
 * sides use the same camera and the same pointer position, so they always agree.
 *
 * ## Registered *with a question*, not as a fact
 *
 * Whether an object wants the press is not settled when it is created — it depends on where the object
 * has since moved and what the turn is doing. A tile is a thing to pick up while it is in your drawer
 * and scenery once it is placed and paid for; the same mesh is both, minutes apart.
 *
 * So a caller registers a **predicate**, consulted at press time. Registering "yes, always" was what
 * made the whole board refuse to pan: every plate and tile ever placed went on claiming presses long
 * after the rules had stopped letting anyone move them, and the board could only be dragged by its
 * gaps. Panels register with no predicate and are simply always live — a tray is furniture, and
 * pressing furniture is never a pan.
 */

const registry = new Map<Object3D, () => boolean>()

const ALWAYS = (): boolean => true

/**
 * Register an object; returns the function to unregister it.
 *
 * @param live asked on every press. Omit for something that always claims one.
 */
export function registerGrabbable(object: Object3D, live: () => boolean = ALWAYS): () => void {
  registry.set(object, live)
  return () => {
    registry.delete(object)
  }
}

/** True if the ray hits anything that currently wants the press. */
export function hitsGrabbable(raycaster: Raycaster): boolean {
  if (registry.size === 0) return false
  const live: Object3D[] = []
  for (const [object, wants] of registry) {
    if (wants()) live.push(object)
  }
  if (live.length === 0) return false
  return raycaster.intersectObjects(live, true).length > 0
}
