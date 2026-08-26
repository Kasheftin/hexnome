/**
 * What a finished game was worth, in one place, because two places would eventually disagree.
 *
 * The number a player is shown at the end of a game has two halves and they are computed from
 * different things:
 *
 *     score(seat) = sum(seat.banked)  +  finalTally(board, rules, leftovers).total
 *                   ^ the rounds        ^ the board it finished with
 *
 * The first half the fold already did — `closeRound` banks `scored + anchors - fined` for every seat
 * as each round closes (game.ts), so it is a read, not an arithmetic. The second half is `groups.ts`,
 * applied to what the player is left holding.
 *
 * ## Why this is in the rules and not in the view
 *
 * Because the server has to produce the same number. A high score board is a claim that two games can
 * be compared, and a server that scored a game even slightly differently from the screen the player
 * read would make that claim false in a way nobody would notice until somebody disputed a row.
 *
 * The view had all of this first, spread across a component: the four scoring dials picked out of the
 * settings by hand, the leftovers gathered in `scene/boardDiagram.ts`, the sum written out in the
 * results panel. Each was correct. None was reusable, and the copy a server made of them would have
 * been a second implementation from the start.
 *
 * ## The ordering caveat
 *
 * `boardTiles` returns tiles in reading order, and `finalTally`'s total does not depend on that —
 * `findGroups` computes connected components, which are a partition however the input is walked. The
 * order is here so that the *groups themselves* come out in the same sequence on both ends, which is
 * what lets a test compare them structurally rather than as a bag. score.spec.ts pins the invariance
 * rather than trusting this paragraph.
 */
import {
  finalTally,
  type FinalTally,
  type Leftovers,
  type PlacedTile,
  type ScoringRules,
} from './groups'
import type { GameSettings } from './gameSettings'
import type { GameState } from './game'
import { tilesInReadingOrder, type Tableau, type TileSpec } from './tableau'

/**
 * The board as `finalTally` wants it: every tile that is on it, with the cell it is on.
 *
 * A tile whose cell cannot be resolved is dropped rather than guessed at. That cannot happen for a
 * tile `tilesOnBoard` returned — the two answers come from the same model — but a score that silently
 * invented a cell would be worse than one that is short by a tile, and the filter costs nothing.
 */
export function boardTiles(tableau: Tableau): PlacedTile[] {
  const placed: PlacedTile[] = []
  for (const tile of tilesInReadingOrder(tableau)) {
    const cell = tableau.cellOfTile(tile.id)
    if (!cell) continue
    placed.push({ id: tile.id, cell, color: tile.color, value: tile.value })
  }
  return placed
}

/**
 * What the player is still holding: loose drawer tiles, and the token of every plate left in a bay.
 *
 * A plate is charged for through its own tile, since that is the only value it has. Its token lives at
 * an `onPlate` location rather than in the drawer, so it has to be gathered separately — reading only
 * `kind: 'drawer'` would quietly let a hoarded plate off.
 *
 * Stems are counted rather than listed: they are interchangeable, and only how many survives.
 */
export function leftoversOf(tableau: Tableau): Leftovers {
  const unplaced: TileSpec[] = []

  for (const tile of tableau.tiles()) {
    if (tile.location.kind === 'drawer') unplaced.push({ color: tile.color, value: tile.value })
  }
  for (const plate of tableau.plates()) {
    if (plate.location.kind !== 'plateSlot') continue
    const token = tableau.plateToken(plate.id)
    if (token) unplaced.push({ color: token.color, value: token.value })
  }

  return { unplaced, stems: tableau.stems().length }
}

/**
 * The four settings that decide what a finished board is worth.
 *
 * A strict subset of `GameSettings`, and no defaulting: `parseGameSettings` has already applied
 * `effectiveGroupBonuses`, so the table here is the one the game actually ran with. Picking these four
 * out by hand at each call site is what this replaces — the view did it in a computed, and a server
 * would have done it again.
 */
export function scoringRulesOf(settings: GameSettings): ScoringRules {
  return {
    minGroupSize: settings.minGroupSize,
    groupBonuses: settings.groupBonuses,
    fineUnplaced: settings.fineUnplaced,
    rewardStems: settings.rewardStems,
  }
}

/** What one board is worth on its own, before the rounds are added to it. */
export function finalTallyOf(tableau: Tableau, settings: GameSettings): FinalTally {
  return finalTally(boardTiles(tableau), scoringRulesOf(settings), leftoversOf(tableau))
}

/**
 * A seat's whole score: every round it banked, plus the board it finished with.
 *
 * `banked` is already net of the first-pass fine — `closeRound` subtracts it before pushing — so
 * nothing here may subtract it again. That is the one mistake this function exists to stop being made
 * twice.
 *
 * Answers for a game still in progress too, counting the rounds that have closed and the board as it
 * stands. That is what the in-game counter wants, and it is the same arithmetic rather than a
 * projection of it.
 */
export function finalScoreOf(state: GameState, seat: number): number {
  const player = state.seats[seat]
  if (!player) return 0
  const rounds = player.banked.reduce((sum, points) => sum + points, 0)
  return rounds + finalTallyOf(player.tableau, state.options.settings).total
}
