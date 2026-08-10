/**
 * Which seat you hold, per game, remembered between visits.
 *
 * The token is what proves a seat is yours, so losing it means losing your place at the table: a
 * refresh would have to ask which player you are, and there is no way to answer that safely. It is a
 * **capability, not an account** — it says "the holder of this may act as seat 2 in that game" and
 * nothing more. It is not a password, and it leaves the machine only in an `Authorization` header.
 *
 * **Per game, not per browser.** One person may be in several games at once and in a different seat
 * in each; a single stored token would put them in the wrong one.
 *
 * The seat *number* is stored beside it only so a fresh page has something to show before the first
 * request answers. Which seat a token holds is the server's answer — see `GameView.you` — because a
 * number kept here is a second copy that can go stale, and a client trusting it could draw one board
 * while acting as another seat.
 */
const KEY = 'hexnome:seats'

export interface SeatHolding {
  readonly seat: number
  readonly token: string
}

type Held = Record<string, SeatHolding>

/**
 * How many games to remember a seat in.
 *
 * Each entry is tiny, but nothing ever deleted them, so without a cap this grows for as long as the
 * browser profile lives. The oldest go first, which is the right order — a game you have not opened
 * in twenty games' time is one you have finished.
 */
const MAX_REMEMBERED = 40

function read(): Held {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Held = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const holding = value as { seat?: unknown, token?: unknown }
      if (typeof holding?.seat === 'number' && typeof holding?.token === 'string') {
        out[id] = { seat: holding.seat, token: holding.token }
      }
    }
    return out
  } catch {
    // Storage can be unavailable (private mode, disabled) or hold invalid JSON. Either way there is
    // no seat to restore, and a spectator is a perfectly good thing to be.
    return {}
  }
}

function write(held: Held): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(held))
  } catch {
    // A full or disabled store costs the seat on the next visit and nothing right now.
  }
}

/** The token for a game, or empty — which the server reads as "a spectator". */
export function seatToken(gameId: string): string {
  return read()[gameId]?.token ?? ''
}

export function seatHolding(gameId: string): SeatHolding | null {
  return read()[gameId] ?? null
}

/** Remember a claim. Newest first, so the cap drops the games nobody has opened in a while. */
export function rememberSeat(gameId: string, holding: SeatHolding): void {
  const held = read()
  delete held[gameId]
  const kept = Object.entries(held).slice(0, MAX_REMEMBERED - 1)
  write({ [gameId]: holding, ...Object.fromEntries(kept) })
}

export function forgetSeat(gameId: string): void {
  const held = read()
  if (!(gameId in held)) return
  delete held[gameId]
  write(held)
}
