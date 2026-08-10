/**
 * A refused drop, in words.
 *
 * The board answers every refusal the same way — one red highlight — and there are five reasons
 * behind it. Told apart only by reading the model, which is not something a player, or a bug report,
 * can do. `whyNotPlaceTile` decides *which*; this says it out loud.
 *
 * It lives in `scene/` rather than in the rules because it needs the palette: "Green-3" is a sentence
 * a person can check against the screen, and `{ color: 2, value: 3 }` is not. The rules know a colour
 * only as an index — docs/tech-spec.md, "The one hard architectural rule".
 */
import type { TileRefusal, TileSpec } from '@hexnome/rules/tableau'
import { TILE_COLORS } from './constants'

/** A colour by the name the screen uses for it, so a log can be checked against the board. */
export function colorName(color: number): string {
  return TILE_COLORS[color]?.name ?? `colour ${color}`
}

export function tileName(spec: TileSpec): string {
  return `${colorName(spec.color)}-${spec.value}`
}

const list = (specs: readonly TileSpec[]): string =>
  specs.length === 0 ? 'nothing' : specs.map(tileName).join(', ')

export function describeTileRefusal(refusal: TileRefusal): string {
  switch (refusal.kind) {
    case 'noSuchPlace':
      return `there is no ${refusal.where.kind} slot there`

    case 'occupied':
      return `something is already in that ${refusal.where.kind} slot`

    /*
     * The one that surprises. Stems live in drawer slots, so a placement that pays more stems than
     * the drawer can hold would either lose them or overflow — it is refused instead. Nothing on
     * screen connects a full drawer to a red cell three tiles away, which is exactly why it reads as
     * a bug in the placement rules.
     */
    case 'rewardWontFit':
      return `it would pay ${refusal.stems} stem${refusal.stems === 1 ? '' : 's'} and the drawer has `
        + `room for ${refusal.freeSlots + refusal.emptying}`
        + (refusal.emptying
          ? ` (${refusal.freeSlots} free, plus ${refusal.emptying} this turn empties)`
          : '')

    case 'neighboursDisagree':
      return refusal.rule === 'strict'
        ? `under the strict rule every neighbour must match, and ${list(refusal.disagreeing)} `
          + `share${refusal.disagreeing.length === 1 ? 's' : ''} neither colour nor value with `
          + `${tileName(refusal.spec)}`
        : `no neighbour shares ${tileName(refusal.spec)}'s colour or value — around it: `
          + `${list(refusal.neighbours)}`

    /*
     * Worth spelling the group out. The placed tile is often not itself the duplicate: dropping a
     * Blue-2 between two Blue-1s duplicates neither of the things you dropped, it joins two groups
     * that were legal apart.
     */
    case 'duplicateInGroup':
      return `it would put two ${tileName(refusal.clash.duplicate)}s in one `
        + `${refusal.clash.axis === 'color' ? 'colour' : 'value'} group — that group would be `
        + `${list(refusal.clash.group)}`
  }
}
