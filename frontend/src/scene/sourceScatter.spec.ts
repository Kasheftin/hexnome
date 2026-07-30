import { describe, expect, it } from 'vitest'
import { MIN_TILE_CLEARANCE, SOURCE_HEAP_SPAN, sourceScatter } from './sourceScatter'

/**
 * Offsets come out in tile-radii, so a tile is a hexagon of circumradius 1 centred on its offset.
 *
 * These are property tests over many seeds rather than pinned values. The pinned-value approach would
 * say "this is what lot 3 of that game looks like", which is not the thing that must hold — what must
 * hold is that no arrangement the generator can produce ever overlaps.
 */
const SEEDS = Array.from({ length: 300 }, (_, i) => `game-${i}`)

function distance(a: { x: number, z: number }, b: { x: number, z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

describe('a heap never overlaps itself', () => {
  it('keeps every pair at least a clear tile apart, over many lots', () => {
    let worst = Infinity
    for (const seed of SEEDS) {
      for (let lot = 0; lot < 6; lot++) {
        const offsets = sourceScatter(seed, lot)
        for (let i = 0; i < offsets.length; i++) {
          for (let j = i + 1; j < offsets.length; j++) {
            const d = distance(offsets[i] as never, offsets[j] as never)
            worst = Math.min(worst, d)
          }
        }
      }
    }
    // Two identical hexagons of circumradius 1 cannot overlap once their centres are 2 apart, in any
    // direction. This is the whole guarantee.
    expect(worst).toBeGreaterThanOrEqual(MIN_TILE_CLEARANCE)
  })

  it('stays inside the room the renderer reserves for it', () => {
    let furthest = 0
    for (const seed of SEEDS) {
      const offsets = sourceScatter(seed, 0)
      for (const offset of offsets) {
        // Plus 1 for the tile's own radius: this is the heap's outer edge, not its centres.
        furthest = Math.max(furthest, Math.hypot(offset.x, offset.z) + 1)
      }
    }
    expect(furthest).toBeLessThanOrEqual(SOURCE_HEAP_SPAN / 2 + 1e-9)
  })
})

describe('a heap still varies', () => {
  it('presents its tiles at different bearings in different lots', () => {
    // Guaranteed clearance came at the cost of per-tile jitter, so the per-lot ring rotation is now
    // the only thing making lots look unalike. If it ever stopped working every lot would be identical,
    // which is exactly the kind of regression that is easy to miss on screen.
    const bearings = new Set(
      Array.from({ length: 6 }, (_, lot) => {
        const first = sourceScatter('a-fixed-game', lot)[0]
        return first ? Math.round(Math.atan2(first.z, first.x) * 100) : 0
      }),
    )
    expect(bearings.size).toBe(6)
  })

  it('is identical for the same game and lot', () => {
    expect(sourceScatter('same', 2)).toEqual(sourceScatter('same', 2))
  })

  it('differs between games', () => {
    expect(sourceScatter('one', 0)).not.toEqual(sourceScatter('two', 0))
  })
})
