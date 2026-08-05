/**
 * What was chosen when a game was started.
 *
 * Pure TypeScript over plain data — no `vue`, no `three` (docs/tech-spec.md). It lives in
 * `game/` because the rules will need it: the mode decides how a round is scored and how many
 * pieces it supplies, so setup has to read from here.
 *
 * Everything is parsed defensively. These values round-trip through localStorage, which is
 * user-editable and outlives any version of this code, so a stored blob can be truncated, from
 * an older shape, or simply nonsense. `parseGameSettings` is the only way in.
 */

import { DEFAULT_PLACEMENT_RULE, isPlacementRule, type PlacementRule } from './placement'

export type GameKind = 'singleplayer' | 'multiplayer' | 'quiz'

export type SingleplayerMode = 'classic' | 'classicReversed' | 'random'

export interface GameKindInfo {
  readonly id: GameKind
  readonly label: string
  /** False until the kind is actually playable; the menu shows it but will not start it. */
  readonly available: boolean
}

export const GAME_KINDS: readonly GameKindInfo[] = [
  { id: 'singleplayer', label: 'Single player', available: true },
  { id: 'multiplayer', label: 'Multiplayer', available: true },
  { id: 'quiz', label: 'Quiz mode', available: false },
]

export interface SingleplayerModeInfo {
  readonly id: SingleplayerMode
  readonly label: string
  readonly rounds: number
  /** One line on how the mode scores, for the menu. See docs/game-design.md, "Round scoring". */
  readonly description: string
}

export const SINGLEPLAYER_MODES: readonly SingleplayerModeInfo[] = [
  {
    id: 'classic',
    label: 'Classic',
    rounds: 4,
    description: 'Scores small values first and the sixes last. Colours dealt by the game id.',
  },
  {
    id: 'classicReversed',
    label: 'Classic reversed',
    rounds: 4,
    description: 'The same four rounds, largest values first.',
  },
  {
    id: 'random',
    label: 'Random',
    rounds: 6,
    description: 'Six rounds, one value and one colour each, both shuffled.',
  },
]

/**
 * How many people are playing, and the first thing the setup screen asks.
 *
 * Part of the settings rather than a column beside them because it is a property of the *game* — it
 * decides how much is dealt and how long a round is, and a replay of the log has to know it. One is
 * an ordinary value here, not a special case: a solo game is a game with one seat.
 */
export const PLAYER_COUNT_CHOICES: readonly number[] = [1, 2, 3, 4]
export const DEFAULT_PLAYERS = 1

/**
 * What a multiplayer table may be, and what it is unless told otherwise.
 *
 * One is missing on purpose: a multiplayer game of one is a singleplayer game, and offering it would
 * be two names for the same thing sitting next to each other in a menu.
 */
export const MULTIPLAYER_COUNT_CHOICES: readonly number[] = [2, 3, 4]
export const DEFAULT_MULTIPLAYER_PLAYERS = 2

// Seven, because a four-player game wants that many. See `defaultPlatesPerRound`.
export const PLATES_PER_ROUND_CHOICES: readonly number[] = [3, 4, 5, 6, 7]
export const DEFAULT_PLATES_PER_ROUND = 4

/**
 * The round supply a table of this size wants: one plate each, plus three.
 *
 * A **shared** supply, not a per-player one — everyone drafts from the same column, so it grows with
 * the table rather than multiplying by it. Three over the headcount keeps a round from being exactly
 * one plate per player, which would leave the last player no choice at all.
 *
 * A default, not a rule: the dial is still there, and `PLATES_PER_ROUND_CHOICES` bounds it.
 */
export function defaultPlatesPerRound(players: number): number {
  return players + 3
}

/**
 * How big the player's drawer is.
 *
 * Both are a difficulty dial in disguise. Tile slots are the room to hold tiles you cannot place yet,
 * and stems occupy them too; bays are how many plates you can keep in hand before committing one to
 * the board. Fewer of either forces earlier decisions.
 *
 * The tile counts are all **even** because the grid is two rows deep, so each divides exactly into
 * columns — see `scene/drawerLayout.ts`.
 */
export const TILE_SLOT_CHOICES: readonly number[] = [12, 14, 16, 18]
export const DEFAULT_TILE_SLOTS = 16

export const PLATE_SLOT_CHOICES: readonly number[] = [1, 2, 3]
export const DEFAULT_PLATE_SLOTS = 2

/**
 * Stems each player starts with — the jokers, dealt into the drawer before the first turn.
 *
 * They occupy ordinary tile slots, so this is also a handicap dial in disguise: every stem is one
 * fewer slot for drafted tiles until it is spent.
 */
