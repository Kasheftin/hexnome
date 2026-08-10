/**
 * What the client and the server say to each other: who is at the table, how far along it is, and
 * every turn anybody has taken.
 *
 * Pure types. This module must not import from `vue` or `three` — see docs/tech-spec.md, "The one
 * hard architectural rule". ESLint enforces it.
 *
 * **Here rather than in the backend, so there is one copy.** Both sides need these shapes, and a
 * duplicate would not fail a typecheck when one of them changed: it would fail at runtime, in a
 * browser, as a field that is quietly undefined. The rest of this package is the game itself; this
 * file is the envelope it travels in, and it is the only part with no opinion about hexagons.
 *
 * Hand-written rather than generated. The surface is three endpoints, and a generator would be more
 * machinery than contract.
 */
import type { Command, PlayerCommand } from './game'
import type { GameSettings } from './gameSettings'

/** Re-exported so a client needs one import for the whole contract. */
export type { Command, GameSettings, PlayerCommand }

/**
 * What a game is waiting for, or that it is not waiting.
 *
 * `waiting` covers a table still filling *and* a solo game in the instant before its only seat is
 * claimed — which is a real instant, because a solo game takes the same path as every other one.
 */
export type GameStatus = 'waiting' | 'running' | 'finished'

/** A place at the table, as everyone is allowed to see it. Never the token. */
export interface SeatView {
  /** Zero-based, matching the tableau. The screen adds one when it shows a number. */
  readonly seat: number
  /** What they called themselves, or empty if they did not say. */
  readonly name: string
  readonly joined: boolean
}

/**
 * A game's identity and setup.
 *
 * **Never its seed.** That is what the desks are built from, and a client holding it could build a
 * second desk from the same order and read the whole deal — which is the thing moving the bag to the
 * server was for. The id is a share link; the seed is a secret; one value cannot be both.
 */
export interface GameView {
  readonly id: string
  readonly status: GameStatus
  /**
   * Bumped on every write to the game, and broadcast to whoever is watching.
   *
   * A watcher compares it with the one it holds and refetches if they differ. It carries no game
   * data, which is what makes it safe to send to anyone holding the id.
   */
  readonly seq: number
  readonly settings: GameSettings
  /** Every seat, claimed or not, so a waiting room can show who is still missing. */
  readonly seats: readonly SeatView[]
  /**
   * Which of them is the caller's, worked out from the token they sent — or null for a spectator.
   *
   * Answered by the server rather than remembered by the client, because the token is the truth and
   * a seat number kept beside it is a second copy that can go stale. A client trusting its own copy
   * could draw one board while acting as another seat, which reads as the game losing its mind
   * rather than as a stale value.
   */
  readonly you: number | null
}

/**
 * The answer to creating or joining: which seat is yours, and the secret that proves it.
 *
 * The **only** response a token ever appears in. Keep it out of everything else.
 */
export interface SeatClaim {
  readonly seat: number
  readonly token: string
  readonly game: GameView
}

export interface CreateGameBody {
  /** A whole `GameSettings`. Unknown here because the server re-validates it rather than trusting it. */
  readonly settings: unknown
  /** What the creator calls themselves. They take seat 0. */
  readonly name?: string
}

/**
 * Which of a game's two desks. They differ only in what they are built from, and the desk service
 * has no idea which is which — see `backend/src/desk`.
 */
export type DeskKind = 'tiles' | 'plates'

export interface CreateDeskBody {
  readonly gameId: string
  readonly kind: DeskKind
}

export interface JoinBody {
  /** Optional. An empty name leaves the seat showing its own label rather than a shared default. */
  readonly name?: string
}

/**
 * A stored turn, as anyone reading the log sees it.
 *
 * One row is one intent, and folding it through `applyCommand` is the whole of applying it. There is
 * no second half — see the `command` column in the schema for why attempt 1 needed one and this does
 * not.
 */
export interface CommandRow {
  readonly seq: number
  readonly prevSeq: number
  /** The seat that played it, or null for the server's own — a deal. */
  readonly author: number | null
  readonly cmdId: string
  readonly command: Command
}

/** Where the chain currently ends. A new command must name this as its `prevSeq`. */
export interface Head {
  readonly seq: number
}

/**
 * Everything after a cursor.
 *
 * A cursor rather than a timestamp: two rows can share a millisecond and clocks step backwards, so
 * `?since=<time>` would silently skip a turn. The numbers are sparse and a game's may jump; only
 * their order ever matters.
 */
export interface CommandSlice {
  /** The cursor the caller passed, echoed so a response is self-describing. */
  readonly since: number
  /** The head at the moment of reading. Equal to `since` when there is nothing new. */
  readonly head: Head
  readonly commands: readonly CommandRow[]
}

export interface SubmitBody {
  /**
   * Client-minted, and stable across resends of the *same* turn.
   *
   * It is what lets a lost response be retried safely: the server recognises the id and hands back
   * the row it already wrote instead of writing a second.
   */
  readonly cmdId: string
  /** The `seq` this turn was built on — the head as the client last saw it. */
  readonly prevSeq: number
  /**
   * The turn itself.
   *
   * No author: it is derived from the seat token on the request. A client that could name its own
   * seat could take somebody else's turn, which is the whole reason the token exists.
   */
  readonly command: unknown
}

/**
 * What a submit wrote — the turn, and anything the server added behind it.
 *
 * Plural because a turn can leave the source wanting a lot, and the deal that follows is the
 * server's own command rather than part of the player's. They are written together, so a reader can
 * never see the turn without the deal it caused.
 */
export interface SubmitResult {
  readonly commands: readonly CommandRow[]
  /** True when this `cmdId` had already been stored and these are the original rows. */
  readonly duplicate: boolean
}
