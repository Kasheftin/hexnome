/**
 * Which seat you are, per game, remembered between visits.
 *
 * The token is what proves a command is yours, so losing it means losing your place at the table —
 * a refresh would have to ask which player you are, and there is no way to answer that safely. Kept
 * in localStorage, keyed by game, so coming back to a tab or a link puts you back in your own chair.
 *
 * **Per game and not per browser.** One person may be in several games at once, in a different seat
 * in each, and a single stored token would put them in the wrong one.
 *
 * A capability, not an account: it says "the holder of this may act as seat 2 in that game", nothing
 * more. It is not a password and never leaves the machine except in the `Authorization` header.
 */
const KEY = 'hexnome:seats'

/** The player's name, which belongs to the person rather than to any one game. */
const NAME_KEY = 'hexnome:name'

/**
 * Names to arrive under, so nobody starts as "Player".
 *
 * Alchemical apparatus and clockwork, which is the register the whole game is already in — and
 * deliberately **not** colours. The palette is Orange, Lime, Green, Blue, Indigo and Magenta, so a
 * player called Indigo would collide with the tiles every time the board mentioned one: "Indigo took
 * the indigos" is a sentence nobody should have to parse.
 *
 * They are also all one word and short enough to sit in a seat row without wrapping.
 */
export const SUGGESTED_NAMES: readonly string[] = [
  'Alembic', 'Athanor', 'Crucible', 'Retort', 'Aludel',
  'Cucurbit', 'Bellows', 'Azoth', 'Vitriol', 'Quintessence',
  'Bismuth', 'Antimony', 'Quicksilver', 'Lodestone', 'Tincture',
  'Amalgam', 'Ember', 'Flux', 'Cinder', 'Filigree',
  'Ratchet', 'Pinion', 'Escapement', 'Flywheel', 'Gimbal',
  'Sprocket', 'Gasket', 'Cogwheel', 'Vernier', 'Armature',
]

export interface SeatHolding {
  readonly seat: number
  readonly token: string
}

function all(): Record<string, SeatHolding> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, SeatHolding> : {}
  }
  catch {
    // Unreadable storage is the same as an empty one: you are simply not seated yet.
    return {}
  }
}

export function seatIn(gameId: string): SeatHolding | null {
  const held = all()[gameId]
  return held && typeof held.token === 'string' && typeof held.seat === 'number' ? held : null
}

export function rememberSeat(gameId: string, holding: SeatHolding): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...all(), [gameId]: holding }))
  }
  catch {
    // Private browsing, or a full quota. The game still plays; it just will not survive a reload.
  }
}

/**
 * What to call yourself, minting one on the first visit.
 *
 * A name is picked and **kept**, so you are the same person next time rather than somebody new every
 * visit. It is a suggestion, not an identity: the field on the menu is there to be typed over.
 *
 * Note the difference between *never set* and *set to empty*. Only the first mints a name; clearing
 * the field is a decision and is left alone, and the table falls back to the seat's own label. A
 * getter that could not tell them apart would overwrite that choice on the next page load.
 */
export function playerName(): string {
  try {
    const stored = globalThis.localStorage?.getItem(NAME_KEY)
    if (stored !== null && stored !== undefined) return stored

    const minted = SUGGESTED_NAMES[Math.floor(Math.random() * SUGGESTED_NAMES.length)]!
    rememberName(minted)
    return minted
  }
  catch {
    return ''
  }
}

export function rememberName(name: string): void {
  try {
    globalThis.localStorage?.setItem(NAME_KEY, name.trim().slice(0, 40))
  }
  catch {
    // See above: not worth failing a game over.
  }
}
