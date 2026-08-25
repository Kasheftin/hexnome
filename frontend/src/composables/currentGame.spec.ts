import { beforeEach, describe, expect, it } from 'vitest'
import { currentGame, forgetCurrentGame, rememberCurrentGame } from './currentGame'

beforeEach(() => {
  localStorage.clear()
})

describe('the game to come back to', () => {
  it('has nothing to offer before a game is played', () => {
    expect(currentGame()).toBeNull()
  })

  it('remembers and returns the game', () => {
    rememberCurrentGame('abc-123')
    expect(currentGame()).toBe('abc-123')
  })

  /* A player is at one table at a time; a menu offering three abandoned games is a filing cabinet. */
  it('keeps only the newest', () => {
    rememberCurrentGame('first')
    rememberCurrentGame('second')
    expect(currentGame()).toBe('second')
  })

  it('ignores an empty id rather than storing one', () => {
    rememberCurrentGame('kept')
    rememberCurrentGame('')
    expect(currentGame()).toBe('kept')
  })

  it('forgets it when told', () => {
    rememberCurrentGame('over')
    forgetCurrentGame()
    expect(currentGame()).toBeNull()
  })

  /*
   * The subtle one. Two tabs on two games: the older finishing must not wipe the offer for the one
   * still being played, so a caller says *which* game it is finishing and is ignored if that is not
   * the game on offer.
   */
  it('will not let an old game clear a newer one', () => {
    rememberCurrentGame('newer')
    forgetCurrentGame('older')
    expect(currentGame()).toBe('newer')

    forgetCurrentGame('newer')
    expect(currentGame()).toBeNull()
  })
})
