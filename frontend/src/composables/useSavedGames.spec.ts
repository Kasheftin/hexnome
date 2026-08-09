import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { defaultGameSettings } from '@hexnome/rules/gameSettings'
import { readSavedGame, useSavedGames } from './useSavedGames'

beforeEach(() => {
  localStorage.clear()
})

const solo = () => ({ ...defaultGameSettings(0), seed: 'a-seed' })

describe('a stored game', () => {
  /*
   * The two readers, and the gap between them. `get` reads the reactive copy, so it is current the
   * instant `create` returns; `readSavedGame` reads localStorage, which `useLocalStorage` writes on
   * the next flush. Nothing in the app trips over that — the router guard runs after `router.push`
   * has already awaited a tick — but "created it and immediately read it back through the guard"
   * would fail, and this is where that is written down.
   */
  it('comes back as it went in, through either reader', async () => {
    const games = useSavedGames()
    const id = games.create(solo())
    expect(games.get(id)?.seed).toBe('a-seed')

    await nextTick()
    expect(readSavedGame(id)?.seed).toBe('a-seed')
  })

  /* A game saved before seeds existed was dealt from its id, so that is the honest substitution. */
  it('falls back to its id when it has no seed', () => {
    const games = useSavedGames()
    const id = games.create({ ...solo(), seed: '' })
    expect(games.get(id)?.seed).toBe(id)
  })
})

describe('naming the seats afterwards', () => {
  it('keeps everything else about the game', () => {
    const games = useSavedGames()
    const id = games.create({ ...solo(), kind: 'multiplayer', players: 3, playerNames: ['Ember'] })

    games.update(id, { playerNames: ['Ember', 'Flux', 'Gimbal'] })
    const after = games.get(id)
    expect(after?.playerNames).toEqual(['Ember', 'Flux', 'Gimbal'])
    expect(after?.players).toBe(3)
    expect(after?.seed).toBe('a-seed')
  })

  /*
   * A patch goes through the same gate a stored blob does. Otherwise `update` becomes a second way
   * into storage, with its own idea of what a readable game is — and the one that skips validation is
   * always the one that writes the unreadable record.
   */
  it('refuses to write a game that could not have been read', () => {
    const games = useSavedGames()
    const id = games.create({ ...solo(), kind: 'multiplayer', players: 2, playerNames: [] })

    games.update(id, { kind: 'co-op' as never })
    expect(games.get(id)?.kind).toBe('multiplayer')

    // Four names at a two-seat table is a list from a different game; the parser drops it whole.
    games.update(id, { playerNames: ['a', 'b', 'c', 'd'] })
    expect(games.get(id)?.playerNames).toEqual([])
  })

  it('does nothing for a game that is not there', () => {
    const games = useSavedGames()
    games.update('no-such-game', { playerNames: ['Ember'] })
    expect(games.get('no-such-game')).toBeNull()
  })
})
