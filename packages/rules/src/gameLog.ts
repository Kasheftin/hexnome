/**
 * A journal of everything that happened to a tableau, and how to play it back.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * The point is that a game is no longer only its final position: any earlier state can be rebuilt by
 * replaying a prefix. The first thing that buys is the scoring accordion, which shows each finished
 * round beside **the board as it stood at the time** rather than as it stands now. Repro from a bug
 * report, spectating and undo all sit on the same mechanism.
 *
 * ## It records effects, not intentions
 *
 * An entry is a mutation that succeeded — "this tile moved to that slot" — not a player's intent
 * ("take the blues"). The difference matters:
 *
 * - **Replay needs no rules and no dice.** Applying the journal cannot diverge, because nothing is
 *   re-decided: no bag is drawn from, no reward re-derived, no legality re-checked.
 * - **It cannot miss a mutation.** {@link recordingTableau} wraps the model, so anything that changes
 *   the board is journalled wherever it was called from — and the board is currently mutated from two
 *   very different places, the game view and the drag handling inside the 3D scene.
 * - The cost is that it does **not** validate. A journal proves what happened; it cannot prove it was
 *   allowed. Server-side validation in multiplayer will want an intent log as well, and that is a
 *   different thing built on the turn rules rather than on the model.
 *
 * ## Why replay reproduces the same ids
 *
 * Entries name tiles and plates by id, so replay is only sound if the ids come out the same. They do,
 * and for a reason worth stating: `addTile`, `addPlate` and `addStem` each check legality **before**
 * taking the next id, so a refused add never burns one. Recording only the calls that succeeded
 * therefore advances the counter in the replay exactly as it advanced in the original.
 *
 * That is an invariant of `tableau.ts` rather than of this file, and `gameLog.spec.ts` pins it.
 */
import {
  createTableau,
  type PlateLocation,
  type Tableau,
  type TableauOptions,
  type TileLocation,
  type TileSpec,
} from './tableau'

/**
 * One thing that happened.
 *
 * There is exactly one variant per mutating method on `Tableau`, plus a marker for the round
 * boundary. Adding a mutator to the model without adding it here would leave a hole in the journal,
 * which is why the wrapper below is written to fail typechecking if the two fall out of step.
 */
export type LogEntry =
  | { readonly op: 'addTile', readonly spec: TileSpec, readonly location: TileLocation, readonly fixed: boolean }
  | { readonly op: 'addPlate', readonly location: PlateLocation, readonly rotation: number, readonly faceDown: boolean }
  | { readonly op: 'addStem', readonly slot: number }
  | { readonly op: 'moveTile', readonly id: string, readonly location: TileLocation }
  | { readonly op: 'movePlate', readonly id: string, readonly location: PlateLocation }
  | { readonly op: 'moveStem', readonly id: string, readonly slot: number }
  | { readonly op: 'rotatePlate', readonly id: string, readonly steps: number }
  | { readonly op: 'discard', readonly id: string }
  | { readonly op: 'revealPlate', readonly id: string, readonly spec: TileSpec, readonly petal: number }
  | { readonly op: 'swapDrawerItems', readonly a: string, readonly b: string }
  /** Not a mutation — a bookmark, so a prefix can be cut at the end of a round. */
  | { readonly op: 'endRound', readonly round: number }

export interface GameLog {
  readonly entries: readonly LogEntry[]
  append(entry: LogEntry): void
  /** How many rounds have been closed. */
  rounds(): number
}

export function createGameLog(): GameLog {
  const entries: LogEntry[] = []
  return {
    // Exposed as the live array rather than a copy: this grows once per action for a whole game, and
    // copying it on every read would be the most expensive thing in the file.
    get entries() { return entries },
    append(entry) { entries.push(entry) },
    rounds: () => entries.filter(entry => entry.op === 'endRound').length,
  }
}

/**
 * A tableau that writes down what is done to it.
 *
 * Every mutator is wrapped and every query passes through untouched. Only calls that **succeeded** are
 * recorded — a refused move is not something that happened, and leaving it out is what keeps the
 * replay's id counter in step (see the module note).
 *
 * Callers cannot tell the difference, which is the point: the 3D scene drags tiles about through this
 * same interface and needs no idea that a journal exists.
 */
