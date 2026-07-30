import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type BufferGeometry,
} from 'three'
import { HIGHLIGHT_COLORS, TILE_SIZE, TILE_THICKNESS } from './constants'
import { createHexPlateGeometry } from './hexPlateGeometry'

/**
 * The three drafting states, drawn as decorations *on* a tile rather than as changes *to* it.
 *
 * - **inactive** — a translucent black hex laid over the top face.
 * - **selected** — a mint ring around the rim.
 * - **active** — neither; the tile as it normally looks.
 *
 * ## Why overlays instead of restyling the tile
 *
 * The obvious approach is to dim the tile's own material. But tiles share one material per palette
 * colour, so dimming one would dim every tile of that colour across the board and drawer. The fix
 * would be a material clone per tile, which then has to be mutated back on the way out of the source
 * and kept in step with the palette — two ways to get a tile stuck looking wrong.
 *
 * An overlay has none of that: it is per-tile by construction, and toggling `visible` is exactly
 * reversible. It also dims the *symbol* along with the face, because it sits above both, which
 * restyling the tile material would not have done — the symbol is a separate textured plane.
 *
 * The one thing it does not cover is the bevelled rim, which keeps its colour. That reads as a dimmed
 * tile catching a little light rather than as a bug, and the rim is what conveys thickness at all.
 */

/**
 * Slightly larger than the tile so the overlay's edge lands just outside the bevel's outer edge
 * rather than on it, where a coincident silhouette would shimmer.
 */
const OVERLAY_R = TILE_SIZE * 1.005

const overlayGeometry: BufferGeometry = createHexPlateGeometry(OVERLAY_R)
const ringGeometry = new RingGeometry(TILE_SIZE * 0.99, TILE_SIZE * 1.2, 6, 1, Math.PI / 2)

/** Above the top face and above the symbol plane, which sits at `TILE_THICKNESS / 2 + 0.008`. */
const DECOR_Y = TILE_THICKNESS / 2 + 0.014

export interface DraftDecor {
  readonly dim: Mesh
  readonly ring: Mesh
}

/**
 * Add both decorations to a tile mesh, hidden.
 *
 * Materials are per-tile — they are the only thing here that gets mutated — while the geometry is
 * shared. Two tiny `MeshBasicMaterial`s per tile is nothing next to a stuck-looking tile.
 */
export function attachDraftDecor(tile: Mesh): DraftDecor {
  const dim = new Mesh(overlayGeometry, new MeshBasicMaterial({
    color: '#05070a',
    transparent: true,
    opacity: 0.62,
    side: DoubleSide,
    // Without this the overlay writes depth above the tile and swallows the ring of a *selected*
    // tile that happens to overlap it in the heap.
    depthWrite: false,
  }))
  dim.position.y = DECOR_Y
  dim.renderOrder = 6
  dim.visible = false
  tile.add(dim)

  const ring = new Mesh(ringGeometry, new MeshBasicMaterial({
    color: HIGHLIGHT_COLORS.valid,
    transparent: true,
    opacity: 0.95,
    side: DoubleSide,
    depthWrite: false,
    /*
     * Never occluded by anything.
     *
     * The ring extends past the tile it belongs to, so with depth testing on it was cut wherever a
     * neighbouring tile crossed it — the selection outline stopped mid-edge and looked like a
     * rendering fault. Lifting the selected tile helps but cannot guarantee it: neighbours sit at
     * their own heights, and a marker that another object can slice through is not a marker.
     *
     * Safe to switch off here specifically because this is UI drawn on a tile, not scene geometry:
     * it is a thin outline, it only ever appears while drafting, and being always-visible is the
     * entire point of it.
     */
    depthTest: false,
  }))
  ring.rotation.x = -Math.PI / 2
  ring.position.y = DECOR_Y
  // Above every other transparent thing, since it ignores depth and must still sort last.
  ring.renderOrder = 30
  ring.visible = false
  tile.add(ring)

  return { dim, ring }
}

export function showDraftState(decor: DraftDecor, state: 'active' | 'selected' | 'inactive'): void {
  decor.dim.visible = state === 'inactive'
  decor.ring.visible = state === 'selected'
}

export function disposeDraftDecor(decor: DraftDecor): void {
  ;(decor.dim.material as MeshBasicMaterial).dispose()
  ;(decor.ring.material as MeshBasicMaterial).dispose()
}

/** Shared geometry — call once, when no tiles remain. */
export function disposeDraftDecorAssets(): void {
  overlayGeometry.dispose()
  ringGeometry.dispose()
}
