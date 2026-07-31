import { ExtrudeGeometry, Shape, type BufferGeometry } from 'three'
import { axialToWorld } from '@/game/hex'
import { plateCells } from '@/game/plate'

/**
 * The plate's body: a thin slab in the shape of the whole flower, for the seven sockets to
 * sit on. Without it a plate is seven unconnected hexes floating on the board.
 *
 * The outline is **computed, not hardcoded**: take the seven cells' hexagons, keep the edges
 * used by exactly one of them, and chain those into a loop. That yields the union's boundary
 * — an 18-sided polygon — and it stays correct if the plate's footprint ever changes.
 *
 * Two facts worth having checked rather than assumed: every boundary vertex has exactly two
 * boundary edges (so the chain is a single closed loop, not several), and the extents come
 * out at `√7 ≈ 2.646` for a petal's far corners and `2.0` for the notches between petals.
 * A petal presents a *flat side* outward, not a vertex — so the reach is not `√3 + 1`.
 */

type Point = readonly [number, number]

function signedArea(polygon: readonly Point[]): number {
  let total = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Point
    const b = polygon[(i + 1) % polygon.length] as Point
    total += a[0] * b[1] - b[0] * a[1]
  }
  return total / 2
}

/**
 * Shrink a polygon by moving every edge inward by `margin`, then mitering the corners.
 *
 * **Not the same as scaling it.** Scaling about the centre moves the *vertices* by a factor,
 * which shifts each edge by an amount proportional to its distance from the centre — so a
 * feature near the middle barely moves while an outer one moves a lot. On this flower a
 * uniform 0.97 scale left the petal sockets with a rim of 0.0087 where the geometry wants
 * 0.087, a tenfold difference: the sockets ended up flush against the slab's edge while a
 * wide margin remained on the inside, which is what read as untidy. Offsetting each edge by a
 * constant distance keeps every socket concentric with its lobe — measured rim spread across
 * the six petals is 0.
 */
export function insetPolygon(polygon: readonly Point[], margin: number): Point[] {
  const n = polygon.length
  if (n < 3 || margin === 0) return [...polygon]
  const sign = signedArea(polygon) > 0 ? 1 : -1

  /** Each edge, shifted inward: a point on the offset line plus its unit direction. */
  const lines = polygon.map((_, i) => {
    const a = polygon[i] as Point
    const b = polygon[(i + 1) % n] as Point
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const dx = (b[0] - a[0]) / length
    const dy = (b[1] - a[1]) / length
    // Inward normal, oriented by the polygon's winding.
    return { px: a[0] - dy * sign * margin, py: a[1] + dx * sign * margin, dx, dy }
  })

  return polygon.map((_, i) => {
    const first = lines[(i - 1 + n) % n]
    const second = lines[i]
    if (!first || !second) return polygon[i] as Point
    const denominator = first.dx * second.dy - first.dy * second.dx
    if (Math.abs(denominator) < 1e-9) {
      // Collinear edges: the two offset lines coincide, so either point will do.
      return [second.px, second.py] as Point
    }
    const t = ((second.px - first.px) * second.dy - (second.py - first.py) * second.dx) / denominator
    return [first.px + first.dx * t, first.py + first.dy * t] as Point
  })
}

/** The boundary of the seven-hex union, in world-plane (x, z), ordered around the loop. */
export function flowerOutline(size: number): Point[] {
  const centres = plateCells({ q: 0, r: 0 }).map(cell => axialToWorld(cell, size))
  const corners: Point[] = Array.from({ length: 6 }, (_, k) => {
    const angle = (Math.PI / 180) * (90 + k * 60)
    return [Math.cos(angle) * size, Math.sin(angle) * size]
  })

  // Quantised, so corners shared between hexes compare equal despite float error.
  const key = (p: Point): string => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`

  const edges = new Map<string, { a: Point, b: Point, count: number }>()
  for (const centre of centres) {
    for (let k = 0; k < 6; k++) {
      const from = corners[k] as Point
      const to = corners[(k + 1) % 6] as Point
      const a: Point = [centre.x + from[0], centre.z + from[1]]
      const b: Point = [centre.x + to[0], centre.z + to[1]]
      const id = [key(a), key(b)].sort().join('|')
      const existing = edges.get(id)
      if (existing) existing.count++
      else edges.set(id, { a, b, count: 1 })
    }
  }

  // An edge shared by two hexes is interior; one used once is on the boundary.
  const boundary = [...edges.values()].filter(edge => edge.count === 1)

  const neighbours = new Map<string, Point[]>()
  for (const edge of boundary) {
    for (const [p, q] of [[edge.a, edge.b], [edge.b, edge.a]] as const) {
      const list = neighbours.get(key(p))
      if (list) list.push(q)
      else neighbours.set(key(p), [q])
    }
  }

  const start = boundary[0]?.a
  if (!start) return []

  const loop: Point[] = []
  let previous: Point | null = null
  let current: Point = start
  do {
    loop.push(current)
    const options = neighbours.get(key(current)) ?? []
    const next = previous && options[0] && key(options[0]) === key(previous)
      ? options[1]
      : options[0]
    if (!next) break
    previous = current
    current = next
  } while (key(current) !== key(start) && loop.length < 64)

  return loop
}

export function createPlateBaseGeometry({
  size,
  thickness,
  bevel,
  /** Inward edge offset, so neighbouring plates leave a hairline between them. */
  margin,
}: {
  size: number
  thickness: number
  bevel: number
  margin: number
}): BufferGeometry {
  const outline = insetPolygon(flowerOutline(size), margin)
  const shape = new Shape()
  outline.forEach(([x, z], index) => {
    // Built in XY and rotated into XZ below. Negating z makes that rotation land the shape
    // back on its original orientation rather than mirrored — the flower happens to be
    // symmetric about z, but relying on that would be a trap for any other footprint.
    const px = x
    const py = -z
    if (index === 0) shape.moveTo(px, py)
    else shape.lineTo(px, py)
  })
  shape.closePath()

  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    // The outline is straight segments; there are no curves to subdivide.
    curveSegments: 1,
  })

  geometry.rotateX(-Math.PI / 2)
  // The bevel extends the solid to [-bevel, depth + bevel]; shift it to sit on [0, thickness]
  // so the plate's local origin is the underside of the slab.
  geometry.translate(0, bevel, 0)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}
