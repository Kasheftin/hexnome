<script setup lang="ts">
/**
 * Everything on the table — plates and tiles — and the one drag that moves them.
 *
 * A single component because a drag is a single piece of state, and because dropping a
 * *tile* depends on where the *plates* are. Splitting them would mean two controllers
 * negotiating over one gesture.
 *
 * **A tile on a plate is parented to it in the scene graph**, not merely positioned to
 * match. Three's transform hierarchy then makes plate-and-tile one rigid body: the tile
 * inherits the plate's position and scale exactly, on the same frame, for free.
 *
 * The earlier version instead eased each tile toward its plate's current position every
 * frame. That looks fine while both are still and wrong whenever the plate moves — the
 * tile is chasing a target that is itself moving, so it trails behind by a lag that
 * compounds. Visible when dragging a plate, and when scrolling the board with a plate in
 * the drawer. Easing cannot fix that; only rigid attachment can, because the tile is not
 * *approaching* the petal, it *is* in the petal.
 *
 * A tile's local transform is therefore just its petal offset, and easing that local
 * position gives the settle animation without reintroducing any lag.
 *
 * **Tiles stay upright while their plate spins.** Rigid attachment would otherwise turn a
 * tile with its plate, and while a hexagon maps onto itself every 60° its *symbol* does
 * not — the art visibly tilts. So each tile cancels its plate's rotation locally, giving a
 * world rotation of zero. Rotation still does what it should: tiles glide around the ring
 * to their new petals, they just never look knocked askew doing it.
 *
 * Board tiles are anchored in **world** space, drawer contents in **screen** space, so the
 * drawer stays put while the board pans beneath it. Each entity keeps both anchors in
 * sync, so crossing between containers eases from where it already is instead of jumping.
 */
import { useLoop, useTresContext } from '@tresjs/core'
import {
  Group,
  Mesh,
  Raycaster,
  TextureLoader,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type OrthographicCamera,
  type Texture,
} from 'three'
import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { axialToWorld, worldToAxial, type Axial } from '@/game/hex'
import { petalCell } from '@/game/plate'
import type { DraftTileState } from '@/game/draft'
import type { PlateLocation, Tableau, TileLocation } from '@/game/tableau'
import {
  DRAWER_SLOT_PX,
  DRAWER_TILE_FILL,
  DRAWER_TILE_Y,
  SOURCE_PLATE_Y,
  SOURCE_TILE_LAYER_STEP,
  SOURCE_TILE_SELECT_LIFT,
  SOURCE_TILE_Y,
  HELD_TILE_Y,
  HEX_SIZE,
  PLATE_BASE_Y,
  PLATE_SLOT_FILL,
  PLATE_SLOT_PX,
  PLATE_SPIN_EASE,
  PLATE_TILE_LIFT,
  PLATE_TOKEN_LIFT,
  PLATE_WORLD_WIDTH,
  SYMBOL_FIT,
  SYMBOL_TEXTURE_URLS,
  symbolOffsetUpFor,
  symbolScaleFor,
  TILE_BEVEL,
  TILE_SIZE,
  TILE_THICKNESS,
} from './constants'
import {
  attachCoinDraftDecor,
  attachDraftDecor,
  attachPlateDraftDecor,
  disposeDraftDecor,
  disposeCoinDraftDecorAssets,
  disposeDraftDecorAssets,
  disposePlateDraftDecorAssets,
  showDraftState,
  type DraftDecor,
} from './draftDecor'
import { registerGrabbable } from './grabbables'
import { createPlateBackVisual, disposePlateBackAssets } from './plateBackVisual'
import { createPlateVisual, disposePlateVisualAssets, petalOffset } from './plateVisual'
import { boardToScreen, screenToBoard, unitsPerPixel } from './screenProjection'
import { createHexPlateGeometry } from './hexPlateGeometry'
import { createStemVisual, disposeStemAssets } from './stemVisual'
import { createSymbolPlane } from './symbolPlane'
import { createTileGeometry, hexApothemOf } from './tileGeometry'
import { SOURCE_HEAP_SPAN, sourceScatter, type ScatterOffset } from './sourceScatter'
import { createTileMaterial, type TileColorIndex } from './tileMaterials'
import { useDrawerLayout } from './useDrawerLayout'
import { useSourceLayout } from './useSourceLayout'

const props = defineProps<{
  tableau: Tableau
  /** Seeds the loose-tile scatter, so a lot looks the same after a refresh. */
  gameId: string
  /**
   * Whether dragging is allowed at all.
   *
   * False outside the `putting` phase. A turn is one chosen action, so until the player has picked
   * "Put" nothing on the table should respond to a drag — otherwise a stray press commits a move they
   * never chose.
   */
  draggable: boolean
  /**
   * Drafting state per source tile, or null when not drafting.
   *
   * Passed in rather than derived here: the rule lives in game/draft.ts and the selection belongs to
   * the turn, so the view's job is only to show it and report clicks.
   */
  draftStates: ReadonlyMap<string, DraftTileState> | null
  /**
   * Payment state per **drawer** item — tiles, plates in bays, and stems — or null when not paying.
   *
   * Separate from `draftStates` because they cover disjoint places: drafting marks the shared source,
   * paying marks your own drawer. One map keyed by id would work but would hide that, and the two are
   * live in different phases.
   */
  payStates: ReadonlyMap<string, DraftTileState> | null
  /**
   * Bumped by the owner on every model mutation.
   *
   * The tableau is plain mutable data, not reactive, so this is how the view learns that plates or
   * tiles may have been added or removed.
   */
  revision: number
}>()

const emit = defineEmits<{
  /** Cells to mark as the drop target, and whether dropping there is legal. */
  target: [cells: Axial[], valid: boolean]
  /** Drawer slot being targeted: a tile slot, a plate slot, or neither. */
  drawerTarget: [tileSlot: number | null, plateSlot: number | null, valid: boolean]
  /** A plate resting in a drawer bay is hovered — or null. Drives the rotate buttons. */
  hoverPlateSlot: [slot: number | null]
  /** A source tile was clicked while drafting. The turn decides what that means. */
  selectTile: [id: string]
  /**
   * An item reached the board. Carries where it came from, so the turn can put it back if the player
   * cancels rather than pays.
   */
  placed: [item: { kind: 'tile' | 'plate', id: string }, origin: TileLocation | PlateLocation]
  /** A drawer item was clicked while paying. */
  selectPayment: [id: string]
  changed: []
}>()

