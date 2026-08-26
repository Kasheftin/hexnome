/**
 * The only place a high score query becomes typed values.
 *
 * The same discipline as `games/dto.ts`: Nest hands a controller whatever arrived, typed as whatever
 * the signature claims, and the claim is not checked. Query strings are worse than bodies about it,
 * because every value is a string and `Number('')` is 0 — so a missing parameter reads as a perfectly
 * plausible number unless somebody says otherwise.
 *
 * The existing `?since=` is read as a bare `Number(since ?? 0)` in the games controller and clamped
 * again inside the service. That works for a cursor, where any nonsense simply means "from the
 * start". It does not work here: an unbounded `offset` is a request for MySQL to count past five
 * million rows, and an unbounded `limit` is a table scan with a page around it.
 */
import { BadRequestException } from '@nestjs/common'
import { isPlayerCount } from '../rules/gameSettings'
import { findPreset } from '../rules/presets'

/** The most rows one request may ask for, and what it gets if it does not ask. */
export const MAX_LIMIT = 100
export const DEFAULT_LIMIT = 20

/**
 * How far in a caller may skip.
 *
 * Not a statement about how many games there will ever be — it is what stops `OFFSET 5000000`, which
 * MySQL answers by counting five million rows and throwing them away. A board nobody will page to the
 * end of does not need to be pageable to the end of.
 */
export const MAX_OFFSET = 10_000

export interface HighscoreQuery {
  readonly presetId: string
  readonly players: number
  readonly limit: number
  readonly offset: number
}

/**
 * A whole number, or the fallback — refusing anything that is neither.
 *
 * Absent is not the same as wrong: no `limit` means "the usual", while `limit=banana` is a caller
 * that thinks it asked for something. The first is answered and the second is refused.
 */
function counted(value: unknown, what: string, fallback: number, max: number): number {
  if (value === undefined || value === '') return fallback
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new BadRequestException(`${what} must be a number`)
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException(`${what} must be a whole number, not ${String(value)}`)
  }
  return Math.min(parsed, max)
}

/**
 * Which board, and which slice of it.
 *
 * **Both filters are required.** A board is a preset *and* a seat count — a solo score says nothing
 * about a score at four — so there is no sensible answer to "all of them", and requiring both keeps
 * the query a pure equality prefix on the index. The screen always has both anyway.
 */
export function highscoreQuery(raw: Record<string, unknown>): HighscoreQuery {
  const preset = raw.preset
  if (typeof preset !== 'string' || !findPreset(preset)) {
    throw new BadRequestException(`no such preset: ${String(preset)}`)
  }

  const players = Number(raw.players)
  if (!isPlayerCount(players)) {
    throw new BadRequestException(`no board seats ${String(raw.players)} players`)
  }

  return {
    presetId: preset,
    players,
    limit: Math.max(1, counted(raw.limit, 'limit', DEFAULT_LIMIT, MAX_LIMIT)),
    offset: counted(raw.offset, 'offset', 0, MAX_OFFSET),
  }
}
