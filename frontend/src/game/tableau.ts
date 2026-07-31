/**
 * Where every plate and tile is, and which moves are legal.
 *
 * Pure TypeScript over plain data — no `vue`, no `three` (docs/tech-spec.md).
 *
 * **Tiles are addressed relative to their plate, not by board cell.** A tile may only
 * ever sit in a petal of a plate, so no tile ever occupies a bare cell, and `(plate,
 * petal)` is the natural address. The payoff is that a plate carries its tiles with it
 * for free: move the plate and nothing about its tiles needs rewriting. Addressing tiles
 * by cell would mean remapping every tile on a plate each time it moved, which is
 * exactly the kind of bookkeeping that goes wrong.
 *
 * Board coverage is derived from the plates rather than stored alongside them, so the two
 * cannot disagree.
 *
 * **Three places an item can be**, and they behave differently: your own board and drawer, and the
 * **shared source** — the pick-from column everyone drafts out of. Source plates lie face down, and
 * a lot's loose tiles are heaped *on* its plate without belonging to it. See `TileLocation`.
 *
 * A third kind of object, the **stem**, lives only in the drawer and shares its slots with tiles — see
 * `Stem`. Occupancy for both runs through one index, so a slot can never hold two things.
 */
import { NEIGHBOR_DIRS, axialAdd, axialKey, type Axial } from './hex'
import {
  DEFAULT_PLACEMENT_RULE,
  groupsAllow,
  neighboursAllow,
  ringIsConnected,
  type PlacementRule,
} from './placement'
import { PETAL_COUNT, isPetal, normalizePetal, petalCell, plateCells } from './plate'

export type PlateLocation =
  | { readonly kind: 'board', readonly hole: Axial }
  | { readonly kind: 'plateSlot', readonly slot: number }
  /** Face-down in a lot of the shared source, waiting to be picked. */
  | { readonly kind: 'source', readonly lot: number }

export type TileLocation =
  | { readonly kind: 'drawer', readonly slot: number }
  | { readonly kind: 'onPlate', readonly plateId: string, readonly petal: number }
  /**
   * Lying loose in a lot of the shared source.
   *
   * Deliberately **not** a petal of the lot's plate. These tiles are heaped on top of a face-down
   * plate, and they are drafted separately from it — a draft takes every item of one colour or one
   * value, which may be some of a lot's tiles, its plate, or both. Addressing them as petals would
   * claim they belong to the plate, and then picking the plate would wrongly carry them along.
   *
   * `index` is a slot within the lot, so two tiles cannot occupy one position.
   */
  | { readonly kind: 'source', readonly lot: number, readonly index: number }

export interface Plate {
  readonly id: string
  readonly location: PlateLocation
  /**
   * Clockwise rotation in sixth-turn steps.
   *
   * A flower is six-fold symmetric, so rotating a plate never changes *which* seven cells
   * it covers — only which petal points where. Fit and connection are therefore unaffected by it;
   * the neighbour rule is not, since turning the plate moves its own tile to a different cell.
   *
   * Deliberately **not** wrapped into 0…5. Kept as a running integer so the rendered angle
   * is continuous and can be eased; wrapping would make a step from 5 to 0 look like a
   * 300° lurch backwards. Every logical use takes it modulo six.
   */
  readonly rotation: number
  /**
   * True while the plate is reverse side up and its own tile is not shown.
   *
   * Plates in the shared source arrive face down, so what you are drafting is partly hidden: you
   * can see the loose tiles heaped on a lot but not which tile the plate itself carries.
   *
   * The plate's own tile is **not created while it is face down**. Nothing should be able to read a
   * hidden value out of the model — not the renderer, not a future opponent's client — and the
   * surest way to guarantee that is for it not to be there. The tile is added on reveal, from the
   * deck that dealt it.
   */
  readonly faceDown: boolean
}

export interface TileSpec {
  /** Index into the six-colour palette. */
  readonly color: number
  /** 1–6, the ordered symbol values. */
  readonly value: number
}

export interface Tile extends TileSpec {
  readonly id: string
  readonly location: TileLocation
  /**
   * True for a plate's **own** tile — the one it arrives with. Plate and tile are one
   * indivisible object, so this tile cannot be lifted off, moved to another petal, or
   * returned to the drawer. It travels with the plate and nowhere else.
   *
   * It is still a full tile in every other respect, and deliberately so: it takes part in
   * colour and value groups exactly like any other. Folding it into the `Plate` record
   * would hide it from anything that enumerates tiles — scoring, most obviously — which is
   * a bug waiting to be written. So it exists as a tile and is merely immovable.
   */
  readonly fixed: boolean
}

/**
 * A **stem** — the game's joker, a stem cell.
 *
 * Lives only in the player's drawer, in an ordinary **tile slot**: a stem in your drawer is one fewer
 * place to put a drafted tile, which is what makes carrying them a real cost.
 *
 * It is deliberately *not* a `Tile`. A stem has no colour and no symbol, so it cannot be drafted,
 * matched, scored or placed — and modelling it as a tile with null fields would put those questions
 * into every piece of code that handles tiles. It shares only the thing it genuinely shares: the slot.
 *
 * Stems can never reach the board. They are spent when placing tiles — how, exactly, is undesigned
 * (docs/game-design.md, open questions).
 */
export interface Stem {
  readonly id: string
  /** Always a drawer slot. Stems have nowhere else to be. */
  readonly slot: number
}

