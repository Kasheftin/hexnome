import { describe, expect, it } from 'vitest'
import type { HighscoreRow } from '@hexnome/rules/wire'
import { boardName, boardRows, finishedOn, nameOf, tableOf } from './highscoreRows'

const row = (over: Partial<HighscoreRow> = {}): HighscoreRow => ({
  gameId: 'a-game',
  presetId: 'standard',
  players: 1,
  score: 42,
  winnerSeat: 0,
  winnerName: 'Ember',
  finishedAt: '2026-03-04T12:00:00.000Z',
  ...over,
})

describe('who a row credits', () => {
  it('uses the name they gave', () => {
    expect(nameOf(row())).toBe('Ember')
  })

  /*
   * An empty name is a real answer, not a missing one — the setup screen allows it and the table
   * shows the seat's own label instead. The board has to reach the same label from the seat number,
   * which is zero-based in the model and one-based on screen.
   */
  it('falls back to the seat label when they declined to say', () => {
    expect(nameOf(row({ winnerName: '', winnerSeat: 2 }))).toBe('Player 3')
    expect(nameOf(row({ winnerName: '   ', winnerSeat: 0 }))).toBe('Player 1')
  })
})

describe('what table it was', () => {
  it('calls playing alone what it is', () => {
    expect(tableOf(1)).toBe('Solo')
  })

  it('counts the rest', () => {
    expect(tableOf(2)).toBe('2 players')
    expect(tableOf(4)).toBe('4 players')
  })
})

describe('when it finished', () => {
  it('gives the day, without a clock time nobody wants', () => {
    expect(finishedOn('2026-03-04T12:00:00.000Z', 'en-GB')).toBe('4 Mar 2026')
  })

  /* `new Date('')` renders as "Invalid Date", which is not a thing to put in front of a player. */
  it('says nothing rather than Invalid Date', () => {
    expect(finishedOn('', 'en-GB')).toBe('—')
    expect(finishedOn('not a date', 'en-GB')).toBe('—')
  })
})

describe('a page of a board', () => {
  /*
   * The rank is a fact about the query, not about the row — the server sends no position, because a
   * row that carried one would be wrong the moment anybody filtered differently.
   */
  it('numbers from where the page starts, not from one', () => {
    const rows = boardRows([row(), row({ score: 40 })], 20, 'en-GB')
    expect(rows.map(entry => entry.rank)).toEqual([21, 22])
  })

  it('keys by the game, since neither name nor score is unique', () => {
    const tied = [row({ winnerName: 'Ember', gameId: 'one' }), row({ winnerName: 'Ember', gameId: 'two' })]
    const keys = boardRows(tied, 0, 'en-GB').map(entry => entry.key)
    expect(keys).toEqual(['one', 'two'])
  })

  it('shapes each row for the table', () => {
    expect(boardRows([row({ players: 3, winnerName: '' })], 0, 'en-GB')[0]).toEqual({
      rank: 1,
      gameId: 'a-game',
      who: 'Player 1',
      score: 42,
      players: '3 players',
      finished: '4 Mar 2026',
      key: 'a-game',
    })
  })
})

describe('what a board is called', () => {
  it('uses the preset it belongs to', () => {
    expect(boardName('standard-2')).toBe('Standard')
    expect(boardName('quick-2')).toBe('Quick')
  })

  /*
   * A board recorded under a ruleset that has since been retired still has to be nameable — and that
   * is not hypothetical: `standard` is exactly such an id now that undo changed what the game deals.
   */
  it('falls back to the id for a ruleset no longer offered', () => {
    expect(boardName('standard')).toBe('standard')
    expect(boardName('retired-preset')).toBe('retired-preset')
  })
})
