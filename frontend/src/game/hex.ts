/**
 * Pointy-top hexagonal grid maths in axial coordinates.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * The board lies in the world XZ plane; Y is up. A hex's `size` is its
 * circumradius (centre to vertex).
 */

export const SQRT3 = Math.sqrt(3)

export interface Axial {
  readonly q: number
  readonly r: number
}

/** An axial coordinate before rounding to a cell. */
export interface AxialFraction {
  readonly q: number
  readonly r: number
}

/** A point on the board plane. `z` is the world Z axis. */
export interface Point2 {
  readonly x: number
  readonly z: number
}

/**
 * The six neighbour directions, counter-clockwise from east.
 *
 * A pointy-top hex has flat sides facing ±X, so the east neighbour shares a
 * flat edge and sits `size * √3` away.
 */
export const NEIGHBOR_DIRS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

/** Centre-to-centre distance between neighbouring cells. */
export function hexSpacing(size: number): number {
  return size * SQRT3
}

/**
 * The inradius — centre to the middle of an edge. Half the spacing.
 *
 * The grid shader uses this as the distance from a cell centre to its boundary
 * along an edge normal.
 */
export function hexApothem(size: number): number {
  return (size * SQRT3) / 2
}

export function axialAdd(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r }
}

export function axialEquals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r
}

/** A stable string key, for Map and Set use. */
export function axialKey(h: Axial): string {
  return `${h.q},${h.r}`
}

/** Number of steps between two cells. */
export function axialDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2
}

export function neighbors(h: Axial): Axial[] {
  return NEIGHBOR_DIRS.map(d => axialAdd(h, d))
}

/**
 * Every cell within `radius` steps of the origin, in reading order.
 *
 * Count is `3r² + 3r + 1` — 169 cells at radius 7.
 */
export function hexDisc(radius: number): Axial[] {
  const out: Axial[] = []
  for (let q = -radius; q <= radius; q++) {
    const lo = Math.max(-radius, -q - radius)
    const hi = Math.min(radius, -q + radius)
    for (let r = lo; r <= hi; r++) out.push({ q, r })
  }
  return out
}

/**
 * Cells filling a **rectangle** in world space, centred on the origin.
 *
 * `halfCols` is measured in column widths (`√3·size`) and `halfRows` in row pitches
 * (`1.5·size`), so `hexRectangle(20, 20)` reaches 20 cells in every direction and
 * comes to 1661 cells: 21 rows of 41 and 20 of 40, since offset rows alternate length.
 *
 * The per-row `-r/2` offset is the whole trick. World x is `size·√3·(q + r/2)`, so
 * iterating a fixed `q` range would slide each row half a cell sideways and produce a
 * rhombus. Offsetting `q` by `-r/2` re-centres every row on x = 0, which is what makes
 * the block rectangular.
 */
export function hexRectangle(halfCols: number, halfRows: number): Axial[] {
  const out: Axial[] = []
  for (let r = -halfRows; r <= halfRows; r++) {
    const shift = -r / 2
    const qMin = Math.ceil(-halfCols + shift)
    const qMax = Math.floor(halfCols + shift)
    for (let q = qMin; q <= qMax; q++) out.push({ q, r })
  }
  return out
}

export interface WorldBounds {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
}

/** World extent of the cell centres in {@link hexRectangle}. */
export function hexRectangleBounds(
  halfCols: number,
  halfRows: number,
  size: number,
): WorldBounds {
  const x = halfCols * SQRT3 * size
  const z = halfRows * 1.5 * size
  return { minX: -x, maxX: x, minZ: -z, maxZ: z }
}

/** Shrink bounds by a whole number of cells on every side. */
export function insetBounds(
  bounds: WorldBounds,
  cells: number,
  size: number,
): WorldBounds {
  const x = cells * SQRT3 * size
  const z = cells * 1.5 * size
  return {
    minX: bounds.minX + x,
    maxX: bounds.maxX - x,
    minZ: bounds.minZ + z,
    maxZ: bounds.maxZ - z,
  }
}

/**
 * A stable pseudo-random number in [0, 1) for a cell.
 *
 * Used to pick which plate variant a cell gets and to jitter its tint. Position-
 * derived rather than random so the board looks identical on every reload — a
 * board that reshuffles its texture variants on refresh reads as a bug.
 */
export function axialHash(h: Axial): number {
  let n = Math.imul(h.q, 0x27d4eb2d) ^ Math.imul(h.r, 0x165667b1)
  n = Math.imul(n ^ (n >>> 15), 0x2545f491)
  return ((n ^ (n >>> 16)) >>> 0) / 0x100000000
}

/** Cell centre in world coordinates. */
export function axialToWorld(h: Axial, size: number): Point2 {
  return {
    x: size * SQRT3 * (h.q + h.r / 2),
    z: size * 1.5 * h.r,
  }
}

/** Inverse of {@link axialToWorld}, before rounding. */
export function worldToAxialFraction(p: Point2, size: number): AxialFraction {
  return {
    q: (SQRT3 * p.x - p.z) / (3 * size),
    r: (2 * p.z) / (3 * size),
  }
}

/**
 * Round a fractional axial coordinate to the nearest cell.
 *
 * Rounds in cube space and discards the component that moved furthest, which is
 * what keeps the result inside the correct hexagon. Rounding q and r
 * independently does not — it produces a rhombus, and the error shows up as
 * misplaced tiles near cell corners.
 */
export function axialRound(f: AxialFraction): Axial {
  const x = f.q
  const z = f.r
  const y = -x - z

  let rx = Math.round(x)
  let ry = Math.round(y)
  let rz = Math.round(z)

  const dx = Math.abs(rx - x)
  const dy = Math.abs(ry - y)
  const dz = Math.abs(rz - z)

  if (dx > dy && dx > dz) {
    rx = -ry - rz
  } else if (dy > dz) {
    ry = -rx - rz
  } else {
    rz = -rx - ry
  }

  return { q: rx, r: rz }
}

/** The cell containing a world-space point. */
export function worldToAxial(p: Point2, size: number): Axial {
  return axialRound(worldToAxialFraction(p, size))
}

/**
 * Signed distance from a point to the boundary of the cell containing it:
 * positive inside, zero on an edge.
 *
 * Mirrored in the grid shader (see scene/HexGridFloor.vue). The two must change
 * together — GLSL cannot import this module, so the duplication is real and the
 * tests here are the only thing pinning the shape down.
 */
export function distanceToCellEdge(p: Point2, size: number): number {
  const cell = worldToAxial(p, size)
  const c = axialToWorld(cell, size)
  const vx = p.x - c.x
  const vz = p.z - c.z

  // Edge normals of a pointy-top hex point at the neighbours: 0°, +60°, -60°.
  const m = Math.max(
    Math.abs(vx),
    Math.abs(vx * 0.5 + vz * (SQRT3 / 2)),
    Math.abs(vx * 0.5 - vz * (SQRT3 / 2)),
  )

  return hexApothem(size) - m
}
