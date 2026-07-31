import { describe, expect, it } from 'vitest'
import {
  COLOR_POINTS,
  VALUE_POINTS,
  createAgenda,
  roundAgenda,
  scoreTargets,
  tallyRound,
  type Agenda,
  type ScoringTarget,
} from './agenda'
import { TILE_COLOR_COUNT, TILE_VALUE_COUNT } from './deck'
import { SINGLEPLAYER_MODES, roundsOf } from './gameSettings'

/** The same two ids the deck pins use — a shared seed would show up as both files changing at once. */
const ID_A = '3f2a1c8e-5b6d-4e7f-9a0b-1c2d3e4f5a6b'
const ID_B = '00000000-0000-4000-8000-000000000000'

const MODES = SINGLEPLAYER_MODES.map(m => m.id)

/** Compact rendering, so a golden pin reads as a plan rather than as a wall of objects. */
const sketch = (agenda: Agenda) => agenda.map(round => round.map(target =>
  target.kind === 'value' ? `v${target.value}/${target.points}` : `c${target.color}/${target.points}`))

const valuesOf = (agenda: Agenda) => agenda.flat()
  .filter((t): t is Extract<ScoringTarget, { kind: 'value' }> => t.kind === 'value')
const colorsOf = (agenda: Agenda) => agenda.flat()
  .filter((t): t is Extract<ScoringTarget, { kind: 'color' }> => t.kind === 'color')

const tile = (color: number, value: number) => ({ color, value })

describe('the agenda a game id deals', () => {
  /*
   * Golden. The agenda is a second promise attached to a URL, like the deck: change the plans, the
   * order the colour deck is built in, or the seed tags, and a returning player gets different targets
   * for an id they already have. If this fails, ask whether existing ids were *meant* to change.
   */
  it('is pinned for known ids', () => {
    expect(sketch(createAgenda(ID_A, 'classic'))).toEqual([
      ['v1/1', 'v2/2', 'c1/1'],
      ['v3/3', 'c3/1', 'c0/1'],
      ['v4/4', 'v5/5', 'c5/1'],
      ['v6/6', 'c2/1', 'c4/1'],
    ])
    expect(sketch(createAgenda(ID_A, 'random'))).toEqual([
      ['v3/3', 'c1/1'], ['v6/6', 'c3/1'], ['v2/2', 'c0/1'],
      ['v5/5', 'c5/1'], ['v4/4', 'c2/1'], ['v1/1', 'c4/1'],
    ])
    // A second id, low-entropy where the first is not, so a weak hash shows up here.
    expect(sketch(createAgenda(ID_B, 'classic'))).toEqual([
      ['v1/1', 'v2/2', 'c5/1'],
      ['v3/3', 'c2/1', 'c1/1'],
      ['v4/4', 'v5/5', 'c4/1'],
      ['v6/6', 'c3/1', 'c0/1'],
    ])
  })

  it('gives the same id the same agenda every time', () => {
    for (const mode of MODES) {
      expect(createAgenda(ID_A, mode)).toEqual(createAgenda(ID_A, mode))
    }
  })

  it('gives different ids different colour plans', () => {
    const a = colorsOf(createAgenda(ID_A, 'classic')).map(t => t.color)
    const b = colorsOf(createAgenda(ID_B, 'classic')).map(t => t.color)
    expect(a).not.toEqual(b)
  })

  it('does not let building one mode disturb another', () => {
    // `shuffleInPlace` and `reverse` both mutate; a shared constant reached by either would show here.
    const first = createAgenda(ID_A, 'classic')
    createAgenda(ID_A, 'classicReversed')
    createAgenda(ID_B, 'random')
    expect(createAgenda(ID_A, 'classic')).toEqual(first)
  })
})

describe('reversed is classic backwards', () => {
  /*
   * The only test that catches reversing the *plan* instead of the result. That bug is deterministic,
   * passes coverage, passes every range check, and simply deals round 1 the wrong colour.
   */
  it('round for round, colours included', () => {
    for (const id of [ID_A, ID_B]) {
      const classic = createAgenda(id, 'classic')
      expect(createAgenda(id, 'classicReversed')).toEqual([...classic].reverse())
    }
  })
})

