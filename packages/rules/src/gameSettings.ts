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

import { DISTINCT_TILES, STANDARD_PLATE_COPIES, STANDARD_TILE_COPIES } from './deck'
import { DEFAULT_PLACEMENT_RULE, isPlacementRule, type PlacementRule } from './placement'

export type GameKind = 'singleplayer' | 'multiplayer' | 'quiz'

export type SingleplayerMode = 'classic' | 'classicReversed' | 'random' | 'quick'

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

/**
 * How many people are at the table.
 *
 * Two to four on the menu. The ceiling in the rules is six — one opening colour each, see
 * `deck.ts` — and the gap is a decision about what makes a good game rather than a limit.
 *
 * A singleplayer game stores {@link SOLO}, which is not offered as a choice: it follows from the kind
 * rather than being picked. Both are valid stored values, which is why the guard takes either.
 */
export const PLAYER_COUNT_CHOICES: readonly number[] = [2, 3, 4]
export const DEFAULT_PLAYER_COUNT = 2
export const SOLO = 1

/** The most characters a player's name may carry, matching the field on the menu. */
export const MAX_NAME_LENGTH = 40

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
  {
    id: 'quick',
    label: 'Quick',
    rounds: 1,
    description: 'One round, and nothing scores until it ends — then the whole board does.',
  },
]

/**
 * How many plates a round deals — and therefore how many slots the source column has
 * (`sourceLots: settings.platesPerRound` in game.ts).
 *
 * **The offered range depends on the mode**, because the dial means different things in each. Over
 * four rounds it is the width of one round's offering; in a one-round game it is the length of the
 * whole game, so the numbers are much larger.
 *
 * There is no union of the two for validation to check against. There was, and it was the bug: a
 * validator that cannot see the mode accepts a classic 4 into a quick game, where the menu offers
 * 8-20 and highlights nothing. Every reading of this dial goes through the mode — see
 * `reconcileSettings`.
 */

/**
 * Rounds deal a handful; quick deals the whole game at once.
 *
 * The scoring modes reach to ten because the count follows the table: the reference game deals more
 * factories to more players, and the presets do the same — 4, 5, 7, 9 from one seat to four. A range
 * that stopped at six could not express its own presets, and the parser would have repaired them into
 * a game nobody chose.
 */
const PLATES_PER_ROUND_BY_MODE: Readonly<Record<SingleplayerMode, readonly number[]>> = {
  classic: [4, 5, 6, 7, 8, 9, 10],
  classicReversed: [4, 5, 6, 7, 8, 9, 10],
  random: [4, 5, 6, 7, 8, 9, 10],
  quick: [8, 12, 16, 20],
}

export const DEFAULT_PLATES_PER_ROUND = 4
const DEFAULT_PLATES_PER_ROUND_QUICK = 12

/** What the menu offers for this mode. */
export function platesPerRoundChoices(mode: SingleplayerMode): readonly number[] {
  return PLATES_PER_ROUND_BY_MODE[mode] ?? PLATES_PER_ROUND_BY_MODE.classic
}

/** What the menu starts on for this mode. */
export function defaultPlatesPerRound(mode: SingleplayerMode): number {
  return mode === 'quick' ? DEFAULT_PLATES_PER_ROUND_QUICK : DEFAULT_PLATES_PER_ROUND
}

/** The part of `GameSettings` whose allowed range depends on the rest of it. */
export interface ReconcilableSettings {
  readonly mode: SingleplayerMode
  readonly platesPerRound: number
}

/**
 * Repair a plate count this mode does not offer.
 *
 * The distinction from `nearestPlatesPerRound` below is intent. Turning the mode dial is a deliberate
 * act, and the nearest value carries "I wanted few" or "I wanted many" across it. This repairs a value
 * that arrived *already* wrong — out of storage, out of a URL, out of a client older than the mode —
 * where there is no preference to carry, because the player never expressed one on this scale. So it
 * falls back to what the menu would have opened on.
 */
