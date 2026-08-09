/**
 * The desk: a bag of tiles, the pile they come back to, and how one becomes the other.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * This is what the server owns. A client that can derive the deck can read the whole game off its own
 * console, so the derivation lives behind an HTTP boundary (`backend/src/desk`) and the browser learns
 * a tile only when it is dealt one.
 *
 * **It knows nothing about the game.** No turns, no plates, no players, no scoring — a bag of numbers
 * that can be drawn from and discarded to. Two desks make a game: one for tiles, one for plates. The
 * desk cannot tell them apart and does not need to; the caller passes a different seed for each.
 *
 * ## State, not a closure
 *
 * Everything is a plain value in and a plain value out, because the whole thing has to survive a round
 * trip through a JSON column between one request and the next. That is the only real difference from
 * the bag this replaces: the mechanism below — sorted batches, the generation counter, the pile's own
 * digits in the reshuffle seed — is the same one, and the golden pin in `desk.spec.ts` is the same
 * assertion.
 *
 * ## Frozen contract
 *
 * The encoding, the build order, the shuffle direction and the reshuffle seed are all promises to
 * every game already dealt. Change one and a seed handed out yesterday deals something else today,
 * silently — nothing at runtime can notice. `desk.spec.ts` pins exact output for two known seeds so
 * that becomes a failing test instead of a confused player. `random.ts` is inside the same contract.
 */
import { TILE_COLOR_COUNT, TILE_VALUE_COUNT } from './deck'
import { createRandom, shuffleInPlace } from './random'
import type { TileSpec } from './tableau'

/**
 * A tile as two digits, `11`–`66`: colour then value.
 *
 * Used for the wire format, the sort key and the reshuffle seed alike — one encoding for all three, so
 * they cannot drift apart. A desk that sorted one way and seeded another would still be deterministic
 * and still be wrong, in a way only a golden test would ever notice.
 *
 * The `+ 1` is load-bearing: colour is 0-based in the model, and `01` loses its leading zero once
 * concatenated into a seed string, which would make two different piles seed the same reshuffle. The
 * trick holds while there are at most nine colours; a tenth needs a different encoding, and every
 * existing seed's reshuffles change with it.
 */
export function tileCode(spec: TileSpec): number {
  return (spec.color + 1) * 10 + spec.value
}

/** The spec a code stands for, or null if it is not one. The inverse of {@link tileCode}. */
export function tileFromCode(code: number): TileSpec | null {
  if (!Number.isInteger(code)) return null
  const color = Math.floor(code / 10) - 1
  const value = code % 10
  if (color < 0 || color >= TILE_COLOR_COUNT) return null
  if (value < 1 || value > TILE_VALUE_COUNT) return null
  return { color, value }
}

export function isTileCode(value: unknown): value is number {
  return typeof value === 'number' && tileFromCode(value) !== null
}

/**
 * A batch in canonical order: ascending.
 *
 * **A batch is a whole event** — one payment, or one round-end sweep — and it is sorted as it lands, so
 * the order the player happened to click in never reaches the pile. Discarding item by item would make
 * every batch a single item, the sort a no-op, and click order load-bearing again, which is the precise
 * thing this exists to prevent.
 *
 * Ties need no tiebreak here. Two equal codes are the same tile as far as anything downstream can tell,
 * which is exactly what the pile used to need a petal comparison to guarantee — codes carry no petal,
 * so the problem does not arise.
 */
export function inDiscardOrder(codes: readonly number[]): number[] {
  return [...codes].sort((a, b) => a - b)
}

/**
 * A desk as it stands, and as it is stored.
 *
 * `seed`, `copies` and `exclude` are what it was built from and never change; `desk`, `discard` and
 * `generation` are play. Keeping the first three means a reshuffle can be reproduced and a discard can
 * be checked against what the bag could possibly hold.
 */
export interface DeskState {
  readonly seed: string
  /** Copies of each of the 36 distinct tiles the desk was built with. */
  readonly copies: number
  /** Codes held back at creation — the players' opening plates. See {@link createDesk}. */
  readonly exclude: readonly number[]
  /** Waiting to be drawn, front first. */
  readonly desk: readonly number[]
  /** Spent, waiting to be shuffled back in. Sorted runs, one per batch. */
  readonly discard: readonly number[]
  /** How many reshuffles have happened, and the generation the next one will use. */
  readonly generation: number
}

export type DeskResult<T> = { readonly ok: true, readonly value: T } | { readonly ok: false, readonly error: string }

const ok = <T>(value: T): DeskResult<T> => ({ ok: true, value })
const fail = <T>(error: string): DeskResult<T> => ({ ok: false, error })

/** The most copies a desk may be built with. Generous: the settings offer 1–4. */
const MAX_COPIES = 10

export interface DeskOptions {
  readonly copies: number
  /**
   * Codes to leave out of the bag entirely, one occurrence removed per entry.
   *
   * This is how a player's opening plate stays out of the shared source: it is on a board, so it must
   * never be dealt. The desk is told which codes rather than asked to work it out — that would mean
   * knowing what an opening plate is, and it is a bag of numbers.
   */
  readonly exclude?: readonly number[]
}

