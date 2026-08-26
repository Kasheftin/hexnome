/**
 * A finished game's log, cut into the moves somebody actually made.
 *
 * The log holds more rows than there were turns. A draft is followed by the server's own `deal`
 * commands refilling the source, written in the same breath, and those carry no author. Stepping
 * through them one at a time would spend four presses watching a lot refill and would count a
 * forty-turn game as a hundred and something.
 *
 * So a **move** is one player-authored command together with whatever the server wrote behind it, and
 * the position after a move is the position the next player actually faced. That also makes stepping
 * symmetric: backwards lands on the same positions forwards did, because both are named by the same
 * boundaries rather than by counting rows in opposite directions.
 *
 * Pure, and separate from the view, because it is the part worth testing — no `.vue` file in this
 * repo is.
 */
import type { CommandRow } from '@hexnome/rules/wire'

export interface ReplayScript {
  /** How many moves the game held. Position 0 is the opening, `moves` is the end. */
  readonly moves: number
  /**
   * How many log rows to fold to reach a position.
   *
   * `rows(0)` is the opening — everything the server wrote before anybody moved, which is the deal
   * that put the first plates out. `rows(moves)` is the whole log.
   */
  rows(position: number): number
}

/**
 * Where each move begins.
 *
 * By author rather than by `kind`, because that is the actual question — "did a person do this?" —
 * and it stays right if the server ever writes something that is not a deal. An `undo` is a player's
 * row like any other and is a move of its own: `replayGame` folds undo rows itself, so a prefix cut
 * anywhere still rebuilds a position that really happened.
 */
export function replayScript(log: readonly CommandRow[]): ReplayScript {
  const starts: number[] = []
  for (const [index, row] of log.entries()) {
    if (row.author !== null) starts.push(index)
  }

  return {
    moves: starts.length,
    rows(position: number): number {
      if (position <= 0) return starts[0] ?? log.length
      return starts[position] ?? log.length
    },
  }
}

/**
 * Which round a position falls in, for a scrubber that wants to say more than a number.
 *
 * Counted from the passes in the log rather than from a replayed state, so a transport can label
 * itself without folding the game first.
 */
export function roundAt(log: readonly CommandRow[], rows: number, seats: number): number {
  let passes = 0
  for (const row of log.slice(0, rows)) {
    if (row.command.kind === 'pass') passes++
  }
  return Math.floor(passes / Math.max(1, seats)) + 1
}
