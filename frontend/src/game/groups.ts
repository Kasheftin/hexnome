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
 * reached by stepping from tile to adjacent tile without leaving the attribute. A group scores the
 * **sum of its tiles' values**, once it reaches the scoring minimum, plus a **bonus for its size**.
 *
 * That single formula covers both kinds, which is not a coincidence worth hiding: a value group is
 * several of the same number, so summing its values *is* `value × size`. Writing it twice would be two
 * chances to disagree.
 *
 * Both the minimum and the bonus table are **settings** — they move the endgame a long way, which is
 * exactly why they are dials rather than constants (see `gameSettings.ts`). The bonus is paid for a
 * group's *exact* size and never accumulated up the table: `+3 / +5 / +7` has to mean seven for a full
 * group, not fifteen.
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
import {
  DEFAULT_FINE_UNPLACED,
  DEFAULT_GROUP_BONUSES,
  DEFAULT_MIN_GROUP_SIZE,
  DEFAULT_REWARD_STEMS,
} from './gameSettings'
import type { TileSpec } from './tableau'

/** A tile as it sits on the board: what it is, and where. */
export interface PlacedTile extends TileSpec {
  readonly id: string
  readonly cell: Axial
}

export type GroupAttribute = 'color' | 'value'

/** What the board is being scored under. Defaults match `gameSettings.ts`. */
export interface ScoringRules {
  /** Below this a run is just tiles that happen to touch. */
  readonly minGroupSize: number
  /** Extra points by exact group size, indexed by size. */
  readonly groupBonuses: readonly number[]
  /** Charge the value of everything left unplaced when the game ends. */
  readonly fineUnplaced: boolean
  /** Pay a point per stem still held when the game ends. */
  readonly rewardStems: boolean
}

export const DEFAULT_SCORING_RULES: ScoringRules = {
  minGroupSize: DEFAULT_MIN_GROUP_SIZE,
  groupBonuses: DEFAULT_GROUP_BONUSES,
  fineUnplaced: DEFAULT_FINE_UNPLACED,
  rewardStems: DEFAULT_REWARD_STEMS,
}

/**
 * What the player was still holding when the game ended.
 *
 * Settled **once, at the end**. Tiles cross freely between rounds, so this is a reckoning for what was
 * never placed over the whole game rather than a per-round tax.
 */
export interface Leftovers {
  /** Loose tiles in the drawer, and the token of every plate still sitting in a bay. */
  readonly unplaced: readonly TileSpec[]
  readonly stems: number
}

export const NOTHING_LEFT: Leftovers = { unplaced: [], stems: 0 }

/** A point per stem. Fixed, unlike the group bonuses — a stem has no value of its own to scale by. */
export const POINTS_PER_STEM = 1

export interface TileGroup {
  readonly attribute: GroupAttribute
  /** The palette index, or the value 1–6, that every member shares. */
  readonly key: number
  /** Members in reading order, so a reveal walks them down the board. */
  readonly tiles: readonly PlacedTile[]
  /** The sum of the members' values. */
  readonly base: number
  /** Extra for reaching this size, and 0 below the table. Shown apart so the reward is visible. */
  readonly bonus: number
  /** `base + bonus`. */
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
  /**
   * What the board was scored under.
   *
   * Carried so a view can show the settlement rows from the *rules* rather than from what happened to
   * be held: with the fine switched off there is no row at all, which is a different statement from a
   * row reading zero because the drawer was empty.
   */
  readonly rules: ScoringRules
  readonly categories: readonly GroupCategory[]
  /** The groups alone, before anything is settled for what was left over. */
  readonly groupPoints: number
  /** What was still held. Empty when the rules ignore it, so a view can show the row either way. */
  readonly leftovers: Leftovers
  /** Charged for `leftovers.unplaced`, as a positive number. Zero when the fine is off. */
  readonly penalty: number
  /** Paid for `leftovers.stems`. Zero when the reward is off. */
  readonly stemBonus: number
  /** `groupPoints + stemBonus - penalty`. */
  readonly total: number
}

/** Sum of the members' values — the base rule, for both kinds of group. */
export function groupBase(tiles: readonly TileSpec[]): number {
  return tiles.reduce((sum, tile) => sum + tile.value, 0)
}

/** What a group of this size is paid on top. By exact size; never the sum of the smaller bonuses. */
export function groupBonus(size: number, rules: ScoringRules = DEFAULT_SCORING_RULES): number {
  return rules.groupBonuses[size] ?? 0
}

/**
 * Every scoring run of one attribute on the board.
 *
 * A flood fill per unvisited tile, which partitions the board exactly once: each tile belongs to one
 * run for a given attribute, so the components cannot overlap and nothing is counted twice *within* an
 * attribute. Runs shorter than the minimum are dropped after the fill rather than during it
 * — a run's size is not known until it is complete.
 *
 * Everything is ordered: members in reading order, and groups by their first member. A reveal built on
 * this then sweeps the board instead of hopping, and the same board always tells the same story.
 */
export function findGroups(
  tiles: readonly PlacedTile[],
  attribute: GroupAttribute,
  rules: ScoringRules = DEFAULT_SCORING_RULES,
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

    if (members.length < rules.minGroupSize) continue
    members.sort((a, b) => compareCellsInReadingOrder(a.cell, b.cell))
    const base = groupBase(members)
    const bonus = groupBonus(members.length, rules)
    groups.push({ attribute, key: start[attribute], tiles: members, base, bonus, points: base + bonus })
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
export function finalTally(
  tiles: readonly PlacedTile[],
  rules: ScoringRules = DEFAULT_SCORING_RULES,
  leftovers: Leftovers = NOTHING_LEFT,
): FinalTally {
  // One pass per attribute, then bucketed — rather than a scan of the board per category.
  const byAttribute = {
    color: findGroups(tiles, 'color', rules),
    value: findGroups(tiles, 'value', rules),
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

  const groupPoints = categories.reduce((sum, item) => sum + item.points, 0)

  /*
   * A tile is charged its face value, so a hoarded 6 hurts six times as much as a 1 — which is the
   * point: the tiles hardest to place are the ones most expensive to keep.
   */
  const penalty = rules.fineUnplaced
    ? leftovers.unplaced.reduce((sum, tile) => sum + tile.value, 0)
    : 0
  const stemBonus = rules.rewardStems ? leftovers.stems * POINTS_PER_STEM : 0

  return {
    rules,
    categories,
    groupPoints,
    leftovers,
    penalty,
    stemBonus,
    total: groupPoints + stemBonus - penalty,
  }
}
