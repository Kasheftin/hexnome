/**
 * What each round scores for.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * ## Two different scoring systems
 *
 * This is the **per-round** one: at the end of a round, count the tiles on the board matching that
 * round's targets. The other is the final **group** scoring — connected runs of a colour or a value,
 * scored once at the end (docs/game-design.md). They share nothing but the word "score", which is why
 * this file is named for the agenda instead.
 *
 * ## The rules
 *
 * A round scores for **targets**. A value target pays for every tile on the board carrying that value;
 * a colour target pays for every tile of that colour. Counting is over the whole board as it stands,
 * not only what was placed during the round, and a plate's own tile counts like any other.
 *
 * Across a mode's rounds every value 1–6 and every colour appears **exactly once** — twelve targets,
 * dealt 3 to a round over four rounds or 2 over six. That is not a rule imposed on the data so much as
 * a consequence of how it is built: see `dealColors`.
 *
 * ## Frozen contract
 *
 * The agenda is derived from the game id, so it is a second promise attached to a URL, alongside the
 * deck. Changing the plans, the order the colour deck is built in, or the seed tags silently hands a
 * returning player different targets for an id they already have. `agenda.spec.ts` pins exact output
 * for known ids so that fails a test instead of a game.
 *
 * It is derived and **never stored**. Both inputs already survive a reload — the id is in the URL, the
 * mode in the saved settings — and persisting the result would let an agenda written by an older build
 * outlive the code that produced it.
 */
import { TILE_COLOR_COUNT, TILE_VALUE_COUNT } from './deck'
import type { SingleplayerMode } from './gameSettings'
import { createRandom, shuffleInPlace } from './random'
import type { TileSpec } from './tableau'

/**
 * One thing a round scores for.
 *
 * A discriminated union rather than `{ kind, index }`, because the two payloads are numbers in
 * *different spaces*: a value is 1–6, a colour is a 0-based index into the palette. One shared field
 * would compile, never narrow, and hide that off-by-one at every use.
 */
export type ScoringTarget =
  | { readonly kind: 'value', readonly value: number, readonly points: number }
  | { readonly kind: 'color', readonly color: number, readonly points: number }

export type RoundAgenda = readonly ScoringTarget[]

/** A whole mode's plan. **Index 0 is round 1** — position *is* the round number. */
export type Agenda = readonly RoundAgenda[]

/**
 * What a tile is worth to a target that matches it.
 *
 * Tunable, because the numbers are not settled. They are applied once, by the builder, and baked into
 * each target — the panel has to print "2 ea" and the scorer has to multiply, and deriving that in two
 * places is how the two come to disagree.
 */
export const VALUE_POINTS: readonly number[] = [1, 2, 3, 4, 5, 6]
export const COLOR_POINTS = 1

/**
 * The fixed half of a mode: which values a round scores, and how many colours it claims.
 *
 * Which colours those are is dealt per game, so a plan says "one colour" and not "orange".
 */
interface RoundPlan {
  readonly values: readonly number[]
  readonly colors: number
}

/**
 * Classic: the values in ascending runs, the colour count alternating to make the arithmetic work.
 *
 * Twelve targets over four rounds is three each, and six values plus six colours is what there is to
 * spend — so a round taking two values takes one colour and vice versa.
 */
const CLASSIC_PLAN: readonly RoundPlan[] = [
  { values: [1, 2], colors: 1 },
  { values: [3], colors: 2 },
  { values: [4, 5], colors: 1 },
  { values: [6], colors: 2 },
]

function pointsForValue(value: number): number {
  return VALUE_POINTS[value - 1] ?? value
}

/** `[0, 1, … n-1]`. Built ascending, always: the shuffle's output depends on the input order. */
function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i)
}

/**
 * Walk a plan, dealing colours off a shuffled deck.
 *
 * **Coverage falls out of the arithmetic here.** The deck is a permutation of all six colours and a
 * plan's slots total exactly six, so "every colour exactly once" is a consequence of consuming the
 * deck rather than a property to check for afterwards. The guard is on the plan, not the result: a
 * plan claiming five colours would silently drop the sixth from every game for ever.
 */
