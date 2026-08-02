import { describe, expect, it } from 'vitest'
import { DEFAULT_MIN_GROUP_SIZE } from './gameSettings'
import {
  finalTally,
  findGroups,
  groupBase,
  groupBonus,
  type PlacedTile,
  type ScoringRules,
} from './groups'

/** Scoring with nothing on top: no size bonuses, no end-of-game settlement. */
const PLAIN: ScoringRules = {
  minGroupSize: DEFAULT_MIN_GROUP_SIZE,
  groupBonuses: [],
  fineUnplaced: false,
  rewardStems: false,
}

const GREEN = 2
const BLUE = 3

let seq = 0
/** A tile at a cell. Ids are incidental here; the cells are the interesting part. */
const at = (q: number, r: number, color: number, value: number): PlacedTile =>
  ({ id: `t${seq++}`, cell: { q, r }, color, value })

/** A horizontal run of `n` cells starting at (0,0), all the same colour and value. */
function run(n: number, color: number, value: number): PlacedTile[] {
  return Array.from({ length: n }, (_, i) => at(i, 0, color, value))
}

describe('groupBase', () => {
  it('sums the members\' values', () => {
    expect(groupBase([at(0, 0, GREEN, 1), at(1, 0, GREEN, 2), at(2, 0, GREEN, 4)])).toBe(7)
  })

  /*
   * A value group is three-or-more of the same number, so summing values *is* value × size. One
   * formula for both kinds, rather than two chances to disagree.
   */
  it('is value × size for a value group, by arithmetic rather than by a second rule', () => {
    expect(groupBase(run(3, GREEN, 3))).toBe(9)
  })
})

describe('finding groups', () => {
  it('finds a run of three', () => {
    const groups = findGroups(run(3, GREEN, 1), 'color', PLAIN)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.tiles).toHaveLength(3)
    expect(groups[0]!.key).toBe(GREEN)
  })

  it('ignores a run shorter than the minimum', () => {
    expect(findGroups(run(DEFAULT_MIN_GROUP_SIZE - 1, GREEN, 1), 'color', PLAIN)).toEqual([])
  })

  it('keeps runs of exactly the minimum', () => {
    expect(findGroups(run(DEFAULT_MIN_GROUP_SIZE, GREEN, 1), 'color', PLAIN)).toHaveLength(1)
  })

  /* Two runs of the same colour with a gap between them are two groups, not one. */
  it('separates runs that do not touch', () => {
    const tiles = [
      at(0, 0, GREEN, 1), at(1, 0, GREEN, 2), at(2, 0, GREEN, 3),
      at(5, 0, GREEN, 4), at(6, 0, GREEN, 5), at(7, 0, GREEN, 6),
    ]
    const groups = findGroups(tiles, 'color', PLAIN)
    expect(groups).toHaveLength(2)
    expect(groups.map(g => g.points)).toEqual([6, 15])
  })

  it('does not step through a tile of another colour', () => {
    const tiles = [
      at(0, 0, GREEN, 1), at(1, 0, GREEN, 2), at(2, 0, BLUE, 3),
      at(3, 0, GREEN, 4), at(4, 0, GREEN, 5),
    ]
    expect(findGroups(tiles, 'color', PLAIN)).toEqual([])
  })

  it('walks the same tiles differently for the two attributes', () => {
    // A run of one colour with mixed values, and a run of one value across colours.
    const tiles = [at(0, 0, GREEN, 1), at(1, 0, GREEN, 1), at(2, 0, BLUE, 1)]
    expect(findGroups(tiles, 'color', PLAIN)).toEqual([])
    expect(findGroups(tiles, 'value', PLAIN)).toHaveLength(1)
  })

  it('partitions: a tile belongs to exactly one group per attribute', () => {
    const tiles = run(5, GREEN, 1)
    const groups = findGroups(tiles, 'color', PLAIN)
    const counted = groups.flatMap(g => g.tiles.map(t => t.id))
    expect(new Set(counted).size).toBe(counted.length)
  })

  describe('order', () => {
    it('lists members in reading order however they were given', () => {
      const tiles = [at(2, 0, GREEN, 3), at(0, 0, GREEN, 1), at(1, 0, GREEN, 2)]
      const members = findGroups(tiles, 'color', PLAIN)[0]!.tiles
      expect(members.map(t => t.cell.q)).toEqual([0, 1, 2])
    })

    it('lists groups by where they start, so the reveal sweeps', () => {
      const tiles = [
        at(5, 0, GREEN, 4), at(6, 0, GREEN, 5), at(7, 0, GREEN, 6),
        at(0, 0, GREEN, 1), at(1, 0, GREEN, 2), at(2, 0, GREEN, 3),
      ]
      expect(findGroups(tiles, 'color', PLAIN).map(g => g.tiles[0]!.cell.q)).toEqual([0, 5])
    })
  })
})

