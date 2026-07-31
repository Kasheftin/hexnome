import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Texture,
} from 'three'

/**
 * The symbol on a tile's top face: a thin plane floating just above it.
 *
 * A separate plane rather than art mapped onto the prism, because
 * `ExtrudeGeometry` generates UVs that are awkward-to-hostile for placing art
 * precisely on the top face, and mixing them with the bevel and side faces means
 * fighting the generator. A child plane is trivially positioned and swapped.
 *
 * Unlit, so the symbol's painted gold gradients survive as authored instead of
 * being multiplied by scene lighting.
 *
 * The plane is centred on the tile's origin and grows about it, so `fitRadius` can never move a symbol
 * off centre. `offsetUp` is the deliberate exception, for motifs whose optical centre is not their
 * bounding-box centre.
 */
export function createSymbolPlane(
  texture: Texture,
  { fitRadius, y, offsetUp = 0 }: { fitRadius: number, y: number, offsetUp?: number },
): Mesh {
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8

  const image = texture.image as { width?: number, height?: number } | undefined
  const aspect = (image?.width ?? 1) / (image?.height ?? 1)

  // Fit the symbol's bounding box inside a circle of `fitRadius`. Normalising by
  // the diagonal means a tall motif and a square one get comparable visual weight,
  // and neither can poke outside the hexagon whatever its aspect.
  const height = (2 * fitRadius) / Math.hypot(aspect, 1)
  const width = height * aspect

  const geometry = new PlaneGeometry(width, height)
  // Lay it flat. Local +Y becomes world -Z, which is screen-up, so the image's top
  // row ends up at the top of the screen.
  geometry.rotateX(-Math.PI / 2)

  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    }),
  )
  mesh.position.y = y
  /*
   * The vertical nudge, converted from screen-up to world once and only here.
   *
   * The board lies in the XZ plane and screen-up is −Z (BoardCamera's up vector is `(0, 0, −1)` at zero
   * tilt), so raising a symbol means *decreasing* z. Flipping the sign at this one point lets every
   * caller — and the tuning table in constants.ts — speak in "up is positive", which is the only way
   * anyone will get it right by eye.
   */
  mesh.position.z = -offsetUp
  mesh.renderOrder = 1
  return mesh
}
