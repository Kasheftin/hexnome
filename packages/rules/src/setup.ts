/**
 * How a game's settings become a tableau, and what the board looks like before the first turn.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * ## Why this is here rather than in the view that used to own it
 *
 * Both sides now build tableaux from the same settings: the client to play on, the server to replay
 * and to decide what the deck owes. Two derivations of the same thing would be free to disagree, and
 * the disagreement would not be an error — it would be a replay that quietly produces a different
 * board, discovered only when a placement the client allowed the server refuses. One function, called
 * from both, is the whole fix.
 *
 * The board size and the tiles per lot moved here for the same reason. They read like rendering
 * constants and they are not: how many cells exist decides what is legal, and how many tiles a lot
 * holds decides what a draft is worth. `scene/constants.ts` re-exports them so nothing that was
 * reading them from there had to change.
 */
import { hexRectangle, type Axial } from './hex'
import { DEFAULT_PLACEMENT_RULE } from './placement'
import {
  DEFAULT_PLATES_PER_ROUND,
  DEFAULT_PLATE_SLOTS,
  DEFAULT_STEMS_PER_EXTERNAL_ANCHOR,
  DEFAULT_STEMS_PER_INTERNAL_ANCHOR,
  DEFAULT_STEM_COUNT,
  DEFAULT_TILE_SLOTS,
  effectiveStrictBonus,
  type GameSettings,
} from './gameSettings'
import type { DealtPlate } from './deck'
import type { Tableau, TableauOptions } from './tableau'

/**
 * Half-extent of the board, in cells, measured from the centre.
 *
 * The playfield is a rectangle in world space, not a hex disc: 20 cells in every direction comes to
 * 1661 cells. Large enough that, with panning clamped, the edge can never be reached — so the board
 * reads as endless without pretending to be infinite.
 */
export const BOARD_HALF_COLS = 20
export const BOARD_HALF_ROWS = 20

/** Loose tiles heaped on each lot's face-down plate. */
export const SOURCE_TILES_PER_LOT = 4

/** Where the player's tableau starts. The board is a rectangle centred here. */
export const BOARD_CENTRE: Axial = { q: 0, r: 0 }

/**
 * The tableau a game's settings call for.
 *
 * Every fallback is the same `DEFAULT_*` the settings parser uses, so a game stored before a setting
 * existed builds the tableau it would have built then.
 *
 * `strictEnclosureBonus` goes through `effectiveStrictBonus` rather than straight off the settings,
 * so the "zero under strict placement" rule holds even for a stored game that predates it or was
 * edited by hand.
 */
export function tableauOptionsFor(settings: GameSettings): TableauOptions {
  return {
    cells: hexRectangle(BOARD_HALF_COLS, BOARD_HALF_ROWS),
    drawerSlots: settings.tileSlots ?? DEFAULT_TILE_SLOTS,
    plateSlots: settings.plateSlots ?? DEFAULT_PLATE_SLOTS,
    // One source slot per plate the round deals — the same number by design, not coincidence: lots
    // never leave the source, so the column is exactly full when the round's plates run out.
    sourceLots: settings.platesPerRound ?? DEFAULT_PLATES_PER_ROUND,
    sourceTilesPerLot: SOURCE_TILES_PER_LOT,
    placementRule: settings.placementRule ?? DEFAULT_PLACEMENT_RULE,
    stemsPerInternalAnchor: settings.stemsPerInternalAnchor ?? DEFAULT_STEMS_PER_INTERNAL_ANCHOR,
    stemsPerExternalAnchor: settings.stemsPerExternalAnchor ?? DEFAULT_STEMS_PER_EXTERNAL_ANCHOR,
    strictEnclosureBonus: effectiveStrictBonus(settings),
  }
}

/**
 * The opening position: one plate at the centre of the board, and the player's stems in the drawer.
 *
 * **The starting plate goes straight to the board.** It is where the player's tableau grows from —
 * every later plate has to connect to it, and every drafted tile needs an empty petal to sit in, so
 * without it the board is unplayable and *Put* has nowhere to go.
 *
 * **Stems take ordinary tile slots**, so they are a cost as well as a gift: three stems is three
 * fewer places to put a drafted tile until they are spent. `freeDrawerSlots` counts them as taken
 * without knowing what they are, so the drawer's capacity rules need no special case.
 *
 * Mutates the tableau it is given rather than returning entries, so that a `recordingTableau`
 * journals it exactly as it journals a turn. That is what makes the opening position the first
 * command rather than a special case beside the log.
 */
export function openingPosition(
  tableau: Tableau,
  settings: GameSettings,
  starting: DealtPlate | undefined,
): void {
  const centre = tableau.addPlate({ kind: 'board', hole: BOARD_CENTRE })
  if (starting && centre) {
    // `fixed`: the plate's own tile, part of the plate and never separable from it.
    tableau.addTile(
      { color: starting.color, value: starting.value },
      { kind: 'onPlate', plateId: centre.id, petal: starting.petal },
      { fixed: true },
    )
  }

  const stems = settings.initialStems ?? DEFAULT_STEM_COUNT
  for (let i = 0; i < stems; i++) {
    const slot = tableau.freeDrawerSlots()[0]
    if (slot === undefined) break
    tableau.addStem(slot)
  }
}