export function reconcilePlatesPerRound(mode: SingleplayerMode, value: unknown): number {
  return typeof value === 'number' && platesPerRoundChoices(mode).includes(value)
    ? value
    : defaultPlatesPerRound(mode)
}

/**
 * Put settings back inside what their own mode allows.
 *
 * This states the invariant the rest of the file leaves implicit: **some dials' ranges are a function
 * of other dials**, and `platesPerRound` is the first of them — one round's width in a four-round
 * game, the whole game's length in a one-round one. A value from one mode is not merely unusual in
 * another, it is unofferable, and a menu asked to show it highlights nothing at all.
 *
 * Saying it in one place is what makes it hold at every entrance: the parser that every stored game
 * comes through, and the setup screen restoring the last game's dials. The next mode-dependent dial
 * is added here, and nowhere else.
 *
 * **Not the job `effectiveFirstPassFine` and its neighbours do.** Those collapse a dial that is
 * *meaningless* in some combination, and they must not be run over a player's saved preferences — see
 * savedSetup.ts, where sending a preset through the parser would quietly wipe the choices it holds.
 * This repairs only the impossible, which is why it is safe to run anywhere, and it returns the
 * settings untouched when there is nothing to repair.
 */
export function reconcileSettings<T extends ReconcilableSettings>(settings: T): T {
  const platesPerRound = reconcilePlatesPerRound(settings.mode, settings.platesPerRound)
  return platesPerRound === settings.platesPerRound ? settings : { ...settings, platesPerRound }
}

/**
 * Move a chosen value onto a mode's own range.
 *
 * Switching from classic to quick leaves 4 selected against a dial that starts at 8, which reads as a
 * choice the player made and cannot see. The nearest offered value is the least surprising answer —
 * it keeps "I wanted few" or "I wanted many" across the switch.
 */
export function nearestPlatesPerRound(mode: SingleplayerMode, value: number): number {
  const choices = platesPerRoundChoices(mode)
  if (choices.includes(value)) return value
  return choices.reduce(
    (best, choice) => (Math.abs(choice - value) < Math.abs(best - value) ? choice : best),
    choices[0] ?? DEFAULT_PLATES_PER_ROUND,
  )
}

/**
 * How much material the game is dealt from, as copies of each of the 36 distinct kinds.
 *
 * More tiles makes duplicates commoner in the source, so a colour sweeps more easily and an awkward
 * value is likelier to come round again. More plates means the plate bag reshuffles later, or never
 * — a four-round game draws 16 plates against a bag of 36, so at two copies the pile is decoration.
 *
 * **Stored as copies, shown as totals.** The stored number is what `createDeck` takes; a player
 * thinks in how many tiles are in play, not in multiples of 36. The labels below are what the menu
 * renders in place of the raw value, and they are *derived* — a fifth choice cannot be added without
 * its total following it.
 */
export const TILE_COPIES_CHOICES: readonly number[] = [2, 3, 4]
export const DEFAULT_TILE_COPIES = STANDARD_TILE_COPIES

export const PLATE_COPIES_CHOICES: readonly number[] = [1, 2, 3]
export const DEFAULT_PLATE_COPIES = STANDARD_PLATE_COPIES

export const TILE_BAG_LABELS: readonly string[] =
  TILE_COPIES_CHOICES.map(copies => String(copies * DISTINCT_TILES))

export const PLATE_BAG_LABELS: readonly string[] =
  PLATE_COPIES_CHOICES.map(copies => String(copies * DISTINCT_TILES))

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
export const TILE_SLOT_CHOICES: readonly number[] = [10, 12, 14, 16]
export const DEFAULT_TILE_SLOTS = 12

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
 * **Always earned under the strict placement rule, and forced on there.** Strict placement guarantees
 * the ring: of any adjacent pair, whichever went down second had to agree with the first. So every
 * enclosure in a strict game collects it, and the dial is shown holding a 1 that cannot be turned.
 *
 * It used to be forced the other way — zeroed under strict, on the reasoning that a bonus paid every
 * time is the base rate under another name. That is arithmetically true and was still wrong at the
 * table: a player who had learned that a strict ring pays four switched to the harder rule and found
 * it paying three. A rule that asks more of you and returns less is not something "you could have set
 * the base rate higher" ever explains.
 */
