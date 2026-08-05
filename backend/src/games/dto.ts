/**
 * The wire shapes, defined once and shared.
 *
 * Deliberately plain interfaces rather than generated types: the surface is a handful of endpoints,
 * and a generator would be more machinery than contract. Anything describing the *game* — settings,
 * log entries — comes from `@hexnome/rules`, so client and server cannot disagree about what a move
 * is.
 *
 * Note the layering. A **command** is a step of the game loop; the `LogEntry` values it carries are
 * the effects that step had. The rules package owns the second and knows nothing of the first, which
 * is what lets the server take over computing effects later without touching the wire format.
 */
import type { LogEntry } from '@hexnome/rules/gameLog'
import type { GameSettings } from '@hexnome/rules/gameSettings'

/** The only seat there is, until there are seats. */
export const SOLO_SEAT = 'p1'

/** The author of anything the server writes on its own account. */
export const SERVER_SEAT = 'server'

/** The predecessor of the first command. Zero rather than null — see the schema. */
export const GENESIS = 0

export interface CreateGameBody {
  readonly settings: unknown
  /**
   * Replay an existing deal. Omitted, a fresh seed is minted.
   *
   * The id is always new — that is the difference between the two, and the whole reason they are
   * separate fields.
   */
  readonly seed?: string
}

/** Where a game's log currently ends, and who may write next. */
export interface Head {
  /** The `seq` a new command must name as its `prevSeq`. */
  readonly seq: number
  /** The seat that may act. Empty once the game is over. */
  readonly awaiting: string
}

/** A game's identity and setup. Never its deck: that is the server's alone. */
export interface GameView {
  readonly id: string
  readonly seed: string
  readonly settings: GameSettings
  readonly status: string
  readonly head: Head
}

/**
 * A stored command, as anyone reading the log sees it.
 *
 * `effects` then `response`, in that order, is what replaying this command means. They are kept
 * apart for the one caller that cannot treat them alike: a client that applied its own turn
 * optimistically already holds `effects` and must apply only `response`.
 */
export interface CommandView {
  readonly seq: number
  readonly prevSeq: number
  readonly author: string
  readonly awaiting: string
  readonly cmdId: string
  /** What the author's turn did. */
  readonly effects: readonly LogEntry[]
  /** What the server added in reply — a restock, a plate turning over. Often empty. */
  readonly response: readonly LogEntry[]
}

/** Everything a command did, in the order it has to be replayed. */
export function replayOf(command: CommandView): LogEntry[] {
  return [...command.effects, ...command.response]
}

export interface CommandSlice {
  /** The cursor the caller passed, echoed so a response is self-describing. */
  readonly since: number
  /** The head at the moment of reading. `seq` equals `since` when there is nothing new. */
  readonly head: Head
  readonly commands: readonly CommandView[]
}

export interface SubmitBody {
  /**
   * The caller's own id for this command, and the reason a retry is safe.
   *
   * Minted by the client, stable across resends of the *same* command. A second submission carrying
   * an id already stored is answered with the stored row rather than refused, which is the
   * difference between "your retry worked" and an error the client cannot interpret.
   */
  readonly cmdId: string
  /**
   * The `seq` the caller built this on, and the concurrency guard.
   *
   * `0` for the first command of a game. Naming a predecessor that already has a child is refused
   * with the real head, so a client that fell behind can catch up in one round trip.
   */
  readonly prevSeq: number
  /** The seat submitting. Refused unless it matches the head's `awaiting`. */
  readonly author?: string
  /** What the player's turn did. Server-owned effects are appended to these, in the same row. */
  readonly effects: readonly LogEntry[]
}

/** What a submission returns: the row as stored, and whether it was already there. */
export interface SubmitResult {
  readonly command: CommandView
  /**
   * True when this `cmdId` had already been stored and the row is the original.
   *
   * Worth telling apart from a fresh write: an idempotent replay means the client's optimistic state
   * is already correct, and there is nothing new to animate.
   */
  readonly duplicate: boolean
}