describe('every mode covers everything exactly once', () => {
  const ids = Array.from({ length: 120 }, (_, i) => `seed-${i}-${i * 7919}`)

  it('spends all six values and all six colours', () => {
    for (const mode of MODES) {
      for (const id of ids) {
        const agenda = createAgenda(id, mode)
        expect(valuesOf(agenda).map(t => t.value).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
        expect(colorsOf(agenda).map(t => t.color).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
        expect(agenda.flat()).toHaveLength(TILE_VALUE_COUNT + TILE_COLOR_COUNT)
      }
    }
  })

  it('runs for as many rounds as the mode says', () => {
    // Looped over the mode list rather than hardcoded, so a new mode fails here instead of shipping
    // an agenda of zero rounds.
    for (const mode of MODES) {
      expect(createAgenda(ID_A, mode)).toHaveLength(roundsOf(mode))
    }
  })

  it('keeps classic\'s value structure whatever the id', () => {
    for (const id of ids.slice(0, 20)) {
      const agenda = createAgenda(id, 'classic')
      expect(agenda.map(round => round.filter(t => t.kind === 'value').map(t => t.value)))
        .toEqual([[1, 2], [3], [4, 5], [6]])
      expect(agenda.map(round => round.filter(t => t.kind === 'color').length)).toEqual([1, 2, 1, 2])
    }
  })

  it('pays the value itself for a value, and a flat rate for a colour', () => {
    const agenda = createAgenda(ID_A, 'classic')
    for (const target of valuesOf(agenda)) {
      expect(target.points).toBe(VALUE_POINTS[target.value - 1])
    }
    for (const target of colorsOf(agenda)) expect(target.points).toBe(COLOR_POINTS)
  })
})

describe('rounds are addressed from 1', () => {
  it('maps round 1 to the first entry, and runs out past the end', () => {
    const agenda = createAgenda(ID_A, 'classic')
    expect(roundAgenda(agenda, 1)).toBe(agenda[0])
    expect(roundAgenda(agenda, 4)).toBe(agenda[3])
    expect(roundAgenda(agenda, 5)).toBeUndefined()
    expect(roundAgenda(agenda, 0)).toBeUndefined()
  })
})

describe('scoring a board against a round', () => {
  const RED = 4
  const BLUE = 1

  it('is nothing on an empty board', () => {
    expect(scoreTargets(roundAgenda(createAgenda(ID_A, 'classic'), 1) ?? [], [])).toBe(0)
  })

  it('pays a value target once per matching tile', () => {
    const targets: ScoringTarget[] = [{ kind: 'value', value: 6, points: 6 }]
    const tiles = [tile(RED, 6), tile(BLUE, 6), tile(BLUE, 6), tile(RED, 1)]
    expect(scoreTargets(targets, tiles)).toBe(18)
  })

  it('pays a colour target regardless of value', () => {
    const targets: ScoringTarget[] = [{ kind: 'color', color: BLUE, points: 1 }]
    const tiles = [tile(BLUE, 1), tile(BLUE, 3), tile(BLUE, 6), tile(BLUE, 2), tile(RED, 1)]
    expect(scoreTargets(targets, tiles)).toBe(4)
  })

  it('pays twice for a tile that matches both targets in one round', () => {
    // The targets are independent things the round pays for, not buckets to sort each tile into.
    const targets: ScoringTarget[] = [
      { kind: 'value', value: 2, points: 2 },
      { kind: 'color', color: BLUE, points: 1 },
    ]
    expect(scoreTargets(targets, [tile(BLUE, 2)])).toBe(3)
  })

  it('adds every target in the round together', () => {
    const targets: ScoringTarget[] = [
      { kind: 'value', value: 1, points: 1 },
      { kind: 'value', value: 2, points: 2 },
      { kind: 'color', color: RED, points: 1 },
    ]
    // red-1 scores 1+1, blue-2 scores 2, red-5 scores 1.
    expect(scoreTargets(targets, [tile(RED, 1), tile(BLUE, 2), tile(RED, 5)])).toBe(5)
  })
})

describe('showing the working', () => {
  const BLUE = 1
  const RED = 4

  it('lists the tiles each target matched, and what they came to', () => {
    const targets = [
      { kind: 'value', value: 2, points: 2 },
      { kind: 'color', color: BLUE, points: 1 },
    ] as const
    const tiles = [tile(BLUE, 2), tile(RED, 2), tile(BLUE, 5)]

    const { rows, total } = tallyRound(targets, tiles)
    expect(rows[0]!.tiles).toEqual([tile(BLUE, 2), tile(RED, 2)])
    expect(rows[0]!.points).toBe(4)
    expect(rows[1]!.tiles).toEqual([tile(BLUE, 2), tile(BLUE, 5)])
    expect(rows[1]!.points).toBe(2)
    // The blue-2 appears in both rows: the rows overlap rather than partition the board.
    expect(total).toBe(6)
  })

  it('keeps a row for a target that matched nothing', () => {
    const { rows, total } = tallyRound([{ kind: 'value', value: 6, points: 6 }], [tile(BLUE, 1)])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.tiles).toEqual([])
    expect(rows[0]!.points).toBe(0)
    expect(total).toBe(0)
  })

  it('agrees with the plain total', () => {
    const targets = createAgenda(ID_A, 'classic')[0]!
    const tiles = [tile(BLUE, 1), tile(RED, 2), tile(BLUE, 2)]
    expect(tallyRound(targets, tiles).total).toBe(scoreTargets(targets, tiles))
  })
})
