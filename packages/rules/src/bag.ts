/**
 * Drawing from a bag: a cursor over one of the seeded decks.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * `game/deck.ts` settles the *order* every game's plates and tiles come out in; this holds the place
 * in that order. Splitting the two is deliberate: the order is a frozen contract derived from the game
 * id, while the cursor is ordinary mutable play state that resets with the board.
 *
 * `take` returns fewer than asked when the bag runs low rather than throwing. A bag running out is a
 * real end-of-game condition, not a programming error, and the caller has to notice it either way —
 * a short array is harder to ignore than an exception nobody catches.
 */

export interface Bag<T> {
  /** Draw up to `n` from the top, in deck order. Returns fewer if the bag runs out. */
  take(n: number): T[]
  /** How many are left. */
  remaining(): number
  /** How many have been drawn so far. */
  drawn(): number
}

export function createBag<T>(items: readonly T[]): Bag<T> {
  let cursor = 0
  return {
    take(n) {
      if (!Number.isInteger(n) || n <= 0) return []
      const end = Math.min(cursor + n, items.length)
      const drawn = items.slice(cursor, end)
      cursor = end
      return drawn
    },
    remaining: () => items.length - cursor,
    drawn: () => cursor,
  }
}