const { scene, camera, renderer, sizes } = useTresContext()
const { onBeforeRender } = useLoop()
const layout = useDrawerLayout()
const sourceLayout = useSourceLayout(() => props.tableau.sourceLots)

const tileGeometry: BufferGeometry = createTileGeometry({
  circumradius: TILE_SIZE,
  thickness: TILE_THICKNESS,
  bevel: TILE_BEVEL,
})

/**
 * A plate's **own** tile is drawn flat — no thickness, no bevel.
 *
 * Purely a visual signal, and a strong one: every loose tile is a thick bevelled piece that catches the
 * key light on its rim, so a token with no rim at all reads as *printed on* the plate rather than *set
 * into* it. That is exactly what it is — a plate and its token are one indivisible object, and the flat
 * face says so without a label.
 *
 * The rule itself is unchanged and lives in the model (`Tile.fixed`): the token is still a full tile for
 * scoring, and it was already undraggable. This only makes that legible.
 */
const tokenGeometry: BufferGeometry = createHexPlateGeometry(TILE_SIZE)

/** A tile's top face in its own local space. A flat token's origin *is* its face. */
function tileFaceY(fixed: boolean): number {
  return fixed ? 0 : TILE_THICKNESS / 2
}
const tileMaterials = new Map<number, Material>()

interface View {
  readonly object: Object3D
  readonly world: Vector3
  screenX: number
  screenY: number
  scale: number
  /** Current rendered spin in radians, eased toward the plate's rotation. */
  spin: number
  /**
   * Which anchoring regime the object was in last frame — 'held', 'drawer' or the plate
   * it rides. Used only to notice a change and restart the scale ease.
   */
  regime: string
  /**
   * True once the scale ease has finished. While settled, scale is assigned *directly*
   * from the current target rather than eased toward it.
   *
   * This is what stops drawer contents from visibly resizing and springing back when the
   * board is zoomed. A drawer item's world scale is a zoom-compensation factor —
   * `pixels × unitsPerPixel` — so when zoom changes the target changes, and easing toward
   * it means rendering a knowingly wrong size for several frames. It is not an animation
   * and must not be treated as one. The ease exists only for the one real transition,
   * between drawer size and board size.
   */
  settled: boolean
  /**
   * True until this view has been positioned once.
   *
   * A view created mid-game starts with no screen anchor, and the easing below would slide it in from
   * the canvas corner. A fresh view snaps to where it belongs on its first frame instead — appearing
   * in place is what "a new lot was dealt" should look like.
   */
  fresh: boolean
  /**
   * Which face this plate view was built for. Undefined on tile views.
   *
   * The face is baked into the mesh at creation, so a plate turning over needs its view rebuilt rather
   * than restyled — reconciliation compares this against the model and replaces the view when they
   * disagree.
   */
  faceDown?: boolean
  /** Drafting overlays. Tiles only; undefined on plate views. */
  decor?: DraftDecor
}

const plateViews = new Map<string, View>()
const tileViews = new Map<string, View>()
const stemViews = new Map<string, View>()
/**
 * What a picked object belongs to.
 *
 * A discriminated union rather than one shape with a union `kind`, so that ruling out `'stem'` actually
 * narrows the type — with a single shape TypeScript narrows the *property* and leaves the object alone.
 */
type Owner =
  | { readonly kind: 'tile', readonly id: string }
  | { readonly kind: 'plate', readonly id: string }
  | { readonly kind: 'stem', readonly id: string }

/** Anything a drag can hold. Stems are excluded: they are inert. */
type Draggable = Exclude<Owner, { kind: 'stem' }>

/** Maps a picked object back to what it belongs to. */
const owners = new Map<Object3D, Owner>()
const unregisters: (() => void)[] = []
const symbolTextures: Texture[] = []
let disposed = false

const held = shallowRef<Draggable | null>(null)
const pointer = { x: 0, y: 0 }
/**
 * Where the held object's centre sits relative to the pointer, in screen pixels, fixed at
 * the moment of the grab.
 *
 * Without it a piece snaps its centre to the cursor the instant you press, which reads as
 * the piece jumping out from under your finger. Grab a tile near its edge and it should
 * stay held near its edge.
 */
const grabOffset = { x: 0, y: 0 }

/**
 * The held object's centre. **This, not the raw pointer, is what resolves the drop
 * target** — otherwise an off-centre grab would highlight a cell the piece is not actually
 * over, and the piece would land somewhere it never looked like it would.
 */
function heldPoint(): { x: number, y: number } {
  return { x: pointer.x + grabOffset.x, y: pointer.y + grabOffset.y }
}
let targetTile: TileLocation | null = null
/**
 * The board cell `targetTile` was resolved *from*, kept rather than recomputed.
 *
 * Deriving it back from the petal index is where this went wrong: a logical petal `p` sits
 * in direction `p − rotation`, so `petalCell(hole, petal)` only finds the right cell on an
 * unrotated plate. On a rotated one it highlighted the pre-rotation cell. Since target
 * resolution already starts from the cell under the pointer, holding on to it removes the
 * inverse mapping — and the chance of getting it wrong — entirely.
 */
let targetTileCell: Axial | null = null
let targetPlate: PlateLocation | null = null
let targetValid = false
let lastEmitted = ''

const raycaster = new Raycaster()
const ndc = new Vector2()

function activeCamera(): OrthographicCamera | null {
  const cam = camera.activeCamera.value as OrthographicCamera | undefined
  return cam?.isOrthographicCamera ? cam : null
}

function canvasEl(): HTMLCanvasElement | null {
  return renderer.instance?.domElement ?? null
}

/** Tile radius in world units when sitting in a drawer tile slot. */
function drawerTileScale(upp: number): number {
  return (((DRAWER_SLOT_PX / 2) * DRAWER_TILE_FILL) * upp) / TILE_SIZE
}

