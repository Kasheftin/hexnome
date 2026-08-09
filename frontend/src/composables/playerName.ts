/**
 * What to call yourself, minted on the first visit and kept.
 *
 * The name belongs to the **person**, not to a game: it is deliberately not one of the game
 * settings, which are frozen against a game id and replayed with it. One player, one name, across
 * every game in this browser.
 *
 * It is a suggestion rather than an identity — nothing is proved by it, and the field on the menu is
 * there to be typed over.
 */

const KEY = 'hexnome:name'

/**
 * Names to arrive under, so nobody starts as "Player".
 *
 * Alchemical apparatus and clockwork, which is the register the rest of the game is already in — and
 * deliberately **not** colours. The palette is Orange, Lime, Green, Blue, Indigo and Magenta, so a
 * player called Indigo would collide with the tiles every time the board mentioned one: "Indigo took
 * the indigos" is a sentence nobody should have to parse.
 *
 * All one word, and short enough to sit in a row beside a score without wrapping.
 */
export const SUGGESTED_NAMES: readonly string[] = [
  'Alembic', 'Athanor', 'Crucible', 'Retort', 'Aludel',
  'Cucurbit', 'Bellows', 'Azoth', 'Vitriol', 'Quintessence',
  'Bismuth', 'Antimony', 'Quicksilver', 'Lodestone', 'Tincture',
  'Amalgam', 'Ember', 'Flux', 'Cinder', 'Filigree',
  'Ratchet', 'Pinion', 'Escapement', 'Flywheel', 'Gimbal',
  'Sprocket', 'Gasket', 'Cogwheel', 'Vernier', 'Armature',
]

/** The longest name that will be kept. Anything past this is cut rather than refused. */
const MAX_LENGTH = 40

/**
 * A suggestion, never the one already in hand.
 *
 * Excluding the current name is the whole point of the reroll button: a uniform pick over thirty
 * names hands back the same one about one press in thirty, which reads as a broken button rather
 * than as luck. Excluding it makes every press visibly do something.
 */
export function suggestName(except?: string): string {
  const pool = SUGGESTED_NAMES.filter(name => name !== except)
  const from = pool.length > 0 ? pool : SUGGESTED_NAMES
  return from[Math.floor(Math.random() * from.length)] as string
}

/**
 * Several suggestions at once, all different from each other and from `except`.
 *
 * For the other seats at a table. Distinctness is the whole requirement: two players called Ember is
 * worse than either of them being called Player 2, and picking one at a time would collide roughly
 * once every four four-player games.
 */
export function suggestNames(count: number, except: readonly string[] = []): string[] {
  const taken = new Set(except)
  const pool = SUGGESTED_NAMES.filter(name => !taken.has(name))
  const picked: string[] = []

  for (let i = 0; i < count; i++) {
    if (pool.length === 0) break
    // Swap-remove: the chosen name leaves the pool, so it cannot come up twice.
    const at = Math.floor(Math.random() * pool.length)
    picked.push(pool[at] as string)
    pool[at] = pool[pool.length - 1] as string
    pool.pop()
  }
  return picked
}

/**
 * The stored name, minting one from {@link SUGGESTED_NAMES} if there has never been one.
 *
 * Note the difference between *never set* and *set to empty*. Only the first mints a name; clearing
 * the field is a decision, and re-minting over it would undo that choice on the next page load.
 */
export function playerName(): string {
  try {
    const stored = globalThis.localStorage?.getItem(KEY)
    if (stored !== null && stored !== undefined) return stored

    const minted = suggestName()
    rememberName(minted)
    return minted
  } catch {
    // Storage can be unavailable (private mode, disabled). You are simply nameless this visit.
    return ''
  }
}

export function rememberName(name: string): void {
  try {
    globalThis.localStorage?.setItem(KEY, name.trim().slice(0, MAX_LENGTH))
  } catch {
    // See above — not worth failing a game over.
  }
}
