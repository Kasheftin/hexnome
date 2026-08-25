import { Plane, Vector3 } from 'three'
import { ref, type Ref } from 'vue'

/**
 * The seam between the source column's scrollbar and the column itself.
 *
 * The scrollbar is a real DOM element and the column is drawn in WebGL, and they live on opposite
 * sides of `<TresCanvas>` — the layout is computed inside the Tres context, which only components
 * *within* the canvas can reach. So the two halves meet here rather than by one calling the other.
 *
 * Each direction has exactly one writer, which is what keeps the bar and the lots from drifting apart:
 *
 * - the **scene** owns the geometry and publishes {@link columnRect}, because it is the half that
 *   already computes the layout every frame;
 * - the **container** owns the gesture and publishes {@link scrollTop}, because it is the half the
 *   browser hands scroll events to.
 *
 * Neither ever writes the other's value. A module-level pair rather than a provide/inject, following
 * `grabbables.ts`: the two components are not related in the tree, and threading a ref down through
 * the canvas boundary to join them would be ceremony around a single number.
 */

/**
 * How far the column is scrolled, in screen pixels.
 *
 * Read straight off a real element's `scrollTop`, so momentum, rubber-banding and the scrollbar's own
 * drag all come from the browser. Passed to `createSourceLayout`, which clamps it — the element and
 * the layout can briefly disagree during a resize, and the layout's answer is the one that renders.
 */
export const scrollTop: Ref<number> = ref(0)

/** Where the column is and how much taller its contents are, for the container to match itself to. */
export interface ColumnRect {
  readonly left: number
  readonly top: number
  readonly width: number
  /** The panel's height on screen — what the container's viewport must be. */
  readonly height: number
  /** The lots' full height, which is what gives the container something to scroll. */
  readonly contentHeight: number
  /**
   * Enough to place a snap marker per lot: one at `pitch * n`.
   *
   * Deliberately measured from zero rather than from the panel's padding. Putting the first marker at
   * the padding looks right — it lands lot 0 flush with the top edge — but it makes a scroll of zero
   * unreachable, so the column can never rest at its own natural top. From zero, every lot comes to
   * rest at exactly the position lot 0 has when the column has not been scrolled at all.
   *
   * Two numbers rather than a ready-made array of offsets, so the seam has nothing to allocate: it is
   * republished whenever the layout changes, and an array would be garbage on every resize frame.
   */
  readonly lotCount: number
  readonly pitch: number
}

/** Null until the scene has drawn once, and again after it unmounts. */
export const columnRect: Ref<ColumnRect | null> = ref(null)

/**
 * The scrolling element, while one exists.
 *
 * `TableauView` binds its picker to this as well as to the canvas, because the container covers the
 * column and receives the presses that would otherwise reach the canvas underneath — without that, the
 * lots would be visible but dead.
 *
 * A ref rather than a lookup: the container only exists while the lots overflow, so it comes and goes
 * with the window size and there is no moment at which querying for it would be reliable.
 */
export const scrollElement: Ref<HTMLElement | null> = ref(null)

/**
 * The band the column occupies, as world-space clipping planes — what hides the scrolled-out lots.
 *
 * Sound only because the board camera is orthographic and axis-aligned, so screen-down is world `+Z`
 * and the panel's top and bottom edges are two planes of constant Z (scene/screenProjection.ts). Under
 * a rotated or perspective camera these would not be planes at all.
 *
 * **One array, shared by every material that needs clipping** — the lots' pieces and the column's own
 * bays. The `Plane` objects are mutated in place by {@link updateSourceClip} rather than replaced, so
 * every material sees the current band without being reassigned, and it does not matter which
 * component updates them first: the renderer reads them when it draws, which is after all of that.
 *
 * three.js keeps a fragment where `normal · point + constant > 0`, so these two say `z >= top` and
 * `z <= bottom`.
 */
export const sourceClipPlanes: readonly Plane[] = [
  new Plane(new Vector3(0, 0, 1), 0),
  new Plane(new Vector3(0, 0, -1), 0),
]

/** Point the planes at the column's current top and bottom edges, in world Z. */
export function updateSourceClip(zTop: number, zBottom: number): void {
  // `constant` is the negated offset along the normal: `z - zTop > 0` and `zBottom - z > 0`.
  sourceClipPlanes[0]?.set(sourceClipPlanes[0].normal, -zTop)
  sourceClipPlanes[1]?.set(sourceClipPlanes[1].normal, zBottom)
}

/**
 * Forget the column, on leaving the game.
 *
 * Both values are module state, so without this a second game would open with the previous one's
 * scroll position and briefly place its lots against a stale rectangle.
 */
export function resetSourceScroll(): void {
  scrollTop.value = 0
  columnRect.value = null
}
