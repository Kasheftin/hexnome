/**
 * The last game's setup, so the next one does not start from scratch.
 *
 * Thirteen dials, a mode and a rule is a lot to redial every time, and a player who has found the
 * game they like plays that game. So starting a game remembers what it was started with, and the
 * setup screen opens on that instead of on the defaults. The same idea as `playerName`, which has
 * always remembered what you called yourself.
 *
 * ## It is **not** a `GameSettings`, and that distinction is the whole file
 *
 * `GameSettings` is what a game *runs* by. This is what a person *chose*. They differ wherever a dial
 * is meaningless in some combination and the rules collapse it: `effectiveFirstPassFine` zeroes the
 * fine in a solo game, `effectiveStrictBonus` zeroes the bonus under the strict rule, and
 * `effectiveGroupBonuses` zeroes every bonus at or below the minimum group size.
 *
 * `parseGameSettings` applies all three on the way in. So routing a preset through it — the obvious
 * thing to do, since it is the gate every other stored blob goes through — would hand back a setup
 * with the player's choices quietly wiped: play one solo game and your first-pass fine is gone.
 *
 * ## What guards it instead
 *
 * This module checks only the *shape*: an object of string to number, plus three optional strings and
 * numbers. Which values are legal is a question about dials, and the dials already answer it — every
 * one carries the `choices` it will accept, so `HomeView` restores a value only if the dial that owns
 * it still offers it. Nothing here has to be kept in step with the setup screen, and a dial whose
 * choices change simply ignores what was stored.
 */
const KEY = 'hexnome:setup'

export interface SavedSetup {
  /** Dial key to value. Unknown keys are ignored on the way back in, so this may outlive a dial. */
  readonly dials: Readonly<Record<string, number>>
  /** The three choices made by pressing a card rather than by turning a dial. */
  readonly mode?: string
  readonly placementRule?: string
  readonly players?: number
}

function numbers(value: unknown): Record<string, number> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'number' && Number.isFinite(entry)) out[key] = entry
  }
  return out
}

/** What was last started with, or null. */
export function savedSetup(): SavedSetup | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null

    const held = parsed as Record<string, unknown>
    return {
      dials: numbers(held.dials),
      mode: typeof held.mode === 'string' ? held.mode : undefined,
      placementRule: typeof held.placementRule === 'string' ? held.placementRule : undefined,
      players: typeof held.players === 'number' ? held.players : undefined,
    }
  } catch {
    // Unavailable, disabled, or holding something that is not JSON. Then there is no last game, and
    // the setup screen opens on the defaults — which is exactly where it opened before this existed.
    return null
  }
}

export function rememberSetup(setup: SavedSetup): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(setup))
  } catch {
    // A full or disabled store costs the next game its dialling and nothing else.
  }
}

/** Back to the defaults, and stay there. */
export function forgetSetup(): void {
  try {
    globalThis.localStorage?.removeItem(KEY)
  } catch {
    // Nothing to do about it, and nothing depends on it having worked.
  }
}