/**
 * Every distinct tile, colour-major then value ascending, repeated `copies` times.
 *
 * The order is part of the frozen contract: the shuffle permutes *this* list, so building it
 * value-major would deal a different desk from the same seed. Copies are built one whole set after
 * another and the finished list is shuffled once, so duplicates spread through the bag rather than the
 * second copy sitting behind the first.
 */
function everyCode(copies: number): number[] {
  const codes: number[] = []
  for (let copy = 0; copy < copies; copy++) {
    for (let color = 0; color < TILE_COLOR_COUNT; color++) {
      // Values are the symbols 1–6, not 0-based like colours — see TileSpec.
      for (let value = 1; value <= TILE_VALUE_COUNT; value++) codes.push(tileCode({ color, value }))
    }
  }
  return codes
}

export function createDesk(seed: string, options: DeskOptions): DeskResult<DeskState> {
  if (typeof seed !== 'string' || seed.length === 0) return fail('seed must be a non-empty string')
  const { copies } = options
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
    return fail(`copies must be a whole number from 1 to ${MAX_COPIES}`)
  }

  const exclude = options.exclude ?? []
  const codes = everyCode(copies)
  for (const code of exclude) {
    if (!isTileCode(code)) return fail(`${String(code)} is not a tile code`)
    const at = codes.indexOf(code)
    // One occurrence per entry, so excluding a code twice needs it listed twice — and a bag of one
    // copy cannot be asked to hold back two of the same tile.
    if (at === -1) return fail(`the bag does not hold enough ${code}s to exclude that many`)
    codes.splice(at, 1)
  }

  shuffleInPlace(codes, createRandom(seed))
  return ok({ seed, copies, exclude: [...exclude], desk: codes, discard: [], generation: 0 })
}

/** How many can still be drawn: what is left in the bag plus what is waiting in the pile. */
export function deskRemaining(state: DeskState): number {
  return state.desk.length + state.discard.length
}

/**
 * Turn the pile into the new bag.
 *
 * Whatever was already drawn stays drawn — the remnant left in the old bag is not part of the pile and
 * is not shuffled back in. That is the deck-of-cards behaviour a short draw expects: you take the last
 * cards off the old deck, *then* cut the discards.
 *
 * The pile's own digits are in the seed as well as being the thing permuted, so the same pile in the
 * same game reshuffles the same way, and a different pile does not.
 */
function reshuffled(seed: string, discard: readonly number[], generation: number): number[] {
  const digits = discard.join('')
  return shuffleInPlace([...discard], createRandom(`${seed}:${generation}:${digits}`))
}

export interface DeskDraw {
  readonly state: DeskState
  readonly codes: readonly number[]
}

/**
 * Draw `n`, reshuffling the pile in if the bag runs short mid-draw.
 *
 * **Refuses rather than returning short.** The bag this replaces handed back what it had, because a
 * caller holding the whole deck could see for itself that the game was over. Over HTTP a short array
 * is a silent surprise, and asking for a thousand tiles is a bug rather than an end-of-game — so a
 * draw that cannot be filled is an error and nothing moves.
 */
export function drawFromDesk(state: DeskState, n: number): DeskResult<DeskDraw> {
  if (!Number.isInteger(n) || n <= 0) return fail('n must be a whole number greater than zero')
  const available = deskRemaining(state)
  if (n > available) return fail(`cannot draw ${n}: only ${available} left in the desk and the pile`)

  const desk = [...state.desk]
  let discard = [...state.discard]
  let generation = state.generation
  const codes: number[] = []

  while (codes.length < n) {
    codes.push(...desk.splice(0, n - codes.length))
    if (codes.length >= n) break
    // Guarded above: with the count checked, there is always something in the pile to come back.
    const next = reshuffled(state.seed, discard, generation)
    desk.push(...next)
    discard = []
    generation++
  }

  return ok({ state: { ...state, desk, discard, generation }, codes })
}

/**
 * Put a whole event's worth of codes into the pile.
 *
 * Validated against what exists: each code exists `copies` times in the whole game, and desk plus pile
 * can never hold more than that — the difference is what players are holding. Anything that would push
 * a code past its total was never drawn, so it is refused. That one check is what stops a client
 * inventing tiles for a desk that would happily deal them back out.
 *
 * **The excluded codes are not deducted.** An opening plate is held rather than destroyed, and spending
 * it puts it in the pile — from where it can be dealt out of a bag it was never in. That is intended: a
 * plate is a plate.
 */
export function discardToDesk(state: DeskState, codes: readonly number[]): DeskResult<DeskState> {
  if (!Array.isArray(codes)) return fail('codes must be an array')
  if (codes.length === 0) return ok(state)

  const held = new Map<number, number>()
  const bump = (code: number): number => {
    const next = (held.get(code) ?? 0) + 1
    held.set(code, next)
    return next
  }
  for (const code of state.desk) bump(code)
  for (const code of state.discard) bump(code)

  for (const code of codes) {
    if (!isTileCode(code)) return fail(`${String(code)} is not a tile code`)
    if (bump(code) > state.copies) return fail(`${code} was never drawn from this desk`)
  }

  return ok({ ...state, discard: [...state.discard, ...inDiscardOrder(codes)] })
}