describe('the final scoresheet', () => {
  it('always has twelve categories, colours then values', () => {
    const { categories } = finalTally([], PLAIN)
    expect(categories).toHaveLength(12)
    expect(categories.slice(0, 6).map(c => c.attribute)).toEqual(Array(6).fill('color'))
    expect(categories.slice(6).map(c => c.key)).toEqual([1, 2, 3, 4, 5, 6])
  })

  /*
   * A colour that scored nothing is a fact about the board. Omitting it would make the twelve rows a
   * different twelve every game, and the player could not tell "no group" from "not scored for".
   */
  it('keeps a category that found nothing', () => {
    const { categories } = finalTally(run(3, GREEN, 1), PLAIN)
    const empty = categories.filter(c => c.groups.length === 0)
    expect(empty).toHaveLength(10)
    expect(empty.every(c => c.points === 0)).toBe(true)
  })

  it('totals every category', () => {
    const tally = finalTally(run(3, GREEN, 4), PLAIN)
    // One colour group (4+4+4) and one value group (the same three tiles) — both score.
    expect(tally.total).toBe(24)
  })

  /* The reason a final total can exceed what a player counts by eye. */
  it('pays a tile for its colour group and its value group both', () => {
    const tiles = run(3, GREEN, 2)
    const colors = finalTally(tiles, PLAIN).categories.filter(c => c.attribute === 'color')
    const values = finalTally(tiles, PLAIN).categories.filter(c => c.attribute === 'value')
    expect(colors.reduce((s, c) => s + c.points, 0)).toBe(6)
    expect(values.reduce((s, c) => s + c.points, 0)).toBe(6)
  })

  it('scores an empty board as nothing, without inventing rows', () => {
    const tally = finalTally([], PLAIN)
    expect(tally.total).toBe(0)
    expect(tally.categories.every(c => c.groups.length === 0)).toBe(true)
  })

  it('files each group under its own colour', () => {
    const tiles = [...run(3, GREEN, 1), at(0, 3, BLUE, 5), at(1, 3, BLUE, 5), at(2, 3, BLUE, 5)]
    const byColor = finalTally(tiles, PLAIN).categories.filter(c => c.attribute === 'color')
    expect(byColor.find(c => c.key === GREEN)?.groups).toHaveLength(1)
    expect(byColor.find(c => c.key === BLUE)?.groups).toHaveLength(1)
    expect(byColor.find(c => c.key === 0)?.groups).toHaveLength(0)
  })

  it('adds up a category with several groups', () => {
    const tiles = [
      at(0, 0, GREEN, 1), at(1, 0, GREEN, 2), at(2, 0, GREEN, 3),
      at(0, 4, GREEN, 4), at(1, 4, GREEN, 5), at(2, 4, GREEN, 6),
    ]
    const green = finalTally(tiles, PLAIN).categories.find(c => c.attribute === 'color' && c.key === GREEN)
    expect(green?.groups).toHaveLength(2)
    expect(green?.points).toBe(21)
  })
})

describe('the scoring minimum', () => {
  const withMin = (minGroupSize: number): ScoringRules => ({ ...PLAIN, minGroupSize })

  it('lets pairs score when it is 2', () => {
    expect(findGroups(run(2, GREEN, 3), 'color', withMin(2))).toHaveLength(1)
  })

  it('refuses threes when it is 4', () => {
    expect(findGroups(run(3, GREEN, 3), 'color', withMin(4))).toEqual([])
    expect(findGroups(run(4, GREEN, 3), 'color', withMin(4))).toHaveLength(1)
  })

  /* The dial the whole endgame turns on: the same board is worth very different amounts. */
  it('changes what a board is worth without changing the board', () => {
    const tiles = run(3, GREEN, 5)
    expect(finalTally(tiles, withMin(2)).total).toBe(30)
    expect(finalTally(tiles, withMin(4)).total).toBe(0)
  })
})

