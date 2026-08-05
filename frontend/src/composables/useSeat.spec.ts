import { beforeEach, describe, expect, it } from 'vitest'
import { playerName, rememberName, rememberSeat, seatIn, SUGGESTED_NAMES } from './useSeat'

beforeEach(() => {
  localStorage.clear()
})

describe('the name you arrive under', () => {
  it('is one of the suggestions on a first visit', () => {
    expect(SUGGESTED_NAMES).toContain(playerName())
  })

  /* Minted once and kept: you are the same person next visit, not a new one. */
  it('is the same on every visit after that', () => {
    const first = playerName()
    expect(playerName()).toBe(first)
    expect(playerName()).toBe(first)
  })

  it('gives way to whatever you type', () => {
    playerName()
    rememberName('Kasheftin')
    expect(playerName()).toBe('Kasheftin')
  })

  /*
   * The distinction the getter has to make. Never set means "suggest me one"; set to empty means
   * "I would rather not say", and re-minting over that would undo a decision on every page load.
   */
  it('leaves a deliberately cleared name cleared', () => {
    playerName()
    rememberName('')
    expect(playerName()).toBe('')
    expect(playerName()).toBe('')
  })

  it('trims and bounds what it is given', () => {
    rememberName(`  ${'x'.repeat(60)}  `)
    expect(playerName()).toBe('x'.repeat(40))
  })

  /* Names are shown beside tiles, so a name that is also a tile colour would read ambiguously. */
  it('suggests nothing that collides with a tile colour', () => {
    const palette = ['Orange', 'Lime', 'Green', 'Blue', 'Indigo', 'Magenta']
    for (const name of SUGGESTED_NAMES) expect(palette).not.toContain(name)
  })

  it('offers a decent spread of distinct, short names', () => {
    expect(SUGGESTED_NAMES.length).toBeGreaterThanOrEqual(30)
    expect(new Set(SUGGESTED_NAMES).size).toBe(SUGGESTED_NAMES.length)
    for (const name of SUGGESTED_NAMES) {
      expect(name).toMatch(/^[A-Z][a-z]+$/)
      expect(name.length).toBeLessThanOrEqual(14)
    }
  })
})

describe('the seat you hold', () => {
  it('is remembered per game, because one person may be in several', () => {
    rememberSeat('game-a', { seat: 0, token: 'aaa' })
    rememberSeat('game-b', { seat: 2, token: 'bbb' })

    expect(seatIn('game-a')).toEqual({ seat: 0, token: 'aaa' })
    expect(seatIn('game-b')).toEqual({ seat: 2, token: 'bbb' })
    expect(seatIn('game-c')).toBeNull()
  })

  it('reads nothing out of storage that has been mangled', () => {
    localStorage.setItem('hexnome:seats', 'not json at all')
    expect(seatIn('game-a')).toBeNull()

    localStorage.setItem('hexnome:seats', JSON.stringify({ 'game-a': { seat: 'one' } }))
    expect(seatIn('game-a')).toBeNull()
  })
})
