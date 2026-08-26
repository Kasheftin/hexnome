import { describe, expect, it } from 'vitest'
import type { Command, CommandRow } from '@hexnome/rules/wire'

import { replayScript, roundAt } from './replayScript'

const pass = (seat: number): Command => ({ kind: 'pass', seat })
const deal = (): Command => ({ kind: 'deal', plate: { color: 0, value: 1 }, lot: 0 } as unknown as Command)

let seq = 0
const row = (author: number | null, command: Command): CommandRow =>
  ({ seq: ++seq, prevSeq: seq - 1, author, cmdId: `c${seq}`, command })

describe('cutting a log into moves', () => {
  /* A game nobody played is one position: whatever the server dealt to open it. */
  it('counts no moves in a log of only server rows', () => {
    const script = replayScript([row(null, deal()), row(null, deal())])
    expect(script.moves).toBe(0)
    expect(script.rows(0)).toBe(2)
  })

  it('counts one move per player row', () => {
    const script = replayScript([
      row(null, deal()),
      row(0, pass(0)),
      row(0, pass(0)),
    ])
    expect(script.moves).toBe(2)
  })

  /*
   * The point of the whole module: the deals a move dragged behind it belong to that move, so the
   * position after it is what the next player saw rather than a half-refilled source.
   */
  it('folds the deals behind a move into it', () => {
    const log = [
      row(null, deal()),          // 0 — the opening
      row(0, pass(0)),            // 1 — move 1
      row(null, deal()),          // 2 — its refill
      row(null, deal()),          // 3
      row(1, pass(1)),            // 4 — move 2
    ]
    const script = replayScript(log)
    expect(script.moves).toBe(2)
    expect(script.rows(0)).toBe(1)   // just the opening deal
    expect(script.rows(1)).toBe(4)   // the pass and both refills
    expect(script.rows(2)).toBe(5)   // everything
  })

  it('ends on the whole log, however it was asked', () => {
    const log = [row(null, deal()), row(0, pass(0))]
    const script = replayScript(log)
    expect(script.rows(script.moves)).toBe(log.length)
    expect(script.rows(99)).toBe(log.length)
  })

  /* Stepping back must land where stepping forward did, or the two disagree about the same position. */
  it('names the same positions in both directions', () => {
    const log = [row(null, deal()), row(0, pass(0)), row(null, deal()), row(1, pass(1))]
    const script = replayScript(log)
    const forwards = [0, 1, 2].map(n => script.rows(n))
    const backwards = [2, 1, 0].map(n => script.rows(n)).reverse()
    expect(backwards).toEqual(forwards)
  })

  it('takes a negative position for the opening rather than throwing', () => {
    const script = replayScript([row(null, deal()), row(0, pass(0))])
    expect(script.rows(-3)).toBe(1)
  })

  /* An undo is something a player did, so it is a move — and `replayGame` folds undo rows itself. */
  it('treats an undo as a move of its own', () => {
    const script = replayScript([
      row(0, pass(0)),
      row(0, { kind: 'undo', seat: 0 } as unknown as Command),
    ])
    expect(script.moves).toBe(2)
  })
})

describe('which round a position is in', () => {
  it('starts in round one', () => {
    expect(roundAt([row(null, deal())], 1, 1)).toBe(1)
  })

  /* Solo: one pass closes a round. */
  it('advances when every seat has passed', () => {
    const log = [row(0, pass(0)), row(0, pass(0)), row(0, pass(0))]
    expect(roundAt(log, 1, 1)).toBe(2)
    expect(roundAt(log, 3, 1)).toBe(4)
  })

  it('needs every seat at a table', () => {
    const log = [row(0, pass(0)), row(1, pass(1)), row(2, pass(2))]
    expect(roundAt(log, 2, 3)).toBe(1)
    expect(roundAt(log, 3, 3)).toBe(2)
  })
})
