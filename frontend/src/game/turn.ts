/**
 * What a player may do on their turn, and which action they are part-way through.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * A turn is **one** action: draft from the shared source, place one item from your drawer, or pass.
 * Choosing is a distinct step from doing, which is what the `idle` phase represents — nothing on the
 * table is interactive until an action is chosen, so a stray click cannot commit a move the player
 * never picked.
 */

export type TurnAction = 'take' | 'put' | 'pass'

export type TurnPhase =
  /** Choosing an action. Nothing on the table responds. */
  | { readonly kind: 'idle' }
  /** Drafting. The source is live; `selected` holds tile ids (see draft.ts). */
  | { readonly kind: 'taking', readonly selected: readonly string[] }
  /** Placing. The drawer and board are live. */
  | { readonly kind: 'putting' }

export const IDLE: TurnPhase = { kind: 'idle' }

export interface TurnOptions {
  readonly take: boolean
  readonly put: boolean
  readonly pass: boolean
}

/**
 * Which actions are open, given the state of the table.
 *
 * `take` also needs somewhere to put what you draft. A draft with a full drawer would be a legal
 * choice leading to an impossible confirmation, and offering it would be the UI lying about what it
 * can do — the same reasoning as `canDragTile` refusing grabs it cannot complete.
 *
 * `pass` is unconditional for now. Whether it should be restricted to "no other action is legal" is
 * still open (docs/game-design.md, open questions).
 */
export function turnOptions({
  sourceTiles,
  drawerItems,
  freeDrawerSlots,
}: {
  sourceTiles: number
  drawerItems: number
  freeDrawerSlots: number
}): TurnOptions {
  return {
    take: sourceTiles > 0 && freeDrawerSlots > 0,
    put: drawerItems > 0,
    pass: true,
  }
}

/** Is any action at all open? If not, the turn can only be passed. */
export function hasRealAction(options: TurnOptions): boolean {
  return options.take || options.put
}
