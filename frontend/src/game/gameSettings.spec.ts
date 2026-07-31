import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLATES_PER_ROUND,
  DEFAULT_STEM_COUNT,
  SINGLEPLAYER_MODES,
  createGameId,
  defaultGameSettings,
  parseGameSettings,
  roundsOf,
} from './gameSettings'

const valid = {
  kind: 'singleplayer',
  mode: 'classic',
  platesPerRound: 5,
  initialStems: 2,
  createdAt: 1_700_000_000_000,
}

describe('parsing settings that came back from storage', () => {
  it('accepts a well-formed record unchanged', () => {
    expect(parseGameSettings(valid)).toEqual(valid)
  })

  it('rejects anything that is not an object', () => {
    for (const junk of [null, undefined, 0, '', 'classic', [], true, NaN]) {
      expect(parseGameSettings(junk)).toBeNull()
    }
  })

  it('rejects an unknown kind or mode outright', () => {
    // These name what the game *is*. Substituting a default would drop the player into a
    // different game from the one they started, so the whole record is refused.
    expect(parseGameSettings({ ...valid, kind: 'co-op' })).toBeNull()
    expect(parseGameSettings({ ...valid, mode: 'blitz' })).toBeNull()
    expect(parseGameSettings({ ...valid, kind: undefined })).toBeNull()
    expect(parseGameSettings({ ...valid, mode: 42 })).toBeNull()
  })

  it('falls back rather than failing on a bad plate count', () => {
    // A dial, not an identity: worth repairing instead of discarding the game.
    for (const bad of [0, 2, 7, 4.5, -4, '4', null, undefined, NaN]) {
      const parsed = parseGameSettings({ ...valid, platesPerRound: bad })
      expect(parsed?.platesPerRound).toBe(DEFAULT_PLATES_PER_ROUND)
    }
  })

  it('falls back rather than failing on a bad stem count', () => {
    // A dial like platesPerRound, not an identity: worth repairing instead of discarding the game.
    for (const bad of [0, 5, 2.5, -1, '3', null, undefined, NaN]) {
      const parsed = parseGameSettings({ ...valid, initialStems: bad })
      expect(parsed?.initialStems).toBe(DEFAULT_STEM_COUNT)
    }
  })

  it('tolerates a missing or nonsense timestamp', () => {
    expect(parseGameSettings({ ...valid, createdAt: undefined })?.createdAt).toBe(0)
    expect(parseGameSettings({ ...valid, createdAt: Infinity })?.createdAt).toBe(0)
    expect(parseGameSettings({ ...valid, createdAt: 'yesterday' })?.createdAt).toBe(0)
  })

  it('ignores extra keys from a future or past shape', () => {
    const parsed = parseGameSettings({ ...valid, seed: 'abc', players: 3 })
    expect(parsed).toEqual(valid)
  })

  it('round-trips through JSON, which is how it is actually stored', () => {
    const parsed = parseGameSettings(JSON.parse(JSON.stringify(valid)))
    expect(parsed).toEqual(valid)
  })
})

describe('defaults', () => {
  it('start a playable singleplayer game', () => {
    const s = defaultGameSettings(123)
    expect(s.kind).toBe('singleplayer')
    expect(s.platesPerRound).toBe(DEFAULT_PLATES_PER_ROUND)
    expect(s.initialStems).toBe(DEFAULT_STEM_COUNT)
    expect(s.createdAt).toBe(123)
    expect(parseGameSettings(s)).toEqual(s)
  })
})

describe('rounds', () => {
  it('are defined for every mode the menu offers', () => {
    for (const mode of SINGLEPLAYER_MODES) {
      expect(roundsOf(mode.id)).toBe(mode.rounds)
      expect(mode.rounds).toBeGreaterThan(0)
    }
  })
})

describe('game ids', () => {
  it('look like uuids and do not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => createGameId()))
    expect(ids.size).toBe(500)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    }
  })
})
