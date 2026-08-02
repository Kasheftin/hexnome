import { BufferGeometry, Float32BufferAttribute } from 'three'
import { SQRT3 } from '@hexnome/rules/hex'

/**
 * A flat pointy-top hexagon lying in the XZ plane, UV-mapped so a texture's
 * bounding box lands exactly on the hexagon's bounding box.
 *
 * For circumradius R (= edge length) the hexagon is `√3·R` wide and `2·R` tall —
 * a ratio of 0.8660. A 200-wide tile image should therefore be 230.94 tall.
 *
 * Built by hand rather than with `CircleGeometry` purely because of the UVs.
 * CircleGeometry maps the *circumscribed square*, so `u` only spans 0.067–0.933
 * across the hexagon; feeding it a full-bleed tile image squashes the art inward.
 * Here `u` and `v` each span the full 0–1 across the hexagon's actual extent.
 */
export function createHexPlateGeometry(
  circumradius: number,
  /**
   * Shrink the sampled region by this many texels so the outermost row is never
   * read. Textures with transparent corners bleed RGB 0 into the edge otherwise,
   * which shows up as a dark fringe around every plate.
   */
  uvInsetTexels = 0.5,
  textureWidth = 200,
  textureHeight = 231,
): BufferGeometry {
  const r = circumradius
  const halfWidth = (SQRT3 / 2) * r

  // Counter-clockwise seen from above, starting at the north vertex, so the face
  // normal comes out as +Y.
  const corners: readonly [number, number][] = [
    [0, -r],
    [-halfWidth, -r / 2],
    [-halfWidth, r / 2],
    [0, r],
    [halfWidth, r / 2],
    [halfWidth, -r / 2],
  ]

  const uShrink = 1 - uvInsetTexels / textureWidth
  const vShrink = 1 - uvInsetTexels / textureHeight

  const positions: number[] = [0, 0, 0]
  const normals: number[] = [0, 1, 0]
  const uvs: number[] = [0.5, 0.5]

  for (const [x, z] of corners) {
    positions.push(x, 0, z)
    normals.push(0, 1, 0)
    // v is flipped relative to z: three uploads images with flipY, so v = 1 is the
    // top of the image, and the top of the image is the hexagon's -Z apex.
    uvs.push(
      0.5 + (x / (2 * halfWidth)) * uShrink,
      0.5 - (z / (2 * r)) * vShrink,
    )
  }

  const indices: number[] = []
  for (let i = 1; i <= 6; i++) {
    indices.push(0, i, i === 6 ? 1 : i + 1)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}
