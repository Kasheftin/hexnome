/**
 * The wire shapes, and the only place an untrusted body becomes a typed value.
 *
 * Nest hands controllers whatever JSON arrived, typed as whatever the signature claims — the claim is
 * not checked. So every field is read through one of these, and a body that does not parse never
 * reaches the service.
 *
 * The *rules* live in `@hexnome/rules/desk`: which codes exist, whether a draw fits, whether a discard
 * could have been drawn. This file only establishes that the request is the right shape, so the two
 * cannot disagree about a game they both partly understand.
 */
import { BadRequestException } from '@nestjs/common'
import type { CreateDeskBody } from '../rules/wire'

/** The most codes one request may carry. A round-end sweep is a few dozen; this is room to spare. */
const MAX_BATCH = 500

function body(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('expected a JSON object')
  }
  return value as Record<string, unknown>
}

function numbers(value: unknown, field: string): number[] {
  if (!Array.isArray(value)) throw new BadRequestException(`${field} must be an array of numbers`)
  if (value.length > MAX_BATCH) throw new BadRequestException(`${field} is too long`)
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) {
      throw new BadRequestException(`${field} must hold whole numbers`)
    }
  }
  return value as number[]
}

/**
 * Which game, and which of its two desks — and nothing else.
 *
 * It used to be `{ seed, copies, exclude }`, all three from the client. Every one of them is a fact
 * about the game, and the server now holds the game: the seed is its own and never sent out, the
 * copies are in its settings, and the plates to hold back follow from them. A client that cannot
 * state them cannot misstate them.
 */
export function createDeskBody(raw: unknown): CreateDeskBody {
  const value = body(raw)
  const { gameId, kind } = value
  if (typeof gameId !== 'string' || gameId.length === 0 || gameId.length > 64) {
    throw new BadRequestException('gameId must be a string of 1 to 64 characters')
  }
  if (kind !== 'tiles' && kind !== 'plates') {
    throw new BadRequestException("kind must be 'tiles' or 'plates'")
  }
  return { gameId, kind }
}

export function drawBody(raw: unknown): number {
  const { n } = body(raw)
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    throw new BadRequestException('n must be a whole number')
  }
  return n
}

/**
 * `{ codes: [...] }`, or a bare array.
 *
 * Both are accepted because both read naturally at the call site — "discard these" is a list, and a
 * wrapper leaves room for a field to be added later without breaking anything.
 */
export function discardBody(raw: unknown): number[] {
  if (Array.isArray(raw)) return numbers(raw, 'codes')
  return numbers(body(raw).codes, 'codes')
}
