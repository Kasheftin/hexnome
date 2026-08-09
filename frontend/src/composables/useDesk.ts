/**
 * A desk, over the wire.
 *
 * The bag used to live here, derived from the game id, which meant every tile the game would ever deal
 * was sitting in memory where anyone could read it. It now lives on the server (`backend/src/desk`) and
 * this is the whole of what the client knows: a handle, and three calls.
 *
 * The API is the one the local bag had — draw, discard — so the game's plumbing reads the same. What
 * is genuinely different is that both are now `async`, and that a draw can fail.
 *
 * ## Calls are chained, not merely awaited
 *
 * Every request for one desk queues behind the last, because the server's answer depends on the order
 * they arrive in: a discard that overtakes the draw that emptied the bag reshuffles a pile that should
 * not have existed yet. Awaiting at each call site would *usually* be enough, and usually is exactly
 * the kind of guarantee that fails once, in play, in a way nobody can reproduce.
 *
 * The chain is per desk. The tile desk and the plate desk are independent and there is no reason to
 * make one wait for the other.
 */

export interface Desk {
  /** The server's handle for this desk. */
  readonly id: string
  /** Draw `n` codes. Rejects if the desk cannot cover it. */
  draw(n: number): Promise<number[]>
  /** Hand a whole event's worth of codes back. One call per event — the server sorts each batch. */
  discard(codes: readonly number[]): Promise<void>
  /** What the server said was left after the last call: bag plus pile. */
  remaining(): number
}

export interface DeskRequest {
  readonly seed: string
  readonly copies: number
  /** Codes to keep out of the bag entirely — the players' opening plates. */
  readonly exclude?: readonly number[]
}

interface DeskAnswer {
  readonly id: string
  readonly remaining: number
  readonly codes?: number[]
}

/**
 * One fetch, with the failure spelled out.
 *
 * A desk call that fails is not recoverable by the game — there is no local bag to fall back on — so
 * the message matters more than the status. The server sends one; anything else means it is not there.
 */
async function post(path: string, body: unknown): Promise<DeskAnswer> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Cannot reach the table. Is the server running?')
  }

  if (!response.ok) {
    const said = await response.json().catch(() => null) as { message?: unknown } | null
    const message = typeof said?.message === 'string' ? said.message : `${response.status}`
    throw new Error(message)
  }
  return await response.json() as DeskAnswer
}

export async function createDesk({ seed, copies, exclude }: DeskRequest): Promise<Desk> {
  const created = await post('/desk', { seed, copies, exclude })

  let remaining = created.remaining
  // The tail of the chain. Every call appends to it, so requests reach the server in the order the
  // game made them however the game happens to await them.
  let queue: Promise<unknown> = Promise.resolve()

  function next<T>(work: () => Promise<T>): Promise<T> {
    // `.catch` before chaining: one failed call must not poison every later one.
    const run = queue.then(() => work(), () => work())
    queue = run.catch(() => undefined)
    return run
  }

  return {
    id: created.id,

    draw: n => next(async () => {
      const answer = await post(`/desk/${created.id}/draw`, { n })
      remaining = answer.remaining
      return answer.codes ?? []
    }),

    discard: codes => next(async () => {
      if (codes.length === 0) return
      const answer = await post(`/desk/${created.id}/discard`, { codes })
      remaining = answer.remaining
    }),

    remaining: () => remaining,
  }
}

export interface RulesHealth {
  readonly distinctTiles: number
  readonly fingerprint: readonly number[]
}

/**
 * What rules the server is running.
 *
 * The browser compiles `@hexnome/rules` from source and hot-reloads it; the server compiles its own
 * copy and holds it until restarted. A server left running across a rules change therefore disagrees
 * silently, and the symptom — a refusal of something the client just did — reads exactly like a logic
 * bug. It cost a whole debugging session once (docs/backend-attempt1.md).
 *
 * So the server deals a fixed probe seed and reports the first codes, and the client deals the same
 * one and compares. Null when it cannot be asked, which the caller reports on its own.
 */
export async function rulesHealth(): Promise<RulesHealth | null> {
  try {
    const response = await fetch('/health')
    if (!response.ok) return null
    const said = await response.json() as { rules?: RulesHealth }
    return said.rules ?? null
  } catch {
    return null
  }
}