export const STEM_COUNT_CHOICES: readonly number[] = [1, 2, 3, 4]
export const DEFAULT_STEM_COUNT = 3

/**
 * Stems awarded for enclosing an anchor — the only way to earn more after the opening allowance.
 *
 * Two rates rather than one because the two are not equally hard to reach, and the pair of dials is
 * where that balance gets tuned. Both share the 1–4 range of the opening allowance, so every stem
 * number in the game reads on the same scale.
 */
export const STEMS_PER_ANCHOR_CHOICES: readonly number[] = [1, 2, 3, 4]
export const DEFAULT_STEMS_PER_INTERNAL_ANCHOR = 3
export const DEFAULT_STEMS_PER_EXTERNAL_ANCHOR = 2

/**
 * An extra stem when an enclosure is strict all the way round — every neighbouring pair of the six
 * sharing a colour or a value.
 *
 * **Meaningless under the strict placement rule, and forced to zero there.** Strict placement already
 * guarantees it: of any adjacent pair, whichever went down second had to agree with the first, so the
 * ring is always connected and the bonus would simply be part of the base rate under another name.
 * Only under the regular rule is placing strictly a choice, and only then is there something to reward.
 */
export const STRICT_BONUS_CHOICES: readonly number[] = [0, 1]
export const DEFAULT_STRICT_ENCLOSURE_BONUS = 1

/**
 * The largest a group can ever be.
 *
 * Not a limit anyone imposed — it falls out of the rules. A group holds no duplicates, and there are
 * six values and six colours, so a colour group runs out at one tile per value and a value group at
 * one per colour. "Full group" and "six tiles" are therefore the same thing.
 */
export const MAX_GROUP_SIZE = 6

/**
 * How many connected tiles it takes to score at all.
 *
 * The biggest single lever on the endgame: at 2 almost anything pays and the board fills with short
 * runs, at 4 only deliberate building does.
 */
export const MIN_GROUP_SIZE_CHOICES: readonly number[] = [2, 3, 4]
export const DEFAULT_MIN_GROUP_SIZE = 3

/**
 * Extra points for a group of a given size, on top of the sum of its values.
 *
 * Indexed **by group size**, so `groupBonuses[6]` is what a full group pays. Sizes below the scoring
 * minimum are simply never consulted; the array covers 0–6 so the lookup is the size itself and no
 * caller has to remember an offset.
 *
 * The default pays for finishing and nothing else — a full group is worth six, a four or a five worth
 * nothing extra. The other common shape, rewarding every step up, is `+3 / +5 / +7`, which is why this
 * is a table rather than a single "full group bonus".
 *
 * **By exact size, not cumulative.** A six-tile group is paid `groupBonuses[6]`, not the sum of the
 * bonuses beneath it — otherwise `+3 / +5 / +7` would quietly mean +15 for a full group.
 */
export const GROUP_BONUS_CHOICES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
export const DEFAULT_GROUP_BONUSES: readonly number[] = [0, 0, 0, 0, 0, 0, 6]

/**
 * Charge for everything still in the drawer when the game ends, at its face value.
 *
 * **Once, at the very end.** Tiles cross between rounds freely — that is most of why a drawer
 * accumulates awkward ones — so this is a reckoning for hoarding across the whole game rather than a
 * per-round tax, and it makes a tile you cannot place a real cost rather than merely a wasted slot.
 */
export const DEFAULT_FINE_UNPLACED = true

/** A point for each stem still held at the end: the mirror of the fine, rewarding what was saved. */
export const DEFAULT_REWARD_STEMS = true
export const DEFAULT_SINGLEPLAYER_MODE: SingleplayerMode = 'classic'

export interface GameSettings {
  readonly kind: GameKind
  readonly mode: SingleplayerMode
  /** Seats at this table, 1–4. The game starts once they are all claimed. */
  readonly players: number
  readonly platesPerRound: number
  /** Tile slots in the player's drawer. Stems share them. */
  readonly tileSlots: number
  /** Plate bays in the player's drawer. */
  readonly plateSlots: number
  /** Stems each player is dealt at the start of the game. */
  readonly initialStems: number
  /** Stems awarded for enclosing an internal anchor. */
  readonly stemsPerInternalAnchor: number
  /** Stems awarded for enclosing an external anchor. */
  readonly stemsPerExternalAnchor: number
  /** Extra stems for a strict enclosure. Always 0 when `placementRule` is `strict`. */
  readonly strictEnclosureBonus: number
  /** How strictly a placed tile must agree with its neighbours. See game/placement.ts. */
  readonly placementRule: PlacementRule
  /** Connected tiles needed before a group scores at all. */
  readonly minGroupSize: number
  /** Extra points by exact group size, indexed by size. See {@link DEFAULT_GROUP_BONUSES}. */
  readonly groupBonuses: readonly number[]
  /** Charge the value of every tile and plate left unplaced when the game ends. */
  readonly fineUnplaced: boolean
  /** Pay a point for each stem still in the drawer when the game ends. */
  readonly rewardStems: boolean
  /** Epoch milliseconds. Supplied by the caller so this module never reads the clock. */
  readonly createdAt: number
}

