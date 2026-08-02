import { describe, expect, it } from 'vitest'
import {
  MIN_GROUP_SIZE,
  finalTally,
  findGroups,
  groupPoints,
  type PlacedTile,
} from './groups'

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

describe('groupPoints', () => {
  it('sums the members\' values', () => {
    expect(groupPoints([at(0, 0, GREEN, 1), at(1, 0, GREEN, 2), at(2, 0, GREEN, 4)])).toBe(7)
  })

  /*
   * A value group is three-or-more of the same number, so summing values *is* value × size. One
   * formula for both kinds, rather than two chances to disagree.
   */
  it('is value × size for a value group, by arithmetic rather than by a second rule', () => {
    expect(groupPoints(run(3, GREEN, 3))).toBe(9)
  })
})

describe('finding groups', () => {
  it('finds a run of three', () => {
    const groups = findGroups(run(3, GREEN, 1), 'color')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.tiles).toHaveLength(3)
    expect(groups[0]!.key).toBe(GREEN)
  })

  it('ignores a run shorter than the minimum', () => {
    expect(findGroups(run(MIN_GROUP_SIZE - 1, GREEN, 1), 'color')).toEqual([])
  })

  it('keeps runs of exactly the minimum', () => {
    expect(findGroups(run(MIN_GROUP_SIZE, GREEN, 1), 'color')).toHaveLength(1)
  })

  /* Two runs of the same colour with a gap between them are two groups, not one. */
  it('separates runs that do not touch', () => {
    const tiles = [
      at(0, 0, GREEN, 1), at(1, 0, GREEN, 2), at(2, 0, GREEN, 3),
      at(5, 0, GREEN, 4), at(6, 0, GREEN, 5), at(7, 0, GREEN, 6),
    ]
    const groups = findGroups(tiles, 'color')
    expect(groups).toHaveLength(2)
    expect(groups.map(g => g.points)).toEqual([6, 15])
  })

  it('does not step through a tile of another colour', () => {
    const tiles = [
      at(0, 0, GREEN, 1), at(1, 0, GREEN, 2), at(2, 0, BLUE, 3),
      at(3, 0, GREEN, 4), at(4, 0, GREEN, 5),
    ]
    expect(findGroups(tiles, 'color')).toEqual([])
  })

  it('walks the same tiles differently for the two attributes', () => {
    // A run of one colour with mixed values, and a run of one value across colours.
    const tiles = [at(0, 0, GREEN, 1), at(1, 0, GREEN, 1), at(2, 0, BLUE, 1)]
    expect(findGroups(tiles, 'color')).toEqual([])
    expect(findGroups(tiles, 'value')).toHaveLength(1)
  })

  it('partitions: a tile belongs to exactly one group per attribute', () => {
    const tiles = run(5, GREEN, 1)
    const groups = findGroups(tiles, 'color')
    const counted = groups.flatMap(g => g.tiles.map(t => t.id))
    expect(new Set(counted).size).toBe(counted.length)
  })

  describe('order', () => {
    it('lists members in reading order however they were given', () => {
      const tiles = [at(2, 0, GREEN, 3), at(0, 0, GREEN, 1), at(1, 0, GREEN, 2)]
      const members = findGroups(tiles, 'color')[0]!.tiles
      expect(members.map(t => t.cell.q)).toEqual([0, 1, 2])
    })

    it('lists groups by where they start, so the reveal sweeps', () => {
      const tiles = [
        at(5, 0, GREEN, 4), at(6, 0, GREEN, 5), at(7, 0, GREEN, 6),
        at(0, 0, GREEN, 1), at(1, 0, GREEN, 2), at(2, 0, GREEN, 3),
      ]
      expect(findGroups(tiles, 'color').map(g => g.tiles[0]!.cell.q)).toEqual([0, 5])
    })
  })
})

describe('the final scoresheet', () => {
  it('always has twelve categories, colours then values', () => {
    const { categories } = finalTally([])
    expect(categories).toHaveLength(12)
    expect(categories.slice(0, 6).map(c => c.attribute)).toEqual(Array(6).fill('color'))
    expect(categories.slice(6).map(c => c.key)).toEqual([1, 2, 3, 4, 5, 6])
  })

  /*
   * A colour that scored nothing is a fact about the board. Omitting it would make the twelve rows a
   * different twelve every game, and the player could not tell "no group" from "not scored for".
   */
  it('keeps a category that found nothing', () => {
    const { categories } = finalTally(run(3, GREEN, 1))
    const empty = categories.filter(c => c.groups.length === 0)
    expect(empty).toHaveLength(10)
    expect(empty.every(c => c.points === 0)).toBe(true)
  })

  it('totals every category', () => {
    const tally = finalTally(run(3, GREEN, 4))
    // One colour group (4+4+4) and one value group (the same three tiles) — both score.
    expect(tally.total).toBe(24)
  })

  /* The reason a final total can exceed what a player counts by eye. */
  it('pays a tile for its colour group and its value group both', () => {
    const tiles = run(3, GREEN, 2)
    const colors = finalTally(tiles).categories.filter(c => c.attribute === 'color')
    const values = finalTally(tiles).categories.filter(c => c.attribute === 'value')
    expect(colors.reduce((s, c) => s + c.points, 0)).toBe(6)
    expect(values.reduce((s, c) => s + c.points, 0)).toBe(6)
  })

  it('scores an empty board as nothing, without inventing rows', () => {
    const tally = finalTally([])
    expect(tally.total).toBe(0)
    expect(tally.categories.every(c => c.groups.length === 0)).toBe(true)
  })

  it('files each group under its own colour', () => {
    const tiles = [...run(3, GREEN, 1), at(0, 3, BLUE, 5), at(1, 3, BLUE, 5), at(2, 3, BLUE, 5)]
    const byColor = finalTally(tiles).categories.filter(c => c.attribute === 'color')
    expect(byColor.find(c => c.key === GREEN)?.groups).toHaveLength(1)
    expect(byColor.find(c => c.key === BLUE)?.groups).toHaveLength(1)
    expect(byColor.find(c => c.key === 0)?.groups).toHaveLength(0)
  })

  it('adds up a category with several groups', () => {
    const tiles = [
      at(0, 0, GREEN, 1), at(1, 0, GREEN, 2), at(2, 0, GREEN, 3),
      at(0, 4, GREEN, 4), at(1, 4, GREEN, 5), at(2, 4, GREEN, 6),
    ]
    const green = finalTally(tiles).categories.find(c => c.attribute === 'color' && c.key === GREEN)
    expect(green?.groups).toHaveLength(2)
    expect(green?.points).toBe(21)
  })
})
