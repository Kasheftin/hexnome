/**
 * The wire shapes, defined once and shared.
 *
 * Deliberately plain interfaces rather than generated types: the surface is a handful of endpoints,
 * and a generator would be more machinery than contract. Anything describing the *game* — settings,
 * log entries — comes from `@hexnome/rules`, so client and server cannot disagree about what a move
 * is.
 */
import type { LogEntry } from '@hexnome/rules/gameLog'
import type { GameSettings } from '@hexnome/rules/gameSettings'

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

/** A game's identity and setup. Never its deck: that is the server's alone. */
export interface GameView {
  readonly id: string
  readonly seed: string
  readonly settings: GameSettings
  readonly status: string
  readonly lastSeq: number
}

/** A journal entry with its place in the sequence. */
export interface SeqEntry {
  readonly seq: number
  readonly origin: 'player' | 'server'
  readonly entry: LogEntry
}

export interface LogSlice {
  /** The cursor the caller passed, echoed so a response is self-describing. */
  readonly since: number
  /** The head at the moment of reading. Equal to `since` when there is nothing new. */
  readonly lastSeq: number
  readonly entries: readonly SeqEntry[]
}

export interface AppendBody {
  readonly entries: readonly LogEntry[]
  /**
   * The head the client believed it was appending to.
   *
   * Optional, and a guard rather than a lock: supplied and stale, the append is refused with the real
   * head so the client can catch up first. Without it, a client that had fallen behind would append
   * moves reasoned from a board that no longer exists.
   */
  readonly expectedSeq?: number
}

export interface AppendResult {
  /** The head before this append. */
  readonly from: number
  /** The head after it. */
  readonly lastSeq: number
  /** Everything this call wrote. */
  readonly entries: readonly SeqEntry[]
}
