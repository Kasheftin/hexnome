/**
 * What a tile is allowed to sit next to.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * ## The rule
 *
 * A tile landing on the board looks at the six cells around it. If none of them holds a tile, the
 * placement is free — an isolated tile answers to nobody. If any of them does, the neighbours have a
 * say, and how much of a say is the game's **placement rule**:
 *
 * - **regular** — *at least one* neighbour must share the new tile's colour or its value.
 * - **strict** — *every* neighbour must share its colour or its value.
 *
 * Regular asks the tile to belong somewhere; strict asks it to belong everywhere it touches. Strict is
 * a superset of regular's requirement, so anything strict allows, regular allows too.
 *
 * A plate is checked the same way, through the tile it carries: the token's cell has six neighbours
 * like any other.
 *
 * ## The open reading
 *
 * "Every neighbour must match by colour or value" is implemented **per neighbour** — one may match by
 * colour while the next matches by value. The alternative reading is that a single attribute has to
 * carry all of them, which is how drafting and payment work and would be stricter again. The two
 * differ only when neighbours match on different attributes, and switching is a one-line change to
 * {@link neighboursAllow}. See docs/game-design.md.
 */
import { NEIGHBOR_DIRS, axialAdd, axialKey, type Axial } from './hex'
import type { TileSpec } from './tableau'

export type PlacementRule = 'regular' | 'strict'

export const PLACEMENT_RULES: readonly PlacementRule[] = ['regular', 'strict']

export const DEFAULT_PLACEMENT_RULE: PlacementRule = 'regular'

export function isPlacementRule(value: unknown): value is PlacementRule {
  return value === 'regular' || value === 'strict'
}

/** Does this neighbour share the placed tile's colour or its value? */
function agrees(placed: TileSpec, neighbour: TileSpec): boolean {
  return neighbour.color === placed.color || neighbour.value === placed.value
}

/**
 * May a tile of `spec` go somewhere with these tiles around it?
 *
 * `neighbours` is only the cells that actually hold a tile — empty ones are not "neighbours that
 * disagree", they are simply absent. That is what makes the empty case fall out rather than needing
 * its own branch: `some` of nothing is false, so the emptiness test has to come first, while `every`
 * of nothing is true and would have been right by accident.
 */
export function neighboursAllow(
  spec: TileSpec,
  neighbours: readonly TileSpec[],
  rule: PlacementRule,
): boolean {
  return neighbourVerdict(spec, neighbours, rule).allowed
}

export interface NeighbourVerdict {
  readonly allowed: boolean
  /** Neighbours sharing the placed tile's colour or value. */
  readonly agreeing: readonly TileSpec[]
  /** Neighbours sharing neither. Under `regular` these are harmless if anything agrees. */
  readonly disagreeing: readonly TileSpec[]
}

/**
 * The same answer, with its reasons — so a refusal can say *which* neighbours it objected to.
 *
 * `neighboursAllow` is defined in terms of this rather than beside it. A second implementation of a
 * rule, kept in step by hand, is how an explanation ends up describing a decision nobody made.
 */
export function neighbourVerdict(
  spec: TileSpec,
  neighbours: readonly TileSpec[],
  rule: PlacementRule,
): NeighbourVerdict {
  const agreeing = neighbours.filter(neighbour => agrees(spec, neighbour))
  const disagreeing = neighbours.filter(neighbour => !agrees(spec, neighbour))
  const allowed = neighbours.length === 0
    || (rule === 'strict' ? disagreeing.length === 0 : agreeing.length > 0)
  return { allowed, agreeing, disagreeing }
}

/* ── groups, and the no-duplicates rule ────────────────────────────────────────
 *
 * A tile belongs to two groups at once: the run of same-**colour** tiles connected to it, and the run
 * of same-**value** tiles connected to it. Both always contain the tile itself, so both exist even for
 * a tile with nothing beside it.
 *
 * **Neither group may contain the same tile twice** — same colour *and* same value. That is the rule
 * this section exists for, and it is what makes a group a set of distinct things rather than a heap.
 *
 * The consequence to keep in mind while reading placements: a tile can never go beside a copy of
 * itself. That is not a separate check; two identical tiles adjacent are connected in *both* groups, so
 * both are duplicated at once.
 *
 * The subtle case is the one that motivates it. `Blue-1 · gap · Blue-1` is legal — nothing connects the
 * two, so they are in different groups. Dropping a Blue-2 into the gap joins them into one colour group
 * of `Blue-1, Blue-2, Blue-1`, and that group now holds two Blue-1s. The tile being placed is not
 * itself a duplicate of anything; it is the bridge that makes two distant tiles collide.
 */

