/**
 * What a game is made of: how many kinds of tile exist, and what everyone opens on.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * **The bag itself is no longer here.** It used to be: `createDeck(gameId)` derived both bags in the
 * browser, which meant every tile the game would ever deal was already in memory and readable from the
 * console. It now lives behind an HTTP boundary — `desk.ts` holds the mechanism and `backend/src/desk`
 * runs it — and what is left in this file is the arithmetic everything else reads.
 */
import { createRandom, shuffleInPlace } from './random'

/** Colours in the palette, and the number of distinct symbols/values. Both six — see game-design.md. */
export const TILE_COLOR_COUNT = 6
export const TILE_VALUE_COUNT = 6

/**
 * How many distinct tiles exist: every colour paired with every value, so 36.
 *
 * Both desks are built from this one enumeration — a plate is drafted by the tile it carries, so
 * "36 plates" and "36 distinct tiles" are the same fact counted twice. Every bag size in the game is
 * a multiple of it.
 */
export const DISTINCT_TILES = TILE_COLOR_COUNT * TILE_VALUE_COUNT

/**
 * The standard bags, and what the settings default to: 36 × 3 = 108 tiles, 36 × 1 = 36 plates.
 *
 * Both are dials — see `gameSettings.ts`, which takes its defaults from here so the number 3 has one
 * home rather than two.
 */
export const STANDARD_TILE_COPIES = 3
export const STANDARD_PLATE_COPIES = 1

/**
 * The value every player's starting plate carries.
 *
 * One is the smallest symbol, so everyone opens from the same modest footing — the interesting
 * decisions should come from what gets drafted, not from an unequal hand.
 */
export const STARTING_PLATE_VALUE = 1

/**
 * The most players a game can seat: **six**.
 *
 * Every player opens on a value-1 plate of their own colour, and there are six colours — so a seventh
 * player would have to double up on one.
 */
export const MAX_PLAYERS = TILE_COLOR_COUNT

/**
 * The plates the players open on, as tile codes.
 *
 * **Chosen here rather than drawn from the desk.** Finding "the first value-1 plate in the bag" means
 * being able to see the bag, which is the one thing the client must not do. So the opening colours come
 * from their own seeded stream, and the desk is told to hold those codes back — it never deals what is
 * already on a board. See `desk.ts`, `DeskOptions.exclude`.
 *
 * One colour each, so nobody opens on a plate identical to their neighbour's. The stream is tagged, so
 * choosing the opening tells nothing about the order of either desk.
 */
export function openingPlateCodes(seed: string, players: number): number[] {
  const wanted = Math.max(0, Math.min(Math.floor(players), MAX_PLAYERS))
  const colors = Array.from({ length: TILE_COLOR_COUNT }, (_, color) => color)
  shuffleInPlace(colors, createRandom(`${seed}:opening`))
  return colors.slice(0, wanted).map(color => (color + 1) * 10 + STARTING_PLATE_VALUE)
}