export function roundsOf(mode: SingleplayerMode): number {
  return SINGLEPLAYER_MODES.find(m => m.id === mode)?.rounds ?? 0
}

export function modeInfo(mode: SingleplayerMode): SingleplayerModeInfo | undefined {
  return SINGLEPLAYER_MODES.find(m => m.id === mode)
}

export function isSingleplayerMode(value: unknown): value is SingleplayerMode {
  return SINGLEPLAYER_MODES.some(m => m.id === value)
}

export function isGameKind(value: unknown): value is GameKind {
  return GAME_KINDS.some(k => k.id === value)
}

export function isPlayerCount(value: unknown): boolean {
  return typeof value === 'number' && PLAYER_COUNT_CHOICES.includes(value)
}

export function isPlatesPerRound(value: unknown): boolean {
  return typeof value === 'number' && PLATES_PER_ROUND_CHOICES.includes(value)
}

export function isTileSlots(value: unknown): boolean {
  return typeof value === 'number' && TILE_SLOT_CHOICES.includes(value)
}

export function isPlateSlots(value: unknown): boolean {
  return typeof value === 'number' && PLATE_SLOT_CHOICES.includes(value)
}

export function isStemCount(value: unknown): boolean {
  return typeof value === 'number' && STEM_COUNT_CHOICES.includes(value)
}

export function isStemsPerAnchor(value: unknown): boolean {
  return typeof value === 'number' && STEMS_PER_ANCHOR_CHOICES.includes(value)
}

export function isStrictBonus(value: unknown): boolean {
  return typeof value === 'number' && STRICT_BONUS_CHOICES.includes(value)
}

export function isMinGroupSize(value: unknown): boolean {
  return typeof value === 'number' && MIN_GROUP_SIZE_CHOICES.includes(value)
}

/**
 * A bonus table from storage, or the default.
 *
 * All or nothing: a table that is the wrong length or holds an unoffered value is replaced entirely
 * rather than patched entry by entry. A half-repaired table is a scoring rule nobody chose, and the
 * player would have no way to see which entries had been quietly rewritten.
 */
export function parseGroupBonuses(value: unknown): readonly number[] {
  if (!Array.isArray(value)) return DEFAULT_GROUP_BONUSES
  if (value.length !== MAX_GROUP_SIZE + 1) return DEFAULT_GROUP_BONUSES
  if (!value.every(entry => GROUP_BONUS_CHOICES.includes(entry as number))) return DEFAULT_GROUP_BONUSES
  return value as readonly number[]
}

/**
 * The bonus a game actually runs with.
 *
 * One function so the rule cannot be applied in one place and forgotten in another: the menu hides the
 * control under strict placement, and this makes the same thing true of a settings blob that was
 * hand-edited, stored before the rule existed, or written by an older build.
 */
export function effectiveStrictBonus(settings: {
  placementRule: PlacementRule
  strictEnclosureBonus: number
}): number {
  return settings.placementRule === 'strict' ? 0 : settings.strictEnclosureBonus
}

/**
 * The bonus table a game actually runs with: nothing is paid at or below the scoring minimum.
 *
 * A group smaller than the minimum never scores at all, and one *at* the minimum is the baseline the
 * bonuses are a reward above — so an entry there would be a flat rise dressed up as a bonus. The menu
 * hides those inputs; this makes the same true of a stored blob written by an older build or edited by
 * hand, exactly as `effectiveStrictBonus` does for its pairing.
 */
export function effectiveGroupBonuses(
  minGroupSize: number,
  bonuses: readonly number[],
): readonly number[] {
  return bonuses.map((bonus, size) => (size <= minGroupSize ? 0 : bonus))
}

export const PLACEMENT_RULE_LABELS: Readonly<Record<PlacementRule, string>> = {
  regular: 'Regular',
  strict: 'Strict',
}