/** Plate scale when sitting in a drawer plate slot. */
function drawerPlateScale(upp: number): number {
  return (PLATE_SLOT_PX * PLATE_SLOT_FILL * upp) / PLATE_WORLD_WIDTH
}

/**
 * Plate scale when sitting in a source lot.
 *
 * Takes the width from the layout rather than a constant, because source lots are sized to fit the
 * viewport's height (sourceLayout.ts) instead of being fixed like the drawer's bays.
 *
 * A lot's loose tiles use this same scale: in a petal a tile is scale 1 relative to its plate, so
 * matching the plate's scale is what makes a heaped tile the same size as a seated one.
 */
function sourcePlateScale(upp: number, plateWidthPx: number): number {
  return (plateWidthPx * upp) / PLATE_WORLD_WIDTH
}

/**
 * Tile scale for a lot's loose tiles: **drawer size**, shrunk only if the lot cannot hold four.
 *
 * Deliberately *not* the plate's scale. A tile heaped on a lot is not seated in a petal, and it is
 * about to be drafted into the drawer — so it is drawn at the size it will be there, and drafting
 * moves it without resizing it. (A tile that *is* in a petal still takes the plate's scale, because
 * there it really is part of the plate.)
 *
 * The clamp is the honest half of this. Four tiles heaped legibly need about `SOURCE_HEAP_SPAN`
 * tile-radii of room, which at drawer size is roughly 172px. Lots are sized to fit six in the viewport
 * height, so on a short window they are far smaller than that — and drawing drawer-sized tiles anyway
 * would spill the heap over its neighbours and hide three tiles behind the fourth. So parity is the
 * target, not a guarantee: it holds on a tall viewport and degrades to whatever fits below that.
 *
 * Bounded by the **plate's** height, not the lot's. The plate is the shorter of the two — a flower is
 * wider than it is tall, while the heap is taller than it is wide — so clamping to the lot let the top
 * and bottom tiles hang off the brass with nothing under them. Clamping to the plate costs a few
 * percent of parity and buys tiles that actually look like they are lying on something.
 */
function sourceTileScale(upp: number, plateHeightPx: number): number {
  const fitsOnPlate = ((plateHeightPx / SOURCE_HEAP_SPAN) * upp) / TILE_SIZE
  return Math.min(drawerTileScale(upp), fitsOnPlate)
}

/**
 * Which draft item a tile represents.
 *
 * Usually itself. But a **plate's token** is drafted as the *plate* — taking it costs a bay and brings
 * the whole plate — so the token tile shows the plate's state and answers to the plate's id. Putting the
 * marker on the token rather than on the slab is deliberate: the token is what the player is matching
 * colours and symbols against, so that is where the eye already is.
 */
function draftKeyOfTile(tile: { id: string, fixed: boolean, location: TileLocation }): string {
  if (!tile.fixed || tile.location.kind !== 'onPlate') return tile.id
  const plate = props.tableau.plate(tile.location.plateId)
  return plate?.location.kind === 'source' ? plate.id : tile.id
}

/**
 * Scatter offsets per heap, computed once each.
 *
 * Keyed on the lot's **plate**, not its slot: the source is a stack, so a lot's slot changes whenever a
 * fresh lot is pushed on top, and keying on the slot would re-scatter every heap in the column each time
 * that happened (see sourceScatter.ts).
 *
 * Cached because it is deterministic — recomputing would give the same answer, but it runs per tile per
 * frame, and hashing a string sixty times a second to learn something that never changes is waste, not
 * safety. Keying on the plate id also means the cache never needs invalidating: the answer for a given
 * heap is fixed for the heap's whole life.
 */
const scatterCache = new Map<string, ScatterOffset[]>()

function scatterFor(heapKey: string): ScatterOffset[] {
  const cached = scatterCache.get(heapKey)
  if (cached) return cached
  const computed = sourceScatter(props.gameId, heapKey, props.tableau.sourceTilesPerLot)
  scatterCache.set(heapKey, computed)
  return computed
}

/**
 * Move `object` under `parent`, keeping it exactly where it appears.
 *
 * Reparenting is what makes a tile rigid with its plate, but three's `add()` only
 * reassigns the parent — the local transform is reinterpreted against the new parent, so
 * the object jumps unless its position and scale are converted first.
 */
const reparentPosition = new Vector3()
const reparentScale = new Vector3()
const parentScale = new Vector3()

function reparent(object: Object3D, parent: Object3D): void {
  if (object.parent === parent) return
  object.updateMatrixWorld()
  object.getWorldPosition(reparentPosition)
  object.getWorldScale(reparentScale)
  parent.updateMatrixWorld()
  parent.getWorldScale(parentScale)
  parent.add(object)
  object.position.copy(parent.worldToLocal(reparentPosition.clone()))
  object.scale.setScalar(reparentScale.x / (parentScale.x || 1))
}

/** Ease `view.scale` toward `target`, then track it exactly. See View.settled. */
function approachScale(view: View, target: number, ease: number): void {
  if (view.settled) {
    view.scale = target
    return
  }
  view.scale += (target - view.scale) * ease
  if (Math.abs(target - view.scale) <= Math.max(target, 1) * 0.005) {
    view.scale = target
    view.settled = true
  }
}

/**
 * Ease a view's screen anchor toward a target — or snap to it, if the view has just been created.
 *
 * Both cases go through one function so no branch can forget to clear `fresh` and leave a view
 * permanently snapping.
 */
function easeScreen(view: View, x: number, y: number, ease: number): void {
  if (view.fresh) {
    view.screenX = x
    view.screenY = y
    view.fresh = false
    return
  }
  view.screenX += (x - view.screenX) * ease
  view.screenY += (y - view.screenY) * ease
}

/** Restart the scale ease when an object changes container. */
function setRegime(view: View, regime: string): void {
  if (view.regime === regime) return
  view.regime = regime
  view.settled = false
}

/* ── picking ──────────────────────────────────────────────────────────────────── */

