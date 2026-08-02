/**
 * A board reduced to what it takes to draw a picture of it.
 *
 * Pure data and functions — no `vue`, no `three`. It lives in `scene/` rather than `game/` because a
 * view description is not a rule: a server validating a move has no use for it, and `game/` is the
 * module that has to stay portable. `sourceScatter.ts` is the same shape of thing for the same reason.
 *
 * ## Why a snapshot instead of the live model
 *
 * `describeBoard` returns plain data, and the scoring panel takes that rather than a `Tableau`. Three
 * things follow, all wanted:
 *
 * - The panel shows the board **as it was scored**, immune to anything that happens afterwards.
 * - There is no `revision` counter to thread through, because a value cannot go stale — the trick
 *   `TableauView` needs only because it watches a mutable model.
 * - In multiplayer an opponent's board arrives as data, and this is already that shape.
 */
import { axialKey, boundsOfCells, compareCellsInReadingOrder, type Axial, type WorldBounds } from '@hexnome/rules/hex'
import type { Leftovers } from '@hexnome/rules/groups'
import { plateCells } from '@hexnome/rules/plate'
import type { AnchorKind, Tableau, Tile, TileSpec } from '@hexnome/rules/tableau'

/** A plate's footprint: the hole it sits on, and the seven cells it covers. */
export interface DiagramPlate {
  readonly id: string
  readonly hole: Axial
  readonly cells: readonly Axial[]
}

export interface DiagramTile {
  readonly id: string
  readonly cell: Axial
  readonly color: number
  readonly value: number
  /** The plate's own token, which cannot be moved. Drawn the same; kept for callers that care. */
  readonly fixed: boolean
}

export interface DiagramAnchor {
  readonly cell: Axial
  readonly kind: AnchorKind
  /** True once all six neighbours hold a tile — the emblem's lit state. */
  readonly lit: boolean
}

export interface BoardDiagram {
  readonly plates: readonly DiagramPlate[]
  readonly tiles: readonly DiagramTile[]
  readonly anchors: readonly DiagramAnchor[]
  /** World extent of every covered cell, for framing. Degenerate when the board is empty. */
  readonly bounds: WorldBounds
}

/**
 * Board tiles in the order a reveal should visit them: down the board, then across.
 *
 * Exported because the order has to be applied **before** the tally, not after. `tallyRound` filters,
 * and filtering preserves order, so sorting the input once puts every row in sweep order — whereas
 * sorting each row afterwards would have to be done in as many places as there are rows.
 *
 * Without this the sequence follows tile *creation* order, which is the order the player happened to
 * place things in and looks like the panel is hopping about at random.
 */
export function tilesInReadingOrder(tableau: Tableau): Tile[] {
  const cells = new Map<string, Axial>()
  for (const tile of tableau.tilesOnBoard()) {
    const cell = tableau.cellOfTile(tile.id)
    if (cell) cells.set(tile.id, cell)
  }
  return [...tableau.tilesOnBoard()].sort((a, b) => {
    const ca = cells.get(a.id)
    const cb = cells.get(b.id)
    if (!ca || !cb) return 0
    return compareCellsInReadingOrder(ca, cb)
  })
}

/**
 * Everything on the board, in world units at `HEX_SIZE`.
 *
 * Rotation is deliberately absent from the output. `cellOfTile` already resolves a petal through its
 * plate's rotation, so tiles arrive at true cells; and a flower is six-fold symmetric, so the slab
 * looks the same whichever way it is turned. A renderer that took rotation would have two chances to
 * apply it and one of them would be wrong.
 */
export function describeBoard(tableau: Tableau, size: number): BoardDiagram {
  const plates: DiagramPlate[] = []
  const covered: Axial[] = []

  for (const plate of tableau.plates()) {
    if (plate.location.kind !== 'board') continue
    const cells = plateCells(plate.location.hole)
    plates.push({ id: plate.id, hole: plate.location.hole, cells })
    covered.push(...cells)
  }

  const tiles: DiagramTile[] = []
  for (const tile of tilesInReadingOrder(tableau)) {
    const cell = tableau.cellOfTile(tile.id)
    if (!cell) continue
    tiles.push({ id: tile.id, cell, color: tile.color, value: tile.value, fixed: tile.fixed })
  }

  const anchors: DiagramAnchor[] = tableau.anchors().map(anchor => ({
    cell: anchor.cell,
    kind: anchor.kind,
    lit: tableau.anchorIsEnclosed(anchor.cell),
  }))

  // External anchors sit on bare cells outside every plate, so they widen the frame.
  const framed = [...covered, ...anchors.map(anchor => anchor.cell)]
  const seen = new Set<string>()
  const unique = framed.filter((cell) => {
    const key = axialKey(cell)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { plates, tiles, anchors, bounds: boundsOfCells(unique, size) }
}

/**
 * What the player is still holding: loose drawer tiles, and the token of every plate left in a bay.
 *
 * A plate is charged for through its own tile, since that is the only value it has. Its token lives at
 * an `onPlate` location rather than in the drawer, so it has to be gathered separately — reading only
 * `kind: 'drawer'` would quietly let a hoarded plate off.
 *
 * Stems are counted rather than listed: they are interchangeable, and only how many survives.
 */
export function describeLeftovers(tableau: Tableau): Leftovers {
  const unplaced: TileSpec[] = []

  for (const tile of tableau.tiles()) {
    if (tile.location.kind === 'drawer') unplaced.push({ color: tile.color, value: tile.value })
  }
  for (const plate of tableau.plates()) {
    if (plate.location.kind !== 'plateSlot') continue
    const token = tableau.plateToken(plate.id)
    if (token) unplaced.push({ color: token.color, value: token.value })
  }

  return { unplaced, stems: tableau.stems().length }
}
