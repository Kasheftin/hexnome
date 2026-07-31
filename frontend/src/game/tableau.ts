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
import { axialKey, type Axial } from './hex'
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
   * it covers — only which petal points where. Rotation is therefore a permutation of the
   * petals, and placement legality is entirely unaffected by it.
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
}: {
  cells: readonly Axial[]
  drawerSlots: number
  plateSlots: number
  sourceLots?: number
  sourceTilesPerLot?: number
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

  function canPlacePlate(location: PlateLocation, movingId?: string): boolean {
    if (location.kind === 'board') return plateFits(location.hole, movingId)
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
    return occupant === undefined || occupant === movingId
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

    freeDrawerSlots() {
      const free: number[] = []
      for (let slot = 0; slot < drawerSlots; slot++) {
        if (!occupants.has(tileLocationKey({ kind: 'drawer', slot }))) free.push(slot)
      }
      return free
    },

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