/**
 * Every tile in the connected run that shares `attribute` with the tile being placed.
 *
 * A flood fill from the placed tile, stepping only through tiles that share the attribute — so the
 * result is the group as the rules define it, not merely everything nearby. `tileAt` describes the
 * board **as it would be after the placement**: the caller is responsible for having anything the move
 * displaces already absent, so this never has to reason about hypotheticals itself.
 */
function connectedGroup(
  origin: Axial,
  spec: TileSpec,
  attribute: 'color' | 'value',
  tileAt: (cell: Axial) => TileSpec | undefined,
): TileSpec[] {
  const members: TileSpec[] = [spec]
  const seen = new Set([axialKey(origin)])
  const frontier: Axial[] = [origin]

  // Only newly reached cells are ever expanded, which is what keeps this linear in the group's size.
  while (frontier.length > 0) {
    const cell = frontier.pop() as Axial
    for (const dir of NEIGHBOR_DIRS) {
      const next = axialAdd(cell, dir)
      const key = axialKey(next)
      if (seen.has(key)) continue
      const tile = tileAt(next)
      if (!tile || tile[attribute] !== spec[attribute]) continue
      seen.add(key)
      members.push(tile)
      frontier.push(next)
    }
  }
  return members
}

/** The first kind occurring twice, or null. */
function firstDuplicate(members: readonly TileSpec[]): TileSpec | null {
  const seen = new Set<string>()
  for (const tile of members) {
    const kind = `${tile.color}:${tile.value}`
    if (seen.has(kind)) return tile
    seen.add(kind)
  }
  return null
}

export interface GroupClash {
  /** Which of the two groups collided. */
  readonly axis: 'color' | 'value'
  /** The kind that appears twice in it. */
  readonly duplicate: TileSpec
  /** The whole group as it would stand after the placement, in flood-fill order. */
  readonly group: readonly TileSpec[]
}

/**
 * Why the groups refuse this placement, or null if they do not.
 *
 * Same relationship to {@link groupsAllow} as {@link neighbourVerdict} has to `neighboursAllow`: the
 * predicate is defined in terms of this, so an explanation cannot describe a rule the game is not
 * playing by.
 *
 * The colour group is reported first when both collide, which is arbitrary — it is a debugging aid,
 * and the second clash is one keystroke away once the first is fixed.
 */
export function groupClash(
  origin: Axial,
  spec: TileSpec,
  tileAt: (cell: Axial) => TileSpec | undefined,
): GroupClash | null {
  for (const axis of ['color', 'value'] as const) {
    const group = connectedGroup(origin, spec, axis, tileAt)
    const duplicate = firstDuplicate(group)
    if (duplicate) return { axis, duplicate, group }
  }
  return null
}

/**
 * Would placing this tile here leave both of its groups free of duplicates?
 *
 * `tileAt` must already describe the board **after** the placement, minus the placed tile itself at
 * `origin` — it is passed separately as `spec` so a caller does not have to fabricate a board that
 * contains a tile it has not committed to yet.
 */
export function groupsAllow(
  origin: Axial,
  spec: TileSpec,
  tileAt: (cell: Axial) => TileSpec | undefined,
): boolean {
  return groupClash(origin, spec, tileAt) === null
}

/**
 * Is every adjacent pair around a ring of tiles connected — sharing a colour or a value?
 *
 * The petals of a plate form a closed ring, each touching the next, so this walks all six pairs
 * including the one that wraps from the last back to the first. A gap anywhere breaks it.
 *
 * **Under the strict placement rule this is always true**, which is why the bonus it feeds is disabled
 * there. Of any adjacent pair, one was placed after the other, and strict required it to agree with
 * every neighbour it found — so agreement round the whole ring comes for free. Only under the regular
 * rule is placing strictly a choice, and only then is there anything to reward.
 */
export function ringIsConnected(ring: readonly TileSpec[]): boolean {
  if (ring.length < 2) return false
  return ring.every((tile, index) => agrees(tile, ring[(index + 1) % ring.length] as TileSpec))
}
