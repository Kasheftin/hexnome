import {
  CircleGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Path,
  RingGeometry,
  Shape,
  ShapeGeometry,
  type BufferGeometry,
} from 'three'
import {
  HEX_SIZE,
  HIGHLIGHT_COLORS,
  PLATE_BASE_MARGIN,
  PLATE_BASE_THICKNESS,
  STEM_RADIUS,
  STEM_THICKNESS,
  TILE_SIZE,
  TILE_THICKNESS,
} from './constants'
import { createHexPlateGeometry } from './hexPlateGeometry'
import { flowerOutline, insetPolygon } from './plateBaseGeometry'

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
 * Larger than the tile, by enough to clear its **antialiased** edge.
 *
 * A coincident silhouette does not just shimmer — it leaves the tile's lit rim showing through as a
 * bright hairline, which reads as a deliberate border rather than as a dimmed tile. Antialiasing blends
 * the tile edge over about a pixel, so the overlay has to finish outside that blend, not merely outside
 * the geometry: 1.005 overshot by 0.19px at drawer size and was invisibly short. 1.04 gives ~1.5px.
 *
 * Expressed as a fraction, so the overshoot stays proportional as a tile is drawn at drawer, lot or
 * board scale. What it spills onto is the plate or the tray beneath, where a slightly darkened hairline
 * is unnoticeable.
 */
const OVERLAY_R = TILE_SIZE * 1.04

const overlayGeometry: BufferGeometry = createHexPlateGeometry(OVERLAY_R)
const ringGeometry = new RingGeometry(TILE_SIZE * 0.99, TILE_SIZE * 1.2, 6, 1, Math.PI / 2)

/** Clearance above a tile's face, and above the symbol plane which sits `0.008` up. */
const DECOR_CLEARANCE = 0.014

export interface DraftDecor {
  readonly dim: Mesh
  readonly ring: Mesh
}

/**
 * Take a decoration out of picking entirely.
 *
 * **Not optional.** These planes float above the object they decorate, and a *plate's* overlay spans the
 * whole flower — so it hangs over the loose tiles heaped on that plate. Left raycastable it swallows
 * every click aimed at those tiles: the hit walks up to the plate, the plate is face down and refuses,
 * and the tiles silently stop responding. Decor is something you look at, never something you hit.
 */
function unpickable(mesh: Mesh): Mesh {
  mesh.raycast = () => {}
  return mesh
}

/**
 * Add both decorations to a tile mesh, hidden.
 *
 * Materials are per-tile — they are the only thing here that gets mutated — while the geometry is
 * shared. Two tiny `MeshBasicMaterial`s per tile is nothing next to a stuck-looking tile.
 *
 * @param faceY the tile's top face in its own local space: `TILE_THICKNESS / 2` for a normal tile, `0`
 * for a plate's token, which is drawn flat. Passed in rather than assumed, because a marker sunk inside
 * its tile is invisible and one floating above it looks detached.
 */
export function attachDraftDecor(tile: Mesh, faceY: number): DraftDecor {
  const decorY = faceY + DECOR_CLEARANCE
  const dim = new Mesh(overlayGeometry, new MeshBasicMaterial({
    color: '#05070a',
    transparent: true,
    opacity: 0.62,
    side: DoubleSide,
    // Without this the overlay writes depth above the tile and swallows the ring of a *selected*
    // tile that happens to overlap it in the heap.
    depthWrite: false,
  }))
  dim.position.y = decorY
  dim.renderOrder = 6
  dim.visible = false
  tile.add(unpickable(dim))

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
  ring.position.y = decorY
  // Above every other transparent thing, since it ignores depth and must still sort last.
  ring.renderOrder = 30
  ring.visible = false
  tile.add(unpickable(ring))

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


/* ── the same three states, for a whole plate ─────────────────────────────────── */

/**
 * A plate is drafted **as a whole object**, so its marker has to cover the whole object.
 *
 * Putting the marker on the plate's token was the first attempt and it was misleading: taking a plate
 * takes the plate, not the tile printed on it, and a ring around the token said the opposite. It also
 * made a plate look like just another tile in a draft, when it costs a bay rather than a tile slot.
 *
 * The shapes follow the flower silhouette rather than a bounding hexagon, reusing the same
 * `flowerOutline` the slab itself is built from — so the outline traces the plate's real edge, lobes and
 * all, and cannot drift from it.
 */

/** Build the flower as a flat `Shape`, offset by `inset`. Negative outsets. */
function flowerShape(inset: number): Shape {
  const shape = new Shape()
  // Built in XY and rotated into XZ below, negating z so the rotation lands it unmirrored — the same
  // convention plateBaseGeometry uses, and for the same reason.
  insetPolygon(flowerOutline(HEX_SIZE), inset).forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, -z)
    else shape.lineTo(x, -z)
  })
  shape.closePath()
  return shape
}

