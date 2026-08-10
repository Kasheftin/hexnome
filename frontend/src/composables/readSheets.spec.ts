import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rememberSheetRead, sheetRead } from './readSheets'

beforeEach(() => {
  localStorage.clear()
})

/*
 * The number is **rounds closed**, not `state.round`. They differ exactly once, at the end: a
 * finished game does not advance its round, so keying on the round number files the last two sheets
 * under one entry and the game ends without showing a score. See `readSheets`.
 */
describe('a score sheet you have read', () => {
  it('is unread until it is put away', () => {
    expect(sheetRead('a-game', 2)).toBe(false)
    rememberSheetRead('a-game', 2)
    expect(sheetRead('a-game', 2)).toBe(true)
  })

  /** The whole point: what makes a refresh stop putting the sheet back. */
  it('stays read across a fresh page', () => {
    rememberSheetRead('a-game', 2)
    expect(sheetRead('a-game', 2)).toBe(true)
  })

  /** A third closed round is a different sheet, and unread because the second one was read. */
  it('does not cover the next round', () => {
    rememberSheetRead('a-game', 2)
    expect(sheetRead('a-game', 3)).toBe(false)
  })

  /** Reading the third leaves the second read — sheets are read in order and none comes back. */
  it('covers every round before it', () => {
    rememberSheetRead('a-game', 3)
    expect(sheetRead('a-game', 2)).toBe(true)
  })

  /** Going backwards cannot un-read one. Nothing does this today; the store simply cannot say it. */
  it('never goes backwards', () => {
    rememberSheetRead('a-game', 3)
    rememberSheetRead('a-game', 2)
    expect(sheetRead('a-game', 3)).toBe(true)
  })

  /** One person can be in several games at once, at different rounds in each. */
  it('is per game', () => {
    rememberSheetRead('a-game', 2)
    expect(sheetRead('another-game', 2)).toBe(false)
  })
})

describe('the store itself', () => {
  it('forgets the oldest games rather than growing forever', () => {
    for (let at = 0; at < 45; at++) rememberSheetRead(`game-${at}`, 2)

    expect(sheetRead('game-44', 2)).toBe(true)
    expect(sheetRead('game-0', 2)).toBe(false)
    expect(Object.keys(JSON.parse(localStorage.getItem('hexnome:read-sheets') ?? '{}') as object))
      .toHaveLength(40)
  })

  /** A sheet shown twice is a smaller wrong than a board that will not draw. */
  it('treats nonsense on disk as nothing read', () => {
    localStorage.setItem('hexnome:read-sheets', 'not json')
    expect(sheetRead('a-game', 2)).toBe(false)

    /*
     * A *numeric* string, which is the case the type guard earns its place on. `"3" >= 2` is true in
     * JavaScript, so a round read straight out of the store without checking would silently answer
     * yes to a question nobody in this codebase asked it.
     */
    localStorage.setItem('hexnome:read-sheets', '{"a-game":"3"}')
    expect(sheetRead('a-game', 2)).toBe(false)
  })

  it('survives a store that will not take writes', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })

    expect(() => rememberSheetRead('a-game', 2)).not.toThrow()
    vi.restoreAllMocks()
  })
})