function dealColors(plan: readonly RoundPlan[], colors: readonly number[]): Agenda {
  const slots = plan.reduce((total, round) => total + round.colors, 0)
  if (slots !== colors.length) {
    throw new Error(
      `agenda plan claims ${slots} colours but ${colors.length} exist — every colour must be dealt once`,
    )
  }

  let next = 0
  return plan.map(round => [
    ...round.values.map((value): ScoringTarget => ({
      kind: 'value',
      value,
      points: pointsForValue(value),
    })),
    ...Array.from({ length: round.colors }, (): ScoringTarget => ({
      kind: 'color',
      color: colors[next++] as number,
      points: COLOR_POINTS,
    })),
  ])
}

/**
 * The agenda for a game.
 *
 * Seeded on two independent streams, following the convention in `random.ts`. One stream would couple
 * the modes to each other: `random` draws values before colours and `classic` draws no values at all,
 * so a shared stream would deal them different colours from the same id purely through draw order.
 *
 * The mode is deliberately **not** part of the seed tag. That is what makes "reversed is classic
 * backwards" true of the colours too, and not merely of the running order.
 */
export function createAgenda(gameId: string, mode: SingleplayerMode): Agenda {
  const colors = shuffleInPlace(range(TILE_COLOR_COUNT), createRandom(`${gameId}:agenda:colors`))

  if (mode === 'random') {
    // Two decks zipped, never a shuffle of pairs — that would weld each value to one colour for ever.
    const values = shuffleInPlace(
      range(TILE_VALUE_COUNT).map(index => index + 1),
      createRandom(`${gameId}:agenda:values`),
    )
    return dealColors(values.map(value => ({ values: [value], colors: 1 })), colors)
  }

  const classic = dealColors(CLASSIC_PLAN, colors)
  /*
   * Reversed is built by reversing the *result*, never the plan.
   *
   * Reversing the plan first would also be deterministic, would also pass every coverage check, and
   * would not be classic reversed: its round 1 would take the first colour off the deck instead of the
   * one classic gave round 4. On a copy, because `reverse` mutates.
   */
  return mode === 'classicReversed' ? [...classic].reverse() : classic
}

/** The round's targets, or undefined past the end. Owns the one place 1-based rounds meet 0-based indices. */
export function roundAgenda(agenda: Agenda, round: number): RoundAgenda | undefined {
  return agenda[round - 1]
}

function matches(target: ScoringTarget, tile: TileSpec): boolean {
  return target.kind === 'value' ? tile.value === target.value : tile.color === target.color
}

/**
 * One target's contribution: what it matched, and what that came to.
 *
 * Generic in the tile so **identity survives the tally**. The board hands in real `Tile`s, and a panel
 * that wants to point at the tile it just counted needs the id back; narrowing to `TileSpec` on the way
 * out would throw that away and leave the caller re-deriving which tile was which. The default keeps
 * `TargetTally` meaning what it always did for callers that only need colour and value.
 */
export interface TargetTally<T extends TileSpec = TileSpec> {
  readonly target: ScoringTarget
  /** The matching tiles themselves, so a results panel can show what was counted. */
  readonly tiles: readonly T[]
  readonly points: number
}

export interface RoundTally<T extends TileSpec = TileSpec> {
  readonly rows: readonly TargetTally<T>[]
  readonly total: number
}

/**
 * What these tiles are worth against these targets, target by target.
 *
 * A tile is counted **once per target it matches**, so one that satisfies both a value and a colour
 * target in the same round scores for both. That follows from the targets being independent things the
 * round pays for, rather than a list to classify each tile into — and it is why this returns rows that
 * can overlap rather than a partition.
 *
 * Returning the tiles and not merely the counts is what lets the round-end panel show its working.
 * A total with no visible arithmetic is a number the player has to trust.
 */
export function tallyRound<T extends TileSpec>(
  targets: RoundAgenda,
  tiles: readonly T[],
): RoundTally<T> {
  const rows = targets.map((target): TargetTally<T> => {
    const matched = tiles.filter(tile => matches(target, tile))
    return { target, tiles: matched, points: matched.length * target.points }
  })
  return { rows, total: rows.reduce((sum, row) => sum + row.points, 0) }
}

/** The same arithmetic, when only the number is wanted. One implementation, so they cannot disagree. */
export function scoreTargets(targets: RoundAgenda, tiles: readonly TileSpec[]): number {
  return tallyRound(targets, tiles).total
}
