import { beforeEach, describe, expect, it } from 'vitest'
import { playerName, rememberName, suggestName, SUGGESTED_NAMES } from './playerName'

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
   * The distinction the getter has to make. Never set means "suggest me one"; set to empty means "I
   * would rather not say", and re-minting over that would undo a decision on every page load.
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

  /* Names will be shown beside tiles, so one that is also a tile colour would read ambiguously. */
  it('suggests nothing that collides with a tile colour', () => {
    const palette = ['Orange', 'Lime', 'Green', 'Blue', 'Indigo', 'Magenta']
    for (const name of SUGGESTED_NAMES) expect(palette).not.toContain(name)
  })

  /*
   * The reroll button's contract. Over a hundred presses a uniform pick would return the current
   * name three or four times, and each of those looks like a press that did nothing.
   */
  it('never suggests the name you already have', () => {
    for (const held of SUGGESTED_NAMES) {
      for (let press = 0; press < 20; press++) {
        const next = suggestName(held)
        expect(next).not.toBe(held)
        expect(SUGGESTED_NAMES).toContain(next)
      }
    }
  })

  /* A typed name is not in the pool, so nothing is excluded and every suggestion is still valid. */
  it('suggests something when what you hold is not a suggestion', () => {
    expect(SUGGESTED_NAMES).toContain(suggestName('Kasheftin'))
    expect(SUGGESTED_NAMES).toContain(suggestName(''))
    expect(SUGGESTED_NAMES).toContain(suggestName())
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
