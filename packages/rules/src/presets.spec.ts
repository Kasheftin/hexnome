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
import { findPreset, GAME_PRESETS, presetPatch, presetSettings } from './presets'

/** One seat, plus every table size the menu offers. */
const SEAT_COUNTS = [SOLO, ...PLAYER_COUNT_CHOICES]

describe('game presets', () => {
  it('offers the three named games', () => {
    expect(GAME_PRESETS.map(preset => preset.id)).toEqual(['standard', 'quick', 'long'])
  })

  it('finds a preset by id, and nothing by a name that is not one', () => {
    expect(findPreset('standard')?.label).toBe('Standard')
    expect(findPreset('custom')).toBeUndefined()
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
    expect([1, 2, 3, 4].map(n => plates('standard', n))).toEqual([4, 5, 7, 9])
    expect([1, 2, 3, 4].map(n => plates('long', n))).toEqual([6, 7, 9, 11])
  })

  /*
   * Undo is declared on the long preset and is inert at a table: `canUndo` refuses whenever there is
   * more than one seat, because taking a turn back would rewind a source others have played against.
   * So the *setting* travels at every seat count, and the rules decide what it means.
   */
  it('offers the long game its undo, whoever is at the table', () => {
    for (const players of SEAT_COUNTS) {
      expect(presetSettings(findPreset('long')!, players).allowUndo).toBe(true)
    }
    expect(presetSettings(findPreset('standard')!, SOLO).allowUndo).toBe(false)
  })

  /*
   * Quick mode counts in a different currency - the number is the whole game's length rather than one
   * round's width - so it does not follow the table.
   */
  it('leaves the quick game the same length at any table', () => {
    const quick = findPreset('quick')!
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
    expect(roundsOf(presetSettings(findPreset('standard')!, SOLO).mode)).toBe(4)
    expect(roundsOf(presetSettings(findPreset('quick')!, SOLO).mode)).toBe(1)
    expect(roundsOf(presetSettings(findPreset('long')!, SOLO).mode)).toBe(6)
  })

  /* A solo preset is a singleplayer game and a table is not, without either being stated twice. */
  it('takes its kind from the seat count', () => {
    const standard = findPreset('standard')!
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
