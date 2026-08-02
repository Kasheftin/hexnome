import { describe, expect, it } from 'vitest'
import { tallyRound, type RoundAgenda } from './agenda'
import { finalTally } from './groups'
import {
  DEFAULT_CADENCE,
  MIN_HOLD_MS,
  REVEAL_BUDGET_MS,
  finalTimeline,
  fitCadence,
  scoringTimeline,
  stepDelays,
  timelineDuration,
  type ScoringStep,
} from './scoringTimeline'

const GREEN = 2
const BLUE = 3

/** A board tile: colour, value and the id the reveal points at. */
const tile = (id: string, color: number, value: number) => ({ id, color, value })

/** All ones for 1 each, then all green for 1 each. */
const TARGETS: RoundAgenda = [
  { kind: 'value', value: 1, points: 1 },
  { kind: 'color', color: GREEN, points: 1 },
]

function timelineOf(tiles: readonly { id: string, color: number, value: number }[]) {
  return scoringTimeline(tallyRound(TARGETS, tiles))
}

const kinds = (steps: readonly ScoringStep[]): string[] => steps.map(s => s.kind)

describe('the shape of a reveal', () => {
  it('walks each row, then its tiles, then closes the row', () => {
    const steps = timelineOf([tile('a', BLUE, 1), tile('b', GREEN, 4)])
    expect(kinds(steps)).toEqual([
      'row', 'tile', 'rowDone',
      'row', 'tile', 'rowDone',
      'total',
    ])
  })

  it('keeps the agenda\'s row order rather than sorting by score', () => {
    // The colour target matches two tiles and the value target one, so a sort by size would flip them.
    const steps = timelineOf([tile('a', BLUE, 1), tile('b', GREEN, 4), tile('c', GREEN, 5)])
    const rows = steps.filter(s => s.kind === 'tile').map(s => s.row)
    expect(rows).toEqual([0, 1, 1])
  })

  it('ends on the total, which agrees with the tally', () => {
    const tiles = [tile('a', BLUE, 1), tile('b', GREEN, 4)]
    const steps = timelineOf(tiles)
    const last = steps[steps.length - 1]
    expect(last).toEqual({ kind: 'total', points: tallyRound(TARGETS, tiles).total })
  })

  /*
   * A target that matched nothing is information — it is a target the player failed to chase — and
   * dropping it would make the reveal skip rows unpredictably.
   */
  it('still opens and closes a row that matched nothing', () => {
    const steps = timelineOf([tile('a', BLUE, 4)])
    expect(kinds(steps)).toEqual(['row', 'rowDone', 'row', 'rowDone', 'total'])
    expect(steps.filter(s => s.kind === 'rowDone')).toEqual([
      { kind: 'rowDone', row: 0, points: 0 },
      { kind: 'rowDone', row: 1, points: 0 },
    ])
  })

  it('runs to completion for a round that scored nothing at all', () => {
    const steps = timelineOf([])
    expect(kinds(steps)).toEqual(['row', 'rowDone', 'row', 'rowDone', 'total'])
    expect(steps[steps.length - 1]).toEqual({ kind: 'total', points: 0 })
  })

  it('produces only a total when the round has no targets', () => {
    expect(scoringTimeline(tallyRound([], [tile('a', GREEN, 1)]))).toEqual([
      { kind: 'total', points: 0 },
    ])
  })
})

describe('the running count', () => {
  it('climbs by the target\'s points with each tile', () => {
    const steps = scoringTimeline(tallyRound(
      [{ kind: 'value', value: 1, points: 3 }],
      [tile('a', BLUE, 1), tile('b', GREEN, 1)],
    ))
    expect(steps.filter(s => s.kind === 'tile').map(s => s.running)).toEqual([3, 6])
  })

  it('lands on the row\'s own subtotal', () => {
    const steps = timelineOf([tile('a', BLUE, 1), tile('b', GREEN, 1)])
    const lastOfRow0 = steps.filter(s => s.kind === 'tile' && s.row === 0).at(-1)
    const done = steps.find(s => s.kind === 'rowDone' && s.row === 0)
    expect(lastOfRow0?.kind === 'tile' && lastOfRow0.running).toBe(done?.kind === 'rowDone' && done.points)
  })

  it('restarts per row rather than accumulating across the panel', () => {
    const steps = timelineOf([tile('a', GREEN, 1)])
    // One tile matches both targets, and each row counts it from zero.
    expect(steps.filter(s => s.kind === 'tile').map(s => s.running)).toEqual([1, 1])
  })
})