function pointerToCanvas(e: PointerEvent): { x: number, y: number } | null {
  const el = canvasEl()
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

/**
 * What is under the pointer. Tiles win over plates automatically: a tile sits higher than
 * the plate beneath it, so under a top-down camera it is the nearer hit.
 *
 * A plate's **own** tile is skipped, and the walk continues up to the plate it is welded
 * to — so pressing anywhere on a plate, its own tile included, drags the plate. That is
 * what makes the pair feel like one object in the hand and not merely in the rulebook.
 * Refusing the grab outright would have been enforcement; this is affordance.
 *
 * Items in the shared source are undraggable, so the walk passes over them too and finds nothing.
 * Drafting is a different gesture — it takes every item of one colour or value at once — and until
 * it exists the column is inert. Being transparent to picking is also what stops a press there from
 * silently starting a drag that could never be completed.
 */
/**
 * Everything the ray may hit, in one list.
 *
 * Stems belong here even though they can never be dragged: they are spent as payment, which is a
 * click, and an object that is not a raycast root is invisible to *every* pick — so leaving them out
 * would make them unspendable and, worse, transparent, letting a press pass through a coin to
 * whatever sits behind it.
 */
function castTo(canvasX: number, canvasY: number): Object3D[] | null {
  const cam = activeCamera()
  const el = canvasEl()
  if (!cam || !el) return null
  ndc.set((canvasX / el.clientWidth) * 2 - 1, -(canvasY / el.clientHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, cam)
  return [...tileViews.values(), ...plateViews.values(), ...stemViews.values()].map(v => v.object)
}

/**
 * The topmost source tile under the pointer, whatever its drafting state.
 *
 * Separate from `pick` because these tiles are deliberately undraggable, so `pick` steps straight
 * over them. Clicking one is a different gesture from dragging it, and it needs its own path.
 *
 * Inactive tiles are returned too. The turn ignores the click (`toggleDraftSelection` refuses it),
 * but stopping the walk here means an inactive tile still *absorbs* the press rather than letting it
 * fall through to whatever is behind — which would otherwise select a tile the player was not
 * pointing at.
 */
function pickSourceItem(canvasX: number, canvasY: number): string | null {
  const roots = castTo(canvasX, canvasY)
  if (!roots) return null
  for (const hit of raycaster.intersectObjects(roots, true)) {
    let node: Object3D | null = hit.object
    while (node) {
      const owner = owners.get(node)
      if (owner) {
        // A stem is never in the source, so it can never be drafted.
        if (owner.kind === 'stem') return null
        if (owner.kind === 'plate') {
          // The slab of a revealed source plate. A face-down one is not draftable and absorbs the press.
          const plate = props.tableau.plate(owner.id)
          return plate?.location.kind === 'source' && !plate.faceDown ? owner.id : null
        }
        const tile = props.tableau.tile(owner.id)
        if (!tile) return null
        // A loose source tile answers for itself; a plate's token answers for its plate.
        if (tile.location.kind === 'source') return tile.id
        const key = draftKeyOfTile(tile)
        return key === tile.id ? null : key
      }
      node = node.parent
    }
  }
  return null
}

/**
 * The drawer item under the pointer — a tile in a slot, a plate in a bay, or a stem.
 *
 * Deliberately blind to everything else: the board and the source are not payment sources, so a click
 * there during payment should do nothing rather than something surprising.
 */
function pickDrawerItem(canvasX: number, canvasY: number): string | null {
  const roots = castTo(canvasX, canvasY)
  if (!roots) return null
  for (const hit of raycaster.intersectObjects(roots, true)) {
    let node: Object3D | null = hit.object
    while (node) {
      const owner = owners.get(node)
      if (owner) {
        if (owner.kind === 'stem') return owner.id
        if (owner.kind === 'plate') {
          return props.tableau.plate(owner.id)?.location.kind === 'plateSlot' ? owner.id : null
        }
        const tile = props.tableau.tile(owner.id)
        if (tile?.location.kind === 'drawer') return tile.id
        // A plate's token in a bay answers for its plate, exactly as it does when drafting.
        if (tile?.fixed && tile.location.kind === 'onPlate') {
          const plate = props.tableau.plate(tile.location.plateId)
          return plate?.location.kind === 'plateSlot' ? plate.id : null
        }
        return null
      }
      node = node.parent
    }
  }
  return null
}

function pick(canvasX: number, canvasY: number): Draggable | null {
  const roots = castTo(canvasX, canvasY)
  if (!roots) return null
  for (const hit of raycaster.intersectObjects(roots, true)) {
    let node: Object3D | null = hit.object
    while (node) {
      const owner = owners.get(node)
      if (owner) {
        /*
         * A stem is never draggable, and it is **opaque**: the walk stops here rather than climbing
         * past. The only thing a stem does is get spent when placing a tile (undesigned), so there is
         * no move to offer — but a press on one must not fall through to whatever is behind it either.
         */
        if (owner.kind === 'stem') return null
        const draggable = owner.kind === 'tile'
          ? props.tableau.canDragTile(owner.id)
          : props.tableau.canDragPlate(owner.id)
        if (draggable) return owner
      }
      // An immovable tile is transparent to picking: keep climbing, and since it is
      // parented to its plate the very next owner found is that plate.
      node = node.parent
    }
  }
  return null
}

/* ── target resolution ────────────────────────────────────────────────────────── */

/** The board cell under the held object's centre. */
function cellUnderHeld(): Axial | null {
  const cam = activeCamera()
  if (!cam) return null
  const at = heldPoint()
  const p = screenToBoard(cam, sizes.width.value, sizes.height.value, at.x, at.y)
  const cell = worldToAxial(p, HEX_SIZE)
  return props.tableau.isBoardCell(cell) ? cell : null
}

function resolveTarget(): void {
  const current = held.value
  targetTile = null
  targetTileCell = null
  targetPlate = null
  targetValid = false
  if (!current) return

  const l = layout.value
  const at = heldPoint()
  const overDrawer = l.contains(at.x, at.y)

  /*
   * Over the shared source: no target at all, valid or otherwise.
   *
   * The column is drawn over the board, so without this the cell *hidden behind it* would resolve as
   * the target and the piece would drop onto a cell the player cannot see. The drawer already has
   * exactly this guard; the source needs its own because it is a separate rectangle.
   *
   * Returning nothing rather than an invalid target is the honest answer: putting something back into
   * the source is not a move that exists.
   */
  if (sourceLayout.value.contains(at.x, at.y)) {
    emitTarget()
    return
  }

  if (current.kind === 'tile') {
    if (overDrawer) {
      // A tile may go in a tile slot. The plate slots and the frame take nothing.
      const slot = l.slotAt(at.x, at.y)
      targetTile = slot === null ? null : { kind: 'drawer', slot }
    } else {
      const cell = cellUnderHeld()
      // petalAt returns null for the hole and for any uncovered cell, which is exactly
      // the "tiles only go into plate petals" rule.
      targetTile = cell ? props.tableau.petalAt(cell) : null
      targetTileCell = targetTile ? cell : null
    }
    targetValid = targetTile !== null && props.tableau.canPlaceTile(targetTile, current.id)
  } else {
    if (overDrawer) {
      const slot = l.plateSlotAt(at.x, at.y)
      targetPlate = slot === null ? null : { kind: 'plateSlot', slot }
    } else {
      // A plate's origin is its hole, so its centre resolves straight to the hole cell.
      const cell = cellUnderHeld()
      targetPlate = cell ? { kind: 'board', hole: cell } : null
    }
    targetValid = targetPlate !== null && props.tableau.canPlacePlate(targetPlate, current.id)
  }

  emitTarget()
}

function emitTarget(): void {
  let cells: Axial[] = []
  let tileSlot: number | null = null
  let plateSlot: number | null = null

  if (targetTile?.kind === 'drawer') {
    tileSlot = targetTile.slot
  } else if (targetTile?.kind === 'onPlate') {
    // The cell we resolved from — never re-derived from the petal index.
    if (targetTileCell) cells = [targetTileCell]
  } else if (targetPlate?.kind === 'plateSlot') {
    plateSlot = targetPlate.slot
  } else if (targetPlate?.kind === 'board') {
    // Show the whole flower, so it is obvious what the plate will cover.
    const hole = targetPlate.hole
    cells = [hole, ...Array.from({ length: 6 }, (_, i) => petalCell(hole, i))]
  }

  const key = `${cells.map(c => `${c.q},${c.r}`).join('|')}/${tileSlot}/${plateSlot}/${targetValid}`
  if (key === lastEmitted) return
  lastEmitted = key
  emit('target', cells, targetValid)
  emit('drawerTarget', tileSlot, plateSlot, targetValid)
}

/* ── pointer handlers ─────────────────────────────────────────────────────────── */

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const c = pointerToCanvas(e)
  if (!c) return

  // Drafting: a click on a source tile is a selection, never a drag.
  if (props.draftStates) {
    const itemId = pickSourceItem(c.x, c.y)
    if (itemId !== null) {
      emit('selectTile', itemId)
      return
    }
  }

  // Paying: a click on anything in the drawer picks it as payment. Nothing is dragged in this phase.
  if (props.payStates) {
    const payerId = pickDrawerItem(c.x, c.y)
    if (payerId !== null) emit('selectPayment', payerId)
    return
  }

  // Outside the `putting` phase nothing is draggable — see the `draggable` prop.
  if (!props.draggable) return

  const hit = pick(c.x, c.y)
  if (!hit) return

  held.value = hit
  pointer.x = c.x
  pointer.y = c.y

  // Keep the piece where it already is relative to the cursor.
  const view = hit.kind === 'tile' ? tileViews.get(hit.id) : plateViews.get(hit.id)
  grabOffset.x = view ? view.screenX - c.x : 0
  grabOffset.y = view ? view.screenY - c.y : 0

  document.body.style.cursor = 'grabbing'
  reportHoverPlateSlot(null)
  resolveTarget()

  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp, { once: true })
}

