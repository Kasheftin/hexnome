import { beforeEach, describe, expect, it } from 'vitest'
import { readSavedGame } from './useSavedGames'

/**
 * Reading games back out of storage.
 *
 * The interesting cases are all about **the seed being separate from the id** — a distinction that
 * did not exist when the first games were stored, so old entries have to keep working.
 */

const KEY = 'hexnome:games'

const settings = {
  kind: 'singleplayer',
  mode: 'classic',
  platesPerRound: 4,
  tileSlots: 16,
  plateSlots: 2,
  initialStems: 3,
  stemsPerInternalAnchor: 3,
  stemsPerExternalAnchor: 2,
  strictEnclosureBonus: 1,
  placementRule: 'regular',
  minGroupSize: 3,
  groupBonuses: [0, 0, 0, 0, 0, 0, 6],
  fineUnplaced: true,
  rewardStems: true,
  createdAt: 1_700_000_000_000,
}

function store(value: Record<string, unknown>): void {
  globalThis.localStorage.setItem(KEY, JSON.stringify(value))
}

beforeEach(() => globalThis.localStorage.clear())

describe('reading a stored game', () => {
  it('returns the seed and the settings separately', () => {
    store({ 'game-1': { seed: 'a-seed', settings } })
    const game = readSavedGame('game-1')
    expect(game?.seed).toBe('a-seed')
    expect(game?.settings.mode).toBe('classic')
  })

  /* Two ids sharing one seed is the whole point: the same deal, played again. */
  it('lets two games share a seed', () => {
    store({ 'first': { seed: 'shared', settings }, 'second': { seed: 'shared', settings } })
    expect(readSavedGame('first')?.seed).toBe(readSavedGame('second')?.seed)
    expect(readSavedGame('first')?.seed).toBe('shared')
  })

  /*
   * Games stored before seeds existed hold settings at the top level and no seed at all. They were
   * played with the id *as* the seed, so falling back to it deals the board they always dealt —
   * rather than silently reshuffling somebody's saved game.
   */
  it('falls back to the id for a game stored before seeds existed', () => {
    store({ 'old-game': settings })
    const game = readSavedGame('old-game')
    expect(game?.seed).toBe('old-game')
    expect(game?.settings.platesPerRound).toBe(4)
  })

  it('drops an entry it cannot read rather than guessing', () => {
    store({ bad: { seed: 'x', settings: { kind: 'nonsense' } } })
    expect(readSavedGame('bad')).toBeNull()
    expect(readSavedGame('missing')).toBeNull()
  })
})