/*
 * The confusing part of the scoring, and therefore the part the reveal exists to show: a tile matching
 * both a value and a colour target is paid for by both.
 */
describe('a tile counted twice', () => {
  it('appears once in each row it belongs to', () => {
    const steps = timelineOf([tile('both', GREEN, 1)])
    const appearances = steps.filter(s => s.kind === 'tile' && s.tileId === 'both')
    expect(appearances.map(s => s.kind === 'tile' && s.row)).toEqual([0, 1])
  })

  it('is not deduplicated away, so the total still reconciles', () => {
    const tiles = [tile('both', GREEN, 1)]
    const steps = timelineOf(tiles)
    expect(steps.filter(s => s.kind === 'tile')).toHaveLength(2)
    expect(steps.at(-1)).toEqual({ kind: 'total', points: 2 })
  })
})

describe('identity', () => {
  it('carries the board id through, which is how a tile gets pointed at', () => {
    const steps = timelineOf([tile('t7', BLUE, 1)])
    expect(steps.find(s => s.kind === 'tile')).toEqual({
      kind: 'tile', row: 0, tileId: 't7', indexInRow: 0, running: 1,
    })
  })

  /* The view finds the chip a tile is flying to by its position in the row, so this has to be right. */
  it('numbers tiles within their own row, restarting each row', () => {
    const steps = timelineOf([tile('a', GREEN, 1), tile('b', GREEN, 1)])
    const byRow = new Map<number, number[]>()
    for (const step of steps) {
      if (step.kind !== 'tile') continue
      byRow.set(step.row, [...(byRow.get(step.row) ?? []), step.indexInRow])
    }
    expect([...byRow.values()]).toEqual([[0, 1], [0, 1]])
  })

  /* A tally built from bare specs still produces a timeline; there is simply nothing to point at. */
  it('tolerates a tally with no ids', () => {
    const steps = scoringTimeline(tallyRound(TARGETS, [{ color: GREEN, value: 1 }]))
    expect(steps.filter(s => s.kind === 'tile').map(s => s.kind === 'tile' && s.tileId)).toEqual(['', ''])
  })
})

describe('timing', () => {
  it('is the sum of every beat', () => {
    const steps = timelineOf([tile('a', BLUE, 1)])
    // row + tile + rowDone, row + rowDone, total
    const expected = DEFAULT_CADENCE.row * 2
      + DEFAULT_CADENCE.tile
      + DEFAULT_CADENCE.rowDone * 2
      + DEFAULT_CADENCE.total
    expect(timelineDuration(steps)).toBe(expected)
  })

  it('gives each step a cumulative delay, starting at zero', () => {
    const steps = timelineOf([tile('a', BLUE, 1)])
    const delays = stepDelays(steps)
    expect(delays[0]).toBe(0)
    expect(delays).toHaveLength(steps.length)
    // Monotonic, since every beat has a positive hold.
    expect([...delays].sort((a, b) => a - b)).toEqual([...delays])
  })

  it('ends one beat short of the full duration, the last hold being the total\'s', () => {
    const steps = timelineOf([tile('a', BLUE, 1)])
    const delays = stepDelays(steps)
    expect(delays.at(-1)).toBe(timelineDuration(steps) - DEFAULT_CADENCE.total)
  })

  it('scales with the cadence it is given', () => {
    const steps = timelineOf([tile('a', BLUE, 1)])
    const brisk = { row: 1, tile: 1, group: 1, rowDone: 1, total: 1 }
    expect(timelineDuration(steps, brisk)).toBe(steps.length)
  })
})

describe('fitting a budget', () => {
  /** A colour target matching `n` tiles — the shape a late round actually produces. */
  function bigRound(n: number) {
    return timelineOf(Array.from({ length: n }, (_, i) => tile(`t${i}`, GREEN, 1)))
  }

  it('leaves a short reveal alone', () => {
    const steps = bigRound(3)
    expect(fitCadence(steps)).toEqual(DEFAULT_CADENCE)
  })

  it('brings a long one back inside the budget', () => {
    const steps = bigRound(60)
    expect(timelineDuration(steps)).toBeGreaterThan(REVEAL_BUDGET_MS)
    // Per-beat rounding can spend at most a millisecond a step over the target.
    expect(timelineDuration(steps, fitCadence(steps))).toBeLessThanOrEqual(REVEAL_BUDGET_MS + steps.length)
  })

  /*
   * Past a point a reveal genuinely cannot fit, and the floor wins over the budget: running fast enough
   * to still be seen beats running so fast it flickers. Skip is the answer for a player who has had
   * enough, which is why overrunning here is a deliberate choice and not a failure to pace.
   */
  it('holds the floor rather than the budget when the two cannot both be met', () => {
    const steps = bigRound(400)
    const cadence = fitCadence(steps)
    expect(cadence).toEqual({
      row: MIN_HOLD_MS, tile: MIN_HOLD_MS, group: MIN_HOLD_MS, rowDone: MIN_HOLD_MS, total: MIN_HOLD_MS,
    })
    expect(timelineDuration(steps, cadence)).toBeGreaterThan(REVEAL_BUDGET_MS)
  })

  it('keeps the rhythm, scaling every beat by the same factor', () => {
    const steps = bigRound(60)
    const cadence = fitCadence(steps)
    // Rows are still held longer than tiles, which is what makes the reveal read as rows.
    expect(cadence.row).toBeGreaterThan(cadence.tile)
  })

  it('survives a timeline with nothing to pace', () => {
    expect(fitCadence(timelineOf([]), 0)).toBeTruthy()
    expect(fitCadence([], 0)).toEqual(DEFAULT_CADENCE)
  })
})