function onWindowPointerMove(e: PointerEvent): void {
  if (!held.value) return
  const c = pointerToCanvas(e)
  if (!c) return
  pointer.x = c.x
  pointer.y = c.y
  resolveTarget()
}

function onWindowPointerUp(): void {
  window.removeEventListener('pointermove', onWindowPointerMove)
  document.body.style.cursor = ''
  const current = held.value

  if (current && targetValid) {
    const ontoBoard = current.kind === 'tile'
      // A tile only ever goes into a petal, so "onto the board" means its plate is on the board.
      ? targetTile?.kind === 'onPlate'
        && props.tableau.plate(targetTile.plateId)?.location.kind === 'board'
      : targetPlate?.kind === 'board'
    // Captured before the move, because that is what Cancel has to restore.
    const origin = current.kind === 'tile'
      ? props.tableau.tile(current.id)?.location
      : props.tableau.plate(current.id)?.location
    const moved = current.kind === 'tile'
      ? targetTile !== null && props.tableau.moveTile(current.id, targetTile)
      : targetPlate !== null && props.tableau.movePlate(current.id, targetPlate)
    if (moved) {
      emit('changed')
      // Reaching the board opens the payment; rearranging the drawer does not.
      if (ontoBoard && origin) emit('placed', current, origin)
    }
  }

  held.value = null
  grabOffset.x = 0
  grabOffset.y = 0
  targetTile = null
  targetTileCell = null
  targetPlate = null
  targetValid = false
  lastEmitted = ''
  emit('target', [], false)
  emit('drawerTarget', null, null, false)
}

let lastHoverPlateSlot: number | null = null

function reportHoverPlateSlot(slot: number | null): void {
  if (slot === lastHoverPlateSlot) return
  lastHoverPlateSlot = slot
  emit('hoverPlateSlot', slot)
}

/**
 * The bay under a screen point, if it holds a plate.
 *
 * The hover region for the rotate buttons is this **rectangle**, not the plate's own
 * geometry. Raycasting the plate is far too strict: a flower has gaps between its petals,
 * and the buttons sit in the bay's corners where there is no petal at all — so crossing
 * either would report a miss, drop the hover, and make the buttons vanish unless you moved
 * fast enough to outrun the gap. The bay contains the plate and both buttons, so with the
 * rectangle there is no gap anywhere and no dependence on pointer speed.
 */
