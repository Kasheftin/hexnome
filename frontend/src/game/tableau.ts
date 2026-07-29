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
import { PETAL_COUNT, isPetal, plateCells } from './plate'

export type PlateLocation =
  | { readonly kind: 'board', readonly hole: Axial }
  | { readonly kind: 'plateSlot', readonly slot: number }

export type TileLocation =
  | { readonly kind: 'drawer', readonly slot: number }
  | { readonly kind: 'onPlate', readonly plateId: string, readonly petal: number }

export interface Plate {
  readonly id: string
  readonly location: PlateLocation
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

  addPlate(location: PlateLocation): Plate | undefined
  addTile(spec: TileSpec, location: TileLocation): Tile | undefined

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
        // plateCells puts the hole first, then petals 0..5.
        next.set(axialKey(cell), { plateId: plate.id, petal: index === 0 ? null : index - 1 })
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
      const cellsOfPlate = plateCells(plate.location.hole)
      return cellsOfPlate[tile.location.petal + 1]
    },

    canPlacePlate,
    canPlaceTile,

    addPlate(location) {
      if (!canPlacePlate(location)) return undefined
      const plate: Plate = { id: `p${nextId++}`, location }
      platesById.set(plate.id, plate)
      occupants.set(plateLocationKey(location), plate.id)
      reindexCoverage()
      return plate
    },

    addTile(spec, location) {
      if (!canPlaceTile(location)) return undefined
      const tile: Tile = { ...spec, id: `t${nextId++}`, location }
      tilesById.set(tile.id, tile)
      occupants.set(tileLocationKey(location), tile.id)
      return tile
    },

    movePlate(id, location) {
      const plate = platesById.get(id)
      if (!plate || !canPlacePlate(location, id)) return false
      occupants.delete(plateLocationKey(plate.location))
      const moved: Plate = { id, location }
      platesById.set(id, moved)
      occupants.set(plateLocationKey(location), id)
      // Tiles on this plate need no update at all — they are addressed by petal.
      reindexCoverage()
      return true
    },

    moveTile(id, location) {
      const tile = tilesById.get(id)
      if (!tile || !canPlaceTile(location, id)) return false
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
