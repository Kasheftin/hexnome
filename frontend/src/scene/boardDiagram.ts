/**
 * A board reduced to what it takes to draw a picture of it.
 *
 * Pure data and functions — no `vue`, no `three`. It lives in `scene/` rather than `game/` because a
 * view description is not a rule: a server validating a move has no use for `plates`, `bounds` or a
 * lit anchor, and `game/` is the module that has to stay portable. `sourceScatter.ts` is the same
 * shape of thing for the same reason.
 *
 * Two things that lived here have since gone home to the rules, because they were never view
 * descriptions at all: `tilesInReadingOrder` is a query over a tableau, and `describeLeftovers` —
 * now `leftoversOf` in `rules/score` — builds a `groups.ts` type out of one. The server needs both to
 * score a finished game, and a second copy of either would be a second answer to what a game was
 * worth. See packages/rules/src/score.ts.
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
import { axialKey, boundsOfCells, type Axial, type WorldBounds } from '@hexnome/rules/hex'
import { plateCells } from '@hexnome/rules/plate'
import { tilesInReadingOrder, type AnchorKind, type Tableau } from '@hexnome/rules/tableau'

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
