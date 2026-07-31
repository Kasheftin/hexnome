import {
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  TextureLoader,
  type BufferGeometry,
  type Texture,
} from 'three'
import {
  STEM_RADIUS,
  STEM_SEGMENTS,
  STEM_SYMBOL_OFFSET_UP,
  STEM_SYMBOL_SCALE,
  STEM_TEXTURE_URL,
  STEM_THICKNESS,
} from './constants'
import { createSymbolPlane } from './symbolPlane'

/**
 * A stem: a metal coin carrying the stem-cell emblem.
 *
 * **Round on purpose.** Every other object on the table is a hexagon that tessellates with its
 * neighbours; a stem never reaches the board, so a coin says "this one is not a tile" before anyone has
 * read a rule. It is a real cylinder rather than a disc for the same reason tiles are prisms — under a
 * top-down camera the rim is the only surface whose normals sweep through a range, so it is the only
 * part that can catch a highlight and read as a solid object.
 *
 * The emblem rides on the flat top as a separate plane, exactly like a tile's symbol, so it gets the
 * same size and offset knobs (`STEM_SYMBOL_*`) while the art is provisional.
 *
 * Built at board scale with its local origin at the coin's **centre**, matching a tile, so the same
 * positioning and scaling code drops it into a drawer slot.
 */

const geometry: BufferGeometry = new CylinderGeometry(
  STEM_RADIUS,
  STEM_RADIUS,
  STEM_THICKNESS,
  STEM_SEGMENTS,
)

/**
 * Warm metal, but not a mirror.
 *
 * Low metalness for the reason the plates learned: this scene's studio environment is deliberately
 * dark, so a highly metallic surface reflects almost nothing and renders near-black.
 */
const material = new MeshStandardMaterial({
  color: '#7a6a3c',
  roughness: 0.42,
  metalness: 0.25,
})

let emblem: Texture | null = null
const pending: Mesh[] = []

/** The coin's top face, where the emblem sits. */
const FACE_Y = STEM_THICKNESS / 2

function addEmblem(coin: Mesh, texture: Texture): void {
  coin.add(createSymbolPlane(texture, {
    fitRadius: STEM_RADIUS * STEM_SYMBOL_SCALE,
    offsetUp: STEM_RADIUS * STEM_SYMBOL_OFFSET_UP,
    y: FACE_Y + 0.008,
  }))
}

export function createStemVisual(): Mesh {
  const coin = new Mesh(geometry, material)
  coin.renderOrder = 4

  if (emblem) {
    addEmblem(coin, emblem)
  } else {
    /*
     * The texture is loaded once, lazily, and coins made before it lands are patched afterwards.
     *
     * Stems are dealt during setup, which is very likely to be before any texture has arrived — and a
     * coin that missed the load would stay blank for the rest of the game with nothing to explain it.
     */
    pending.push(coin)
    if (pending.length === 1) {
      new TextureLoader().load(STEM_TEXTURE_URL, texture => {
        // The PNG holds sRGB values; without this three reads them as linear and it washes out.
        texture.colorSpace = SRGBColorSpace
        texture.anisotropy = 8
        emblem = texture
        for (const waiting of pending) addEmblem(waiting, texture)
        pending.length = 0
      })
    }
  }
  return coin
}

/** Shared geometry, material and texture — call once, when no stems remain. */
export function disposeStemAssets(): void {
  geometry.dispose()
  material.dispose()
  emblem?.dispose()
  emblem = null
  pending.length = 0
}
