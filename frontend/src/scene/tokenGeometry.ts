import { BufferAttribute, BufferGeometry } from 'three'

/**
 * A plate's own tile: a pointy-top hexagon with its rim rolled **inward**, so it reads as a tile
 * pressed into the plate rather than one sitting on it.
 *
 * **It is `createTileGeometry`'s rim, mirrored.** A loose tile is convex — a quarter circle sweeping
 * from its flat top out and down to its side wall, normals turning up-and-outward. This is the cavity
 * that tile would leave: the same quarter circle the other way, from the flat face out and *up* to the
 * rim, normals turning up-and-inward. Convex and concave under one light are opposites — where a tile
 * catches its highlight, a token darkens — which is what makes the two impossible to confuse even
 * though their silhouettes are identical.
 *
 * That inversion is also the whole visual argument. A token is *part of the plate*, not a piece on it,
 * and it was flat before precisely to say so; flat said it by having no rim at all, which left the
 * token's edge as a bare colour step — one shade meeting another along a hard 60° diagonal with only
 * the sampler to soften it. A rim that turns the wrong way says the same thing better: no player will
 * read a hollow as a loose piece.
 *
 * **The rim rises rather than the face sinking.** A cavity wants the face below the plate's surface,
 * and there is nowhere to put it — the socket mark it sits on is 0.012 beneath it and would simply
 * cover it up. At `BOARD_TILT_DEG = 0` the two are the same picture: a top-down orthographic camera
 * turns depth into draw order and nothing else, so all that reaches the screen is the rim's shading.
 * If a tilt ever comes back this is the thing to revisit.
 *
 * The origin stays on the **face**, so `PLATE_TOKEN_LIFT` still means what it says and the rim is what
 * moved. The symbol has to clear it — see `tileFaceY` in TableauView.
 */
export function createTokenGeometry({
  /** Circumradius of the finished hexagon, matching the loose tile it stands in for. */
  circumradius,
  /** How far in from the silhouette the rim rolls, as `TILE_BEVEL` is for a tile. */
  rim,
  /** How far the rim stands above the face. */
  depth,
  /** Steps across the rim. Four is already a smooth sweep at the sizes a token is drawn. */
  segments = 4,
}: {
  circumradius: number
  rim: number
  depth: number
  segments?: number
}): BufferGeometry {
  const faceRadius = circumradius - rim

  /*
   * The profile, from the face's edge (u = 0) out to the silhouette (u = 1), as
   * (circumradius, height above the face). Tangent horizontal where it leaves the face, so there is
   * no crease in the middle of the tile, and vertical at the rim, where the loose tile's own side wall
   * would be — the same two boundary conditions `createTileGeometry` has, read the other way.
   */
  const radiusAt = (u: number): number => faceRadius + rim * Math.sin((u * Math.PI) / 2)
  const heightAt = (u: number): number => depth * (1 - Math.cos((u * Math.PI) / 2))

  /*
   * The surface normal in the facet's own (outward, up) frame: perpendicular to the profile's tangent
   * `(dr, dy)`, taken as `(-dy, dr)`, which for a profile that widens as it rises points inward and up
   * — the way the inside of a bowl faces.
   */
  const normalAt = (u: number): { out: number, up: number } => {
    const dr = rim * Math.cos((u * Math.PI) / 2)
    const dy = depth * Math.sin((u * Math.PI) / 2)
    const length = Math.hypot(dy, dr) || 1
    return { out: -dy / length, up: dr / length }
  }

  const positions: number[] = []
  const normals: number[] = []

  const push = (vertex: Vertex): void => {
    positions.push(vertex.x, vertex.y, vertex.z)
    normals.push(vertex.nx, vertex.ny, vertex.nz)
  }

  // Corners at 90°, 150°, … — the pointy-top convention the tiles and the plate's cells share. Built
  // straight into the world's XZ plane: x from cosine, z from *minus* sine.
  const cornerAngle = (corner: number): number => Math.PI / 2 + (corner * Math.PI) / 3

  // The face: a fan from the centre, flat, normal straight up.
  const centre: Vertex = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 }
  for (let corner = 0; corner < 6; corner++) {
    const at = (index: number): Vertex => ({
      x: Math.cos(cornerAngle(index)) * faceRadius,
      y: 0,
      z: -Math.sin(cornerAngle(index)) * faceRadius,
      nx: 0,
      ny: 1,
      nz: 0,
    })
    for (const vertex of ordered(centre, at(corner), at(corner + 1))) push(vertex)
  }

  // The rim: one quad strip per side, smooth along the roll and faceted across the corners.
  for (let facet = 0; facet < 6; facet++) {
    const angles = [cornerAngle(facet), cornerAngle(facet + 1)]
    // The facet faces outward along its midpoint, halfway between its two corners.
    const facing = cornerAngle(facet) + Math.PI / 6
    const outX = Math.cos(facing)
    const outZ = -Math.sin(facing)

    for (let step = 0; step < segments; step++) {
      const corners = [step / segments, (step + 1) / segments].flatMap(u => {
        const radius = radiusAt(u)
        const height = heightAt(u)
        const normal = normalAt(u)
        return angles.map((angle): Vertex => ({
          x: Math.cos(angle) * radius,
          y: height,
          z: -Math.sin(angle) * radius,
          nx: outX * normal.out,
          ny: normal.up,
          nz: outZ * normal.out,
        }))
      })

      // [inner-left, inner-right, outer-left, outer-right] of one quad across the rim.
      const [a, b, c, d] = corners as [Vertex, Vertex, Vertex, Vertex]
      for (const vertex of [...ordered(a, b, d), ...ordered(a, d, c)]) push(vertex)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3))
  geometry.computeBoundingSphere()
  return geometry
}

type Vertex = { x: number, y: number, z: number, nx: number, ny: number, nz: number }

/**
 * A triangle wound to agree with the normals its vertices carry.
 *
 * Worked out per triangle rather than reasoned about once: the tile material culls back faces, so a
 * triangle wound the wrong way is not subtly wrong but simply absent, and that is a poor thing to
 * leave resting on a convention.
 */
function ordered(p: Vertex, q: Vertex, r: Vertex): [Vertex, Vertex, Vertex] {
  const ux = q.x - p.x, uy = q.y - p.y, uz = q.z - p.z
  const vx = r.x - p.x, vy = r.y - p.y, vz = r.z - p.z
  const cx = uy * vz - uz * vy
  const cy = uz * vx - ux * vz
  const cz = ux * vy - uy * vx
  return cx * p.nx + cy * p.ny + cz * p.nz > 0 ? [p, q, r] : [p, r, q]
}
