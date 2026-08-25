import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readScoringPanel, rememberScoringPanel } from './scoringPanel'

describe('remembering whether the scoring panel is open', () => {
  beforeEach(() => localStorage.clear())

  it('has no answer until the player gives one', () => {
    // Not "closed". A player who has never pressed the control has stated nothing, and the caller
    // decides what to do about that — which is the whole reason this is nullable.
    expect(readScoringPanel()).toBeNull()
  })

  it('remembers either choice', () => {
    rememberScoringPanel('closed')
    expect(readScoringPanel()).toBe('closed')
    rememberScoringPanel('open')
    expect(readScoringPanel()).toBe('open')
  })

  it('reads nonsense as no preference rather than as a choice', () => {
    for (const junk of ['', 'yes', 'OPEN', '1', '{}']) {
      localStorage.setItem('hexnome:scoring-panel', junk)
      expect(readScoringPanel()).toBeNull()
    }
  })

  it('survives storage being unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readScoringPanel()).toBeNull()
    expect(() => rememberScoringPanel('open')).not.toThrow()
    getItem.mockRestore()
    setItem.mockRestore()
  })
})
