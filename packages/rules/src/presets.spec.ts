/**
 * A preset must get the game it asks for.
 *
 * The whole risk in this file is silent repair. Settings pass through `parseGameSettings` on the way
 * to a game, and it does not refuse a value it cannot use — it substitutes one, which is right for a
 * blob out of storage and wrong for a card in a menu. A preset naming seven plates in a mode that
 * offers eight to twenty would be quietly dealt twelve, and the only symptom would be a game that did
 * not match its own description.
 *
 * So the central test compares what a preset *declares* against what it *becomes*, field by field,
 * at every seat count it can be played at.
 */
import { describe, expect, it } from 'vitest'
import { PLAYER_COUNT_CHOICES, platesPerRoundChoices, roundsOf, SOLO } from './gameSettings'
import { findPreset, GAME_PRESETS, presetPatch, presetSettings, type GamePreset } from './presets'

/** One seat, plus every table size the menu offers. */
const SEAT_COUNTS = [SOLO, ...PLAYER_COUNT_CHOICES]

describe('game presets', () => {
  it('offers the three named games', () => {
    expect(GAME_PRESETS.map(preset => preset.id)).toEqual(['standard-2', 'quick-2', 'long-2'])
  })

  it('finds a preset by id, and nothing by a name that is not one', () => {
    expect(findPreset('standard-2')?.label).toBe('Standard')
    // The old ids are gone, which is what a retune is meant to do to a board.
    expect(findPreset('custom')).toBeUndefined()
    expect(findPreset('standard')).toBeUndefined()
  })

  /*
   * The one that matters. Every value a preset states has to survive the parser unchanged, or the
   * card is describing a game nobody is going to be dealt.
   *
   * It covers the collapses too, by construction: a preset that declared `firstPassFine` would fail
   * here at one seat, where the rules zero it. That is the correct outcome - declaring it would be a
   * lie at a table of one - and the failure names the field.
   */
  it('gets exactly the game it declares, at every seat count', () => {
    for (const preset of GAME_PRESETS) {
      for (const players of SEAT_COUNTS) {
        const declared = presetPatch(preset, players)
        const actual = presetSettings(preset, players) as unknown as Record<string, unknown>
        for (const [key, value] of Object.entries(declared)) {
          expect(`${preset.id}/${players}/${key}=${JSON.stringify(actual[key])}`)
            .toBe(`${preset.id}/${players}/${key}=${JSON.stringify(value)}`)
        }
      }
    }
  })

  /*
   * The plate count is the reason `byPlayers` exists, so state both tables outright.
   *
   * One progression, two starting points: a seat adds 0, 1, 3, 5 to whatever the preset opens on.
   * Standard opens at four; Long & precise wants more choice in front of it from the start, and opens
   * at six — which is what puts eleven at the top of the dial's range.
   */
  it('widens the source as the table fills', () => {
    const plates = (id: string, players: number) => presetSettings(findPreset(id)!, players).platesPerRound
    expect([1, 2, 3, 4].map(n => plates('standard-2', n))).toEqual([4, 5, 7, 9])
    expect([1, 2, 3, 4].map(n => plates('long-2', n))).toEqual([6, 7, 9, 11])
  })

  /*
   * Every named game offers undo, and it is inert at a table: `canUndo` refuses whenever there is more
   * than one seat, because taking a turn back would rewind a source others have played against. So the
   * *setting* travels at every seat count and the rules decide what it means.
   *
   * Long & precise says so outright; the other two get it from the default. Both are worth asserting,
   * because a board is only comparable while every game on it could take a move back.
   */
  it('lets a solo player take a move back, in every named game', () => {
    for (const preset of GAME_PRESETS) {
      for (const players of SEAT_COUNTS) {
        expect(`${preset.id}/${players}`)
          .toBe(presetSettings(preset, players).allowUndo ? `${preset.id}/${players}` : 'no undo')
      }
    }
  })

  /*
   * Quick mode counts in a different currency - the number is the whole game's length rather than one
   * round's width - so it does not follow the table.
   */
  it('leaves the quick game the same length at any table', () => {
    const quick = findPreset('quick-2')!
    expect(SEAT_COUNTS.map(n => presetSettings(quick, n).platesPerRound)).toEqual([12, 12, 12, 12])
  })

  it('names a plate count its own mode offers', () => {
    for (const preset of GAME_PRESETS) {
      for (const players of SEAT_COUNTS) {
        const settings = presetSettings(preset, players)
        expect(platesPerRoundChoices(settings.mode)).toContain(settings.platesPerRound)
      }
    }
  })

  it('runs the number of rounds its mode says', () => {
    expect(roundsOf(presetSettings(findPreset('standard-2')!, SOLO).mode)).toBe(4)
    expect(roundsOf(presetSettings(findPreset('quick-2')!, SOLO).mode)).toBe(1)
    expect(roundsOf(presetSettings(findPreset('long-2')!, SOLO).mode)).toBe(6)
  })

  /* A solo preset is a singleplayer game and a table is not, without either being stated twice. */
  it('takes its kind from the seat count', () => {
    const standard = findPreset('standard-2')!
    expect(presetSettings(standard, SOLO).kind).toBe('singleplayer')
    expect(presetSettings(standard, 3).kind).toBe('multiplayer')
    expect(presetSettings(standard, 3).players).toBe(3)
  })

  /* Twice through, same game. Nothing here may depend on when it was called. */
  it('is the same settings every time it is asked', () => {
    for (const preset of GAME_PRESETS) {
      expect(presetSettings(preset, 2)).toEqual(presetSettings(preset, 2))
    }
  })
})

