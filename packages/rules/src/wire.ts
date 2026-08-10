/**
 * What the client and the server say to each other about a *game* — who is at the table and how far
 * along it is. Not yet about turns; those still live in the tab.
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
import type { GameSettings } from './gameSettings'

/** Re-exported so a client needs one import for the whole contract. */
export type { GameSettings }

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

export interface JoinBody {
  /** Optional. An empty name leaves the seat showing its own label rather than a shared default. */
  readonly name?: string
}
