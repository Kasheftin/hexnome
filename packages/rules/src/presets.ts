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
 * consumer needs it. The setup screen offers them; a table of high scores would need the same
 * definitions to say which games belong on which board, and it runs on the server. One copy, in the
 * package both already compile.
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
 * Plates per round at one, two, three and four seats.
 *
 * Shared by the two round-scoring presets because it is a fact about tables rather than about either
 * of them: more players draft from the same source, so the source has to be wider or the last player
 * of a round is choosing from leavings.
 */
const PLATES_BY_SEATS: Readonly<Record<number, Partial<GameSettings>>> = {
  1: { platesPerRound: 4 },
  2: { platesPerRound: 5 },
  3: { platesPerRound: 7 },
  4: { platesPerRound: 9 },
}

export const GAME_PRESETS: readonly GamePreset[] = [
  {
    id: 'standard',
    label: 'Standard',
    note: 'The game as it is meant to be played.',
    settings: { mode: 'classic', placementRule: 'regular', tileSlots: 12 },
    byPlayers: PLATES_BY_SEATS,
  },
  {
    id: 'quick',
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
    id: 'long',
    label: 'Long & precise',
    note: 'Six rounds, and every neighbour must match.',
    settings: { mode: 'random', placementRule: 'strict', tileSlots: 16 },
    byPlayers: PLATES_BY_SEATS,
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
