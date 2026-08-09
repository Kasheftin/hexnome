/**
 * Drafting from the shared source: which tiles you may still click, and when the take is legal.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * ## The rule
 *
 * A draft is defined by **one attribute** — a colour or a symbol — and takes every *distinct* tile in
 * the source carrying it. Three parts, and the third is the one that surprises:
 *
 * 1. Pick any tile to start. That tile's colour and its symbol are both still live as the criterion.
 * 2. Pick a second, and the criterion **pins**: two tiles that share only a colour can only be a
 *    colour draft, so every remaining symbol match goes inactive.
 * 3. **At most one of each distinct kind.** The bag holds several copies of every tile — three by
 *    default, and a setting — so the source often shows duplicates. Selecting one red-2 makes any
 *    *other* red-2 inactive: it is already represented. The duplicate is left in the source rather
 *    than swept along.
 *
 *    A revealed plate counts as its token here, so a red-1 plate and a red-1 tile are the same kind: take
 *    one or the other, never both.
 *
 * Worked example, source `blue-1  blue-3  red-3  yellow-3`:
 *
 * ```
 * select yellow-3          -> the only yellow, so the COLOUR sweep is already complete.
 *                             Confirmable now, even though two more 3s are sitting there clickable.
 * select yellow-3, red-3   -> they share only the symbol, so the VALUE strategy pins and colour is
 *                             off the table. Not confirmable: blue-3 is a 3 and is not selected.
 * ...plus blue-3           -> every 3 taken. Confirmable.
 * ```
 *
 * And with duplicates, source `red-4  red-2  red-2  blue-1`:
 *
 * ```
 * select red-4    -> the only 4, so the value sweep is complete. Confirmable.
 * select red-2    -> now pinned to colour; the second red-2 is a copy of a selected kind, so it is
 *                    excluded and does not hold the colour sweep open. Confirmable, and it stays behind.
 * ```
 *
 * So "all of the colour" means all *kinds* of that colour, not all copies — and a sweep can be complete
 * while other tiles are still clickable under the strategy you did not take.
 */

export type DraftTileState = 'active' | 'selected' | 'inactive'

/**
 * One thing in the source that can be drafted.
 *
 * Usually a loose tile. It can also be a **revealed plate**, which enters the draft as its own token —
 * a plate showing blue-4 is drafted by anyone sweeping blue or sweeping 4s, exactly as a blue-4 tile
 * would be. A face-down plate is not an item at all: its token is unknown, and an unknown cannot be
 * matched against a criterion.
 */
export interface DraftItem {
  readonly id: string
  readonly kind: 'tile' | 'plate'
  readonly color: number
  readonly value: number
}

/**
 * Which attributes could still be the criterion.
 *
 * Both stay live while the selection cannot distinguish them — one tile, or several that happen to
 * share colour *and* symbol (which cannot arise through {@link toggleDraftSelection}, but a caller
 * could construct it).
 */
export interface DraftCriteria {
  readonly color: boolean
  readonly value: boolean
}

/**
 * Identity of an item *kind* — colour and value only.
 *
 * **A plate counts as its token, full stop.** A revealed red-1 plate and a loose red-1 tile are the same
 * kind, so you may take one or the other but never both: they repeat, and a draft takes one of each
 * kind. Which one you take is a real choice — the plate brings a whole plate and costs a bay, the tile
 * costs a tile slot — and when space is tight that choice can be what makes a sweep fit.
 *
 * Deliberately *not* keyed on tile-or-plate. Doing that would let a colour sweep take both, which is the
 * repetition the one-per-kind rule exists to prevent.
 */
function kindOf(item: DraftItem): string {
  return `${item.color}:${item.value}`
}

function selectedItems(
  available: readonly DraftItem[],
  selectedIds: readonly string[],
): DraftItem[] {
  const wanted = new Set(selectedIds)
  return available.filter(item => wanted.has(item.id))
}

export function draftCriteria(selected: readonly DraftItem[]): DraftCriteria {
  const first = selected[0]
  if (!first) return { color: true, value: true }
  return {
    color: selected.every(tile => tile.color === first.color),
    value: selected.every(tile => tile.value === first.value),
  }
}

/**
 * The state of every tile in the source, given what is selected.
 *
 * Recomputed from scratch rather than patched incrementally. Deselecting a tile can widen the
 * criterion again and re-activate tiles that were inactive, so any attempt to track states
 * incrementally has to reason about un-pinning — and getting that subtly wrong leaves tiles
 * unclickable for no visible reason.
 */
export function draftStates(
  available: readonly DraftItem[],
  selectedIds: readonly string[],
): Map<string, DraftTileState> {
  const selected = selectedItems(available, selectedIds)
  const chosen = new Set(selected.map(tile => tile.id))
  const takenKinds = new Set(selected.map(kindOf))
  const criteria = draftCriteria(selected)
  const first = selected[0]

  const states = new Map<string, DraftTileState>()
  for (const tile of available) {
    if (chosen.has(tile.id)) {
      states.set(tile.id, 'selected')
    } else if (!first) {
      // Nothing picked yet: anything can start a draft.
      states.set(tile.id, 'active')
    } else if (takenKinds.has(kindOf(tile))) {
      // A copy of something already selected. One per kind, so this one is out.
      states.set(tile.id, 'inactive')
    } else {
      const matches = (criteria.color && tile.color === first.color)
        || (criteria.value && tile.value === first.value)
      states.set(tile.id, matches ? 'active' : 'inactive')
    }
  }
  return states
}

