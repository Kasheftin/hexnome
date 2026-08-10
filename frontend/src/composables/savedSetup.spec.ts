import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetSetup, rememberSetup, savedSetup } from './savedSetup'

beforeEach(() => {
  localStorage.clear()
})

const SETUP = { dials: { tileCopies: 3, minGroupSize: 4 }, mode: 'random', placementRule: 'strict', players: 3 }

describe('the last game´s setup', () => {
  it('is absent until a game has been started', () => {
    expect(savedSetup()).toBeNull()
  })

  it('comes back as it went in', () => {
    rememberSetup(SETUP)
    expect(savedSetup()).toEqual(SETUP)
  })

  it('is replaced by the next game rather than merged with it', () => {
    rememberSetup(SETUP)
    rememberSetup({ dials: { tileCopies: 2 } })

    // Not `{ tileCopies: 2, minGroupSize: 4 }`: a setup is what one game was started with, whole.
    expect(savedSetup()?.dials).toEqual({ tileCopies: 2 })
    expect(savedSetup()?.mode).toBeUndefined()
  })

  it('is forgotten on request', () => {
    rememberSetup(SETUP)
    forgetSetup()
    expect(savedSetup()).toBeNull()
  })
})

/**
 * What it does with a blob it cannot read.
 *
 * The store is a text file a person can edit, and this one is written by a version of the app that
 * may not be the one reading it. Every answer here is "fall back to the defaults", because a setup
 * screen opening on the defaults is exactly where it opened before any of this existed.
 */
describe('a store holding something else', () => {
  it('treats nonsense as no setup at all', () => {
    for (const junk of ['not json', '[]', 'null', '"a string"', '7']) {
      localStorage.setItem('hexnome:setup', junk)
      const read = savedSetup()
      expect(`${junk}: ${read === null || Object.keys(read.dials).length === 0}`).toBe(`${junk}: true`)
    }
  })

  /** One bad dial must not cost the other twelve. */
  it('keeps the dials it can read and drops the rest', () => {
    localStorage.setItem('hexnome:setup', JSON.stringify({
      dials: { tileCopies: 3, minGroupSize: 'four', plateSlots: null, initialStems: 2 },
    }))

    expect(savedSetup()?.dials).toEqual({ tileCopies: 3, initialStems: 2 })
  })

  it('drops the card choices when they are not strings', () => {
    localStorage.setItem('hexnome:setup', JSON.stringify({ dials: {}, mode: 7, placementRule: [] }))

    const read = savedSetup()
    expect(read?.mode).toBeUndefined()
    expect(read?.placementRule).toBeUndefined()
  })

  it('survives a store that will not take writes', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })

    expect(() => rememberSetup(SETUP)).not.toThrow()
    vi.restoreAllMocks()
  })
})