/** One line each, because the difference is easy to state and expensive to discover by playing. */
export const PLACEMENT_RULE_HINTS: Readonly<Record<PlacementRule, string>> = {
  regular: 'one neighbour must match',
  strict: 'every neighbour must match',
}

export function defaultGameSettings(createdAt: number): GameSettings {
  return {
    kind: 'singleplayer',
    mode: DEFAULT_SINGLEPLAYER_MODE,
    players: DEFAULT_PLAYERS,
    platesPerRound: DEFAULT_PLATES_PER_ROUND,
    tileSlots: DEFAULT_TILE_SLOTS,
    plateSlots: DEFAULT_PLATE_SLOTS,
    initialStems: DEFAULT_STEM_COUNT,
    stemsPerInternalAnchor: DEFAULT_STEMS_PER_INTERNAL_ANCHOR,
    stemsPerExternalAnchor: DEFAULT_STEMS_PER_EXTERNAL_ANCHOR,
    strictEnclosureBonus: DEFAULT_STRICT_ENCLOSURE_BONUS,
    placementRule: DEFAULT_PLACEMENT_RULE,
    minGroupSize: DEFAULT_MIN_GROUP_SIZE,
    groupBonuses: DEFAULT_GROUP_BONUSES,
    fineUnplaced: DEFAULT_FINE_UNPLACED,
    rewardStems: DEFAULT_REWARD_STEMS,
    createdAt,
  }
}

/**
 * Read settings from an untrusted value, or null if it cannot be salvaged.
 *
 * Returns null rather than a patched-up default on a bad `kind` or `mode`: those name what the
 * game *is*, so quietly substituting one would drop a player into a different game from the one
 * they started. `platesPerRound`, the stem counts and `placementRule` are different — they are dials,
 * so an unrecognised value falls back to the default rather than discarding the whole game. That also
 * makes them safe to add: a game saved before a dial existed simply gets its default.
 */
export function parseGameSettings(value: unknown): GameSettings | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>

  if (!isGameKind(raw.kind)) return null
  if (!isSingleplayerMode(raw.mode)) return null

  const placementRule = isPlacementRule(raw.placementRule)
    ? raw.placementRule
    : DEFAULT_PLACEMENT_RULE

  const minGroupSize = isMinGroupSize(raw.minGroupSize)
    ? (raw.minGroupSize as number)
    : DEFAULT_MIN_GROUP_SIZE

  return {
    kind: raw.kind,
    mode: raw.mode,
    // Games stored before there were seats have none, and were played by one person.
    players: isPlayerCount(raw.players) ? (raw.players as number) : DEFAULT_PLAYERS,
    platesPerRound: isPlatesPerRound(raw.platesPerRound)
      ? (raw.platesPerRound as number)
      : DEFAULT_PLATES_PER_ROUND,
    tileSlots: isTileSlots(raw.tileSlots) ? (raw.tileSlots as number) : DEFAULT_TILE_SLOTS,
    plateSlots: isPlateSlots(raw.plateSlots) ? (raw.plateSlots as number) : DEFAULT_PLATE_SLOTS,
    initialStems: isStemCount(raw.initialStems)
      ? (raw.initialStems as number)
      : DEFAULT_STEM_COUNT,
    stemsPerInternalAnchor: isStemsPerAnchor(raw.stemsPerInternalAnchor)
      ? (raw.stemsPerInternalAnchor as number)
      : DEFAULT_STEMS_PER_INTERNAL_ANCHOR,
    stemsPerExternalAnchor: isStemsPerAnchor(raw.stemsPerExternalAnchor)
      ? (raw.stemsPerExternalAnchor as number)
      : DEFAULT_STEMS_PER_EXTERNAL_ANCHOR,
    placementRule,
    minGroupSize,
    // Normalised on the way in, so nothing downstream has to remember the pairing.
    groupBonuses: effectiveGroupBonuses(minGroupSize, parseGroupBonuses(raw.groupBonuses)),
    // A switch that is anything but `false` stays on: these are on by default, and a blob written
    // before they existed should play the way a new game does rather than quietly lose them.
    fineUnplaced: raw.fineUnplaced !== false,
    rewardStems: raw.rewardStems !== false,
    // Normalised on the way in, so nothing downstream has to remember the pairing.
    strictEnclosureBonus: effectiveStrictBonus({
      placementRule,
      strictEnclosureBonus: isStrictBonus(raw.strictEnclosureBonus)
        ? (raw.strictEnclosureBonus as number)
        : DEFAULT_STRICT_ENCLOSURE_BONUS,
    }),
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : 0,
  }
}
