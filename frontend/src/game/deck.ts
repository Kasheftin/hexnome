/**
 * The bags: the order plates and tiles come out of, derived from the game's id.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * A game is minted with a uuid and stored against it, so `/game?id=…` already survives a refresh
 * (composables/useSavedGames.ts). Seeding the bags from that same id makes the deck a property of
 * the id rather than of the moment the page loaded: the same link always deals the same 36 plates
 * and 108 tiles in the same order. That is what will later let two clients agree on a deck without
 * sending it, and it makes a bug report reproducible from a URL alone.
 *
 * These are the *bags*, not the shared source. The shared source is a window onto the front of
 * them; how wide that window is and when it refills is still open (docs/game-design.md, open
 * question 4).
 *
 * ## This derivation is a frozen contract
 *
 * Changing the hash, the generator, the order the bag is built in, or the direction of the shuffle
 * all silently hand a returning player a different deck for an id they already have. Nothing at
 * runtime can detect that. deck.spec.ts pins the exact output for two known ids so such a change
 * fails a test instead of a game. The hash, generator and shuffle live in game/random.ts, so that
 * file is inside the same contract even though the pins are here.
 *
 * A note on what this does *not* claim: a uuid carries 122 bits of entropy, while the number of
 * possible orders is 36! × 108! — vastly larger. So this picks from a tiny subset of orders rather
 * than sampling uniformly from all of them. For dealing a board that is of no consequence; it just
 * shouldn't be described as a uniform shuffle.
 */
import { PETAL_COUNT } from './plate'
import { createRandom, shuffleInPlace } from './random'
import type { TileSpec } from './tableau'

/** Colours in the palette, and the number of distinct symbols/values. Both six — see game-design.md. */
export const TILE_COLOR_COUNT = 6
export const TILE_VALUE_COUNT = 6

/** Copies of each distinct tile in a standard bag: 36 distinct × 3 = 108. */
export const STANDARD_TILE_COPIES = 3

/**
 * A plate as it comes out of the bag: its pre-filled tile, and which petal that tile occupies.
 *
 * The petal is cosmetic — a plate rotates freely in the drawer, and drafting matches on the tile's
 * colour or value, not its position. It is seeded anyway so that "same id, same deal" holds all the
 * way down to what the player actually sees.
 */
export interface DealtPlate extends TileSpec {
  readonly petal: number
}

export interface Deck {
  /** All 36 plates, in the order they leave the bag. */
  readonly plates: readonly DealtPlate[]
  /** All tiles, in the order they leave the bag. `tileCopies × 36` of them. */
  readonly tiles: readonly TileSpec[]
}

export interface DeckOptions {
  /**
   * Copies of each distinct tile. Defaults to the standard 3.
   *
   * The game modes differ in how many tiles are in play, so this is a parameter rather than a
   * constant — but no mode sets it yet.
   */
  readonly tileCopies?: number
}

/**
 * The 36 distinct tiles, colour-major then value ascending.
 *
 * This order is part of the frozen contract. The shuffle permutes *this* list, so building it
 * value-major instead would deal a different deck from the same id.
 */
function distinctTiles(): TileSpec[] {
  const out: TileSpec[] = []
  for (let color = 0; color < TILE_COLOR_COUNT; color++) {
    // Values are the symbols 1–6, not 0-based like colours — see TileSpec.
    for (let value = 1; value <= TILE_VALUE_COUNT; value++) {
      out.push({ color, value })
    }
  }
  return out
}

/**
 * The bags for a game, in draw order.
 *
 * Both are returned whole rather than as something you pull from one at a time: the id defines the
 * order of all 36 plates and all 108 tiles up front, and play can read as far down each as it
 * needs. Nothing here tracks how far that is — the board resets on reload anyway.
 */
export function createDeck(gameId: string, options: DeckOptions = {}): Deck {
  const tileCopies = options.tileCopies ?? STANDARD_TILE_COPIES

  // One plate per distinct tile: 6 colours × 6 values = 36. The plate's own tile is what it is
  // drafted by, so "36 plates" and "36 distinct tiles" are the same enumeration.
  const plateRng = createRandom(`${gameId}:plates`)
  const plates: DealtPlate[] = distinctTiles().map(spec => ({
    ...spec,
    // Drawn while building, so the petals are assigned in the fixed pre-shuffle order. Shuffling
    // afterwards moves each plate but keeps its petal, which keeps the two decisions independent.
    petal: Math.floor(plateRng() * PETAL_COUNT),
  }))
  shuffleInPlace(plates, plateRng)

  const tileRng = createRandom(`${gameId}:tiles`)
  const tiles: TileSpec[] = []
  for (let copy = 0; copy < tileCopies; copy++) {
    tiles.push(...distinctTiles())
  }
  shuffleInPlace(tiles, tileRng)

  return { plates, tiles }
}

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
 * Not a policy, an arithmetic fact. Every player is dealt a distinct value-1 plate, the bag holds one
 * plate per (colour, value) pair, and there are six colours — so there are exactly six value-1 plates
 * in existence. A seventh player would have nothing to open with.
 */
export const MAX_PLAYERS = TILE_COLOR_COUNT

export interface StartingDeal {
  /** One plate per player, in seating order. Shorter than asked only if the bag ran out. */
  readonly starting: DealtPlate[]
  /** What is left for the shared source, in unchanged draw order. */
  readonly remaining: DealtPlate[]
}

/**
 * Pull each player's opening plate out of the bag before play begins.
 *
 * The dealer reads the shuffled bag in **draw order** and takes the first value-1 plate for the first
 * player, the next for the second, and so on. Order matters and is not incidental: the bag's order is
 * derived from the game id, so which player opens with which colour is settled by the id too, the same
 * way everything else about the deal is.
 *
 * The plates are **removed**, not copied — they are in a player's drawer, so they can never turn up in
 * the shared source. Everything else keeps its relative order, so the source is dealt exactly as it
 * would have been minus those plates.
 *
 * Happens once, at the start of the game.
 */
export function dealStartingPlates(
  plates: readonly DealtPlate[],
  players: number,
): StartingDeal {
  const wanted = Math.max(0, Math.min(Math.floor(players), MAX_PLAYERS))
  const starting: DealtPlate[] = []
  const remaining: DealtPlate[] = []

  for (const plate of plates) {
    if (starting.length < wanted && plate.value === STARTING_PLATE_VALUE) starting.push(plate)
    else remaining.push(plate)
  }
  return { starting, remaining }
}
