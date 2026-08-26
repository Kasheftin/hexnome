/**
 * The handful of games worth offering by name.
 *
 * The setup screen can dial nineteen things, which is the right amount of control and the wrong
 * amount of choice to face on the way to a first game. A preset is the answer to "just deal me a
 * proper game": a name, a one-line reason to pick it, and the settings behind it.
 *
 * ## Why they live in the rules
 *
 * Because a preset is a statement about a game rather than about a screen, and because more than one
 * consumer needs it. The setup screen offers them; the high score board uses the same definitions to
 * say which games belong on which board, and it runs on the server — see `matchPreset` at the foot of
 * this file. One copy, in the package both already compile.
 *
 * ## Patches, not settings
 *
 * Each preset states only what makes it different, over `defaultGameSettings`. A preset holding all
 * twenty-three fields would be a second place for every default to live, and the two would part
 * company the first time one of them moved.
 *
 * ## Why the seat count is a parameter
 *
 * Plates per round follows the table. The reference game deals more factories to more players, and so
 * do these: four at one seat, then five, seven and nine. That is the one setting that varies, but
 * `byPlayers` is a patch like any other, so the next one that varies needs no new machinery.
 *
 * A preset is therefore not one game but four, one per seat count — which is the same grid a high
 * score table would have to keep anyway, since a score at two seats says nothing about a score at
 * four.
 */
import {
  defaultGameSettings,
  parseGameSettings,
  SOLO,
  type GameSettings,
} from './gameSettings'

export interface GamePreset {
  readonly id: string
  /** What the card says. */
  readonly label: string
  /**
   * Why somebody would pick this one, in a line.
   *
   * Flavour only. The numbers on the card — rounds, plates, placement — are read off the settings
   * themselves, so a preset cannot describe a game it does not deal.
   */
  readonly note: string
  readonly settings: Partial<GameSettings>
  /** What changes with the seat count, applied over `settings`. */
  readonly byPlayers?: Readonly<Record<number, Partial<GameSettings>>>
}

/**
 * How much wider the source gets as the table fills, by seat count.
 *
 * A fact about tables rather than about any one preset: more players draft from the same source, so
 * it has to be wider or the last player of a round is choosing from leavings. Stated once, as the
 * *progression*, so a preset says only where it starts.
 */
const WIDER_BY_SEATS = [0, 1, 3, 5]

function platesBySeats(base: number): Readonly<Record<number, Partial<GameSettings>>> {
  return Object.fromEntries(
    WIDER_BY_SEATS.map((wider, seats) => [seats + 1, { platesPerRound: base + wider }]),
  )
}

export const GAME_PRESETS: readonly GamePreset[] = [
  {
    id: 'standard-2',
    label: 'Standard',
    note: 'The game as it is meant to be played.',
    settings: { mode: 'classic', placementRule: 'regular', tileSlots: 12 },
    byPlayers: platesBySeats(4),
  },
  {
    id: 'quick-2',
    label: 'Quick',
    note: 'One round, scored once at the end. A single sitting.',
    /*
     * Flat across seat counts, deliberately. A wider source and a longer game are different levers,
     * and quick mode's whole length is this number — scaling it with the table would make a
     * four-player quick game twice the game a solo one is, rather than the same game at a fuller
     * table.
     */
    settings: { mode: 'quick', placementRule: 'regular', tileSlots: 12, platesPerRound: 12 },
  },
  {
    id: 'long-2',
    label: 'Long & precise',
    note: 'Six rounds, every neighbour must match, and you may take a turn back.',
    /*
     * `allowUndo` at a table is simply inert — `canUndo` refuses whenever there is more than one
     * seat, because taking a turn back would rewind a source everybody else has already played
     * against. Declared anyway rather than only for the solo variant, so the preset is one game with
     * one description at every seat count.
     */
    settings: { mode: 'random', placementRule: 'strict', tileSlots: 16, allowUndo: true },
    // A wider source than Standard's before the table is even counted: a long game wants the choice.
    byPlayers: platesBySeats(6),
  },
]

export function findPreset(id: string): GamePreset | undefined {
  return GAME_PRESETS.find(preset => preset.id === id)
}

/**
 * Everything a preset declares at this seat count, merged but not yet validated.
 *
 * Kept separate from the settings below because it is what the preset *claims*, and the point of
 * having both is to be able to check that the claim survives — see presets.spec.ts.
 */
export function presetPatch(preset: GamePreset, players: number): Partial<GameSettings> {
  return { ...preset.settings, ...(preset.byPlayers?.[players] ?? {}) }
}

