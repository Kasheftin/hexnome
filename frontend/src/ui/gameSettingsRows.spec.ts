import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GROUP_BONUSES,
  DEFAULT_TILE_COPIES,
  MAX_GROUP_SIZE,
  defaultGameSettings,
  parseGameSettings,
  type GameSettings,
} from '@hexnome/rules/gameSettings'
import { DISTINCT_TILES } from '@hexnome/rules/deck'
import { DIAL_TEXT, bonusKey } from './dialText'
import { ROW_ORDER, settingRows } from './gameSettingsRows'

/**
 * A game's settings, read back.
 *
 * Most of this is a lookup and not worth testing. What is worth testing is the handful that are
 * *stored as one thing and read as another* — the bag holds copies and a player thinks in totals, the
 * switches are booleans and read as words, the group bonuses are an array behind one key each. Those
 * are exactly where a read-only view goes quietly wrong, because a plausible wrong number looks
 * every bit as convincing as the right one.
 */

const settings = (overrides: Partial<GameSettings> = {}): GameSettings =>
  ({ ...defaultGameSettings(0), ...overrides })

const valueOf = (key: string, s: GameSettings = settings()): string | undefined =>
  settingRows(s).find(row => row.key === key)?.value

describe('the values that are not stored the way they are read', () => {
  it('shows the bags as totals, not as copies', () => {
    expect(valueOf('tileCopies')).toBe(String(DEFAULT_TILE_COPIES * DISTINCT_TILES))
    expect(valueOf('tileCopies', settings({ tileCopies: 2 }))).toBe(String(2 * DISTINCT_TILES))
  })

  it('shows the switches as words', () => {
    expect(valueOf('fineUnplaced', settings({ fineUnplaced: true }))).toBe('Yes')
    expect(valueOf('rewardStems', settings({ rewardStems: false }))).toBe('No')
  })

  it('reads each group bonus out of the table by its size', () => {
    const bonuses = [0, 0, 0, 0, 4, 5, 6]
    const s = settings({ groupBonuses: bonuses, minGroupSize: 2 })

    expect(valueOf(bonusKey(4), s)).toBe('4')
    expect(valueOf(bonusKey(6), s)).toBe('6')
  })

  it('names the mode with the rounds it runs for', () => {
    expect(valueOf('mode', settings({ mode: 'random' }))).toContain('6 rounds')
    expect(valueOf('mode', settings({ mode: 'classic' }))).toContain('4 rounds')
    /* The one-round mode, which read "1 rounds" until the count was allowed to be singular. */
    expect(valueOf('mode', settings({ mode: 'quick' }))).toContain('1 round')
    expect(valueOf('mode', settings({ mode: 'quick' }))).not.toContain('1 rounds')
  })
})

describe('what the panel lists', () => {
  /**
   * The one that will actually go wrong: a dial is added to the setup screen and this list is not
   * touched, so the new setting silently never appears in the panel that claims to show all of them.
   */
  it('has a row for every dial that has text', () => {
    for (const key of Object.keys(DIAL_TEXT)) {
      expect(`${key}: listed`).toBe(`${ROW_ORDER.includes(key) ? key : 'MISSING ' + key}: listed`)
    }
  })

  it('lists nothing it has no words for', () => {
    for (const key of ROW_ORDER) {
      expect(`${key}: has text`).toBe(`${key in DIAL_TEXT ? key : 'UNKNOWN ' + key}: has text`)
    }
  })

  /**
   * Shown holding the value the rules force on it — see `settingRows`.
   *
   * Built through `parseGameSettings`, which is how a real game's settings reach this panel: the
   * server re-reads its stored JSON on the way out, and that is where `effectiveStrictBonus` forces a
   * bonus the strict rule always earns. A hand-built object could say anything and would prove nothing
   * about what a player actually sees.
   */
  it('reads the bonus a strict game is always paid, not the one that was stored', () => {
    const strict = parseGameSettings({
      ...defaultGameSettings(0),
      placementRule: 'strict',
      strictEnclosureBonus: 0,
    })
    expect(strict).not.toBeNull()

    expect(valueOf('strictEnclosureBonus', strict!)).toBe('1')
    expect(settingRows(strict!).some(row => row.key === 'strictEnclosureBonus')).toBe(true)
  })

  it('says how many players only when there is more than one', () => {
    expect(settingRows(settings({ players: 3 })).some(r => r.key === 'players')).toBe(true)
    expect(settingRows(settings({ players: 1 })).some(r => r.key === 'players')).toBe(false)
  })

  it('gives every row a label and a value', () => {
    for (const row of settingRows(settings())) {
      expect(`${row.key}: ${row.label.length > 0 && row.value.length > 0}`).toBe(`${row.key}: true`)
    }
  })

  /** The defaults, end to end, so the table cannot silently describe a different game. */
  it('reports the defaults a fresh game runs under', () => {
    expect(valueOf(bonusKey(MAX_GROUP_SIZE))).toBe(String(DEFAULT_GROUP_BONUSES[MAX_GROUP_SIZE]))
  })
})
