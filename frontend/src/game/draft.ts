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
 * 3. **At most one of each distinct tile.** The bag holds three copies of every tile, so the source
 *    often shows duplicates. Selecting one red-2 makes any *other* red-2 inactive — it is already
 *    represented. The duplicate is left in the source rather than swept along.
 *
 * Worked example, source `red-4  red-2  red-2  blue-1`:
 *
 * ```
 * select red-4   -> blue-1 inactive (shares neither), both red-2 active (share red)
 * select red-2   -> criterion pins to colour; the other red-2 inactive (identical, already taken)
 * confirm        -> takes { red-4, red-2 }, leaving one red-2 behind
 * ```
 *
 * So "take all of the colour" means all *kinds* of that colour, not all copies. That is why
 * {@link canConfirmDraft} compares sets of distinct tiles rather than counting them.
 */

export type DraftTileState = 'active' | 'selected' | 'inactive'

/** A tile in the source, as drafting sees it. */
export interface DraftTile {
  readonly id: string
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

/** Identity of a tile *kind*, ignoring which physical copy it is. */
function kindOf(tile: DraftTile): string {
  return `${tile.color}:${tile.value}`
}

function selectedTiles(
  available: readonly DraftTile[],
  selectedIds: readonly string[],
): DraftTile[] {
  const wanted = new Set(selectedIds)
  return available.filter(tile => wanted.has(tile.id))
}

export function draftCriteria(selected: readonly DraftTile[]): DraftCriteria {
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
  available: readonly DraftTile[],
  selectedIds: readonly string[],
): Map<string, DraftTileState> {
  const selected = selectedTiles(available, selectedIds)
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
  available: readonly DraftTile[],
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
 * Is this selection a complete, legal draft?
 *
 * True when there is an attribute whose every distinct kind in the source is selected — exactly once.
 * A partial selection is not a legal take even though each click was legal: you commit to sweeping an
 * attribute, not to picking favourites.
 *
 * Note that a *single* tile can be complete. If only one distinct 4 is showing, selecting it is
 * already "all the 4s".
 */
export function canConfirmDraft(
  available: readonly DraftTile[],
  selectedIds: readonly string[],
): boolean {
  const selected = selectedTiles(available, selectedIds)
  if (selected.length === 0) return false

  const kinds = new Set(selected.map(kindOf))
  // Two copies of one kind can never be a legal draft, however they got selected.
  if (kinds.size !== selected.length) return false

  const criteria = draftCriteria(selected)
  const first = selected[0]
  if (!first) return false

  return (criteria.color && sameSet(kinds, kindsMatching(available, 'color', first.color)))
    || (criteria.value && sameSet(kinds, kindsMatching(available, 'value', first.value)))
}

/**
 * Add or remove a tile, returning the new selection.
 *
 * Refuses tiles that are inactive, so the returned selection is always one the rules allow — the
 * caller does not have to check first, and a stray click cannot corrupt the state.
 */
export function toggleDraftSelection(
  available: readonly DraftTile[],
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
  available: readonly DraftTile[],
  selectedIds: readonly string[],
): 'color' | 'value' | null {
  const selected = selectedTiles(available, selectedIds)
  if (selected.length < 2) return null
  const criteria = draftCriteria(selected)
  if (criteria.color && !criteria.value) return 'color'
  if (criteria.value && !criteria.color) return 'value'
  return null
}
