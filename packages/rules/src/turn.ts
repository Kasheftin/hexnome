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
 *
 * Placing takes **two** steps rather than one — `putting` then `paying` — because a placement has a
 * price. The item lands on the board first so the player can see what they are buying, and the turn
 * only ends when the price is paid. Until then Cancel restores the board exactly.
 */
import type { PlateLocation, TileLocation } from './tableau'

export type TurnAction = 'take' | 'put' | 'pass'

/**
 * Whether an action may be **inferred from the gesture that starts it**, rather than chosen first.
 *
 * On: touching the shared source begins a draft, and dragging out of the drawer onto the board begins
 * a placement. The source also stops looking disabled while a draft is available, since it is live.
 *
 * Off: the table is inert until Take or Put is pressed, which is how the game behaved before. Nothing
 * else changes — both routes end at the same confirm step either way, so the flag only moves *when* the
 * action is named, never what it costs.
 *
 * Here as a constant rather than a game setting on purpose. It is not a rules variant for players to
 * pick between; it is one open question about how the game should feel, and it wants an answer rather
 * than a switch. Flip it, have someone play both, delete the loser.
 */
export const INFER_ACTIONS_FROM_GESTURES = true

export type TurnPhase =
  /**
   * No action chosen yet — but the table is **not** inert.
   *
   * It used to be. The reasoning was that a turn is one committed action, so a stray press should not
   * be able to spend it. That reasoning has since been undermined by the actions themselves: drafting
   * only *selects* until Take is pressed, and placing lands the item provisionally and waits to be paid
   * for. Neither gesture can commit anything on its own any more, so demanding the button first was
   * asking the player to say what they were about to do immediately before doing it.
   *
   * So the two actions with a gesture of their own are **inferred** from that gesture: touching the
   * source begins a draft, dragging out of the drawer onto the board begins a placement. Both still
   * end at the same confirm step, and Cancel still returns here having spent nothing.
   *
   * `pass` has no gesture and cannot be inferred, which is why the bar keeps its buttons — they are
   * also the only route for a player not using a pointer.
   */
  | { readonly kind: 'idle' }
  /**
   * Drafting. The source is live; `selected` holds tile ids (see draft.ts).
   *
   * `inferred` records **how the phase began**, and it exists for one reason: an inference should be
   * as easy to take back as it was to make. A draft that started by clicking a tile is undone by
   * unclicking it — emptying the selection returns to `idle`, because clicking was the only thing that
   * ever said "I am drafting". A draft started by pressing the button stays put with nothing selected,
   * since the player said it out loud and it is not the view's place to overrule them.
   *
   * Without the distinction one of the two has to be wrong: either an inferred draft is sticky, which
   * traps the player in a mode they never chose, or an explicit one collapses, which makes the button
   * look broken.
   */
  | {
      readonly kind: 'taking'
      readonly selected: readonly string[]
      readonly inferred: boolean
    }
  /** Placing. The drawer and board are live, and a drag is what moves the item. */
  | { readonly kind: 'putting' }
  /**
   * Placed, and now settling up.
   *
   * The item is **already on the board** — the move happened, so it renders where it landed and the
   * player can see what they are paying for. `origin` is what makes that safe: Cancel puts it back
   * exactly where it came from, so a provisional placement is genuinely undoable rather than merely
   * discouraged.
   *
   * Dragging is off in this phase. The drawer is live for a different purpose: picking what to spend.
   */
  | {
      readonly kind: 'paying'
      readonly item: { readonly kind: 'tile' | 'plate', readonly id: string }
      readonly origin: TileLocation | PlateLocation
      readonly selected: readonly string[]
    }

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
  placeableItems,
  freeDrawerSlots,
  freePlateSlots,
}: {
  /** Loose tiles showing in the source. */
  sourceTiles: number
  /** Revealed plates showing in the source. Face-down ones cannot be drafted. */
  sourcePlates: number
  /**
   * Drawer items that could actually be *placed* — not everything in the drawer.
   *
   * An item you cannot pay for is not a move you can make, so offering Put with only those in hand
   * would light a button that leads nowhere. Stems never count: they cannot reach the board at all.
   */
  placeableItems: number
  freeDrawerSlots: number
  freePlateSlots: number
}): TurnOptions {
  return {
    take: (sourceTiles > 0 && freeDrawerSlots > 0) || (sourcePlates > 0 && freePlateSlots > 0),
    put: placeableItems > 0,
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
