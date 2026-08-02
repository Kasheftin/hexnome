/**
 * The discard pile, and refilling a bag from it.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * Named for the pile rather than for the act. `tableau.discard` already means *destroy this*, and two
 * different meanings one grep apart is how the wrong one gets called.
 *
 * ## Frozen contract
 *
 * This is the third promise attached to a game's seed, after the deck and the agenda — and it is a
 * wider one than either. Those two are pure functions of the seed, so "the deck for this seed" is a
 * fixed thing a golden test can pin. A reshuffle depends on the seed **and on how the game was
 * played**, so what gets
 * pinned here is the *mechanism*: the encoding, the ordering, the generation counter, and the promise
 * that an identical pile in an identical game gives an identical result.
 *
 * ## Why the pile is ordered
 *
 * `shuffleInPlace` is Fisher-Yates over **a specific array**, so the pile's order reaches the result
 * twice: once through the seed string built from it, and once through the array being permuted. Left
 * to itself that order would come from `Map` iteration and from the order the player happened to click
 * payment chips — incidental things that would make a "reproducible" game quietly irreproducible.
 *
 * So every batch is sorted on the way in. **A batch is a whole event**: one payment, or one round-end
 * sweep. Discarding item by item would make every batch a single item, the sort a no-op, and click
 * order load-bearing again — which is the precise thing this exists to prevent.
 *
 * ## Why the pile holds bare specs
 *
 * Sorting by `tileCode` has ties, and ties are only safe while the tied items are indistinguishable.
 * For tiles a tie is between literally equal `{ color, value }`; for plates there are no ties at all,
 * since each of the 36 pairs occurs once. Give a pile item an id or a rotation and tie order becomes
 * observable — the determinism above breaks quietly, in a way no test would obviously catch. Hence:
 * **specs only, never records**.
 */
import { createBag, type Bag } from './bag'
import { createRandom, shuffleInPlace } from './random'
import type { TileSpec } from './tableau'

/**
 * A tile's two-digit code, `11`–`66`, used for **both** the sort key and the seed digits.
 *
 * One function for both so they cannot drift apart: a pile that sorted one way and seeded another
 * would still be deterministic, and still be wrong in a way only a golden test would notice.
 *
 * The `+ 1` is there because colour is 0-based in code and a leading zero would make the digit string
 * ambiguous — `01` and `1` are not distinguishable once concatenated. That trick holds only while
 * there are at most nine colours; a tenth would need a different encoding, and every existing id's
 * reshuffles would change with it.
 */
export function tileCode(spec: TileSpec): number {
  return (spec.color + 1) * 10 + spec.value
}

/** A plate's petal, if it has one — a tiebreak that costs nothing and never reaches the seed. */
function petalOf(item: TileSpec): number {
  return (item as { readonly petal?: number }).petal ?? 0
}

/**
 * A batch in canonical order: ascending by code.
 *
 * Copies rather than sorting in place. The caller usually hands over an array it built for the
 * purpose, but "the pile reorders my array" is not a surprise worth saving an allocation for.
 */
export function inDiscardOrder<T extends TileSpec>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => tileCode(a) - tileCode(b) || petalOf(a) - petalOf(b))
}

export interface RecyclingBag<T extends TileSpec> {
  /**
   * Draw up to `n`, reshuffling the pile in if the bag runs short mid-draw.
   *
   * Returns fewer than asked only when bag *and* pile are both dry — the same short-array contract
   * `Bag.take` has, and for the same reason: it is a game state, not a programming error.
   */
  draw(n: number): T[]
  /** Add a whole event's worth of items to the pile. One call per event — see the module doc. */
  discard(items: readonly T[]): void
  /** How many can still be drawn: what is left in the bag plus what is waiting in the pile. */
  remaining(): number
  /** The pile as it stands, for tests and for anything that wants to show a count. */
  pile(): readonly T[]
  /** How many reshuffles have happened. Also the generation the next one will use. */
  reshuffles(): number
}

/**
 * A bag that comes back.
 *
 * Built **on top of** `createBag`, holding one and replacing it on reshuffle, so cursor arithmetic and
 * the short-draw contract are inherited rather than re-derived. `bag.ts` stays what its doc says it
 * is: a cursor over a frozen deck.
 *
 * `seed` is the stable part — `${gameId}:reshuffle:${kind}` — and the generation and the pile's digits
 * are appended per reshuffle.
 */
export function createRecyclingBag<T extends TileSpec>(
  items: readonly T[],
  { seed }: { readonly seed: string },
): RecyclingBag<T> {
  let bag: Bag<T> = createBag(items)
  let pile: T[] = []
  let generation = 0

  /**
   * Turn the pile into the new bag.
   *
   * Whatever was already drawn stays drawn — the remnant left in the old bag is not part of the pile
   * and is not shuffled back in. That is the deck-of-cards behaviour a short draw expects: you take
   * the last cards off the old deck, *then* cut the discards.
   */
  function reshuffle(): void {
    const digits = pile.map(tileCode).join('')
    bag = createBag(shuffleInPlace([...pile], createRandom(`${seed}:${generation}:${digits}`)))
    pile = []
    generation++
  }

  return {
    draw(n) {
      if (!Number.isInteger(n) || n <= 0) return []
      const drawn: T[] = []
      while (drawn.length < n) {
        drawn.push(...bag.take(n - drawn.length))
        // Only reshuffle for a draw that is still short, and only if there is something to reshuffle:
        // a no-op that bumped the generation would silently reseed the next real one.
        if (drawn.length >= n || pile.length === 0) break
        reshuffle()
      }
      return drawn
    },
    discard(batch) {
      if (batch.length === 0) return
      pile.push(...inDiscardOrder(batch))
    },
    remaining: () => bag.remaining() + pile.length,
    pile: () => pile,
    reshuffles: () => generation,
  }
}