export const STRICT_BONUS_CHOICES: readonly number[] = [0, 1]
export const DEFAULT_STRICT_ENCLOSURE_BONUS = 1

/**
 * Points paid for every anchor on the board, at the end of **every** round.
 *
 * The one reward for building *wide* rather than dense. Everything else pays for tiles — the round
 * targets, the final groups — so without this a player is best served by one plate worked to death,
 * and the board never grows. An anchor is what a plate brings with it: exactly one internal anchor
 * each, always, plus whatever external ones the arrangement happens to wrap.
 *
 * It compounds, which is the point. A plate placed in round 1 pays its anchor again in every round
 * that follows — one extra plate in a four-round game is four points, not one — so the argument for
 * spending a turn on width is strongest early and fades to nothing by the last round.
 *
 * **Unlike the stem rates, an anchor need not be enclosed.** Those pay for the ring of six tiles around
 * a hole, which is a feat; this pays for the hole existing, which is a decision about the shape of your
 * board. The two are deliberately different rewards for the same feature, which is why external anchors
 * default to 0 here — a wrapped gap is a by-product of placing plates loosely rather than something to
 * encourage on its own.
 */
export const ANCHOR_POINT_CHOICES: readonly number[] = [0, 1, 2]
export const DEFAULT_POINTS_PER_INTERNAL_ANCHOR = 1
export const DEFAULT_POINTS_PER_EXTERNAL_ANCHOR = 0

/**
 * What the first player to pass in a round gives up, in points.
 *
 * Passing first is not simply giving up: it also takes the **first turn of the next round**, which is
 * first pick of a fresh source. The fine is the price of that, and the two together are one decision —
 * leave early and lead, or stay and take what is left. At 0 there is no reason not to bail out the
 * moment the source turns awkward, which is why the default is not 0.
 *
 * **Meaningless in a solo game, and forced to zero there.** With one seat every pass is the first one,
 * so the fine would be an unconditional charge for finishing a round, and leading the next is not a
 * privilege when there is nobody to lead. See {@link effectiveFirstPassFine}.
 */
export const FIRST_PASS_FINE_CHOICES: readonly number[] = [0, 1, 2]
export const DEFAULT_FIRST_PASS_FINE = 1

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

/**
 * Undo, **off unless asked for**.
 *
 * The opposite default to the switches above, and deliberately so. Those are part of how the game is
 * scored and a table that never touches them should still play the real game; undo changes what a
 * turn *is* — a decision you can see the consequences of and take back — so it is a thing a player
 * opts into rather than one they have to notice and turn off.
 *
 * It is also why it stays singleplayer. Over a shared source, one player rewinding a draft everyone
 * else has already seen is not a mechanic, it is a broken table.
 */
export const DEFAULT_ALLOW_UNDO = false
export const DEFAULT_SINGLEPLAYER_MODE: SingleplayerMode = 'classic'

