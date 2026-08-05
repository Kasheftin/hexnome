/**
 * The game API, as four functions.
 *
 * Thin on purpose. The shapes come from `@hexnome/rules/wire`, which the server imports too, so this
 * file holds no opinion about what a command *is* — only about how to ask for one. Anything clever
 * belongs in `useGameSync`, which is where the sequencing lives.
 *
 * Errors arrive as {@link ApiError} carrying the status and the parsed body, because the body is
 * where the useful part is: a `409` says what the head really is, a `422` says which effect was
 * refused. Throwing away the body and keeping only "request failed" is what makes a sync layer
 * impossible to write.
 */
import type {
  CommandSlice,
  CommandView,
  GameSettings,
  GameView,
  LogEntry,
  SubmitResult,
} from '@hexnome/rules/wire'

/**
 * Where the server is.
 *
 * Same-origin by default, so a production build behind one host or a Vite proxy both work with no
 * configuration; `VITE_API_BASE` overrides it for a dev server on another port.
 */
const BASE = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** The parsed response body, or the raw text when it was not JSON. */
    readonly body: unknown,
  ) {
    super(`the server answered ${status}`)
    this.name = 'ApiError'
  }

  /** The caller built on a head that has moved. The body carries the real one. */
  get isStale(): boolean {
    return this.status === 409
  }

  /** The server would not accept the move. A disagreement about the rules, which is a bug. */
  get isRefused(): boolean {
    return this.status === 422
  }

  get isMissing(): boolean {
    return this.status === 404
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  })

  const text = await response.text()
  let body: unknown = text
  try {
    body = text ? JSON.parse(text) : null
  }
  catch {
    // Left as text. An HTML error page from a proxy is worth seeing in the console verbatim.
  }

  if (!response.ok) throw new ApiError(response.status, body)
  return body as T
}

export function createGame(
  settings: Omit<GameSettings, 'createdAt'> & { createdAt?: number },
  seed?: string,
): Promise<GameView> {
  return request('/games', {
    method: 'POST',
    body: JSON.stringify({ settings: { ...settings, createdAt: settings.createdAt ?? Date.now() }, seed }),
  })
}

export function getGame(id: string): Promise<GameView> {
  return request(`/games/${encodeURIComponent(id)}`)
}

export function getCommands(id: string, since = 0): Promise<CommandSlice> {
  return request(`/games/${encodeURIComponent(id)}/commands?since=${since}`)
}

export interface SubmitTurn {
  readonly cmdId: string
  readonly prevSeq: number
  readonly author?: string
  readonly effects: readonly LogEntry[]
}

export function submitCommand(id: string, turn: SubmitTurn): Promise<SubmitResult> {
  return request(`/games/${encodeURIComponent(id)}/commands`, {
    method: 'POST',
    body: JSON.stringify(turn),
  })
}

export type { CommandView, GameView }