/**
 * The settings a preset actually runs as.
 *
 * Through `parseGameSettings`, so what comes out is what the game will be dealt with rather than what
 * was asked for — the two differ wherever a dial is meaningless in a combination and the rules
 * collapse it. A preset that named a value the parser would repair would be a card promising one game
 * and dealing another, which is what the spec exists to prevent.
 *
 * Names are left out: a preset says what kind of game, not who is at it.
 */
export function presetSettings(
  preset: GamePreset,
  players: number,
  createdAt = 0,
): GameSettings {
  const parsed = parseGameSettings({
    ...defaultGameSettings(createdAt),
    kind: players <= SOLO ? 'singleplayer' : 'multiplayer',
    players,
    ...presetPatch(preset, players),
  })
  /*
   * Unreachable: the input is built from validated defaults and a patch the spec holds to legal
   * values. Thrown rather than defaulted, because a preset the parser rejects is a bug in this file
   * and silently handing back a different game would hide it.
   */
  if (!parsed) throw new Error(`preset ${preset.id} does not describe a valid game`)
  return parsed
}


/*
 * ── Recognising a preset again ───────────────────────────────────────────────
 *
 * **Retuning a preset means minting a new id, never editing one in place.**
 *
 * A high score board is the set of games whose settings match a preset, and a game records which
 * preset it matched at the moment it was created. Change what a preset deals and every game already on
 * that board stays there, now sitting beside games of a different shape — a leaderboard quietly
 * comparing two things.
 *
 * The ids therefore name a *ruleset*, not a game. The `-2` on all three is the first application of
 * the rule: turning undo on by default made a solo game materially easier, so the boards those ids
 * name start again rather than mixing the two. The labels are unchanged, because what a player calls
 * the game did not change — only what it deals.
 *
 * All three moved together even though only one had scores on it, so that "which ruleset is this?" has
 * one answer per generation rather than three ids at three different vintages.
 *
 * `presets.spec.ts` pins what each one deals, so the *next* retune fails a test rather than a season
 * of scores.
 */

/**
 * Every field that decides what game this is.
 *
 * `satisfies Record<RuleField, true>` is the point of the shape: it will not compile unless every
 * rule-bearing setting is listed, so adding one to `GameSettings` fails a typecheck here instead of
 * being silently left out of the comparison — which would quietly widen every board.
 *
 * The two that are absent are the two that are not rules. `playerNames` is who turned up, and
 * `createdAt` is when.
 */
type RuleField = Exclude<keyof GameSettings, 'playerNames' | 'createdAt'>

const RULE_FIELDS = {
  kind: true,
  mode: true,
  players: true,
  platesPerRound: true,
  tileCopies: true,
  plateCopies: true,
  tileSlots: true,
  plateSlots: true,
  initialStems: true,
  stemsPerInternalAnchor: true,
  stemsPerExternalAnchor: true,
  strictEnclosureBonus: true,
  pointsPerInternalAnchor: true,
  pointsPerExternalAnchor: true,
  firstPassFine: true,
  placementRule: true,
  minGroupSize: true,
  groupBonuses: true,
  fineUnplaced: true,
  rewardStems: true,
  allowUndo: true,
} as const satisfies Record<RuleField, true>

/** Do these two describe the same game, whoever is playing it and whenever it was made? */
export function sameRules(a: GameSettings, b: GameSettings): boolean {
  for (const field of Object.keys(RULE_FIELDS) as RuleField[]) {
    const left: unknown = a[field]
    const right: unknown = b[field]
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right)) return false
      if (left.length !== right.length) return false
      if (left.some((entry, index) => entry !== right[index])) return false
      continue
    }
    if (left !== right) return false
  }
  return true
}

/**
 * Which preset this game is, or null for one that is nobody's.
 *
 * **Derived, never declared.** The obvious design is for the setup screen to say which card was
 * pressed and for the server to write it down — and then a client can claim a `standard` board while
 * dealing itself sixteen slots and undo, which makes the whole table decoration. There is nothing to
 * lie about here: the settings arrive validated, `presetSettings` reconstructs exactly what each
 * preset deals at that seat count, and the answer is whether they are the same game.
 *
 * A custom game dialled to match a preset exactly does match, and should: it *is* that game. What
 * "custom games do not appear" means is that a game which is not one of these games has no board.
 */
export function matchPreset(settings: GameSettings): string | null {
  const found = GAME_PRESETS.find(
    preset => sameRules(presetSettings(preset, settings.players), settings),
  )
  return found?.id ?? null
}