function plateBayAt(canvasX: number, canvasY: number): number | null {
  const slot = layout.value.plateSlotAt(canvasX, canvasY)
  if (slot === null) return null
  const occupied = props.tableau.plates().some(
    plate => plate.location.kind === 'plateSlot' && plate.location.slot === slot,
  )
  return occupied ? slot : null
}

function onCanvasPointerMove(e: PointerEvent): void {
  if (held.value) return
  const c = pointerToCanvas(e)
  if (!c) return
  const hit = pick(c.x, c.y)
  document.body.style.cursor = hit ? 'grab' : ''

  // Rotate buttons appear only for a plate resting in a bay — never for one on the board.
  reportHoverPlateSlot(plateBayAt(c.x, c.y))
}

function onCanvasPointerLeave(): void {
  document.body.style.cursor = ''
  reportHoverPlateSlot(null)
}

/**
 * q / e turn the plate currently in hand. Only while dragging — a plate resting in a bay is
 * turned with its buttons, and a plate on the board is not turnable at all.
 */
function onKeyDown(e: KeyboardEvent): void {
  const current = held.value
  if (!current || current.kind !== 'plate') return
  const key = e.key.toLowerCase()
  const steps = key === 'e' ? 1 : key === 'q' ? -1 : 0
  if (steps === 0) return
  e.preventDefault()
  if (props.tableau.rotatePlate(current.id, steps)) emit('changed')
}

/* ── per-frame placement ──────────────────────────────────────────────────────── */

const desired = new Vector3()

onBeforeRender(({ delta }) => {
  const cam = activeCamera()
  if (!cam) return
  const w = sizes.width.value
  const h = sizes.height.value
  const upp = unitsPerPixel(cam, h)
  const ease = Math.min(1, delta * 16)
  const current = held.value
  const l = layout.value
  const src = sourceLayout.value

  // Plates first: tiles are positioned through them.
  for (const [id, view] of plateViews) {
    const plate = props.tableau.plate(id)
    if (!plate) continue

    // A plate is drafted — and spent — as a whole object, so the marker covers the whole plate.
    if (view.decor) {
      showDraftState(view.decor, props.draftStates?.get(id) ?? props.payStates?.get(id) ?? 'active')
    }

    if (current?.kind === 'plate' && current.id === id) {
      setRegime(view, 'held')
      const at = heldPoint()
      view.screenX = at.x
      view.screenY = at.y
      view.fresh = false
      const p = screenToBoard(cam, w, h, view.screenX, view.screenY)
      view.world.set(p.x, HELD_TILE_Y, p.z)
      approachScale(view, 1, ease)
    } else if (plate.location.kind === 'plateSlot') {
      setRegime(view, 'drawer')
      const c = l.plateSlotCentre(plate.location.slot)
      easeScreen(view, c.x, c.y, ease)
      const p = screenToBoard(cam, w, h, view.screenX, view.screenY)
      view.world.set(p.x, DRAWER_TILE_Y, p.z)
      approachScale(view, drawerPlateScale(upp), ease)
    } else if (plate.location.kind === 'source') {
      setRegime(view, 'source')
      const c = src.lotCentre(plate.location.lot)
      easeScreen(view, c.x, c.y, ease)
      const p = screenToBoard(cam, w, h, view.screenX, view.screenY)
      view.world.set(p.x, SOURCE_PLATE_Y, p.z)
      approachScale(view, sourcePlateScale(upp, src.plateWidth), ease)
    } else {
      setRegime(view, 'board')
      const c = axialToWorld(plate.location.hole, HEX_SIZE)
      desired.set(c.x, PLATE_BASE_Y, c.z)
      if (view.fresh) { view.world.copy(desired); view.fresh = false }
      else view.world.lerp(desired, ease)
      approachScale(view, 1, ease)
      const s = boardToScreen(cam, w, h, view.world.x, view.world.z)
      view.screenX = s.x
      view.screenY = s.y
    }

    // Ease toward the plate's rotation. `rotation` is a running integer, never wrapped, so
    // this angle is continuous — a step from 5 to 0 turns 60° on, not 300° back.
    const spinTarget = -plate.rotation * (Math.PI / 3)
    view.spin += (spinTarget - view.spin) * Math.min(1, delta * PLATE_SPIN_EASE)
    if (Math.abs(spinTarget - view.spin) < 0.0005) view.spin = spinTarget
    view.object.rotation.y = view.spin

    view.object.position.copy(view.world)
    view.object.scale.setScalar(view.scale)
    view.object.updateMatrixWorld()
  }

  /*
   * Stems sit in drawer slots exactly as tiles do, and at the same size — they displace a tile, so
   * looking like one costs is the point.
   */
  for (const stem of props.tableau.stems()) {
    const view = stemViews.get(stem.id)
    if (!view) continue
    if (view.decor) showDraftState(view.decor, props.payStates?.get(stem.id) ?? 'active')
    setRegime(view, 'drawer')
    const c = l.slotCentre(stem.slot)
    easeScreen(view, c.x, c.y, ease)
    const p = screenToBoard(cam, w, h, view.screenX, view.screenY)
    view.world.set(p.x, DRAWER_TILE_Y, p.z)
    approachScale(view, drawerTileScale(upp), ease)
    view.object.position.copy(view.world)
    view.object.scale.setScalar(view.scale)
  }

  for (const [id, view] of tileViews) {
    const tile = props.tableau.tile(id)
    if (!tile) continue

    /*
     * Drafting overlays.
     *
     * Driven every frame from the incoming map rather than on change, so a tile leaving the source —
     * or the draft being cancelled — clears its overlay without anything having to remember to. The
     * map is null when not drafting, which reads as "no state, show none".
     */
    if (view.decor) {
      // A tile is marked either as a draft candidate in the source or as a payer in the drawer —
      // never both, since those are different places and different phases.
      showDraftState(view.decor, props.draftStates?.get(id) ?? props.payStates?.get(id) ?? 'active')
    }

    if (current?.kind === 'tile' && current.id === id) {
      setRegime(view, 'held')
      reparent(view.object, scene.value)
      const at = heldPoint()
      view.screenX = at.x
      view.screenY = at.y
      view.fresh = false
      const p = screenToBoard(cam, w, h, view.screenX, view.screenY)
      view.world.set(p.x, HELD_TILE_Y, p.z)
      approachScale(view, 1, ease)
      view.object.position.copy(view.world)
      view.object.scale.setScalar(view.scale)
      // No parent spin to cancel once it is off the plate.
      view.object.rotation.y = 0
    } else if (tile.location.kind === 'drawer') {
      setRegime(view, 'drawer')
      reparent(view.object, scene.value)
      const c = l.slotCentre(tile.location.slot)
      easeScreen(view, c.x, c.y, ease)
      const p = screenToBoard(cam, w, h, view.screenX, view.screenY)
      view.world.set(p.x, DRAWER_TILE_Y, p.z)
      approachScale(view, drawerTileScale(upp), ease)
      view.object.position.copy(view.world)
      view.object.scale.setScalar(view.scale)
      view.object.rotation.y = 0
    } else if (tile.location.kind === 'source') {
      /*
       * Heaped on the lot's face-down plate, not seated in a petal.
       *
       * Positioned from the **lot**, not from the plate, even though it lands on top of it. The
       * plate can be drafted away while its tiles remain, and parenting to it would leave them
       * with nothing to hang off. The scatter offsets are in plate-scale world units, so
       * multiplying by the same scale the plate uses keeps the heap in proportion with it.
       */
      setRegime(view, 'source')
      reparent(view.object, scene.value)
      const lot = tile.location.lot
      // The heap's identity is its plate, so its arrangement survives the stack shifting down. Falls
      // back to the slot only if the lot somehow has no plate, which nothing can currently cause.
      const heapKey = props.tableau.plateInSourceLot(lot)?.id ?? `lot${lot}`
      const c = src.lotCentre(lot)
      easeScreen(view, c.x, c.y, ease)
      const p = screenToBoard(cam, w, h, view.screenX, view.screenY)
      const s = sourceTileScale(upp, src.plateHeight)
      // Scatter offsets are in tile-radii, so they convert with the tile's own world radius — which
      // is what keeps the heap's shape identical whether the tiles are at drawer size or clamped.
      const radius = TILE_SIZE * s
      const offset = scatterFor(heapKey)[tile.location.index]
      const layer = offset ? offset.layer : 0
      // A selected tile rides above the heap so its ring cannot be occluded by a neighbour.
      const lift = props.draftStates?.get(id) === 'selected' ? SOURCE_TILE_SELECT_LIFT : 0
      view.world.set(
        p.x + (offset?.x ?? 0) * radius,
        SOURCE_TILE_Y + layer * SOURCE_TILE_LAYER_STEP + lift,
        p.z + (offset?.z ?? 0) * radius,
      )
      approachScale(view, s, ease)
      view.object.position.copy(view.world)
      view.object.scale.setScalar(view.scale)
      // Upright, like every other tile. A tossed angle would read well but would tilt the symbol,
      // and keeping symbols square to the screen is a rule the plates already follow.
      view.object.rotation.y = 0
    } else {
      // Rigid with the plate: parented to it, so it inherits the plate's position and
      // scale exactly and on the same frame. Only the local settle into the petal eases.
      const plateView = plateViews.get(tile.location.plateId)
      if (!plateView) continue
      setRegime(view, tile.location.plateId)
      reparent(view.object, plateView.object)
      const offset = petalOffset(tile.location.petal)
      desired.set(offset.x, tile.fixed ? PLATE_TOKEN_LIFT : PLATE_TILE_LIFT, offset.z)
      // Ease into the petal, then sit exactly in it. A lerp only ever converges
      // asymptotically, and "almost rigid" is what the lag looked like in the first place.
      if (view.fresh || view.object.position.distanceToSquared(desired) < 1e-6) {
        view.object.position.copy(desired)
        view.fresh = false
      } else {
        view.object.position.lerp(desired, ease)
      }
      approachScale(view, 1, ease)
      view.object.scale.setScalar(view.scale)
      // Undo the plate's spin so the tile's symbol reads upright at every rotation.
      view.object.rotation.y = -plateView.spin
      // Keep the world and screen anchors current, so being picked up starts from here.
      view.object.updateMatrixWorld()
      view.object.getWorldPosition(view.world)
      const s = boardToScreen(cam, w, h, view.world.x, view.world.z)
      view.screenX = s.x
      view.screenY = s.y
    }
  }
})

