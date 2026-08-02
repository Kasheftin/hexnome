import { describe, expect, it } from 'vitest'
import {
  axialDistance,
  axialEquals,
  axialKey,
  axialToWorld,
  distanceToCellEdge,
  hexApothem,
  hexSpacing,
  neighbors,
  worldToAxial,
  worldToAxialFraction,
  type Axial,
  type Point2,
  boundsOfCells,
  compareCellsInReadingOrder,
  hexRectangle,
} from './hex'

/** Deterministic PRNG, so a failure is always reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const SIZE = 1.3

function dist(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

describe('axialToWorld', () => {
  it('puts the origin cell at the world origin', () => {
    expect(axialToWorld({ q: 0, r: 0 }, SIZE)).toEqual({ x: 0, z: 0 })
  })

  it('places the east neighbour along +X at one spacing', () => {
    const p = axialToWorld({ q: 1, r: 0 }, SIZE)
    expect(p.x).toBeCloseTo(hexSpacing(SIZE), 12)
    expect(p.z).toBeCloseTo(0, 12)
  })

  it('puts every neighbour of the origin exactly one spacing away', () => {
    const origin = axialToWorld({ q: 0, r: 0 }, SIZE)
    for (const n of neighbors({ q: 0, r: 0 })) {
      expect(dist(axialToWorld(n, SIZE), origin)).toBeCloseTo(hexSpacing(SIZE), 12)
    }
  })

  it('scales linearly with size', () => {
    const a = axialToWorld({ q: 3, r: -2 }, 1)
    const b = axialToWorld({ q: 3, r: -2 }, 2)
    expect(b.x).toBeCloseTo(a.x * 2, 12)
    expect(b.z).toBeCloseTo(a.z * 2, 12)
  })
})

describe('neighbors', () => {
  it('returns six distinct cells', () => {
    const ns = neighbors({ q: 4, r: -7 })
    expect(ns).toHaveLength(6)
    expect(new Set(ns.map(axialKey)).size).toBe(6)
  })

  it('returns cells all at axial distance 1', () => {
    const h: Axial = { q: 4, r: -7 }
    for (const n of neighbors(h)) {
      expect(axialDistance(h, n)).toBe(1)
    }
  })

  it('is symmetric — each neighbour has the original as a neighbour', () => {
    const h: Axial = { q: 2, r: 5 }
    for (const n of neighbors(h)) {
      expect(neighbors(n).some(m => axialEquals(m, h))).toBe(true)
    }
  })
})

describe('worldToAxialFraction', () => {
  it('inverts axialToWorld exactly for integer cells', () => {
    for (let q = -6; q <= 6; q++) {
      for (let r = -6; r <= 6; r++) {
        const f = worldToAxialFraction(axialToWorld({ q, r }, SIZE), SIZE)
        expect(f.q).toBeCloseTo(q, 10)
        expect(f.r).toBeCloseTo(r, 10)
      }
    }
  })
})

describe('worldToAxial', () => {
  it('round-trips every cell centre in a large patch', () => {
    for (let q = -20; q <= 20; q++) {
      for (let r = -20; r <= 20; r++) {
        const back = worldToAxial(axialToWorld({ q, r }, SIZE), SIZE)
        expect(axialKey(back)).toBe(axialKey({ q, r }))
      }
    }
  })

  it('returns the genuinely nearest cell centre, brute-force checked', () => {
    // This is the test that matters. Independent q/r rounding passes the
    // round-trip test above and fails this one near cell corners.
    const rand = lcg(20260728)
    const candidates: Axial[] = []
    for (let q = -14; q <= 14; q++) {
      for (let r = -14; r <= 14; r++) candidates.push({ q, r })
    }

    for (let i = 0; i < 4000; i++) {
      const p: Point2 = {
        x: (rand() - 0.5) * 20 * SIZE,
        z: (rand() - 0.5) * 20 * SIZE,
      }
      const got = worldToAxial(p, SIZE)

      let best = candidates[0] as Axial
      let bestD = Infinity
      for (const c of candidates) {
        const d = dist(p, axialToWorld(c, SIZE))
        if (d < bestD) {
          bestD = d
          best = c
        }
      }

      // Ties on an exact edge are legitimate; only flag a real mismatch.
      const gotD = dist(p, axialToWorld(got, SIZE))
      expect(
        gotD - bestD,
        `point (${p.x}, ${p.z}) resolved to ${axialKey(got)}, nearest is ${axialKey(best)}`,
      ).toBeLessThan(1e-9)
    }
  })

  it('maps points just inside each edge to the current cell', () => {
    const h: Axial = { q: 2, r: -3 }
    const c = axialToWorld(h, SIZE)
    const a = hexApothem(SIZE)
    for (let k = 0; k < 6; k++) {
      const ang = (k * Math.PI) / 3
      const p: Point2 = {
        x: c.x + Math.cos(ang) * a * 0.98,
        z: c.z + Math.sin(ang) * a * 0.98,
      }
      expect(axialKey(worldToAxial(p, SIZE))).toBe(axialKey(h))
    }
  })

  it('maps points just outside each edge to the neighbouring cell', () => {
    const h: Axial = { q: 2, r: -3 }
    const c = axialToWorld(h, SIZE)
    const a = hexApothem(SIZE)
    for (let k = 0; k < 6; k++) {
      const ang = (k * Math.PI) / 3
      const p: Point2 = {
        x: c.x + Math.cos(ang) * a * 1.02,
        z: c.z + Math.sin(ang) * a * 1.02,
      }
      const got = worldToAxial(p, SIZE)
      expect(axialKey(got)).not.toBe(axialKey(h))
      expect(axialDistance(got, h)).toBe(1)
    }
  })
})

describe('distanceToCellEdge', () => {
  it('is the apothem at a cell centre', () => {
    const c = axialToWorld({ q: -2, r: 4 }, SIZE)
    expect(distanceToCellEdge(c, SIZE)).toBeCloseTo(hexApothem(SIZE), 10)
  })

  it('is ~zero on an edge midpoint', () => {
    const c = axialToWorld({ q: 1, r: 1 }, SIZE)
    const a = hexApothem(SIZE)
    for (let k = 0; k < 6; k++) {
      const ang = (k * Math.PI) / 3
      const p: Point2 = { x: c.x + Math.cos(ang) * a, z: c.z + Math.sin(ang) * a }
      expect(Math.abs(distanceToCellEdge(p, SIZE))).toBeLessThan(1e-9)
    }
  })

  it('is never negative and never exceeds the apothem', () => {
    const rand = lcg(99)
    const a = hexApothem(SIZE)
    for (let i = 0; i < 5000; i++) {
      const d = distanceToCellEdge(
        { x: (rand() - 0.5) * 40, z: (rand() - 0.5) * 40 },
        SIZE,
      )
      expect(d).toBeGreaterThanOrEqual(-1e-9)
      expect(d).toBeLessThanOrEqual(a + 1e-9)
    }
  })
})

describe('boundsOfCells', () => {
  it('is a degenerate box for no cells at all', () => {
    expect(boundsOfCells([], 1)).toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 })
  })

  /* Whole hexagons, not centres — a frame drawn to the centres would clip every edge cell in half. */
  it('covers a single cell\'s full extent, not just its centre', () => {
    const size = 2
    const bounds = boundsOfCells([{ q: 0, r: 0 }], size)
    expect(bounds.maxX - bounds.minX).toBeCloseTo(hexApothem(size) * 2)
    expect(bounds.maxZ - bounds.minZ).toBeCloseTo(size * 2)
  })

  it('encloses every cell it is given', () => {
    const cells = hexRectangle(2, 2)
    const bounds = boundsOfCells(cells, 1)
    for (const cell of cells) {
      const { x, z } = axialToWorld(cell, 1)
      expect(x).toBeGreaterThanOrEqual(bounds.minX)
      expect(x).toBeLessThanOrEqual(bounds.maxX)
      expect(z).toBeGreaterThanOrEqual(bounds.minZ)
      expect(z).toBeLessThanOrEqual(bounds.maxZ)
    }
  })

  it('grows when a cell is added outside it', () => {
    const one = boundsOfCells([{ q: 0, r: 0 }], 1)
    const two = boundsOfCells([{ q: 0, r: 0 }, { q: 3, r: 0 }], 1)
    expect(two.maxX).toBeGreaterThan(one.maxX)
    expect(two.minX).toBeCloseTo(one.minX)
  })
})

describe('compareCellsInReadingOrder', () => {
  it('puts an earlier row first, whatever the column', () => {
    expect(compareCellsInReadingOrder({ q: 9, r: 0 }, { q: 0, r: 1 })).toBeLessThan(0)
  })

  it('orders left to right within a row', () => {
    expect(compareCellsInReadingOrder({ q: 0, r: 2 }, { q: 1, r: 2 })).toBeLessThan(0)
  })

  it('is zero for the same cell, so a sort using it is stable', () => {
    expect(compareCellsInReadingOrder({ q: 1, r: 2 }, { q: 1, r: 2 })).toBe(0)
  })

  it('sorts a scrambled set into rows', () => {
    const sorted = [{ q: 1, r: 1 }, { q: 0, r: 0 }, { q: 0, r: 1 }, { q: 2, r: 0 }]
      .sort(compareCellsInReadingOrder)
    expect(sorted).toEqual([{ q: 0, r: 0 }, { q: 2, r: 0 }, { q: 0, r: 1 }, { q: 1, r: 1 }])
  })
})
