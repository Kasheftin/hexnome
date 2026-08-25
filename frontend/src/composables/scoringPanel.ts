/**
 * Whether the scoring panel is open, remembered across games and refreshes.
 *
 * **One value for the player, not one per game.** Unlike a read sheet or a seat, this says nothing
 * about any particular table — it is a preference about how much of the screen you want the plan to
 * take. Keying it by game would make the same person answer the same question again every time they
 * started one.
 *
 * ## Why it is three states and not a boolean
 *
 * `null` means *never chosen*, and that is a different thing from "closed". A player who has never
 * touched the control has no preference to honour, so the sensible default depends on the screen:
 * a phone cannot spare 247px down the right-hand edge, and a desktop can. Storing a boolean would
 * force a default at the moment of writing and then remember it forever — so a player who opened the
 * game once on a laptop would find it open on their phone, having never said they wanted that.
 *
 * Once they *do* press it, the choice is theirs on every screen. A preference stated out loud beats
 * one inferred from a viewport.
 */

const KEY = 'hexnome:scoring-panel'

export type ScoringPanelChoice = 'open' | 'closed'

/**
 * Below this, the panel would cover the board rather than sit beside it.
 *
 * Its own width plus its margins is 275px; on a 390px phone that is most of the screen, and the board
 * underneath is the thing being played. Exported so the default and any stylesheet that cares are
 * reading one number.
 */
export const NARROW_SCREEN = '(max-width: 720px)'

/** What the player last chose, or null if they never have. */
export function readScoringPanel(): ScoringPanelChoice | null {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    return raw === 'open' || raw === 'closed' ? raw : null
  } catch {
    // Storage can be unavailable (private mode, disabled). No preference is a perfectly good answer.
    return null
  }
}

export function rememberScoringPanel(choice: ScoringPanelChoice): void {
  try {
    globalThis.localStorage?.setItem(KEY, choice)
  } catch {
    // A full or disabled store costs the preference on the next visit and nothing right now.
  }
}