export function recordingTableau(inner: Tableau, record: (entry: LogEntry) => void): Tableau {
  return {
    ...inner,

    addTile(spec, location, options) {
      const tile = inner.addTile(spec, location, options)
      if (tile) {
        record({
          op: 'addTile',
          spec: { color: spec.color, value: spec.value },
          location,
          fixed: options?.fixed ?? false,
        })
      }
      return tile
    },

    addPlate(location, options) {
      const plate = inner.addPlate(location, options)
      if (plate) {
        record({
          op: 'addPlate',
          location,
          rotation: options?.rotation ?? 0,
          faceDown: options?.faceDown ?? false,
        })
      }
      return plate
    },

    addStem(slot) {
      const stem = inner.addStem(slot)
      if (stem) record({ op: 'addStem', slot })
      return stem
    },

    moveTile(id, location) {
      const moved = inner.moveTile(id, location)
      if (moved) record({ op: 'moveTile', id, location })
      return moved
    },

    movePlate(id, location) {
      const moved = inner.movePlate(id, location)
      if (moved) record({ op: 'movePlate', id, location })
      return moved
    },

    moveStem(id, slot) {
      const moved = inner.moveStem(id, slot)
      if (moved) record({ op: 'moveStem', id, slot })
      return moved
    },

    rotatePlate(id, steps) {
      const turned = inner.rotatePlate(id, steps)
      if (turned) record({ op: 'rotatePlate', id, steps })
      return turned
    },

    discard(id) {
      const receipt = inner.discard(id)
      if (receipt) record({ op: 'discard', id })
      return receipt
    },

    revealPlate(id, spec, petal) {
      const revealed = inner.revealPlate(id, spec, petal)
      if (revealed) record({ op: 'revealPlate', id, spec: { color: spec.color, value: spec.value }, petal })
      return revealed
    },

    swapDrawerItems(a, b) {
      const swapped = inner.swapDrawerItems(a, b)
      if (swapped) record({ op: 'swapDrawerItems', a, b })
      return swapped
    },
  }
}

/**
 * Apply one entry, and say whether the model accepted it.
 *
 * **The return value is what makes replay double as verification.** Every mutator already checks
 * legality and answers `null` or `false` when it refuses; this used to discard that and return
 * nothing, so an entry describing an impossible move applied as silently as a real one. A server
 * receiving entries from a client needs exactly the opposite: it replays what it was sent and
 * refuses the lot if any of it was not allowed — using this same code, so the two sides cannot
 * disagree about what is legal.
 *
 * `false` means *this entry did not happen*, not that the tableau is damaged: a refused mutation
 * changes nothing, so a caller may stop and discard, or carry on, as it prefers.
 *
 * Exported for tests and for verification; `replayTableau` is what ordinary callers want.
 */
export function applyEntry(tableau: Tableau, entry: LogEntry): boolean {
  switch (entry.op) {
    case 'addTile':
      return !!tableau.addTile(entry.spec, entry.location, { fixed: entry.fixed })
    case 'addPlate':
      return !!tableau.addPlate(entry.location, { rotation: entry.rotation, faceDown: entry.faceDown })
    case 'addStem': return !!tableau.addStem(entry.slot)
    case 'moveTile': return !!tableau.moveTile(entry.id, entry.location)
    case 'movePlate': return !!tableau.movePlate(entry.id, entry.location)
    case 'moveStem': return !!tableau.moveStem(entry.id, entry.slot)
    case 'rotatePlate': return !!tableau.rotatePlate(entry.id, entry.steps)
    case 'discard': return !!tableau.discard(entry.id)
    case 'revealPlate': return !!tableau.revealPlate(entry.id, entry.spec, entry.petal)
    case 'swapDrawerItems': return !!tableau.swapDrawerItems(entry.a, entry.b)
    // A bookmark. Nothing to apply, and nothing that can be refused.
    case 'endRound': return true
  }
}

/**
 * The entries up to and including the end of a given round.
 *
 * Round 1 is the first bookmark. Asking for a round that has not finished yields the whole journal,
 * which is the useful answer: the caller wants "as far as you got".
 */
export function entriesThroughRound(
  entries: readonly LogEntry[],
  round: number,
): readonly LogEntry[] {
  let seen = 0
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]?.op !== 'endRound') continue
    seen++
    if (seen === round) return entries.slice(0, i + 1)
  }
  return entries
}

/**
 * Rebuild a tableau by replaying a journal into a fresh one.
 *
 * `options` must be the options the original was built with. They are not part of the journal because
 * they include the whole board's cell list — a few thousand of them, dwarfing a game's worth of
 * entries — and because they are already derivable from the game's settings.
 */
export function replayTableau(
  entries: readonly LogEntry[],
  options: TableauOptions,
): Tableau {
  const tableau = createTableau(options)
  for (const entry of entries) applyEntry(tableau, entry)
  return tableau
}