/* ── setup ────────────────────────────────────────────────────────────────────── */

function tileMaterialFor(colorIndex: number): Material {
  const existing = tileMaterials.get(colorIndex)
  if (existing) return existing
  const created = createTileMaterial(colorIndex as TileColorIndex)
  tileMaterials.set(colorIndex, created)
  return created
}

/**
 * Bring the scene in line with the model: create views for anything new, drop views for anything gone.
 *
 * **Not a one-off build.** The source restocks during play — a fresh face-down plate and four tiles are
 * pushed on at the start of a turn — so objects appear after mount. An `onMounted`-only build left those
 * with no mesh at all: the model was correct and the top slot rendered empty, which is a whole class of
 * bug that looks like broken rules.
 *
 * Driven by the `revision` prop rather than run every frame. Every model mutation bumps it, so this
 * fires exactly when something could have changed and never allocates in the render loop.
 */
function reconcileViews(): void {
  // Tile views need their symbol texture, so there is nothing to do until the textures land. The
  // revision watcher will call again, and the load itself calls once.
  if (disposed || symbolTextures.length === 0) return

  for (const plate of props.tableau.plates()) {
    const existing = plateViews.get(plate.id)
    if (existing) {
      // A plate that turned over: its face is baked into the mesh, so rebuild rather than restyle.
      if (existing.faceDown === plate.faceDown) continue
      if (existing.decor) disposeDraftDecor(existing.decor)
      scene.value?.remove(existing.object)
      owners.delete(existing.object)
      plateViews.delete(plate.id)
    }
    // A face-down plate shows its blank reverse. Chosen at creation rather than swapped later: nothing
    // flips a plate yet, and revealing one will need to rebuild its view regardless.
    const group: Group = plate.faceDown ? createPlateBackVisual() : createPlateVisual()
    group.renderOrder = 1
    const plateDecor = attachPlateDraftDecor(group)
    plateViews.set(plate.id, {
      object: group,
      world: new Vector3(),
      screenX: 0,
      screenY: 0,
      scale: 1,
      spin: -plate.rotation * (Math.PI / 3),
      regime: '',
      settled: false,
      fresh: true,
      faceDown: plate.faceDown,
      decor: plateDecor,
    })
    group.rotation.y = -plate.rotation * (Math.PI / 3)
    owners.set(group, { kind: 'plate', id: plate.id })
    scene.value.add(group)
    unregisters.push(registerGrabbable(group))
  }

  for (const tile of props.tableau.tiles()) {
    if (tileViews.has(tile.id)) continue
    const faceY = tileFaceY(tile.fixed)
    const mesh = new Mesh(tile.fixed ? tokenGeometry : tileGeometry, tileMaterialFor(tile.color))
    mesh.renderOrder = 4
    const texture = symbolTextures[
      Math.min(symbolTextures.length, Math.max(1, tile.value)) - 1
    ]
    if (texture) {
      mesh.add(createSymbolPlane(texture, {
        fitRadius: hexApothemOf(TILE_SIZE) * SYMBOL_FIT * symbolScaleFor(tile.value),
        offsetUp: HEX_SIZE * symbolOffsetUpFor(tile.value),
        y: faceY + 0.008,
      }))
    }
    tileViews.set(tile.id, {
      object: mesh,
      world: new Vector3(),
      screenX: 0,
      screenY: 0,
      scale: 1,
      spin: 0,
      regime: '',
      settled: false,
      fresh: true,
      decor: attachDraftDecor(mesh, faceY),
    })
    owners.set(mesh, { kind: 'tile', id: tile.id })
    scene.value.add(mesh)
    unregisters.push(registerGrabbable(mesh))
  }

  for (const stem of props.tableau.stems()) {
    if (stemViews.has(stem.id)) continue
    const coin = createStemVisual()
    const coinDecor = attachCoinDraftDecor(coin)
    stemViews.set(stem.id, {
      object: coin,
      world: new Vector3(),
      screenX: 0,
      screenY: 0,
      scale: 1,
      spin: 0,
      regime: '',
      settled: false,
      fresh: true,
      decor: coinDecor,
    })
    owners.set(coin, { kind: 'stem', id: stem.id })
    scene.value.add(coin)
    unregisters.push(registerGrabbable(coin))
  }

  /*
   * Anything the model no longer has.
   *
   * Paying for a placement is the first thing that destroys objects, and it can destroy any of the
   * three kinds — so all three are swept. A missing branch here does not merely leak a mesh: the
   * object stays on the table, still clickable, long after the rules say it was spent.
   */
  const liveStems = new Set(props.tableau.stems().map(stem => stem.id))
  for (const [id, view] of [...stemViews]) {
    if (liveStems.has(id)) continue
    if (view.decor) disposeDraftDecor(view.decor)
    view.object.parent?.remove(view.object)
    owners.delete(view.object)
    stemViews.delete(id)
  }
  for (const [id, view] of [...plateViews]) {
    if (props.tableau.plate(id)) continue
    if (view.decor) disposeDraftDecor(view.decor)
    scene.value?.remove(view.object)
    owners.delete(view.object)
    plateViews.delete(id)
  }
  for (const [id, view] of [...tileViews]) {
    if (props.tableau.tile(id)) continue
    if (view.decor) disposeDraftDecor(view.decor)
    view.object.parent?.remove(view.object)
    owners.delete(view.object)
    tileViews.delete(id)
  }
}

