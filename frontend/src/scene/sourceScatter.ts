import { createRandom } from '@/game/random'
import { SOURCE_TILES_PER_LOT } from './constants'

/**
 * Where a lot's loose tiles lie on its face-down plate.
 *
 * The tiles are heaped on the plate rather than seated in its petals, so they need positions that
 * look tossed rather than arranged. "Looks tossed" and "comes back the same after a refresh" pull in
 * opposite directions unless the randomness is seeded — so it is, from the game id, through the same
 * generator that deals the deck (`game/random.ts`).
 *
 * **Keyed on the lot's plate, not its slot.** The source is a stack: when a fresh lot is pushed on top,
 * every older lot shifts down a slot. Keyed on the slot, each of them would silently re-scatter as it
 * moved — every heap in the column rearranging itself because one new lot arrived, which reads as a
 * glitch rather than as a shift. Keyed on the plate, a heap keeps the arrangement it was dealt for as
 * long as it exists.
 *
 * Offsets are in **units of the tile's own circumradius**, not world units. The caller multiplies by
 * whatever radius it is drawing tiles at, so the heap keeps its shape whether the tiles are at drawer
 * size or shrunk to fit a small lot.
 */

export interface ScatterOffset {
  readonly x: number
  readonly z: number
  /** Draw order within the heap. Lower sits nearer the plate. */
  readonly layer: number
}

/**
 * Ring radius for the heap, **in units of the tile's own circumradius**.
 *
 * Measuring in tile-radii rather than in board units is what lets the arrangement keep its
 * proportions at any tile size — the loose tiles are drawn at drawer size, not at their lot's plate
 * scale, so a band fixed in board units would spread correctly at one size and clump at every other.
 *
 * ## Why the floor is 1.45, and why there is no angular jitter
 *
 * Two identical hexagons are centrally symmetric, so they overlap unless the offset between their
 * centres lies outside a hexagon of twice the circumradius. That boundary runs from `√3 ≈ 1.73` in the
 * flat direction to `2` at the vertices — so **2 radii of separation is safe in every direction**,
 * whatever the tiles' relative bearing.
 *
 * Four tiles a quarter-turn apart at radius `r` are `r√2` apart, so `r√2 ≥ 2` gives `r ≥ √2 ≈ 1.414`.
 * 1.45 clears that with margin.
 *
 * Angular jitter is what had to go. Nudging two neighbours towards each other narrows their gap below
 * a quarter-turn, and the radius needed to stay clear grows as `1 / sin(gap / 2)` — even ±8° pushes it
 * past 1.66, which costs enough lot height to shrink the tiles noticeably. The per-lot ring rotation
 * below gives the variety instead, at no cost in space.
 *
 * Radial jitter is free, though, and that is not a coincidence: separation is `√(r₁² + r₂²)`, which is
 * smallest when both sit at the floor. Jitter can only push them further apart.
 */
const RADIUS_MIN = 1.45
const RADIUS_MAX = 1.55

/**
 * How much room a heap needs, as a multiple of the tile's circumradius.
 *
 * The furthest tile reaches `RADIUS_MAX + 1` radii from the centre — its own radius beyond its centre —
 * and the ring is symmetric, so it spans twice that. Height is the binding dimension: a pointy-top
 * hexagon is taller than it is wide, and a lot is very slightly wider than tall.
 *
 * Exported because the renderer needs it to decide when a tile must be shrunk below drawer size to keep
 * the heap on its plate. Derived rather than written twice, so widening the band above cannot silently
 * let heaps overflow.
 */
export const SOURCE_HEAP_SPAN = 2 * (RADIUS_MAX + 1)

/** Centre separation, in tile-radii, below which two tiles could overlap in some direction. */
export const MIN_TILE_CLEARANCE = 2

/**
 * The four positions never overlap, by construction: one per equal sector at a radius that guarantees
 * clearance in every direction (see RADIUS_MIN). What varies per lot is the rotation of the whole
 * ring, so no two lots present their tiles at the same bearings.
 *
 * An earlier version jittered each tile within its sector. It looked more casually tossed and the
 * tiles overlapped badly — enough that a selected tile's outline was cut by whichever neighbour was
 * heaped over it. Guaranteed clearance is worth more than the scatter.
 */
export function sourceScatter(
  gameId: string,
  /** Stable identity for the heap — its plate's id. Not the slot, which changes as the stack shifts. */
  heapKey: string,
  count = SOURCE_TILES_PER_LOT,
): ScatterOffset[] {
  const rng = createRandom(`${gameId}:scatter:${heapKey}`)
  const sector = (2 * Math.PI) / count
  // The whole ring is turned once per lot, so the heaps do not all form the same cross.
  const ringRotation = rng() * 2 * Math.PI
  const out: ScatterOffset[] = []

  for (let index = 0; index < count; index++) {
    // Exactly one tile per sector, on the sector's bisector. The spacing is what guarantees the
    // tiles never overlap, so it is not something to randomise.
    const angle = ringRotation + sector * (index + 0.5)
    const radius = RADIUS_MIN + rng() * (RADIUS_MAX - RADIUS_MIN)
    out.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      layer: index,
    })
  }

  return out
}