describe('the size bonus', () => {
  /** Nothing extra until six, which is worth six — the default shape. */
  const FULL_ONLY: ScoringRules = { ...PLAIN, minGroupSize: 3, groupBonuses: [0, 0, 0, 0, 0, 0, 6] }
  /** Rewarding every step up, the other common shape. */
  const LADDER: ScoringRules = { ...PLAIN, minGroupSize: 3, groupBonuses: [0, 0, 0, 0, 3, 5, 7] }

  it('pays nothing at the minimum', () => {
    expect(groupBonus(3, FULL_ONLY)).toBe(0)
  })

  it('pays for a full group', () => {
    const full = findGroups(
      [1, 2, 3, 4, 5, 6].map((value, i) => at(i, 0, GREEN, value)),
      'color',
      FULL_ONLY,
    )[0]!
    expect(full.base).toBe(21)
    expect(full.bonus).toBe(6)
    expect(full.points).toBe(27)
  })

  /*
   * The user-facing promise: five value-1 tiles are worth five, and finding the sixth is worth
   * six *and* the bonus rather than one more point.
   */
  it('makes finishing a group worth more than the tile that finished it', () => {
    const five = [0, 1, 2, 3, 4].map(i => at(i, 0, i, 1))
    const six = [0, 1, 2, 3, 4, 5].map(i => at(i, 0, i, 1))
    const points = (tiles: PlacedTile[]) =>
      findGroups(tiles, 'value', FULL_ONLY)[0]?.points ?? 0
    expect(points(five)).toBe(5)
    expect(points(six)).toBe(12)
  })

  /* `+3 / +5 / +7` has to mean seven for a full group, not fifteen. */
  it('pays for the exact size and never accumulates up the table', () => {
    expect(groupBonus(4, LADDER)).toBe(3)
    expect(groupBonus(5, LADDER)).toBe(5)
    expect(groupBonus(6, LADDER)).toBe(7)
  })

  it('keeps base and bonus apart, so a sheet can show the reward', () => {
    const group = findGroups([1, 2, 3, 4].map((v, i) => at(i, 0, GREEN, v)), 'color', LADDER)[0]!
    expect([group.base, group.bonus, group.points]).toEqual([10, 3, 13])
  })

  it('treats a missing entry as no bonus rather than as an error', () => {
    expect(groupBonus(6, PLAIN)).toBe(0)
  })

  it('reaches the sheet total', () => {
    const tiles = [1, 2, 3, 4, 5, 6].map((value, i) => at(i, 0, GREEN, value))
    // One colour group of six: 21 base + 6 bonus. No value group — every value differs.
    expect(finalTally(tiles, FULL_ONLY).total).toBe(27)
  })
})

describe('what is left in the drawer', () => {
  const spec = (color: number, value: number) => ({ color, value })
  const settling = (over: Partial<ScoringRules> = {}): ScoringRules =>
    ({ ...PLAIN, fineUnplaced: true, rewardStems: true, ...over })

  it('charges each unplaced tile its face value', () => {
    const tally = finalTally([], settling(), { unplaced: [spec(0, 6), spec(1, 2)], stems: 0 })
    expect(tally.penalty).toBe(8)
    expect(tally.total).toBe(-8)
  })

  /* The point of charging by value: the tiles hardest to place cost the most to hoard. */
  it('makes a hoarded six hurt six times as much as a one', () => {
    const one = finalTally([], settling(), { unplaced: [spec(0, 1)], stems: 0 })
    const six = finalTally([], settling(), { unplaced: [spec(0, 6)], stems: 0 })
    expect(six.penalty).toBe(one.penalty * 6)
  })

  it('pays a point per stem', () => {
    const tally = finalTally([], settling(), { unplaced: [], stems: 3 })
    expect(tally.stemBonus).toBe(3)
    expect(tally.total).toBe(3)
  })

  it('settles both against the groups', () => {
    // A run of three 4s: 12 from the group, minus a held 5, plus two stems.
    const tally = finalTally(run(3, GREEN, 4), settling(), { unplaced: [spec(1, 5)], stems: 2 })
    expect(tally.groupPoints).toBe(24)
    expect(tally.total).toBe(24 - 5 + 2)
  })

  it('charges nothing when the fine is off', () => {
    const tally = finalTally([], settling({ fineUnplaced: false }), { unplaced: [spec(0, 6)], stems: 0 })
    expect(tally.penalty).toBe(0)
    expect(tally.total).toBe(0)
  })

  it('pays nothing when the stem bonus is off', () => {
    const tally = finalTally([], settling({ rewardStems: false }), { unplaced: [], stems: 4 })
    expect(tally.stemBonus).toBe(0)
  })

  /* The two switches are independent — one on and one off has to work. */
  it('applies each switch on its own', () => {
    const held = { unplaced: [spec(0, 3)], stems: 2 }
    expect(finalTally([], settling({ rewardStems: false }), held).total).toBe(-3)
    expect(finalTally([], settling({ fineUnplaced: false }), held).total).toBe(2)
  })

  /* A view shows the rows from the settings, so what was held is reported even when it is not charged. */
  it('reports what was held even when neither switch is on', () => {
    const held = { unplaced: [spec(0, 3)], stems: 2 }
    const tally = finalTally([], PLAIN, held)
    expect(tally.leftovers).toEqual(held)
    expect([tally.penalty, tally.stemBonus]).toEqual([0, 0])
  })

  it('defaults to holding nothing, so an existing caller is unaffected', () => {
    const tally = finalTally(run(3, GREEN, 4), settling())
    expect(tally.total).toBe(tally.groupPoints)
  })

  it('can drive a total below zero', () => {
    const tally = finalTally([], settling(), { unplaced: [spec(0, 6), spec(0, 6)], stems: 1 })
    expect(tally.total).toBe(-11)
  })
})
