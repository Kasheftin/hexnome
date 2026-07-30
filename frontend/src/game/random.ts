/**
 * Seeded randomness, derived from a string.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * `Math.random()` is deliberately unseedable, so anything that has to look random *and* come back
 * the same on the next page load needs its own generator. The game id is the seed (deck.ts), which
 * is what makes a game's deck and its layout a property of its URL.
 *
 * ## Frozen contract
 *
 * Changing anything in this file changes every sequence derived from it — decks dealt from ids
 * already handed out included, silently. `deck.spec.ts` pins exact output for known ids so such a
 * change fails a test rather than a game. Treat that as the guard on this file too, not just on
 * deck.ts.
 *
 * Everything below is exact 32-bit integer arithmetic (`Math.imul`, shifts, xor) plus a single
 * exact division by 2³². That is a requirement rather than a nicety: a sequence that came out
 * differently on a different JS engine would defeat the point of seeding it at all.
 */

/** A generator of numbers in [0, 1). */
export type Random = () => number

/**
 * Hash a string to four 32-bit words (cyrb128).
 *
 * The generator needs 128 bits of state and the seed is a string, so something has to bridge the
 * two. This avalanches well enough that seeds differing in one character give unrelated sequences —
 * which matters, because seeds here are often a shared prefix plus a short tag.
 */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703
  let h2 = 3144134277
  let h3 = 1013904242
  let h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ]
}

/**
 * sfc32: small, fast, and — the part that matters here — built only from integer operations.
 *
 * The final `/ 2**32` is the one non-integer step, and it is exact in float64 because the numerator
 * is below 2⁵³. Statistical quality is well beyond what dealing a board needs; reproducibility is
 * the reason it is here.
 */
function sfc32(seed: readonly [number, number, number, number]): Random {
  let [a, b, c, d] = seed
  return () => {
    a |= 0
    b |= 0
    c |= 0
    d |= 0
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
}

/**
 * An independent generator for a named stream.
 *
 * Callers pass a tagged seed — `${gameId}:tiles`, `${gameId}:scatter:0` — so each stream is
 * independent of the others. That independence is the point: on a shared stream, drawing one more
 * item from one consumer would shift everything every other consumer sees, coupling decisions that
 * have no reason to be coupled.
 */
export function createRandom(seed: string): Random {
  return sfc32(cyrb128(seed))
}

/**
 * Fisher-Yates, descending, in place.
 *
 * The direction is part of the frozen contract: ascending would visit the same seeds in a different
 * order and permute differently.
 *
 * `Math.floor(rng() * n)` carries a modulo bias, because 2³² values rarely divide evenly into n. At
 * the sizes used here the bias is around 2⁻³² — orders of magnitude below anything a player could
 * notice over the life of the game. Rejection sampling would remove it and buy nothing.
 */
export function shuffleInPlace<T>(items: T[], rng: Random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const swap = items[i] as T
    items[i] = items[j] as T
    items[j] = swap
  }
  return items
}
