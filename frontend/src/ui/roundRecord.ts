/**
 * A finished round as the results panel needs it: what the board looked like, and what it scored.
 *
 * Both halves are **derived from the game journal** rather than kept as the round ends — see
 * `game/gameLog.ts`. That is what lets the panel show round 1's board while round 3 is being played:
 * the picture is rebuilt from a prefix of the log, not remembered.
 */
import type { RoundTally } from '@/game/agenda'
import type { Tile } from '@/game/tableau'
import type { BoardDiagram } from '@/scene/boardDiagram'

export interface RoundRecord {
  /** 1-based, matching what the player is shown. */
  readonly round: number
  /** The board as it stood when this round ended. */
  readonly board: BoardDiagram
  readonly tally: RoundTally<Tile>
}
