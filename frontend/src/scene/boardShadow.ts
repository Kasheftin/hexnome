import { Vector2 } from 'three'

/**
 * The blob shadow the floating object casts on the board, written by whatever is
 * hovering and read by the floor shader.
 *
 * Deliberately a plain mutable object, not a Pinia store or a `ref`. It changes
 * every frame and is consumed inside the render loop; routing 60 updates a
 * second through Vue's reactivity would be pure overhead, and nothing outside
 * the render loop needs to observe it.
 *
 * Once real tiles cast real shadows this goes away — it is a cheap stand-in that
 * makes "floating above the board" legible without a shadow map.
 */
export const boardShadow = {
  center: new Vector2(0, 0),
  radius: 1.2,
  strength: 0.55,
}