/**
 * A cell that pays out when the six cells around it are all filled.
 *
 * **Both kinds are the same shape of thing** — a cell with six neighbours — and that is the point of
 * modelling them as cells rather than as properties of a plate. Enclosure, the strict ring and the
 * reward are then one question asked once, and only the *rate* differs by kind.
 *
 * - `internal` — a plate's centre hole. Every placed plate has exactly one, always.
 * - `external` — a bare cell that no plate covers, with all six neighbours covered. These appear when
 *   a plate is placed in a way that wraps a gap, which is possible because plates need only connect,
 *   not interlock (docs/game-design.md, open question 10). On a perfectly tessellated board there are
 *   none at all.
 */
export type AnchorKind = 'internal' | 'external'

export interface Anchor {
  readonly cell: Axial
  readonly kind: AnchorKind
}

/** What a plate puts on a board cell. `petal` is null for the hole. */
export interface Coverage {
  readonly plateId: string
  readonly petal: number | null
}

export function plateLocationKey(location: PlateLocation): string {
  switch (location.kind) {
    case 'board': return `plate:board:${axialKey(location.hole)}`
    case 'plateSlot': return `plate:slot:${location.slot}`
    case 'source': return `plate:source:${location.lot}`
  }
}

export function tileLocationKey(location: TileLocation): string {
  switch (location.kind) {
    case 'drawer': return `tile:drawer:${location.slot}`
    case 'onPlate': return `tile:plate:${location.plateId}:${location.petal}`
    case 'source': return `tile:source:${location.lot}:${location.index}`
  }
}

export interface Tableau {
  readonly drawerSlots: number
  readonly plateSlots: number
  /** Lots in the shared source — the pick-from area. */
  readonly sourceLots: number
  /** Loose tiles a source lot has room for, heaped on its face-down plate. */
  readonly sourceTilesPerLot: number

  tiles(): readonly Tile[]
  plates(): readonly Plate[]
  plate(id: string): Plate | undefined
  tile(id: string): Tile | undefined

  /** The face-down plate in a source lot, if it still holds one. */
  plateInSourceLot(lot: number): Plate | undefined
  /** Loose tiles in a source lot, in index order. */
  tilesInSourceLot(lot: number): readonly Tile[]
  /** A plate's own tile — the one it arrived with. Absent while the plate is face down. */
  plateToken(plateId: string): Tile | undefined

  stems(): readonly Stem[]
  /**
   * Put a stem in a drawer slot.
   *
   * Shares the slot index with tiles, so a stem and a tile can never occupy the same slot and
   * `freeDrawerSlots` counts stems as taken without knowing what they are.
   */
  addStem(slot: number): Stem | undefined
  /**
   * Move a stem to another drawer slot.
   *
   * There is no other destination, and that is the rule rather than an omission: a stem cannot go to
   * the board. Expressing it as "the only move takes a slot number" makes the illegal move
   * unrepresentable instead of merely rejected.
   */
  moveStem(id: string, slot: number): boolean

  /** Which plate, if any, covers this board cell, and as what. */
  coverageAt(cell: Axial): Coverage | undefined
  /** The board cell a tile sits on, if its plate is on the board. */
  cellOfTile(id: string): Axial | undefined

  /**
   * May a plate go here?
   *
   * On the **board** that means two things: all seven cells are on the board and free, *and* the plate
   * touches one already placed — the tableau is a single connected sheet. The first plate is exempt,
   * having nothing to touch. Elsewhere it just means the bay or lot is empty.
   *
   * `movingId` excludes a plate from blocking itself, so "put it back where it is" is always legal.
   */
  canPlacePlate(location: PlateLocation, movingId?: string): boolean
  canPlaceTile(location: TileLocation, movingId?: string): boolean
  /**
   * May the player drag this tile? False for a plate's own tile, and for anything in the source.
   *
   * The UI consults this so it never offers a grab it cannot complete. Note what it is *not*: a
   * source tile is undraggable but still movable — drafting will move it via `moveTile`. Only
   * `fixed` is an absolute bar, and `moveTile` enforces that one itself.
   */
  canDragTile(id: string): boolean
  /**
   * May the player drag this plate? False while it sits in the shared source.
   *
   * Drafting is a different gesture from dragging a plate around your own tableau — it takes every
   * item of a colour or value at once, not one object under the cursor — so the drag controller must
   * not offer it. `movePlate` still works, which is how drafting will get plates out.
   */
  canDragPlate(id: string): boolean

  addPlate(
    location: PlateLocation,
    options?: { readonly rotation?: number, readonly faceDown?: boolean },
  ): Plate | undefined
  /**
   * Turn a face-down plate over, giving it the tile it has been carrying all along.
   *
   * Flipping and creating the token are one operation because they are one fact: `faceDown` means "this
   * plate's token is not known here". Letting a caller do half of it would allow a face-up plate with no
   * token, or a face-down plate whose token can be read — both of which the rest of the code assumes
   * cannot happen.
   *
   * The spec comes from outside because the model genuinely does not have it. That is the point: a
   * face-down plate holds no hidden value, so nothing local can leak it, and in multiplayer the reveal
   * will arrive from the server rather than being uncovered from data the client already had.
   */
  revealPlate(id: string, spec: TileSpec, petal: number): boolean
  /** Turn a plate by `steps` sixth-turns; positive is clockwise on screen. */
  rotatePlate(id: string, steps: number): boolean
  addTile(
    spec: TileSpec,
    location: TileLocation,
    options?: { readonly fixed?: boolean },
  ): Tile | undefined

  movePlate(id: string, location: PlateLocation): boolean
  moveTile(id: string, location: TileLocation): boolean

  /** Are all six of a plate's petals filled? Its anchor is lit exactly when this is true. */
  plateIsEnclosed(plateId: string): boolean
  /** Is an enclosed plate's ring of six connected pair-to-pair? Earns the strict bonus. */
  plateEnclosureIsStrict(plateId: string): boolean

