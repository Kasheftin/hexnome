/**
 * Final scoring: the connected runs on a finished board.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * **A second, unrelated scoring system.** `agenda.ts` scores a *round* against its targets; this scores
 * the *board* once at the end. They share only the word "score", which is why they are separate files.
 *
 * ## The rules
 *
 * A **group** is a run of connected tiles sharing an attribute — all one colour, or all one value —
 * reached by stepping from tile to adjacent tile without leaving the attribute. A group scores only at
 * **size 3 or more**, and it scores the **sum of its tiles' values**.
 *
 * That single formula covers both kinds, which is not a coincidence worth hiding: a value group is
 * three-or-more of the same number, so summing its values *is* `value × size`. Writing it twice would
 * be two chances to disagree.
 *
 * These are the same groups placement is judged against (`placement.ts`), so a scored group can never
 * contain a duplicate — the placement that would have created one was refused at the time.
 *
 * ## A tile scores twice on purpose
 *
 * A tile belongs to a colour group *and* a value group, and is paid for by both. That is the same rule
 * the round targets follow, and the same reason a total can exceed what a player counts by eye.
 */
import { NEIGHBOR_DIRS, axialAdd, axialKey, compareCellsInReadingOrder, type Axial } from './hex'
import { TILE_COLOR_COUNT, TILE_VALUE_COUNT } from './deck'
import type { TileSpec } from './tableau'

/** A tile as it sits on the board: what it is, and where. */
export interface PlacedTile extends TileSpec {
  readonly id: string
  readonly cell: Axial
}

/** Below this a run is just tiles that happen to touch. */
export const MIN_GROUP_SIZE = 3

export type GroupAttribute = 'color' | 'value'

export interface TileGroup {
  readonly attribute: GroupAttribute
  /** The palette index, or the value 1–6, that every member shares. */
  readonly key: number
  /** Members in reading order, so a reveal walks them down the board. */
  readonly tiles: readonly PlacedTile[]
  readonly points: number
}

/**
 * One of the twelve things a finished board is scored for: a colour, or a value.
 *
 * Present whether or not it found anything. A colour that scored nothing is a fact about the board,
 * and a scoresheet that silently omitted it would make the twelve rows a different twelve every game.
 */
export interface GroupCategory {
  readonly attribute: GroupAttribute
  readonly key: number
  readonly groups: readonly TileGroup[]
  readonly points: number
}

export interface FinalTally {
  readonly categories: readonly GroupCategory[]
  readonly total: number
}

/** Sum of the members' values — the whole scoring rule, for both kinds of group. */
export function groupPoints(tiles: readonly TileSpec[]): number {
  return tiles.reduce((sum, tile) => sum + tile.value, 0)
}

/**
 * Every scoring run of one attribute on the board.
 *
 * A flood fill per unvisited tile, which partitions the board exactly once: each tile belongs to one
 * run for a given attribute, so the components cannot overlap and nothing is counted twice *within* an
 * attribute. Runs shorter than {@link MIN_GROUP_SIZE} are dropped after the fill rather than during it
 * — a run's size is not known until it is complete.
 *
 * Everything is ordered: members in reading order, and groups by their first member. A reveal built on
 * this then sweeps the board instead of hopping, and the same board always tells the same story.
 */
export function findGroups(
  tiles: readonly PlacedTile[],
  attribute: GroupAttribute,
): TileGroup[] {
  const byCell = new Map<string, PlacedTile>()
  for (const tile of tiles) byCell.set(axialKey(tile.cell), tile)

  const seen = new Set<string>()
  const groups: TileGroup[] = []

  for (const start of tiles) {
    if (seen.has(axialKey(start.cell))) continue
    seen.add(axialKey(start.cell))

    const members: PlacedTile[] = []
    const frontier: PlacedTile[] = [start]
    while (frontier.length > 0) {
      const current = frontier.pop() as PlacedTile
      members.push(current)
      for (const dir of NEIGHBOR_DIRS) {
        const key = axialKey(axialAdd(current.cell, dir))
        if (seen.has(key)) continue
        const neighbour = byCell.get(key)
        if (!neighbour || neighbour[attribute] !== start[attribute]) continue
        seen.add(key)
        frontier.push(neighbour)
      }
    }

    if (members.length < MIN_GROUP_SIZE) continue
    members.sort((a, b) => compareCellsInReadingOrder(a.cell, b.cell))
    groups.push({
      attribute,
      key: start[attribute],
      tiles: members,
      points: groupPoints(members),
    })
  }

  groups.sort((a, b) => compareCellsInReadingOrder(
    a.tiles[0]?.cell ?? { q: 0, r: 0 },
    b.tiles[0]?.cell ?? { q: 0, r: 0 },
  ))
  return groups
}

/**
 * The whole final scoresheet: six colours, then six values.
 *
 * Colours first because their order is arbitrary — nothing in the palette is "first" — while the values
 * have a natural 1–6 run, so putting them second lets the sheet end on something that counts upward.
 */
export function finalTally(tiles: readonly PlacedTile[]): FinalTally {
  // One pass per attribute, then bucketed — rather than a scan of the board per category.
  const byAttribute = {
    color: findGroups(tiles, 'color'),
    value: findGroups(tiles, 'value'),
  }

  function category(attribute: GroupAttribute, key: number): GroupCategory {
    const groups = byAttribute[attribute].filter(group => group.key === key)
    return {
      attribute,
      key,
      groups,
      points: groups.reduce((sum, group) => sum + group.points, 0),
    }
  }

  const categories: GroupCategory[] = [
    ...Array.from({ length: TILE_COLOR_COUNT }, (_, color) => category('color', color)),
    ...Array.from({ length: TILE_VALUE_COUNT }, (_, index) => category('value', index + 1)),
  ]

  return {
    categories,
    total: categories.reduce((sum, item) => sum + item.points, 0),
  }
}