describe('the final scoresheet reveal', () => {
  let n = 0
  const at = (q: number, r: number, color: number, value: number) =>
    ({ id: `f${n++}`, cell: { q, r }, color, value })
  const strip = (color: number, value: number, r = 0) =>
    [at(0, r, color, value), at(1, r, color, value), at(2, r, color, value)]

  it('walks all twelve categories, scoring or not', () => {
    const steps = finalTimeline(finalTally([]))
    expect(steps.filter(s => s.kind === 'row')).toHaveLength(12)
    expect(steps.filter(s => s.kind === 'rowDone')).toHaveLength(12)
    expect(steps.at(-1)).toEqual({ kind: 'total', points: 0 })
  })

  /*
   * The unit is the group, not the tile: three touching greens are worth something the same three
   * scattered are not, so flying them one at a time would be counting the wrong thing.
   */
  it('lands a whole group at once, carrying every member', () => {
    const steps = finalTimeline(finalTally(strip(GREEN, 4)))
    const groups = steps.filter(s => s.kind === 'group')
    expect(groups).toHaveLength(2) // the colour run and the value run, same three tiles
    expect(groups[0]!.kind === 'group' && groups[0]!.tileIds).toHaveLength(3)
  })

  it('carries what each group alone scored, and the row\'s running subtotal', () => {
    // Two separate green runs: 1+2+3 = 6, then 4+5+6 = 15.
    const tiles = [
      at(0, 0, GREEN, 1), at(1, 0, GREEN, 2), at(2, 0, GREEN, 3),
      at(0, 5, GREEN, 4), at(1, 5, GREEN, 5), at(2, 5, GREEN, 6),
    ]
    const green = finalTimeline(finalTally(tiles))
      .filter(s => s.kind === 'group' && s.row === GREEN)
    expect(green.map(s => s.kind === 'group' && s.points)).toEqual([6, 15])
    expect(green.map(s => s.kind === 'group' && s.running)).toEqual([6, 21])
  })

  it('numbers groups within their row', () => {
    const tiles = [
      at(0, 0, GREEN, 1), at(1, 0, GREEN, 2), at(2, 0, GREEN, 3),
      at(0, 5, GREEN, 4), at(1, 5, GREEN, 5), at(2, 5, GREEN, 6),
    ]
    const green = finalTimeline(finalTally(tiles))
      .filter(s => s.kind === 'group' && s.row === GREEN)
    expect(green.map(s => s.kind === 'group' && s.groupIndex)).toEqual([0, 1])
  })

  it('closes each row on the category\'s own total', () => {
    const tally = finalTally(strip(GREEN, 4))
    const steps = finalTimeline(tally)
    tally.categories.forEach((category, row) => {
      const done = steps.find(s => s.kind === 'rowDone' && s.row === row)
      expect(done?.kind === 'rowDone' && done.points).toBe(category.points)
    })
  })

  it('ends on a total that agrees with the tally', () => {
    const tally = finalTally(strip(GREEN, 4))
    expect(finalTimeline(tally).at(-1)).toEqual({ kind: 'total', points: tally.total })
  })

  /* Twelve rows of groups is long, so the budget has to reach this timeline too. */
  it('is paced by the same budget as a round', () => {
    const tiles = Array.from({ length: 6 }, (_, i) => strip(i, i + 1, i * 5)).flat()
    const steps = finalTimeline(finalTally(tiles))
    expect(timelineDuration(steps, fitCadence(steps)))
      .toBeLessThanOrEqual(REVEAL_BUDGET_MS + steps.length)
  })
})