  /** Every anchor on the board right now — plate holes, plus any bare cell the plates have wrapped. */
  anchors(): readonly Anchor[]
  /** Do all six cells around this one hold a tile? */
  anchorIsEnclosed(cell: Axial): boolean
  /** Is the ring of six around this cell connected pair-to-pair? */
  anchorRingIsStrict(cell: Axial): boolean
  /** Stems this anchor pays when enclosed, bonus included if its ring is strict. */
  anchorReward(anchor: Anchor): number

  /** Whatever sits in a drawer tile slot — a tile or a stem — by id. */
  drawerSlotOccupant(slot: number): string | undefined
  /** Whichever plate sits in a bay, by id. */
  plateSlotOccupant(slot: number): string | undefined

  /**
   * Exchange the drawer positions of two items.
   *
   * Rearranging your drawer is not a move in the game — it costs nothing and ends no turn — but a drawer
   * with no free slot could not be rearranged at all if the only tool were `moveTile`, which refuses an
   * occupied destination. Swapping is what makes a full drawer sortable.
   *
   * Either id may be a tile, a stem or a plate, but both must currently be **in the drawer** and in the
   * same kind of seat: two tile slots, or two bays. A tile and a plate cannot trade places, because the
   * seats are different sizes and a plate in a tile slot is not a position the game has.
   *
   * Both seats are vacated before either is filled. Writing one at a time would collide with the key the
   * other still holds, and the second write would be refused — leaving one item moved and one not.
   */
  swapDrawerItems(a: string, b: string): boolean

  /**
   * Remove a tile, plate or stem from the game entirely.
   *
   * Spending something to pay for a placement is not moving it anywhere — there is no discard pile, and
   * inventing a location for one would put a place in the model that the rules do not have.
   *
   * Takes an id of any kind so a caller settling a mixed payment does not have to sort tiles from plates
   * from stems first. Discarding a plate takes its tiles with it, since a tile addressed by petal cannot
   * outlive the plate it is addressed against.
   *
   * Returns false if nothing by that id exists.
   */
  discard(id: string): boolean

  /**
   * The tile-location a board cell corresponds to — an empty-or-not petal of whichever
   * plate covers it. Null for the hole or an uncovered cell, which is what makes
   * "tiles only go on plates" fall out of target resolution.
   */
  petalAt(cell: Axial): TileLocation | null

  freeDrawerSlots(): number[]
  freePlateSlots(): number[]
  isBoardCell(cell: Axial): boolean
}

