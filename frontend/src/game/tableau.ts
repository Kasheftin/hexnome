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
 */
import { axialKey, type Axial } from './hex'
import { PETAL_COUNT, isPetal, normalizePetal, petalCell, plateCells } from './plate'

export type PlateLocation =
  | { readonly kind: 'board', readonly hole: Axial }
  | { readonly kind: 'plateSlot', readonly slot: number }

export type TileLocation =
  | { readonly kind: 'drawer', readonly slot: number }
  | { readonly kind: 'onPlate', readonly plateId: string, readonly petal: number }

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

/** What a plate puts on a board cell. `petal` is null for the hole. */
export interface Coverage {
  readonly plateId: string
  readonly petal: number | null
}

export function plateLocationKey(location: PlateLocation): string {
  return location.kind === 'board'
    ? `plate:board:${axialKey(location.hole)}`
    : `plate:slot:${location.slot}`
}

export function tileLocationKey(location: TileLocation): string {
  return location.kind === 'drawer'
    ? `tile:drawer:${location.slot}`
    : `tile:plate:${location.plateId}:${location.petal}`
}

export interface Tableau {
  readonly drawerSlots: number
  readonly plateSlots: number

  tiles(): readonly Tile[]
  plates(): readonly Plate[]
  plate(id: string): Plate | undefined
  tile(id: string): Tile | undefined

  /** Which plate, if any, covers this board cell, and as what. */
  coverageAt(cell: Axial): Coverage | undefined
  /** The board cell a tile sits on, if its plate is on the board. */
  cellOfTile(id: string): Axial | undefined

  canPlacePlate(location: PlateLocation, movingId?: string): boolean
  canPlaceTile(location: TileLocation, movingId?: string): boolean
  /**
   * May this tile be picked up at all? False for a plate's own tile.
   *
   * The single source of truth for that rule: `moveTile` refuses anything this rejects, and
   * the UI consults it so it never offers a grab it cannot complete.
   */
  canMoveTile(id: string): boolean

  addPlate(location: PlateLocation, rotation?: number): Plate | undefined
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
}: {
  cells: readonly Axial[]
  drawerSlots: number
  plateSlots: number
}): Tableau {
  const boardCells = new Set(cells.map(axialKey))
  const platesById = new Map<string, Plate>()
  const tilesById = new Map<string, Tile>()
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

  function canPlacePlate(location: PlateLocation, movingId?: string): boolean {
    if (location.kind === 'plateSlot') {
      if (!Number.isInteger(location.slot) || location.slot < 0 || location.slot >= plateSlots) {
        return false
      }
      const occupant = occupants.get(plateLocationKey(location))
      return occupant === undefined || occupant === movingId
    }
    return plateFits(location.hole, movingId)
  }

  function canPlaceTile(location: TileLocation, movingId?: string): boolean {
    if (location.kind === 'drawer') {
      if (!Number.isInteger(location.slot) || location.slot < 0 || location.slot >= drawerSlots) {
        return false
      }
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

    tiles: () => [...tilesById.values()],
    plates: () => [...platesById.values()],
    plate: id => platesById.get(id),
    tile: id => tilesById.get(id),

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

    canMoveTile(id) {
      const tile = tilesById.get(id)
      return tile !== undefined && !tile.fixed
    },

    addPlate(location, rotation = 0) {
      if (!canPlacePlate(location)) return undefined
      const plate: Plate = { id: `p${nextId++}`, location, rotation }
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

    movePlate(id, location) {
      const plate = platesById.get(id)
      if (!plate || !canPlacePlate(location, id)) return false
      occupants.delete(plateLocationKey(plate.location))
      const moved: Plate = { id, location, rotation: plate.rotation }
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
      // A plate's own tile is part of the plate and never moves on its own.
      if (!tile || tile.fixed || !canPlaceTile(location, id)) return false
      occupants.delete(tileLocationKey(tile.location))
      const moved: Tile = { ...tile, location }
      tilesById.set(id, moved)
      occupants.set(tileLocationKey(location), id)
      return true
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
