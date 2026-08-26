/**
 * The games endpoint, over the wire.
 *
 * Five calls. The shapes come from `@hexnome/rules/wire`, which both sides import, so a field that
 * changes on the server fails a typecheck here rather than arriving as `undefined` in a browser.
 *
 * The fetch wrapper and `ApiError` live in `base.ts`, with the URL building — they are the transport,
 * not this resource, and a second endpoint module would otherwise have had to copy them.
 *
 * Nothing here holds state. Which game is open, and what it currently says, is the store's business
 * (`stores/game.ts`); this is the transport under it.
 */
import type { CommandSlice, GameView, SeatClaim, SubmitResult } from '@hexnome/rules/wire'
import { request } from './base'

function send<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * The seat token as a header, or nothing.
 *
 * Reading a game is public — the id is already the right to look at a table — so a request without
 * one is perfectly valid and simply comes back with `you: null`.
 */
function asSeat(token: string): HeadersInit | undefined {
  return token ? { Authorization: `Seat ${token}` } : undefined
}

/** Open a table. The creator takes seat 0 and gets the token that proves it. */
export function createGame(settings: unknown, name: string): Promise<SeatClaim> {
  return send<SeatClaim>('/games', { settings, name })
}

export function getGame(id: string, token = ''): Promise<GameView> {
  return request<GameView>(`/games/${encodeURIComponent(id)}`, { headers: asSeat(token) })
}

/** Take the lowest free chair. 409 if the table filled up while you were reading it. */
export function joinGame(id: string, name: string): Promise<SeatClaim> {
  return send<SeatClaim>(`/games/${encodeURIComponent(id)}/join`, { name })
}

/** Everything after a cursor. `since=0` is the whole log, which is how a fresh page loads. */
export function getCommands(id: string, since = 0): Promise<CommandSlice> {
  return request<CommandSlice>(`/games/${encodeURIComponent(id)}/commands?since=${since}`)
}

/**
 * Take a turn.
 *
 * The seat is not in the body — it comes from the token, because a client that could name its own
 * seat could take somebody else's turn.
 */
export function submitCommand(
  id: string,
  turn: { cmdId: string, prevSeq: number, command: unknown },
  token: string,
): Promise<SubmitResult> {
  return request<SubmitResult>(`/games/${encodeURIComponent(id)}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...asSeat(token) },
    body: JSON.stringify(turn),
  })
}