/**
 * What each ruleset deals, pinned.
 *
 * The tripwire the header of `presets.ts` promises and this suite did not have: a preset id names a
 * *ruleset*, a finished game records which id it matched, and a board is every game carrying that id.
 * Change what an id deals and the board goes on comparing games that are no longer the same game —
 * silently, because nothing about a stored row looks wrong.
 *
 * So editing a preset fails here, and the diff names the field. **The fix is never to update these
 * strings in place.** Mint a new id, let the old board stop filling, and add its line below — which is
 * what the `-2` on all three is: undo became a default, a solo game got materially easier, and the
 * boards those ids named started again.
 *
 * Verbose on purpose. A digest would be a third of the size and would only ever say "something moved".
 */
const DEALS: Readonly<Record<string, string>> = {
  'standard-2/1':
    'allowUndo=true fineUnplaced=true firstPassFine=0 groupBonuses=[0,0,0,0,0,0,6] initialStems=3 kind="singleplayer" minGroupSize=3 mode="classic" placementRule="regular" plateCopies=1 plateSlots=2 platesPerRound=4 players=1 pointsPerExternalAnchor=0 pointsPerInternalAnchor=1 rewardStems=true stemsPerExternalAnchor=2 stemsPerInternalAnchor=3 strictEnclosureBonus=1 tileCopies=3 tileSlots=12',
  'standard-2/2':
    'allowUndo=true fineUnplaced=true firstPassFine=0 groupBonuses=[0,0,0,0,0,0,6] initialStems=3 kind="multiplayer" minGroupSize=3 mode="classic" placementRule="regular" plateCopies=1 plateSlots=2 platesPerRound=5 players=2 pointsPerExternalAnchor=0 pointsPerInternalAnchor=1 rewardStems=true stemsPerExternalAnchor=2 stemsPerInternalAnchor=3 strictEnclosureBonus=1 tileCopies=3 tileSlots=12',
  'standard-2/3':
    'allowUndo=true fineUnplaced=true firstPassFine=0 groupBonuses=[0,0,0,0,0,0,6] initialStems=3 kind="multiplayer" minGroupSize=3 mode="classic" placementRule="regular" plateCopies=1 plateSlots=2 platesPerRound=7 players=3 pointsPerExternalAnchor=0 pointsPerInternalAnchor=1 rewardStems=true stemsPerExternalAnchor=2 stemsPerInternalAnchor=3 strictEnclosureBonus=1 tileCopies=3 tileSlots=12',
  'standard-2/4':
    'allowUndo=true fineUnplaced=true firstPassFine=0 groupBonuses=[0,0,0,0,0,0,6] initialStems=3 kind="multiplayer" minGroupSize=3 mode="classic" placementRule="regular" plateCopies=1 plateSlots=2 platesPerRound=9 players=4 pointsPerExternalAnchor=0 pointsPerInternalAnchor=1 rewardStems=true stemsPerExternalAnchor=2 stemsPerInternalAnchor=3 strictEnclosureBonus=1 tileCopies=3 tileSlots=12',
  'quick-2/1':
    'allowUndo=true fineUnplaced=true firstPassFine=0 groupBonuses=[0,0,0,0,0,0,6] initialStems=3 kind="singleplayer" minGroupSize=3 mode="quick" placementRule="regular" plateCopies=1 plateSlots=2 platesPerRound=12 players=1 pointsPerExternalAnchor=0 pointsPerInternalAnchor=1 rewardStems=true stemsPerExternalAnchor=2 stemsPerInternalAnchor=3 strictEnclosureBonus=1 tileCopies=3 tileSlots=12',
  'quick-2/2':
    'allowUndo=true fineUnplaced=true firstPassFine=0 groupBonuses=[0,0,0,0,0,0,6] initialStems=3 kind="multiplayer" minGroupSize=3 mode="quick" placementRule="regular" plateCopies=1 plateSlots=2 platesPerRound=12 players=2 pointsPerExternalAnchor=0 pointsPerInternalAnchor=1 rewardStems=true stemsPerExternalAnchor=2 stemsPerInternalAnchor=3 strictEnclosureBonus=1 tileCopies=3 tileSlots=12',
  'quick-2/3':
    'allowUndo=true fineUnplaced=true firstPassFine=0 groupBonuses=[0,0,0,0,0,0,6] initialStems=3 kind="multiplayer" minGroupSize=3 mode="quick" placementRule="regular" plateCopies=1 plateSlots=2 platesPerRound=12 players=3 pointsPerExternalAnchor=0 pointsPerInternalAnchor=1 rewardStems=true stemsPerExternalAnchor=2 stemsPerInternalAnchor=3 strictEnclosureBonus=1 tileCopies=3 tileSlots=12',
  'quick-2/4':
    'allowUndo=true fineUnplaced=true firstPassFine=0 groupBonuses=[0,0,0,0,0,0,6] initialStems=3 kind="multiplayer" minGroupSize=3 mode="quick" placementRule="regular" plateCopies=1 plateSlots=2 platesPerRound=12 players=4 pointsPerExternalAnchor=0 pointsPerInternalAnchor=1 rewardStems=true stemsPerExternalAnchor=2 stemsPerInternalAnchor=3 strictEnclosureBonus=1 tileCopies=3 tileSlots=12',
  'long-2/1':
    'allowUndo=true fineUnplaced=true firstPassFine=0 groupBonuses=[0,0,0,0,0,0,6] initialStems=3 kind="singleplayer" minGroupSize=3 mode="random" placementRule="strict" plateCopies=1 plateSlots=2 platesPerRound=6 players=1 pointsPerExternalAnchor=0 pointsPerInternalAnchor=1 rewardStems=true stemsPerExternalAnchor=2 stemsPerInternalAnchor=3 strictEnclosureBonus=1 tileCopies=3 tileSlots=16',
  'long-2/2':
    'allowUndo=true fineUnplaced=true firstPassFine=0 groupBonuses=[0,0,0,0,0,0,6] initialStems=3 kind="multiplayer" minGroupSize=3 mode="random" placementRule="strict" plateCopies=1 plateSlots=2 platesPerRound=7 players=2 pointsPerExternalAnchor=0 pointsPerInternalAnchor=1 rewardStems=true stemsPerExternalAnchor=2 stemsPerInternalAnchor=3 strictEnclosureBonus=1 tileCopies=3 tileSlots=16',
  'long-2/3':
    'allowUndo=true fineUnplaced=true firstPassFine=0 groupBonuses=[0,0,0,0,0,0,6] initialStems=3 kind="multiplayer" minGroupSize=3 mode="random" placementRule="strict" plateCopies=1 plateSlots=2 platesPerRound=9 players=3 pointsPerExternalAnchor=0 pointsPerInternalAnchor=1 rewardStems=true stemsPerExternalAnchor=2 stemsPerInternalAnchor=3 strictEnclosureBonus=1 tileCopies=3 tileSlots=16',
  'long-2/4':
    'allowUndo=true fineUnplaced=true firstPassFine=0 groupBonuses=[0,0,0,0,0,0,6] initialStems=3 kind="multiplayer" minGroupSize=3 mode="random" placementRule="strict" plateCopies=1 plateSlots=2 platesPerRound=11 players=4 pointsPerExternalAnchor=0 pointsPerInternalAnchor=1 rewardStems=true stemsPerExternalAnchor=2 stemsPerInternalAnchor=3 strictEnclosureBonus=1 tileCopies=3 tileSlots=16',
}

describe('what each ruleset deals', () => {
  it('has not changed under the boards that record it', () => {
    for (const preset of GAME_PRESETS) {
      for (const players of SEAT_COUNTS) {
        const key = `${preset.id}/${players}`
        expect(`${key} ${fingerprint(preset, players)}`).toBe(`${key} ${DEALS[key] ?? 'unpinned'}`)
      }
    }
  })

  /* Every offered ruleset is pinned, so adding a preset cannot quietly skip the check above. */
  it('pins every ruleset on offer', () => {
    const wanted = GAME_PRESETS.flatMap(p => SEAT_COUNTS.map(n => `${p.id}/${n}`))
    expect(Object.keys(DEALS).sort()).toEqual(wanted.sort())
  })
})

/** Every rule-bearing field, in a stable order — the two that are not rules left out. */
function fingerprint(preset: GamePreset, players: number): string {
  return Object.entries(presetSettings(preset, players))
    .filter(([key]) => key !== 'playerNames' && key !== 'createdAt')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' ')
}
