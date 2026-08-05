/**
 * What the client and the server say to each other.
 *
 * Pure types and two constants. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * **Here rather than in the backend, so there is one copy.** Both sides need these shapes, and a
 * duplicate would not fail a typecheck when one of them changed — it would fail at runtime, in a
 * browser, as a field that is quietly undefined. The rest of this package is the game itself; this
 * file is the envelope it travels in, and it is the only part with no opinion about hexagons.
 *
 * Note the layering. A **command** is a step of the game loop; the `LogEntry` values it carries are
 * the effects that step had. Everything else here knows nothing of commands, which is what lets the
 * server take over computing effects later without touching the format.
 *
 * Deliberately hand-written rather than generated: the surface is four endpoints, and a generator
 * would be more machinery than contract.
 */
import type { LogEntry } from './gameLog'
import type { GameSettings } from './gameSettings'

/*
 * Re-exported so a client needs one import for the whole contract. They belong to the game rather
 * than to the wire, but every shape below is made of them.
 */
export type { GameSettings, LogEntry }

/**
 * The server's own writes have no seat.
 *
 * `null` rather than a reserved number, so nothing can accidentally compare equal to a real seat —
 * and so the type says outright that not every command comes from a player.
 */
export const SERVER_SEAT = null

/** The predecessor of the first command. Zero rather than null — see the schema. */
export const GENESIS = 0

export interface JoinBody {
  /** Optional. An empty name leaves the seat showing its own label rather than a shared default. */
  readonly name?: string
}

export interface CreateGameBody {
  readonly settings: unknown
  /** What the creator calls themselves. They take seat 0. */
  readonly name?: string
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
  /** The seat that may act, or null once the game is over. Zero-based, as the tableau counts. */
  readonly awaiting: number | null
}

/** A place at the table, as everyone is allowed to see it. Never the token. */
export interface SeatView {
  /** Zero-based, matching the tableau. The screen adds one when it shows a number. */
  readonly seat: number
  /** What they called themselves, or empty if they did not say. */
  readonly name: string
  readonly joined: boolean
}

/** What a game is waiting for, or that it is not waiting. */
export type GameStatus = 'lobby' | 'running' | 'finished'

/**
 * The answer to joining or creating: which seat is yours, and the secret that proves it.
 *
 * The **only** response a token ever appears in. Keep it out of everything else.
 */
export interface SeatClaim {
  readonly seat: number
  readonly token: string
  readonly game: GameView
}

/** A game's identity and setup. Never its deck: that is the server's alone. */
export interface GameView {
  readonly id: string
  readonly seed: string
  readonly settings: GameSettings
  readonly status: GameStatus
  /** Every seat, claimed or not, so a waiting room can show who is still missing. */
  readonly seats: readonly SeatView[]
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
  readonly author: number | null
  readonly awaiting: number | null
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
  /*
   * No author. It is derived from the seat token on the request — a client that could name its own
   * seat could take somebody else's turn, which is the whole reason the token exists.
   */
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
