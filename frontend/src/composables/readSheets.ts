/**
 * Which round's score sheet you have read, per game, remembered across a refresh.
 *
 * The sheet is the one thing on the table that is **yours rather than the game's**. A round closing
 * is in the log and closes for everybody; putting the sheet away is a person finishing reading, and
 * two people at one table finish at different moments. So it is not a command — if it were, the first
 * player to press Next round would sweep the sheet out from under everyone still adding up their
 * score.
 *
 * That leaves nothing in the state to fold, and a refresh knows only that the game stands at round 3.
 * Whether you have already read round 2's sheet is a fact about this browser, and this is where it
 * lives.
 *
 * Stored as the **number of closed rounds whose sheet is done with**, not a list: sheets are read in
 * order, and one number cannot disagree with itself.
 *
 * Rounds *closed*, deliberately, and not `state.round`. They agree for every round but the last, and
 * the last is where it matters: a finished game does not advance its round, so round 4's sheet and
 * round 3's would be filed under the same number and the game would end without ever showing a
 * score. Counting what has been banked names each sheet once.
 *
 * The last round's sheet is filed like any other. Reading it is what the Calculate final score button
 * means — the round is done with, and what follows is the closing reckoning rather than a next round.
 * A game whose last sheet is read rebuilds on the final scoring, which is where its player left it.
 */
const KEY = 'hexnome:read-sheets'

type Read = Record<string, number>

/** How many games to remember, oldest dropped first — the same cap and reasoning as `useSeat`. */
const MAX_REMEMBERED = 40

function read(): Read {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Read = {}
    for (const [id, round] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof round === 'number' && Number.isFinite(round)) out[id] = round
    }
    return out
  } catch {
    // Storage can be unavailable or hold nonsense. Showing a sheet again is a smaller wrong than
    // failing to draw the board, so an unreadable store simply means nothing has been read.
    return {}
  }
}

function write(sheets: Read): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(sheets))
  } catch {
    // A full or disabled store costs one repeated sheet and nothing else.
  }
}

/** Has the sheet for this many closed rounds already been put away in this browser? */
export function sheetRead(gameId: string, roundsClosed: number): boolean {
  return (read()[gameId] ?? 0) >= roundsClosed
}

/** Put it away. Newest first, so the cap drops games nobody has opened in a while. */
export function rememberSheetRead(gameId: string, roundsClosed: number): void {
  const sheets = read()
  const already = sheets[gameId] ?? 0
  delete sheets[gameId]
  const kept = Object.entries(sheets).slice(0, MAX_REMEMBERED - 1)
  write({ [gameId]: Math.max(already, roundsClosed), ...Object.fromEntries(kept) })
}
