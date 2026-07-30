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
 * **`take` needs somewhere to put what you draft**, and tiles and plates go to different places: the
 * tile grid and the plate bays. A full tile grid does not stop you drafting a plate, and full bays do
 * not stop you drafting tiles — so this asks whether *either* kind is both available and housable.
 * Collapsing the two into one "drawer has room" test would close the action while a legal draft existed.
 *
 * Offering an action that cannot be completed would be the UI lying about what it can do — the same
 * reasoning as `canDragTile` refusing grabs it cannot complete.
 *
 * This is only about whether a draft can *start*. Whether the particular selection a player builds fits
 * is a separate check, because a colour sweep can drag a plate along with the tiles (see `draftSpace`).
 *
 * `pass` is unconditional for now. Whether it should be restricted to "no other action is legal" is
 * still open (docs/game-design.md, open questions).
 */
export function turnOptions({
  sourceTiles,
  sourcePlates,
  drawerItems,
  freeDrawerSlots,
  freePlateSlots,
}: {
  /** Loose tiles showing in the source. */
  sourceTiles: number
  /** Revealed plates showing in the source. Face-down ones cannot be drafted. */
  sourcePlates: number
  drawerItems: number
  freeDrawerSlots: number
  freePlateSlots: number
}): TurnOptions {
  return {
    take: (sourceTiles > 0 && freeDrawerSlots > 0) || (sourcePlates > 0 && freePlateSlots > 0),
    put: drawerItems > 0,
    pass: true,
  }
}

/** Is any action at all open? If not, the turn can only be passed. */
export function hasRealAction(options: TurnOptions): boolean {
  return options.take || options.put
}

/**
 * Where the game is: which round, and which turn within it.
 *
 * Both 1-based, because they are shown to a player rather than used as indices.
 *
 * **Turns are counted within a round, not across the game** — so `nextRound` resets the turn to 1.
 * That is the only interesting decision here, and it is settled in one place so whoever wires round
 * advancement does not have to make it again. It matches how the count reads aloud: "round 2, turn 5"
 * describes the fifth turn *of that round*.
 *
 * Rounds do not advance yet, so `nextRound` is currently unused by the game. It exists because the
 * reset semantics belong with the type they act on, not with the code that will eventually call it.
 */
export interface TurnCount {
  readonly round: number
  readonly turn: number
}

export const FIRST_TURN: TurnCount = { round: 1, turn: 1 }

/** The next turn of the same round. Every completed action advances this — a pass included. */
export function nextTurn(count: TurnCount): TurnCount {
  return { round: count.round, turn: count.turn + 1 }
}

/** The first turn of the next round. */
export function nextRound(count: TurnCount): TurnCount {
  return { round: count.round + 1, turn: 1 }
}