export interface GameSettings {
  readonly kind: GameKind
  readonly mode: SingleplayerMode
  /**
   * How many people are at the table. {@link SOLO} for a singleplayer game.
   *
   * Stored rather than derived from `kind`, because it is the number the deal and the turn order are
   * built from and "multiplayer" does not say how many.
   */
  readonly players: number
  /**
   * What to call each of them, in seating order. Seat 0 is whoever created the game.
   *
   * May be shorter than `players` — a seat with no name falls back to its number. Local names for
   * now: everyone is at one screen, so there is nobody to ask.
   */
  readonly playerNames: readonly string[]
  readonly platesPerRound: number
  /** Copies of each distinct tile in the bag. `× 36` is the total dealt from. */
  readonly tileCopies: number
  /** Copies of each distinct plate in the bag. `× 36` is the total dealt from. */
  readonly plateCopies: number
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
  /** Points per internal anchor on the board, banked at the end of every round. */
  readonly pointsPerInternalAnchor: number
  /** Points per external anchor on the board, banked at the end of every round. */
  readonly pointsPerExternalAnchor: number
  /** Points charged to the first seat to pass in a round. Always 0 in a solo game. */
  readonly firstPassFine: number
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
  /**
   * Let the player take the last turn back. Singleplayer only — see {@link DEFAULT_ALLOW_UNDO}.
   *
   * Honoured by `canUndo` in game.ts, which is what both the button and the server ask, so a game
   * with this off has no undo rather than an undo button that gets refused.
   */
  readonly allowUndo: boolean
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
  return value === SOLO || (typeof value === 'number' && PLAYER_COUNT_CHOICES.includes(value))
}

/**
 * Who is at the table, as stored.
 *
 * All or nothing, like the bonus table: a list that is the wrong shape is replaced entirely rather
 * than patched entry by entry, because a half-repaired one would seat somebody under a name they did
 * not choose and give them no way to see it happened.
 *
 * Short is allowed and means "the rest have not been named yet" — the lobby fills those in. Names are
 * trimmed and bounded here so nothing downstream has to wonder.
 */
export function parsePlayerNames(value: unknown, players: number): readonly string[] {
  if (!Array.isArray(value)) return []
  if (value.length > players) return []
  if (!value.every(name => typeof name === 'string')) return []
  return value.map(name => (name as string).trim().slice(0, MAX_NAME_LENGTH))
}

export function isTileCopies(value: unknown): boolean {
  return typeof value === 'number' && TILE_COPIES_CHOICES.includes(value)
}