/** Every distinct kind in the source carrying `attribute` = `of`. */
function kindsMatching(
  available: readonly DraftItem[],
  attribute: 'color' | 'value',
  of: number,
): Set<string> {
  const kinds = new Set<string>()
  for (const tile of available) {
    if (tile[attribute] === of) kinds.add(kindOf(tile))
  }
  return kinds
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const item of a) if (!b.has(item)) return false
  return true
}

/**
 * Which strategies this selection has **finished sweeping**.
 *
 * A strategy is finished when every distinct kind in the source carrying that attribute is selected.
 * Both can be finished at once — a tile unique in colour *and* in symbol finishes both by itself.
 *
 * The key point, and the thing that is easy to get wrong: a strategy being finished does not require the
 * *other* strategy to be finished, or even to be ruled out. Pick `yellow-3` from
 * `blue-1 blue-3 red-3 yellow-3` and the colour strategy is done — it is the only yellow — even though
 * two more 3s are sitting there unselected and still clickable. Take is legal at that moment.
 *
 * A strategy that is no longer *live* can never be finished. Once two tiles share only a colour, the
 * symbol strategy is off the table for the rest of the draft (see {@link draftCriteria}).
 *
 * Duplicates are compared as **kinds**, so a second copy of an already-selected tile never holds a
 * strategy open — it does not exist as far as drafting is concerned.
 */
export function completedStrategies(
  available: readonly DraftItem[],
  selectedIds: readonly string[],
): DraftCriteria {
  const selected = selectedItems(available, selectedIds)
  const first = selected[0]
  if (!first) return { color: false, value: false }

  const kinds = new Set(selected.map(kindOf))
  // Two copies of one kind can never be a legal draft, however they got selected. Unreachable through
  // toggleDraftSelection, but this is the rule of record for callers that are not the UI.
  if (kinds.size !== selected.length) return { color: false, value: false }

  const live = draftCriteria(selected)
  return {
    color: live.color && sameSet(kinds, kindsMatching(available, 'color', first.color)),
    value: live.value && sameSet(kinds, kindsMatching(available, 'value', first.value)),
  }
}

/**
 * Is this selection a complete, legal draft?
 *
 * True as soon as **either** strategy has been swept. Deliberately *not* "nothing is left clickable":
 * those differ whenever a tile is unique in one attribute but shares the other, and in that case the
 * player has already committed to a sweep they can finish. Requiring an empty pool would force them to
 * keep picking tiles they never meant to take.
 *
 * A partial sweep is still refused: each click is legal on its own, but confirming means you have taken
 * everything one attribute offers.
 */
export function canConfirmDraft(
  available: readonly DraftItem[],
  selectedIds: readonly string[],
): boolean {
  const done = completedStrategies(available, selectedIds)
  return done.color || done.value
}

/**
 * Add or remove a tile, returning the new selection.
 *
 * Refuses tiles that are inactive, so the returned selection is always one the rules allow — the
 * caller does not have to check first, and a stray click cannot corrupt the state.
 */
export function toggleDraftSelection(
  available: readonly DraftItem[],
  selectedIds: readonly string[],
  id: string,
): string[] {
  const state = draftStates(available, selectedIds).get(id)
  if (state === 'selected') return selectedIds.filter(other => other !== id)
  if (state === 'active') return [...selectedIds, id]
  return [...selectedIds]
}

/**
 * The attribute a selection has settled on, for describing the take in the UI.
 *
 * Null while both are still live — with one tile picked, "Take red" and "Take 4" are equally true, and
 * claiming either would be guessing at intent the player has not expressed yet.
 */
export function draftAttribute(
  available: readonly DraftItem[],
  selectedIds: readonly string[],
): 'color' | 'value' | null {
  const selected = selectedItems(available, selectedIds)
  if (selected.length < 2) return null
  const criteria = draftCriteria(selected)
  if (criteria.color && !criteria.value) return 'color'
  if (criteria.value && !criteria.color) return 'value'
  return null
}

/**
 * How much drawer room a selection needs, split by where each item goes.
 *
 * Tiles and plates land in different places — the tile grid and the plate bays — so one combined count
 * would say a draft fits when it does not. A sweep that takes three tiles and a plate needs three tile
 * slots *and* a free bay; having four spare tile slots is no help at all.
 */
export function draftSpace(
  available: readonly DraftItem[],
  selectedIds: readonly string[],
): DraftSpace {
  let tiles = 0
  let plates = 0
  for (const item of selectedItems(available, selectedIds)) {
    if (item.kind === 'plate') plates++
    else tiles++
  }
  return { tiles, plates }
}

export interface DraftSpace {
  readonly tiles: number
  readonly plates: number
}

/**
 * Will the drawer hold this draft?
 *
 * Separate from {@link canConfirmDraft} on purpose: a sweep can be perfectly legal and still impossible,
 * because a colour sweep drags a plate along with the tiles and the bays may be full. Those are different
 * problems and the player deserves to be told which one they have — "out of space" rather than a button
 * that has quietly stopped working.
 */
export function draftFits(
  available: readonly DraftItem[],
  selectedIds: readonly string[],
  capacity: DraftSpace,
): boolean {
  const need = draftSpace(available, selectedIds)
  return need.tiles <= capacity.tiles && need.plates <= capacity.plates
}