function flowerPath(inset: number): Path {
  const path = new Path()
  insetPolygon(flowerOutline(HEX_SIZE), inset).forEach(([x, z], index) => {
    if (index === 0) path.moveTo(x, -z)
    else path.lineTo(x, -z)
  })
  path.closePath()
  return path
}

function flatten(geometry: BufferGeometry): BufferGeometry {
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/**
 * The slab's silhouette, pushed out past its antialiased edge.
 *
 * Same reasoning as the tile overlay above: sitting exactly on `PLATE_BASE_MARGIN` left the slab's lit
 * edge showing as a hairline around a dimmed plate. 0.035 beyond it is ~1px at the sizes plates are
 * drawn, and spills only onto the lot behind.
 */
const PLATE_DIM_OVERSHOOT = 0.035
const plateDimGeometry = flatten(
  new ShapeGeometry(flowerShape(PLATE_BASE_MARGIN - PLATE_DIM_OVERSHOOT)),
)

/**
 * An outline straddling the slab's edge, like the tile ring straddles a tile's.
 *
 * The slab edge sits at `PLATE_BASE_MARGIN` (0.03) in, so spanning 0.06 out to 0.09 in puts roughly half
 * the band beyond the plate — enough to read as an outline around it rather than a stripe painted on it.
 */
const plateRingGeometry = flatten(new ShapeGeometry((() => {
  const ring = flowerShape(-0.06)
  ring.holes.push(flowerPath(0.09))
  return ring
})()))

/**
 * Clear of everything the plate carries.
 *
 * A tile seated in a petal reaches `PLATE_TILE_LIFT + TILE_THICKNESS / 2`; the marker has to sit above
 * that or a plate with tiles on it would show a marker cut into pieces by them.
 */
const PLATE_DECOR_Y = PLATE_BASE_THICKNESS + TILE_THICKNESS + 0.06

export function attachPlateDraftDecor(plate: Mesh | { add(o: Mesh): unknown }): DraftDecor {
  const dim = new Mesh(plateDimGeometry, new MeshBasicMaterial({
    color: '#05070a',
    transparent: true,
    opacity: 0.55,
    side: DoubleSide,
    depthWrite: false,
  }))
  dim.position.y = PLATE_DECOR_Y
  dim.renderOrder = 6
  dim.visible = false
  plate.add(unpickable(dim))

  const ring = new Mesh(plateRingGeometry, new MeshBasicMaterial({
    color: HIGHLIGHT_COLORS.valid,
    transparent: true,
    opacity: 0.95,
    side: DoubleSide,
    depthWrite: false,
    // Never occluded, for the same reason as the tile ring: a marker another object can slice through
    // is not a marker.
    depthTest: false,
  }))
  ring.position.y = PLATE_DECOR_Y + 0.01
  ring.renderOrder = 30
  ring.visible = false
  plate.add(unpickable(ring))

  return { dim, ring }
}

/** Shared plate geometry — call once, when no plates remain. */
export function disposePlateDraftDecorAssets(): void {
  plateDimGeometry.dispose()
  plateRingGeometry.dispose()
}


/* ── the same three states, for a stem coin ───────────────────────────────────── */

/**
 * Round decor for a round object.
 *
 * A hexagonal overlay on a coin would leave its corners hanging over the slot and clip the coin's own
 * edge — and the whole point of drawing a stem as a coin is that it is visibly not a hexagon. The
 * marker has to agree with the shape it marks.
 */
const coinDimGeometry: BufferGeometry = flatten(new CircleGeometry(STEM_RADIUS * 1.04, 32))
const coinRingGeometry: BufferGeometry = flatten(
  new RingGeometry(STEM_RADIUS * 1.0, STEM_RADIUS * 1.22, 32),
)

/** Above the coin's face and the emblem plane that sits on it. */
const COIN_DECOR_Y = STEM_THICKNESS / 2 + DECOR_CLEARANCE

export function attachCoinDraftDecor(coin: Mesh): DraftDecor {
  const dim = new Mesh(coinDimGeometry, new MeshBasicMaterial({
    color: '#05070a',
    transparent: true,
    opacity: 0.62,
    side: DoubleSide,
    depthWrite: false,
  }))
  dim.position.y = COIN_DECOR_Y
  dim.renderOrder = 6
  dim.visible = false
  coin.add(unpickable(dim))

  const ring = new Mesh(coinRingGeometry, new MeshBasicMaterial({
    color: HIGHLIGHT_COLORS.valid,
    transparent: true,
    opacity: 0.95,
    side: DoubleSide,
    depthWrite: false,
    depthTest: false,
  }))
  ring.position.y = COIN_DECOR_Y
  ring.renderOrder = 30
  ring.visible = false
  coin.add(unpickable(ring))

  return { dim, ring }
}

/** Shared coin geometry — call once, when no stems remain. */
export function disposeCoinDraftDecorAssets(): void {
  coinDimGeometry.dispose()
  coinRingGeometry.dispose()
}