export function createTableau({
  cells,
  drawerSlots,
  plateSlots,
  sourceLots = 0,
  sourceTilesPerLot = 0,
  placementRule = DEFAULT_PLACEMENT_RULE,
  stemsPerInternalAnchor = 0,
  stemsPerExternalAnchor = 0,
  strictEnclosureBonus = 0,
}: {
  cells: readonly Axial[]
  drawerSlots: number
  plateSlots: number
  sourceLots?: number
  sourceTilesPerLot?: number
  /**
   * How strictly a tile has to agree with its neighbours — a game setting, fixed for the game's
   * lifetime, so it is taken once here rather than passed to every call that asks about legality.
   */
  placementRule?: PlacementRule
  /**
   * Stems awarded for enclosing a plate's anchor — a game setting.
   *
   * The tableau needs it only to answer one question: whether a placement that *would* enclose a plate
   * has somewhere to put the reward. Defaults to zero so a tableau built without it — every test that
   * does not care — behaves as though there were no award at all.
   */
  stemsPerInternalAnchor?: number
  /** Stems awarded for enclosing an external anchor — a bare cell the plates have wrapped. */
  stemsPerExternalAnchor?: number
  /** Extra stems when an enclosure is strict all the way round. Zero when the game is already strict. */
  strictEnclosureBonus?: number
}): Tableau {
  const boardCells = new Set(cells.map(axialKey))
  const platesById = new Map<string, Plate>()
  const tilesById = new Map<string, Tile>()
  const stemsById = new Map<string, Stem>()
  /** locationKey → id, for both kinds. Occupancy lives here and nowhere else. */
  const occupants = new Map<string, string>()
  /** cellKey → coverage. Derived from the plates; rebuilt whenever they change. */
  let coverage = new Map<string, Coverage>()
  let nextId = 1

  function reindexCoverage(): void {
    const next = new Map<string, Coverage>()
    for (const plate of platesById.values()) {
      if (plate.location.kind !== 'board') continue
      const cellsOfPlate = plateCells(plate.location.hole)
      cellsOfPlate.forEach((cell, index) => {
        // plateCells puts the hole first, then the six directions in order. A cell lying in
        // direction d holds logical petal (d + rotation): the plate turned under it.
        next.set(axialKey(cell), {
          plateId: plate.id,
          petal: index === 0 ? null : normalizePetal(index - 1 + plate.rotation),
        })
      })
    }
    coverage = next
  }

  function isBoardCell(cell: Axial): boolean {
    return boardCells.has(axialKey(cell))
  }

  function plateFits(hole: Axial, movingId?: string): boolean {
    for (const cell of plateCells(hole)) {
      if (!isBoardCell(cell)) return false
      const covered = coverage.get(axialKey(cell))
      // Its own cells are fine — putting a plate back where it is, is a no-op.
      if (covered && covered.plateId !== movingId) return false
    }
    return true
  }

  /**
   * Does a plate at this hole touch one already on the board?
   *
   * **The board is one connected sheet.** Plates may not be dropped off on their own to be joined up
   * later: every plate after the first has to share an edge with what is already there, so the tableau
   * grows outward from the starting plate rather than as islands.
   *
   * Touching means **sharing an edge**, which for hexes is the same as being neighbours — so this asks
   * whether any of the new plate's seven cells has a neighbour belonging to another plate. Corner
   * contact does not arise: hexes have no corners that touch without an edge between them.
   *
   * The moving plate is excluded from "another", which matters twice. Sliding a plate to an adjacent
   * hole must not count its own old cells as the connection it needs, and the **first** plate on the
   * board has nothing to touch at all — with no other plates, this is vacuously true and anywhere is
   * legal. That is what lets the opening plate land in the middle of an empty board.
   */
  function plateConnects(hole: Axial, movingId?: string): boolean {
    let others = false
    for (const plate of platesById.values()) {
      if (plate.location.kind === 'board' && plate.id !== movingId) {
        others = true
        break
      }
    }
    if (!others) return true

    const own = new Set(plateCells(hole).map(axialKey))
    for (const cell of plateCells(hole)) {
      for (const dir of NEIGHBOR_DIRS) {
        const key = axialKey(axialAdd(cell, dir))
        // A cell of the plate itself is not something it can be connected *to*.
        if (own.has(key)) continue
        const covered = coverage.get(key)
        if (covered && covered.plateId !== movingId) return true
      }
    }
    return false
  }

  function inRange(n: number, limit: number): boolean {
    return Number.isInteger(n) && n >= 0 && n < limit
  }

  /**
   * Can the player pick this up with the pointer?
   *
   * Distinct from whether the model will move it, and the distinction is load-bearing. Being in the
   * shared source makes an item undraggable but not immovable: drafting will take items out of the
   * source, and it will do that through `moveTile`/`movePlate`. So this is the drag *affordance*,
   * while `fixed` — a plate's own tile — is an invariant the mutations enforce for every caller.
   *
   * Conflating the two would either let a drag lift a tile out of the source or leave drafting with
   * no way to move one.
   */
  function tileCanDrag(id: string): boolean {
    const tile = tilesById.get(id)
    if (!tile || tile.fixed) return false
    return tile.location.kind !== 'source'
  }

  function plateCanDrag(id: string): boolean {
    const plate = platesById.get(id)
    return plate !== undefined && plate.location.kind !== 'source'
  }

  /**
   * Where an item sits in the drawer, if it is in the drawer at all.
   *
   * The unit of a swap is the **seat**, not the item: a tile slot takes a tile or a stem
   * interchangeably, and a bay takes a plate. Resolving to a seat is what lets one swap handle all
   * three kinds without the caller sorting them first, and what makes "a plate cannot trade places with
   * a tile" a single comparison rather than a table of cases.
   */
  type DrawerSeat =
    | { readonly kind: 'tileSlot', readonly slot: number }
    | { readonly kind: 'bay', readonly slot: number }

  function drawerSeat(id: string): DrawerSeat | null {
    const stem = stemsById.get(id)
    if (stem) return { kind: 'tileSlot', slot: stem.slot }

    const tile = tilesById.get(id)
    if (tile) {
      // A plate's own tile is welded to it and has no seat of its own, wherever the plate is.
      if (tile.fixed || tile.location.kind !== 'drawer') return null
      return { kind: 'tileSlot', slot: tile.location.slot }
    }

    const plate = platesById.get(id)
    if (plate?.location.kind === 'plateSlot') return { kind: 'bay', slot: plate.location.slot }
    return null
  }

  /** Put a tile or stem in a drawer slot, assuming the slot has already been vacated. */
  function seatInTileSlot(id: string, slot: number): void {
    const key = tileLocationKey({ kind: 'drawer', slot })
    const stem = stemsById.get(id)
    if (stem) {
      stemsById.set(id, { id, slot })
      occupants.set(key, id)
      return
    }
    const tile = tilesById.get(id)
    if (!tile) return
    tilesById.set(id, { ...tile, location: { kind: 'drawer', slot } })
    occupants.set(key, id)
  }

  /** Put a plate in a bay, assuming the bay has already been vacated. */
  function seatInBay(id: string, slot: number): void {
    const plate = platesById.get(id)
    if (!plate) return
    platesById.set(id, { ...plate, location: { kind: 'plateSlot', slot } })
    occupants.set(plateLocationKey({ kind: 'plateSlot', slot }), id)
  }

  /** What tile, if any, is on this cell right now. */
  function settledTileAt(cell: Axial): Tile | undefined {
    const covered = coverage.get(axialKey(cell))
    if (!covered || covered.petal === null) return undefined
    const id = occupants.get(
      tileLocationKey({ kind: 'onPlate', plateId: covered.plateId, petal: covered.petal }),
    )
    return id === undefined ? undefined : tilesById.get(id)
  }

  /**
   * The board **as it would be** once a move lands: a cell → tile lookup.
   *
   * Both placement rules ask questions about the finished board rather than the current one — what a
   * tile would touch, what group it would join — so both take their answers from here. One view rather
   * than a bespoke lookup per rule is the point: two views would be two chances to disagree about what
   * "after the move" means.
   *
   * A moving **tile** vanishes from its old cell, or it would show up as its own neighbour when nudged
   * one petal along. A moving **plate** takes everything it carries with it: its tiles leave their old
   * cells and appear at the new ones, so they can be each other's neighbours at the destination.
   *
   * `landing` puts the moving tile at its destination. The placement rules do not want it — they supply
   * the placed tile separately and would double-count it — but anything asking about the *finished*
   * board, such as whether a ring of six is complete, very much does.
   */
  function boardAfter(move: {
    tileId?: string
    plateId?: string
    hole?: Axial
    rotation?: number
    landing?: { cell: Axial, spec: TileSpec }
  }): (cell: Axial) => TileSpec | undefined {
    const arriving = new Map<string, TileSpec>()
    if (move.landing) arriving.set(axialKey(move.landing.cell), move.landing.spec)
    if (move.plateId !== undefined && move.hole !== undefined) {
      for (const tile of tilesById.values()) {
        if (tile.location.kind !== 'onPlate' || tile.location.plateId !== move.plateId) continue
        const cell = cellOfPetal(move.hole, move.rotation ?? 0, tile.location.petal)
        arriving.set(axialKey(cell), tile)
      }
    }
    return cell => {
      const key = axialKey(cell)
      const incoming = arriving.get(key)
      if (incoming) return incoming
      const covered = coverage.get(key)
      // Everything the moving plate used to cover is empty now — it has gone.
      if (!covered || covered.plateId === move.plateId) return undefined
      const settled = settledTileAt(cell)
      return settled === undefined || settled.id === move.tileId ? undefined : settled
    }
  }

  /** The tiles on the six cells around this one, seen through a given board. */
  function neighboursOf(
    cell: Axial,
    view: (at: Axial) => TileSpec | undefined,
  ): TileSpec[] {
    const found: TileSpec[] = []
    for (const dir of NEIGHBOR_DIRS) {
      const tile = view(axialAdd(cell, dir))
      if (tile) found.push(tile)
    }
    return found
  }

  /** Drawer slots holding neither a tile nor a stem, in order. */
  function freeDrawerSlotList(): number[] {
    const free: number[] = []
    for (let slot = 0; slot < drawerSlots; slot++) {
      if (!occupants.has(tileLocationKey({ kind: 'drawer', slot }))) free.push(slot)
    }
    return free
  }

  /** How many of a plate's six petals hold a tile, with one move imagined as already made. */
  function filledPetals(plateId: string, move?: { into: number, movingId: string }): number {
    let filled = 0
    for (let petal = 0; petal < PETAL_COUNT; petal++) {
      const occupant = occupants.get(tileLocationKey({ kind: 'onPlate', plateId, petal }))
      const taken = move && petal === move.into
        ? true
        : occupant !== undefined && occupant !== move?.movingId
      if (taken) filled += 1
    }
    return filled
  }

  /**
   * Are all six of this plate's petals filled?
   *
   * Derived rather than stored, like coverage: a plate is enclosed exactly when its petals say so, and
   * a flag would be a second answer to the same question waiting to disagree. The consequence is that
   * enclosure is reversible — a provisional placement lights the anchor and cancelling it goes dark
   * again — which is what a player watching the board should see.
   */
  function plateIsEnclosed(plateId: string): boolean {
    return platesById.has(plateId) && filledPetals(plateId) === PETAL_COUNT
  }

  /** A plate's six petals in ring order, or null if any is empty. One move may be imagined as made. */
  function petalRing(plateId: string, move?: { into: number, movingId: string }): TileSpec[] | null {
    const ring: TileSpec[] = []
    for (let petal = 0; petal < PETAL_COUNT; petal++) {
      /*
       * Logical petal order *is* ring order. A petal `p` points in direction `p − rotation`, so
       * consecutive petals point in consecutive directions whatever the rotation — the whole ring is
       * offset, never reordered. That is what lets this walk 0…5 and get adjacent cells.
       */
      let tile: Tile | undefined
      if (move && petal === move.into) {
        tile = tilesById.get(move.movingId)
      } else {
        const id = occupants.get(tileLocationKey({ kind: 'onPlate', plateId, petal }))
        // The mover has left wherever it was; it only counts at its destination.
        tile = id === undefined || id === move?.movingId ? undefined : tilesById.get(id)
      }
      if (!tile) return null
      ring.push(tile)
    }
    return ring
  }

  /**
   * Is this plate not merely enclosed but enclosed *strictly* — every neighbouring pair around the
   * ring sharing a colour or a value?
   */
  function plateEnclosureIsStrict(plateId: string): boolean {
    const ring = petalRing(plateId)
    return ring !== null && ringIsConnected(ring)
  }

  /* ── anchors ─────────────────────────────────────────────────────────────────
   *
   * Everything below works on a *view* of the board rather than on the live one, so the same code
   * answers "how things are" and "how they would be after this move". `covered` reports which plate
   * covers a cell and `tileAt` what sits on it; a hypothetical simply supplies different functions.
   */

  interface BoardView {
    /** Cells the plates occupy, and which plate each belongs to. */
    covered: (cell: Axial) => string | undefined
    tileAt: (cell: Axial) => TileSpec | undefined
    /** Hole cells of every plate on the board — the internal anchors. */
    holes: Axial[]
    /** Every cell the plates occupy, for finding the bare cells beside them. */
    occupied: Axial[]
  }

  function boardPlatesWith(move?: PlateMove): { id: string, hole: Axial, rotation: number }[] {
    const list: { id: string, hole: Axial, rotation: number }[] = []
    for (const plate of platesById.values()) {
      if (plate.id === move?.plateId) continue
      if (plate.location.kind === 'board') {
        list.push({ id: plate.id, hole: plate.location.hole, rotation: plate.rotation })
      }
    }
    if (move) list.push({ id: move.plateId, hole: move.hole, rotation: move.rotation })
    return list
  }

  interface PlateMove { plateId: string, hole: Axial, rotation: number }
  interface TileMove { movingId: string, cell: Axial, spec: TileSpec }

  /** The board as it is, or as one move would leave it. */
  function viewOf(move?: { tile?: TileMove, plate?: PlateMove }): BoardView {
    const plates = boardPlatesWith(move?.plate)
    const owner = new Map<string, string>()
    const occupied: Axial[] = []
    for (const plate of plates) {
      for (const cell of plateCells(plate.hole)) {
        owner.set(axialKey(cell), plate.id)
        occupied.push(cell)
      }
    }
    const tileAt = move?.plate
      ? boardAfter({ plateId: move.plate.plateId, hole: move.plate.hole, rotation: move.plate.rotation })
      : boardAfter(move?.tile
        ? {
            tileId: move.tile.movingId,
            landing: { cell: move.tile.cell, spec: move.tile.spec },
          }
        : {})
    return {
      covered: cell => owner.get(axialKey(cell)),
      tileAt,
      holes: plates.map(plate => plate.hole),
      occupied,
    }
  }

  /** Every anchor in a view: one per plate hole, plus every bare cell the plates have wrapped. */
  function anchorsIn(view: BoardView): Anchor[] {
    const found: Anchor[] = []
    const seen = new Set<string>()
    for (const hole of view.holes) {
      seen.add(axialKey(hole))
      found.push({ cell: hole, kind: 'internal' })
    }
    /*
     * Candidates are the bare cells *touching* coverage — nothing further out can have six covered
     * neighbours, so this reaches every external anchor without walking the board.
     */
    for (const cell of view.occupied) {
      for (const dir of NEIGHBOR_DIRS) {
        const candidate = axialAdd(cell, dir)
        const key = axialKey(candidate)
        if (seen.has(key) || view.covered(candidate)) continue
        seen.add(key)
        if (NEIGHBOR_DIRS.every(step => view.covered(axialAdd(candidate, step)))) {
          found.push({ cell: candidate, kind: 'external' })
        }
      }
    }
    return found
  }

  /** The six tiles around a cell in ring order, or null if any of the six is missing. */
  function ringAround(cell: Axial, view: BoardView): TileSpec[] | null {
    const ring: TileSpec[] = []
    for (const dir of NEIGHBOR_DIRS) {
      const tile = view.tileAt(axialAdd(cell, dir))
      if (!tile) return null
      ring.push(tile)
    }
    return ring
  }

  function rewardOf(anchor: Anchor, view: BoardView): number {
    const ring = ringAround(anchor.cell, view)
    if (ring === null) return 0
    const base = anchor.kind === 'internal' ? stemsPerInternalAnchor : stemsPerExternalAnchor
    return base + (ringIsConnected(ring) ? strictEnclosureBonus : 0)
  }

  /**
   * What a move would pay: every anchor it closes, summed.
   *
   * **Newly** closed — enclosed afterwards and not before. One move can close more than one at once (a
   * tile sits beside up to six anchors; a plate can wrap a gap and fill it in the same action), and
   * reserving room for only one of them would let the rest overflow the drawer.
   *
   * An anchor that did not exist before the move counts as newly closed, which is what makes a plate
   * that creates *and* immediately encloses an external anchor pay out.
   */
  function rewardOfMove(move: { tile?: TileMove, plate?: PlateMove }): number {
    const before = viewOf()
    const enclosedBefore = new Set(
      anchorsIn(before)
        .filter(anchor => ringAround(anchor.cell, before) !== null)
        .map(anchor => axialKey(anchor.cell)),
    )
    const after = viewOf(move)
    let total = 0
    for (const anchor of anchorsIn(after)) {
      if (enclosedBefore.has(axialKey(anchor.cell))) continue
      total += rewardOf(anchor, after)
    }
    return total
  }

  /** Is there room in the drawer for what this move pays? `vacating` counts the slot it empties. */
  function rewardHasRoom(reward: number, vacating: number): boolean {
    return reward <= 0 || freeDrawerSlotList().length + vacating >= reward
  }

  /**
   * Would this placement enclose the plate, and if so is there room for what that pays?
   *
   * The reward is stems, stems live in drawer slots, and a reward with nowhere to go would either
   * vanish or overflow. Refusing the move instead is the only option that loses nothing — so this is a
   * placement rule like any other, checked before the drop rather than discovered after it.
   *
   * The slot the tile is *leaving* counts as free: it is vacated by the very move being judged, and
   * ignoring that would refuse the last placement of a full drawer even when the reward fits exactly.
   */
  function tileRewardFits(location: TileLocation, movingId: string): boolean {
    if (location.kind !== 'onPlate') return true
    const plate = platesById.get(location.plateId)
    const tile = tilesById.get(movingId)
    if (!tile || plate?.location.kind !== 'board') return true
    const cell = cellOfPetal(plate.location.hole, plate.rotation, location.petal)
    const reward = rewardOfMove({ tile: { movingId, cell, spec: tile } })
    const vacating = tile.location.kind === 'drawer' ? 1 : 0
    return rewardHasRoom(reward, vacating)
  }

  /**
   * Does a plate placement pay more than the drawer can hold?
   *
   * A plate is the move most able to surprise here: it can **wrap a gap and close it in one action**,
   * creating an external anchor whose six neighbours are already filled, and it brings its own tile
   * which may close a neighbouring anchor at the same time. Both are counted, because `rewardOfMove`
   * compares the whole board before against the whole board after rather than looking at one anchor.
   *
   * Nothing is vacated: a plate leaves a *bay*, not a tile slot, so the stems gain no room from it.
   */
  function plateRewardFits(hole: Axial, movingId: string): boolean {
    const plate = platesById.get(movingId)
    if (!plate) return true
    const reward = rewardOfMove({ plate: { plateId: movingId, hole, rotation: plate.rotation } })
    return rewardHasRoom(reward, 0)
  }

  /** The board cell a plate's petal would occupy, given where and how the plate sits. */
  function cellOfPetal(hole: Axial, rotation: number, petal: number): Axial {
    // Inverse of the coverage mapping: logical petal p points in direction p − rotation.
    return petalCell(hole, normalizePetal(petal - rotation))
  }

  /** Both rules, asked of one tile arriving on one cell. */
  function tileIsWelcome(
    cell: Axial,
    spec: TileSpec,
    view: (at: Axial) => TileSpec | undefined,
  ): boolean {
    return neighboursAllow(spec, neighboursOf(cell, view), placementRule)
      && groupsAllow(cell, spec, view)
  }

  /**
   * Would every tile this plate carries be welcome where the plate is going?
   *
   * A plate arriving from a bay carries exactly one tile — its own token — which is the case the rules
   * are written for. A plate lifted off the board can carry more, and each is checked, because a tile
   * riding along is still a tile that ends up somewhere.
   */
  function plateTilesAgree(hole: Axial, movingId: string, rotation: number): boolean {
    const view = boardAfter({ plateId: movingId, hole, rotation })
    for (const tile of tilesById.values()) {
      if (tile.location.kind !== 'onPlate' || tile.location.plateId !== movingId) continue
      if (!tileIsWelcome(cellOfPetal(hole, rotation, tile.location.petal), tile, view)) return false
    }
    return true
  }

  function canPlacePlate(location: PlateLocation, movingId?: string): boolean {
    if (location.kind === 'board') {
      if (!plateFits(location.hole, movingId) || !plateConnects(location.hole, movingId)) return false
      // Dealt plates have no id to look tiles up by; only a *move* is a player's placement.
      if (movingId === undefined) return true
      if (!plateRewardFits(location.hole, movingId)) return false
      const plate = platesById.get(movingId)
      return plate === undefined || plateTilesAgree(location.hole, movingId, plate.rotation)
    }
    if (location.kind === 'plateSlot' && !inRange(location.slot, plateSlots)) return false
    if (location.kind === 'source' && !inRange(location.lot, sourceLots)) return false
    const occupant = occupants.get(plateLocationKey(location))
    return occupant === undefined || occupant === movingId
  }

  function canPlaceTile(location: TileLocation, movingId?: string): boolean {
    if (location.kind === 'drawer') {
      if (!inRange(location.slot, drawerSlots)) return false
    } else if (location.kind === 'source') {
      if (!inRange(location.lot, sourceLots)) return false
      if (!inRange(location.index, sourceTilesPerLot)) return false
    } else {
      if (!isPetal(location.petal)) return false
      if (!platesById.has(location.plateId)) return false
    }
    const occupant = occupants.get(tileLocationKey(location))
    if (occupant !== undefined && occupant !== movingId) return false

    /*
     * The placement rules, which only a landing on the **board** can break.
     *
     * Asked here rather than by the caller so that every path — the drag, the model, whatever comes
     * next — gets the same answer. `movingId` is required: without a tile there is nothing whose
     * colour and value to compare, and the dealing primitives (`addTile`, `revealPlate`) pass no id
     * because dealing is not a placement. Those set the board up; this governs playing on it.
     */
    if (location.kind !== 'onPlate' || movingId === undefined) return true
    const tile = tilesById.get(movingId)
    const plate = platesById.get(location.plateId)
    if (!tile || plate?.location.kind !== 'board') return true
    if (!tileRewardFits(location, movingId)) return false
    const cell = cellOfPetal(plate.location.hole, plate.rotation, location.petal)
    return tileIsWelcome(cell, tile, boardAfter({ tileId: movingId }))
  }

  return {
    drawerSlots,
    plateSlots,
    sourceLots,
    sourceTilesPerLot,

    tiles: () => [...tilesById.values()],
    plates: () => [...platesById.values()],
    plate: id => platesById.get(id),
    tile: id => tilesById.get(id),

    plateInSourceLot(lot) {
      const id = occupants.get(plateLocationKey({ kind: 'source', lot }))
      return id === undefined ? undefined : platesById.get(id)
    },

    tilesInSourceLot(lot) {
      const found: Tile[] = []
      for (let index = 0; index < sourceTilesPerLot; index++) {
        const id = occupants.get(tileLocationKey({ kind: 'source', lot, index }))
        const tile = id === undefined ? undefined : tilesById.get(id)
        if (tile) found.push(tile)
      }
      return found
    },

    stems: () => [...stemsById.values()],

    addStem(slot) {
      if (!inRange(slot, drawerSlots)) return undefined
      // The same key a tile would use, so the slot cannot hold both.
      const key = tileLocationKey({ kind: 'drawer', slot })
      if (occupants.has(key)) return undefined
      const stem: Stem = { id: `s${nextId++}`, slot }
      stemsById.set(stem.id, stem)
      occupants.set(key, stem.id)
      return stem
    },

    moveStem(id, slot) {
      const stem = stemsById.get(id)
      if (!stem || !inRange(slot, drawerSlots)) return false
      const key = tileLocationKey({ kind: 'drawer', slot })
      const occupant = occupants.get(key)
      if (occupant !== undefined && occupant !== id) return false
      occupants.delete(tileLocationKey({ kind: 'drawer', slot: stem.slot }))
      stemsById.set(id, { id, slot })
      occupants.set(key, id)
      return true
    },

    plateToken(plateId) {
      for (const tile of tilesById.values()) {
        if (tile.fixed && tile.location.kind === 'onPlate' && tile.location.plateId === plateId) {
          return tile
        }
      }
      return undefined
    },

    coverageAt: cell => coverage.get(axialKey(cell)),

    cellOfTile(id) {
      const tile = tilesById.get(id)
      if (!tile || tile.location.kind !== 'onPlate') return undefined
      const plate = platesById.get(tile.location.plateId)
      if (!plate || plate.location.kind !== 'board') return undefined
      // Inverse of the coverage mapping: logical petal p points in direction p − rotation.
      const direction = normalizePetal(tile.location.petal - plate.rotation)
      return petalCell(plate.location.hole, direction)
    },

    canPlacePlate,
    canPlaceTile,

    canDragTile: tileCanDrag,
    canDragPlate: plateCanDrag,

    addPlate(location, options) {
      if (!canPlacePlate(location)) return undefined
      const plate: Plate = {
        id: `p${nextId++}`,
        location,
        rotation: options?.rotation ?? 0,
        faceDown: options?.faceDown ?? false,
      }
      platesById.set(plate.id, plate)
      occupants.set(plateLocationKey(location), plate.id)
      reindexCoverage()
      return plate
    },

    addTile(spec, location, options) {
      if (!canPlaceTile(location)) return undefined
      const tile: Tile = {
        ...spec,
        id: `t${nextId++}`,
        location,
        fixed: options?.fixed ?? false,
      }
      tilesById.set(tile.id, tile)
      occupants.set(tileLocationKey(location), tile.id)
      return tile
    },

    revealPlate(id, spec, petal) {
      const plate = platesById.get(id)
      if (!plate || !plate.faceDown) return false
      const location: TileLocation = { kind: 'onPlate', plateId: id, petal }
      if (!canPlaceTile(location)) return false

      platesById.set(id, { ...plate, faceDown: false })
      const tile: Tile = { ...spec, id: `t${nextId++}`, location, fixed: true }
      tilesById.set(tile.id, tile)
      occupants.set(tileLocationKey(location), tile.id)
      return true
    },

    movePlate(id, location) {
      const plate = platesById.get(id)
      if (!plate || !canPlacePlate(location, id)) return false
      occupants.delete(plateLocationKey(plate.location))
      const moved: Plate = { ...plate, location }
      platesById.set(id, moved)
      occupants.set(plateLocationKey(location), id)
      // Tiles on this plate need no update at all — they are addressed by petal.
      reindexCoverage()
      return true
    },

    rotatePlate(id, steps) {
      const plate = platesById.get(id)
      if (!plate || !Number.isInteger(steps) || steps === 0) return false
      platesById.set(id, { ...plate, rotation: plate.rotation + steps })
      // The covered cells do not change, but which petal each one holds does.
      reindexCoverage()
      return true
    },

    plateIsEnclosed,
    plateEnclosureIsStrict,

    anchors: () => anchorsIn(viewOf()),
    anchorIsEnclosed: cell => ringAround(cell, viewOf()) !== null,
    anchorRingIsStrict(cell) {
      const ring = ringAround(cell, viewOf())
      return ring !== null && ringIsConnected(ring)
    },
    anchorReward: anchor => rewardOf(anchor, viewOf()),

    drawerSlotOccupant(slot) {
      return occupants.get(tileLocationKey({ kind: 'drawer', slot }))
    },

    plateSlotOccupant(slot) {
      return occupants.get(plateLocationKey({ kind: 'plateSlot', slot }))
    },

    swapDrawerItems(a, b) {
      if (a === b) return false
      const seatA = drawerSeat(a)
      const seatB = drawerSeat(b)
      if (!seatA || !seatB || seatA.kind !== seatB.kind) return false

      if (seatA.kind === 'tileSlot' && seatB.kind === 'tileSlot') {
        occupants.delete(tileLocationKey({ kind: 'drawer', slot: seatA.slot }))
        occupants.delete(tileLocationKey({ kind: 'drawer', slot: seatB.slot }))
        seatInTileSlot(a, seatB.slot)
        seatInTileSlot(b, seatA.slot)
        return true
      }

      occupants.delete(plateLocationKey({ kind: 'plateSlot', slot: seatA.slot }))
      occupants.delete(plateLocationKey({ kind: 'plateSlot', slot: seatB.slot }))
      seatInBay(a, seatB.slot)
      seatInBay(b, seatA.slot)
      // Neither plate is on the board, so coverage cannot actually change — reindexed anyway so that
      // every path which moves a plate leaves the same invariant behind.
      reindexCoverage()
      return true
    },

    moveTile(id, location) {
      const tile = tilesById.get(id)
      // A plate's own tile is part of the plate and never moves on its own — an invariant, not
      // an affordance, so it is checked here rather than via tileCanDrag. Source tiles are
      // deliberately still movable: that is how drafting will take them.
      if (!tile || tile.fixed || !canPlaceTile(location, id)) return false
      occupants.delete(tileLocationKey(tile.location))
      const moved: Tile = { ...tile, location }
      tilesById.set(id, moved)
      occupants.set(tileLocationKey(location), id)
      return true
    },

    discard(id) {
      const stem = stemsById.get(id)
      if (stem) {
        occupants.delete(tileLocationKey({ kind: 'drawer', slot: stem.slot }))
        stemsById.delete(id)
        return true
      }

      const tile = tilesById.get(id)
      if (tile) {
        occupants.delete(tileLocationKey(tile.location))
        tilesById.delete(id)
        return true
      }

      const plate = platesById.get(id)
      if (plate) {
        // Its tiles are addressed as (plate, petal), so they cannot outlive it.
        for (const carried of [...tilesById.values()]) {
          if (carried.location.kind === 'onPlate' && carried.location.plateId === id) {
            occupants.delete(tileLocationKey(carried.location))
            tilesById.delete(carried.id)
          }
        }
        occupants.delete(plateLocationKey(plate.location))
        platesById.delete(id)
        reindexCoverage()
        return true
      }
      return false
    },

    petalAt(cell) {
      const covered = coverage.get(axialKey(cell))
      if (!covered || covered.petal === null) return null
      return { kind: 'onPlate', plateId: covered.plateId, petal: covered.petal }
    },

    freeDrawerSlots: freeDrawerSlotList,

    freePlateSlots() {
      const free: number[] = []
      for (let slot = 0; slot < plateSlots; slot++) {
        if (!occupants.has(plateLocationKey({ kind: 'plateSlot', slot }))) free.push(slot)
      }
      return free
    },

    isBoardCell,
  }
}

export { PETAL_COUNT }
