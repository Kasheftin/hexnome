/**
 * A board row, as words.
 *
 * Split out of the panel for the reason `gameSettingsRows.ts` was split out of `GameSettingsPanel`:
 * no `.vue` file in this repo is unit tested, so anything worth asserting has to live somewhere a
 * spec can reach. What is here is every decision about *what a row says*; the panel only arranges it.
 */
import type { HighscoreRow } from '@hexnome/rules/wire'
import { findPreset } from '@hexnome/rules/presets'
import { SOLO } from '@hexnome/rules/gameSettings'

export interface BoardRow {
  /** Where this row stands on the whole board, not on the page — so page two starts at 21. */
  readonly rank: number
  readonly who: string
  readonly score: number
  readonly players: string
  readonly finished: string
  readonly key: string
}

/**
 * What to call a player who did not say.
 *
 * An empty name is a real answer — naming yourself is optional, and the seat shows its own label
 * instead — so this is the same label the table used, rebuilt from the seat number. Seats are
 * zero-based in the model and one-based on screen, which is the whole of the arithmetic.
 */
export function nameOf(row: Pick<HighscoreRow, 'winnerName' | 'winnerSeat'>): string {
  const given = row.winnerName.trim()
  return given === '' ? `Player ${row.winnerSeat + 1}` : given
}

/** "Solo" rather than "1 player", because playing alone is a different thing, not a smaller table. */
export function tableOf(players: number): string {
  return players <= SOLO ? 'Solo' : `${players} players`
}

/**
 * The day it was finished, in the reader's own locale.
 *
 * A date and no clock time: to the minute is precision nobody reading a leaderboard wants, and it
 * makes every row wide enough to wrap on a phone. An unparseable value comes back as an em dash
 * rather than "Invalid Date", which is what `new Date('')` would otherwise put on screen.
 */
export function finishedOn(iso: string, locale?: string): string {
  const when = new Date(iso)
  if (Number.isNaN(when.getTime())) return '—'
  return when.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** What the board is called, for the heading — its preset's own label. */
export function boardName(presetId: string): string {
  return findPreset(presetId)?.label ?? presetId
}

/**
 * A page of rows, numbered from where the page starts.
 *
 * The rank comes from the offset rather than from the row, because the server does not send one —
 * position on a board is a fact about the query, and a row that carried its own rank would be wrong
 * the moment anybody filtered differently.
 */
export function boardRows(rows: readonly HighscoreRow[], offset: number, locale?: string): BoardRow[] {
  return rows.map((row, index) => ({
    rank: offset + index + 1,
    who: nameOf(row),
    score: row.score,
    players: tableOf(row.players),
    finished: finishedOn(row.finishedAt, locale),
    // Neither the name nor the score is unique on a board; the position on it is.
    key: `${offset + index}:${row.finishedAt}`,
  }))
}
