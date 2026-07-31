/**
 * Paying to place an item on the board.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * ## The rule
 *
 * Placing an item of value **V** costs **V − 1** items out of your own drawer. A value-1 item is
 * therefore free, and a value-6 one costs five.
 *
 * What may pay is decided the same way a draft is decided — by **one attribute** — but anchored on the
 * item being placed rather than discovered from the selection:
 *
 * - Every payer must share the placed item's **colour**, or every payer must share its **value**.
 * - **No two equal items** anywhere in the transaction. That spans the placed item *and* the payment, so
 *   a blue-3 cannot be paid for with another blue-3, and two yellow-3s cannot pay together.
 * - **Stems are wild.** Any number, no matching, and they are exempt from the equal-items rule — they
 *   have no colour or value to be equal by.
 *
 * A plate pays as its own token, exactly as it drafts as its own token.
 *
 * ## Why the strategy pins on the first real payer
 *
 * A payer that shared *both* the placed item's colour and its value would be equal to it, and equal
 * items are barred. So every non-stem payer shares exactly one attribute — which means the first one
 * settles the strategy outright. There is no gradual narrowing here as there is in drafting, and the
 * code should not pretend otherwise.
 */

export type PaymentState = 'active' | 'selected' | 'inactive'

/** Something in the drawer that could pay: a tile, a plate (as its token), or a stem. */
export interface Payer {
  readonly id: string
  readonly kind: 'tile' | 'plate' | 'stem'
  /** Absent on stems, which have no colour or value at all. */
  readonly color?: number
  readonly value?: number
}

/** The item being placed. A plate is described by its token. */
export interface PaymentTarget {
  readonly color: number
  readonly value: number
}

/**
 * What placing this costs, in items.
 *
 * Clamped at zero so a malformed value can never ask for a negative payment, which would otherwise
 * make `canConfirmPayment` unsatisfiable and strand the player mid-turn.
 */
export function paymentCost(target: PaymentTarget): number {
  return Math.max(0, Math.floor(target.value) - 1)
}

function isWild(payer: Payer): boolean {
  return payer.kind === 'stem'
}

/** Identity by colour and value, ignoring tile-or-plate — the same rule drafting uses. */
function kindOf(item: { color?: number, value?: number }): string {
  return `${item.color}:${item.value}`
}

function chosen(available: readonly Payer[], selectedIds: readonly string[]): Payer[] {
  const wanted = new Set(selectedIds)
  return available.filter(payer => wanted.has(payer.id))
}

/**
 * Which attribute the payment has settled on, or null while only stems are selected.
 *
 * Derived from the first non-stem payer, because that one pick decides it — see the note above.
 */
export function paymentAttribute(
  target: PaymentTarget,
  available: readonly Payer[],
  selectedIds: readonly string[],
): 'color' | 'value' | null {
  const real = chosen(available, selectedIds).find(payer => !isWild(payer))
  if (!real) return null
  return real.color === target.color ? 'color' : 'value'
}

/**
 * The state of every drawer item, given what is already selected.
 *
 * Recomputed from scratch on every change, like the draft states: deselecting the payer that pinned the
 * strategy has to widen the field again, and patching that incrementally is how items end up
 * unclickable for no visible reason.
 */
export function paymentStates(
  target: PaymentTarget,
  available: readonly Payer[],
  selectedIds: readonly string[],
): Map<string, PaymentState> {
  const picked = chosen(available, selectedIds)
  const pickedIds = new Set(picked.map(payer => payer.id))
  const takenKinds = new Set(picked.filter(p => !isWild(p)).map(kindOf))
  const attribute = paymentAttribute(target, available, selectedIds)
  const full = picked.length >= paymentCost(target)

  const states = new Map<string, PaymentState>()
  for (const payer of available) {
    if (pickedIds.has(payer.id)) {
      states.set(payer.id, 'selected')
      continue
    }
    // Nothing more can be added once the cost is met. Offering a further pick would only lead to a
    // payment that cannot be confirmed.
    if (full) {
      states.set(payer.id, 'inactive')
      continue
    }
    if (isWild(payer)) {
      states.set(payer.id, 'active')
      continue
    }
    const sharesColor = payer.color === target.color
    const sharesValue = payer.value === target.value
    const matches = attribute === 'color' ? sharesColor
      : attribute === 'value' ? sharesValue
        : sharesColor || sharesValue
    // Equal to the placed item, or to something already being spent.
    const repeats = kindOf(payer) === kindOf(target) || takenKinds.has(kindOf(payer))
    states.set(payer.id, matches && !repeats ? 'active' : 'inactive')
  }
  return states
}

/**
 * Is this payment exactly right?
 *
 * Exactly, not at least: the cost is a price, and letting a player overpay would quietly throw away
 * items they will want. A free placement (value 1) is confirmable with nothing selected.
 */
export function canConfirmPayment(
  target: PaymentTarget,
  available: readonly Payer[],
  selectedIds: readonly string[],
): boolean {
  const picked = chosen(available, selectedIds)
  if (picked.length !== paymentCost(target)) return false

  const real = picked.filter(payer => !isWild(payer))
  const kinds = new Set(real.map(kindOf))
  // No repeats among the payers, and none equal to what is being placed.
  if (kinds.size !== real.length) return false
  if (kinds.has(kindOf(target))) return false

  // Every real payer shares one and the same attribute with the target.
  return real.every(payer => payer.color === target.color)
    || real.every(payer => payer.value === target.value)
}

/**
 * Add or remove a payer, returning the new selection.
 *
 * Refuses anything not currently `active`, so the selection is always one the rules allow and a stray
 * click cannot corrupt it.
 */
export function togglePayment(
  target: PaymentTarget,
  available: readonly Payer[],
  selectedIds: readonly string[],
  id: string,
): string[] {
  const state = paymentStates(target, available, selectedIds).get(id)
  if (state === 'selected') return selectedIds.filter(other => other !== id)
  if (state === 'active') return [...selectedIds, id]
  return [...selectedIds]
}
