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

export interface CreateDeskBody {
  readonly seed: string
  readonly copies: number
  readonly exclude: number[]
}

export function createDeskBody(raw: unknown): CreateDeskBody {
  const value = body(raw)
  const { seed, copies } = value
  if (typeof seed !== 'string' || seed.length === 0 || seed.length > 200) {
    throw new BadRequestException('seed must be a string of 1 to 200 characters')
  }
  if (typeof copies !== 'number' || !Number.isInteger(copies)) {
    throw new BadRequestException('copies must be a whole number')
  }
  return { seed, copies, exclude: value.exclude === undefined ? [] : numbers(value.exclude, 'exclude') }
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
