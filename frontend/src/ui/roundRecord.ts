/**
 * A finished round as the results panel needs it: what the board looked like, and what it scored.
 *
 * Both halves are **derived from the game journal** rather than kept as the round ends — see
 * `game/gameLog.ts`. That is what lets the panel show round 1's board while round 3 is being played:
 * the picture is rebuilt from a prefix of the log, not remembered.
 */
import type { RoundTally } from '@hexnome/rules/agenda'
import type { Leftovers } from '@hexnome/rules/groups'
import type { Tile } from '@hexnome/rules/tableau'
import type { BoardDiagram } from '@/scene/boardDiagram'

export interface RoundRecord {
  /** 1-based, matching what the player is shown. */
  readonly round: number
  /** The board as it stood when this round ended. */
  readonly board: BoardDiagram
  readonly tally: RoundTally<Tile>
  /**
   * Points taken off for being the first to pass this round, or 0.
   *
   * Kept beside the tally rather than folded into it, because it is not something the board can be
   * counted to find: the tally is what the tiles were worth, and this is what the round charged for
   * leaving it early. `SeatState.banked` is already net of it — this is only so the panel can show
   * why the two numbers differ.
   */
  readonly fine: number
  /** Still in the drawer at that point. Only the last round's is ever settled — see `game/groups.ts`. */
  readonly leftovers: Leftovers
}