export function isPlateCopies(value: unknown): boolean {
  return typeof value === 'number' && PLATE_COPIES_CHOICES.includes(value)
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

export function isAnchorPoints(value: unknown): boolean {
  return typeof value === 'number' && ANCHOR_POINT_CHOICES.includes(value)
}

export function isFirstPassFine(value: unknown): boolean {
  return typeof value === 'number' && FIRST_PASS_FINE_CHOICES.includes(value)
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
 * What a strict game pays for a ring it was always going to close.
 *
 * Its own name rather than a bare `1`, because it is the same fact as `DEFAULT_STRICT_ENCLOSURE_BONUS`
 * seen from the other side: the bonus exists, and strict placement earns it every time.
 */
export const STRICT_BONUS_WHEN_FORCED = DEFAULT_STRICT_ENCLOSURE_BONUS

/**
 * The bonus a game actually runs with.
 *
 * One function so the rule cannot be applied in one place and forgotten in another: the menu locks the
 * control under strict placement, and this makes the same thing true of a settings blob that was
 * hand-edited, stored before the rule changed, or written by an older build.
 */
export function effectiveStrictBonus(settings: {
  placementRule: PlacementRule
  strictEnclosureBonus: number
}): number {
  return settings.placementRule === 'strict'
    ? STRICT_BONUS_WHEN_FORCED
    : settings.strictEnclosureBonus
}

/**
 * The first-pass fine a game actually runs with: nothing at all at a table of one.
 *
 * Keyed on the **seat count** rather than on `kind`, because that is what the rule is about. A solo
 * game passes once per round and always first, so a fine there is a charge for reaching the end of a
 * round, and the turn order it pays for cannot mean anything with one seat.
 *
 * One function for the same reason as {@link effectiveStrictBonus}: the menu hides the control in a
 * solo game, and this makes the same thing true of a settings blob that was hand-edited, stored before
 * the rule existed, or written by an older build.
 */
export function effectiveFirstPassFine(settings: {
  players: number
  firstPassFine: number
}): number {
  return settings.players <= SOLO ? 0 : settings.firstPassFine
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
    players: SOLO,
    playerNames: [],
    platesPerRound: DEFAULT_PLATES_PER_ROUND,
    tileCopies: DEFAULT_TILE_COPIES,
    plateCopies: DEFAULT_PLATE_COPIES,
    tileSlots: DEFAULT_TILE_SLOTS,
    plateSlots: DEFAULT_PLATE_SLOTS,
    initialStems: DEFAULT_STEM_COUNT,
    stemsPerInternalAnchor: DEFAULT_STEMS_PER_INTERNAL_ANCHOR,
    stemsPerExternalAnchor: DEFAULT_STEMS_PER_EXTERNAL_ANCHOR,
    strictEnclosureBonus: DEFAULT_STRICT_ENCLOSURE_BONUS,
    pointsPerInternalAnchor: DEFAULT_POINTS_PER_INTERNAL_ANCHOR,
    pointsPerExternalAnchor: DEFAULT_POINTS_PER_EXTERNAL_ANCHOR,
    // Solo by default, and the fine means nothing there — see `effectiveFirstPassFine`.
    firstPassFine: 0,
    placementRule: DEFAULT_PLACEMENT_RULE,
    minGroupSize: DEFAULT_MIN_GROUP_SIZE,
    groupBonuses: DEFAULT_GROUP_BONUSES,
    fineUnplaced: DEFAULT_FINE_UNPLACED,
    rewardStems: DEFAULT_REWARD_STEMS,
    allowUndo: DEFAULT_ALLOW_UNDO,
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

  /*
   * The seat count follows the kind when it is missing or unreadable, rather than taking a default of
   * its own: a game saved before this existed was a singleplayer game, and every other reading of it
   * would be wrong. Names are then validated against however many seats that gives.
   */
  const players = isPlayerCount(raw.players)
    ? (raw.players as number)
    : (raw.kind === 'singleplayer' ? SOLO : DEFAULT_PLAYER_COUNT)

  return {
    kind: raw.kind,
    mode: raw.mode,
    players,
    playerNames: parsePlayerNames(raw.playerNames, players),
    // Through the mode, so a plate count from another one cannot survive being stored and read back.
    platesPerRound: reconcilePlatesPerRound(raw.mode, raw.platesPerRound),
    tileCopies: isTileCopies(raw.tileCopies) ? (raw.tileCopies as number) : DEFAULT_TILE_COPIES,
    plateCopies: isPlateCopies(raw.plateCopies)
      ? (raw.plateCopies as number)
      : DEFAULT_PLATE_COPIES,
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
    /*
     * The other way round from the two above, and not a slip. They are on by default, so a blob
     * written before they existed should keep playing the real game. Undo is off by default, so the
     * same blob must not silently acquire it — only an explicit `true` turns it on.
     */
    allowUndo: raw.allowUndo === true,
    // Normalised on the way in, so nothing downstream has to remember the pairing.
    strictEnclosureBonus: effectiveStrictBonus({
      placementRule,
      strictEnclosureBonus: isStrictBonus(raw.strictEnclosureBonus)
        ? (raw.strictEnclosureBonus as number)
        : DEFAULT_STRICT_ENCLOSURE_BONUS,
    }),
    pointsPerInternalAnchor: isAnchorPoints(raw.pointsPerInternalAnchor)
      ? (raw.pointsPerInternalAnchor as number)
      : DEFAULT_POINTS_PER_INTERNAL_ANCHOR,
    pointsPerExternalAnchor: isAnchorPoints(raw.pointsPerExternalAnchor)
      ? (raw.pointsPerExternalAnchor as number)
      : DEFAULT_POINTS_PER_EXTERNAL_ANCHOR,
    // The same, for the pairing with the seat count.
    firstPassFine: effectiveFirstPassFine({
      players,
      firstPassFine: isFirstPassFine(raw.firstPassFine)
        ? (raw.firstPassFine as number)
        : DEFAULT_FIRST_PASS_FINE,
    }),
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : 0,
  }
}
