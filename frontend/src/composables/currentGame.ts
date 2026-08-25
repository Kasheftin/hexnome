/**
 * The game in progress, so the menu can offer a way back into it.
 *
 * Leaving a game does not end it — the board, the desks and the log all live on the server, and the
 * only thing that carries a player back is the id in the URL. Somebody who presses *menu* mid-round
 * and then reloads has no way to find their table again; the browser history is the only record, and
 * on a phone that is not a place anybody looks.
 *
 * **One id, not a list.** A player is at one table at a time, and a menu offering three abandoned
 * games is a filing cabinet rather than a way back to what they were doing. The newest wins.
 *
 * Stored under its own key rather than beside the seats (`useSeat.ts`), which are per game and
 * outlive this: a seat says *who you were* at a table, and this says *which table*.
 */

const KEY = 'hexnome:current-game'

/** The game to offer, or null if there is none to go back to. */
export function currentGame(): string | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    return raw && raw.length > 0 ? raw : null
  } catch {
    // Storage can be unavailable (private mode, disabled). No offer is a perfectly good answer.
    return null
  }
}

export function rememberCurrentGame(id: string): void {
  if (!id) return
  try {
    globalThis.localStorage?.setItem(KEY, id)
  } catch {
    // A full or disabled store costs the offer and nothing else; the game itself is on the server.
  }
}

/**
 * Forget it — the game is over, or this one is not worth offering.
 *
 * Called with the id so a stale tab cannot clear a *newer* game's entry: two tabs on two games, and
 * the older one finishing would otherwise wipe the offer for the one still being played.
 */
export function forgetCurrentGame(id?: string): void {
  try {
    if (id !== undefined && currentGame() !== id) return
    globalThis.localStorage?.removeItem(KEY)
  } catch {
    // Nothing to do: the offer stays until the next game replaces it.
  }
}
