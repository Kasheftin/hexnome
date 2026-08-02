/**
 * The order a score is counted out in — a round's targets, or the final board's groups.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * A round-end panel that states a total asks to be trusted. Counting it out — this target, then these
 * tiles one at a time, then the next target — shows where the number came from. That reveal has two
 * halves, and they are deliberately split: **this module owns the sequence, the view owns the clock and
 * the pixels.** The sequence is then something a test can read, which is the half where the arithmetic
 * lives and where a mistake would be invisible on screen.
 *
 * ## A tile can be counted twice
 *
 * A tile matching both a value target and a colour target appears in both rows, because the targets are
 * independent things the round pays for rather than bins to sort tiles into (see `agenda.ts`). So the
 * same `tileId` legitimately appears in two `tile` steps. That is the single most confusing thing about
 * the scoring, which makes it the thing the reveal most needs to show rather than hide.
 */
import type { RoundTally } from './agenda'
import type { FinalTally } from './groups'
import type { TileSpec } from './tableau'

/**
 * One beat of the reveal.
 *
 * `running` is the row's subtotal **after** this tile lands, so a view can assign it rather than
 * accumulate — an animation that can be skipped, replayed or interrupted should never be the thing
 * holding the count.
 */
export type ScoringStep =
  /** This target lights up. Nothing has been counted for it yet. */
  | { readonly kind: 'row', readonly row: number }
  | {
    readonly kind: 'tile'
    readonly row: number
    /** Identifies the tile on the board. Empty when the tally was built from bare specs. */
    readonly tileId: string
    /** Position within its own row, so a view can find the chip this tile is flying to. */
    readonly indexInRow: number
    readonly running: number
  }
  /**
   * A whole connected group lands at once, and then shows what it scored.
   *
   * Final scoring's unit is the group, not the tile: three green tiles touching are worth something
   * that the same three scattered are not, so a reveal that flew them one at a time would be counting
   * the wrong thing.
   */
  | {
    readonly kind: 'group'
    readonly row: number
    readonly groupIndex: number
    readonly tileIds: readonly string[]
    /** What this group alone scored. */
    readonly points: number
    /** The row's subtotal after it lands. */
    readonly running: number
  }
  /** The row is finished, at `points`. Also fires for a row that matched nothing. */
  | { readonly kind: 'rowDone', readonly row: number, readonly points: number }
  | { readonly kind: 'total', readonly points: number }

/** How long each kind of beat is held, in milliseconds. */
export interface Cadence {
  /** After a row lights up, before its first tile. */
  readonly row: number
  /** Between one tile landing and the next leaving. */
  readonly tile: number
  /** After a whole group lands, before the next one — longer, there being more to take in. */
  readonly group: number
  /** After a row's last tile, before the next row. */
  readonly rowDone: number
  /** Before the total is revealed. */
  readonly total: number
}

export const DEFAULT_CADENCE: Cadence = { row: 420, tile: 260, group: 620, rowDone: 340, total: 420 }

/** A tile with an id, when the tally was built from the board. */
interface Identifiable extends TileSpec {
  readonly id?: string
}

/**
 * Flatten a tally into the beats of its reveal.
 *
 * Rows keep the agenda's order rather than being sorted by size or score: the panel is explaining the
 * round's targets, and reordering them would break the correspondence with the agenda the player has
 * been looking at all round.
 *
 * **An empty row still gets its beats.** A target that matched nothing is information — it is a target
 * the player failed to chase — and dropping it would make the reveal skip rows unpredictably.
 */
export function scoringTimeline<T extends Identifiable>(
  tally: RoundTally<T>,
): readonly ScoringStep[] {
  const steps: ScoringStep[] = []

  tally.rows.forEach((tallyRow, row) => {
    steps.push({ kind: 'row', row })
    let running = 0
    tallyRow.tiles.forEach((tile, indexInRow) => {
      running += tallyRow.target.points
      steps.push({ kind: 'tile', row, tileId: tile.id ?? '', indexInRow, running })
    })
    steps.push({ kind: 'rowDone', row, points: tallyRow.points })
  })

  steps.push({ kind: 'total', points: tally.total })
  return steps
}

/** How long this beat is held. Exported so a driver can chain one timer rather than schedule many. */
export function holdOf(step: ScoringStep, cadence: Cadence = DEFAULT_CADENCE): number {
  switch (step.kind) {
    case 'row': return cadence.row
    case 'tile': return cadence.tile
    case 'group': return cadence.group
    case 'rowDone': return cadence.rowDone
    case 'total': return cadence.total
  }
}

/** Cumulative delay before each step, so a view can schedule the whole reveal in one pass. */
export function stepDelays(
  steps: readonly ScoringStep[],
  cadence: Cadence = DEFAULT_CADENCE,
): readonly number[] {
  let elapsed = 0
  return steps.map((step) => {
    const at = elapsed
    elapsed += holdOf(step, cadence)
    return at
  })
}

/**
 * How long the whole reveal takes.
 *
 * Worth having as a number rather than a feeling: a reveal that outlasts the player's patience is a
 * reveal they will skip every round, and the only way to know is to be able to compute it.
 */
export function timelineDuration(
  steps: readonly ScoringStep[],
  cadence: Cadence = DEFAULT_CADENCE,
): number {
  return steps.reduce((total, step) => total + holdOf(step, cadence), 0)
}

/** Nothing is held for less than this, however many tiles there are. Below it the beat stops reading. */
export const MIN_HOLD_MS = 60

/** A reveal longer than this is one the player will learn to skip rather than watch. */
export const REVEAL_BUDGET_MS = 9000

/**
 * Shrink the cadence until the reveal fits a budget.
 *
 * The board tops out at 36 plates — a couple of hundred tiles — and a late colour target can match
 * dozens of them. At the default pace that is half a minute for one row. Rather than special-casing
 * big boards in the view, the whole cadence is scaled by one factor, so the *rhythm* survives and only
 * the tempo changes.
 *
 * The floor is per beat rather than on the total: past a certain point a reveal genuinely cannot fit,
 * and running fast enough to still be seen is better than running so fast it flickers. Skip exists for
 * the player who has had enough.
 */
export function fitCadence(
  steps: readonly ScoringStep[],
  budgetMs: number = REVEAL_BUDGET_MS,
  cadence: Cadence = DEFAULT_CADENCE,
): Cadence {
  const full = timelineDuration(steps, cadence)
  if (full <= budgetMs || full === 0) return cadence

  const factor = budgetMs / full
  const scale = (ms: number): number => Math.max(MIN_HOLD_MS, Math.round(ms * factor))
  return {
    row: scale(cadence.row),
    tile: scale(cadence.tile),
    group: scale(cadence.group),
    rowDone: scale(cadence.rowDone),
    total: scale(cadence.total),
  }
}

/**
 * The same walk over the final scoresheet: each of the twelve categories, then its groups.
 *
 * Every category appears, scoring or not — a colour that formed no run of three is a fact about the
 * board, and a sheet that listed only the scoring ones would be a different twelve rows every game.
 */
export function finalTimeline(tally: FinalTally): readonly ScoringStep[] {
  const steps: ScoringStep[] = []

  tally.categories.forEach((category, row) => {
    steps.push({ kind: 'row', row })
    let running = 0
    category.groups.forEach((group, groupIndex) => {
      running += group.points
      steps.push({
        kind: 'group',
        row,
        groupIndex,
        tileIds: group.tiles.map(tile => tile.id),
        points: group.points,
        running,
      })
    })
    steps.push({ kind: 'rowDone', row, points: category.points })
  })

  steps.push({ kind: 'total', points: tally.total })
  return steps
}
