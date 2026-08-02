import { ExtrudeGeometry, Shape, type BufferGeometry } from 'three'
import { SQRT3 } from '@hexnome/rules/hex'

/**
 * A thick pointy-top hexagonal prism with a rounded top edge — the physical game
 * tile, built to match the Azul: Queen's Garden pieces in
 * `external assets/azul.png`.
 *
 * The silhouette is a **sharp** hexagon: six crisp corners, no rounding in the 2D
 * profile. Seen from directly above, the tile's outline is a plain hexagon.
 *
 * The rounding is entirely on the **top edge**, from the extrusion bevel. Three's
 * bevel sweeps a quarter-circle (`cos`/`sin` of t·π/2), so with enough segments the
 * rim reads as a genuine roll-over from the flat top down to the vertical side wall.
 * At the corners that roll-over wraps around a still-sharp corner, which is exactly
 * how the Azul tiles look.
 *
 * That rim is also the only part of the tile that can catch a highlight: the board
 * camera is orthographic and looks straight down, so the flat top face has a single
 * normal and therefore one uniform shade. See docs/tech-spec.md.
 *
 * Built in the XY plane by `ExtrudeGeometry` and rotated into XZ here, once, so no
 * per-tile mesh rotation is needed.
 */
export function createTileGeometry({
  circumradius,
  thickness = 0.34,
  /** Radius of the rounded top edge, in world units. */
  bevel = 0.1,
  /** Segments across the rim. More is smoother; 5 is already round to the eye. */
  bevelSegments = 5,
}: {
  circumradius: number
  thickness?: number
  bevel?: number
  bevelSegments?: number
}): BufferGeometry {
  // The bevel pushes the widest point outward by `bevel`, so inset the profile by
  // the same amount to land the finished silhouette on `circumradius`.
  const r = circumradius - bevel

  const shape = new Shape()
  for (let i = 0; i < 6; i++) {
    // Vertices at ±Y in the profile, which becomes ±Z after the rotation below, so
    // the flat sides face ±X and match the grid's pointy-top orientation.
    const angle = (Math.PI / 180) * (90 + i * 60)
    const x = Math.cos(angle) * r
    const y = Math.sin(angle) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()

  const geometry = new ExtrudeGeometry(shape, {
    depth: thickness - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
    // The hexagon's sides are straight lines, so there is nothing to subdivide.
    curveSegments: 1,
  })

  // Extrude builds along +Z from the XY plane; stand it up so the faces point at ±Y.
  geometry.rotateX(-Math.PI / 2)
  // The bevel extends the solid from -bevel to depth+bevel, so after rotation the
  // span is [-bevel, thickness-bevel]. Shift by (bevel - thickness/2) to centre the
  // tile on its own origin: top face at +thickness/2, bottom at -thickness/2.
  geometry.translate(0, bevel - thickness / 2, 0)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

/** Half the width of a pointy-top hexagon: the distance to a flat side. */
export function hexApothemOf(circumradius: number): number {
  return (circumradius * SQRT3) / 2
}
