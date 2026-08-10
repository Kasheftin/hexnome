/**
 * The games endpoint, over the wire.
 *
 * Three calls and one error type. The shapes come from `@hexnome/rules/wire`, which both sides
 * import, so a field that changes on the server fails a typecheck here rather than arriving as
 * `undefined` in a browser.
 *
 * Nothing here holds state. Which game is open, and what it currently says, is the store's business
 * (`stores/game.ts`); this is the transport under it.
 */
import type { GameView, SeatClaim } from '@hexnome/rules/wire'

/**
 * A request the server answered, and refused.
 *
 * The status matters to one caller — a join that comes back 409 means somebody took the chair, which
 * is a thing to say rather than a thing to retry — so it is carried rather than folded into the
 * message.
 */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Unreachable is its own status: 0, because no server said anything. */
const UNREACHABLE = 0

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new ApiError(UNREACHABLE, 'Cannot reach the table. Is the server running?')
  }

  if (!response.ok) {
    const said = await response.json().catch(() => null) as { message?: unknown } | null
    throw new ApiError(response.status, typeof said?.message === 'string' ? said.message : `${response.status}`)
  }
  return await response.json() as T
}

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
