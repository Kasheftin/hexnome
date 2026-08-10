/**
 * The wire shapes, and the only place an untrusted body becomes a typed value.
 *
 * The same discipline as `desk/dto.ts`: Nest hands a controller whatever JSON arrived, typed as
 * whatever the signature claims, and the claim is not checked. So every field is read through one of
 * these and a body that does not parse never reaches the service.
 *
 * `settings` is the exception that proves it — it is passed through as `unknown` and validated by
 * `parseGameSettings`, which is the same gate the client already puts localStorage through. There is
 * one definition of what a readable game is, and it is in the rules package.
 */
import { BadRequestException } from '@nestjs/common'
import { MAX_NAME_LENGTH, parseGameSettings, type GameSettings } from '../rules/gameSettings'

function body(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BadRequestException('expected a JSON object')
  }
  return value as Record<string, unknown>
}

/**
 * A name, trimmed and bounded — or empty, which is allowed.
 *
 * An empty name is not a missing one: the seat shows its own label instead, and that is a perfectly
 * good way to sit down. Refusing it would make naming yourself mandatory in a game where the point
 * of the screen is that you have already arrived.
 */
function name(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new BadRequestException('name must be a string')
  return value.trim().slice(0, MAX_NAME_LENGTH)
}

export interface CreateGame {
  readonly settings: GameSettings
  readonly name: string
}

export function createGameBody(raw: unknown): CreateGame {
  const value = body(raw)
  const settings = parseGameSettings(value.settings)
  if (!settings) throw new BadRequestException('settings are not a game this server can read')
  return { settings, name: name(value.name) }
}

export function joinBody(raw: unknown): { readonly name: string } {
  // A join may carry no body at all — "put me anywhere" is a complete request.
  if (raw === undefined || raw === null) return { name: '' }
  return { name: name(body(raw).name) }
}

/**
 * A submitted turn: which turn it is, what it was built on, and the intent itself.
 *
 * The `command` is passed through as `unknown` and read by `parseCommand` in the rules package, for
 * the same reason `settings` is: there is one definition of what a readable command is, and it is
 * the one the fold uses.
 */
export function submitBody(raw: unknown): { cmdId: string, prevSeq: number, command: unknown } {
  const value = body(raw)
  const { cmdId, prevSeq } = value
  if (typeof cmdId !== 'string' || cmdId.length === 0 || cmdId.length > 36) {
    throw new BadRequestException('cmdId must be a string of 1 to 36 characters')
  }
  if (typeof prevSeq !== 'number' || !Number.isInteger(prevSeq) || prevSeq < 0) {
    throw new BadRequestException('prevSeq must be a whole number, 0 or more')
  }
  return { cmdId, prevSeq, command: value.command }
}

/**
 * The seat token from an `Authorization: Seat <token>` header, or empty.
 *
 * Empty is not an error on a read: the id is already the capability to look at a table, and the token
 * only decides which seat `you` names. On a submit it is everything — the seat comes from here and
 * nowhere else, so a client cannot claim one.
 */
export function seatToken(header: string | undefined): string {
  const [scheme, value] = (header ?? '').split(' ')
  return scheme?.toLowerCase() === 'seat' ? (value ?? '') : ''
}