// Objects can appear or vanish at any point in play, so views follow the model rather than the mount.
watch(() => props.revision, reconcileViews)

let canvas: HTMLCanvasElement | null = null

onMounted(() => {
  canvas = canvasEl()
  canvas?.addEventListener('pointerdown', onPointerDown)
  canvas?.addEventListener('pointermove', onCanvasPointerMove)
  canvas?.addEventListener('pointerleave', onCanvasPointerLeave)
  window.addEventListener('keydown', onKeyDown)

  const loader = new TextureLoader()
  Promise.all(
    SYMBOL_TEXTURE_URLS.map(
      url => new Promise<Texture>((resolve, reject) => {
        loader.load(url, resolve, undefined, reject)
      }),
    ),
  )
    .then(loaded => {
      symbolTextures.push(...loaded)
      reconcileViews()
    })
    .catch((error: unknown) => {
      console.error('[hexnome] failed to load symbol textures', error)
    })
})

onBeforeUnmount(() => {
  disposed = true
  canvas?.removeEventListener('pointerdown', onPointerDown)
  canvas?.removeEventListener('pointermove', onCanvasPointerMove)
  canvas?.removeEventListener('pointerleave', onCanvasPointerLeave)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('pointermove', onWindowPointerMove)
  document.body.style.cursor = ''
  for (const off of unregisters) off()
  unregisters.length = 0

  for (const view of tileViews.values()) {
    if (view.decor) disposeDraftDecor(view.decor)
    view.object.parent?.remove(view.object)
    for (const child of view.object.children) {
      const mesh = child as Mesh
      mesh.geometry?.dispose()
      ;(mesh.material as Material | undefined)?.dispose()
    }
  }
  for (const view of plateViews.values()) {
    if (view.decor) disposeDraftDecor(view.decor)
    scene.value?.remove(view.object)
  }
  for (const view of stemViews.values()) {
    if (view.decor) disposeDraftDecor(view.decor)
    scene.value?.remove(view.object)
  }
  stemViews.clear()
  tileViews.clear()
  plateViews.clear()
  owners.clear()

  for (const material of tileMaterials.values()) material.dispose()
  tileMaterials.clear()
  for (const texture of symbolTextures) texture.dispose()
  symbolTextures.length = 0
  tileGeometry.dispose()
  tokenGeometry.dispose()
  disposePlateVisualAssets()
  disposePlateBackAssets()
  disposeDraftDecorAssets()
  disposePlateDraftDecorAssets()
  disposeCoinDraftDecorAssets()
  disposeStemAssets()
  scatterCache.clear()
})
</script>

<template>
  <TresGroup />
</template>
