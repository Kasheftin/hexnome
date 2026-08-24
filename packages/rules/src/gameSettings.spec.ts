import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PLATES_PER_ROUND,
  DEFAULT_STEM_COUNT,
  DEFAULT_STEMS_PER_EXTERNAL_ANCHOR,
  DEFAULT_STEMS_PER_INTERNAL_ANCHOR,
  DEFAULT_GROUP_BONUSES,
  DEFAULT_MIN_GROUP_SIZE,
  DEFAULT_PLATE_SLOTS,
  DEFAULT_TILE_SLOTS,
  DEFAULT_PLAYER_COUNT,
  MAX_NAME_LENGTH,
  SOLO,
  DEFAULT_TILE_COPIES,
  DEFAULT_PLATE_COPIES,
  TILE_COPIES_CHOICES,
  PLATE_COPIES_CHOICES,
  TILE_BAG_LABELS,
  PLATE_BAG_LABELS,
  TILE_SLOT_CHOICES,
  DEFAULT_STRICT_ENCLOSURE_BONUS,
  DEFAULT_FIRST_PASS_FINE,
  DEFAULT_POINTS_PER_EXTERNAL_ANCHOR,
  DEFAULT_POINTS_PER_INTERNAL_ANCHOR,
  SINGLEPLAYER_MODES,
  effectiveGroupBonuses,
  defaultGameSettings,
  parseGameSettings,
  roundsOf,
} from './gameSettings'
import { STANDARD_PLATE_COPIES, STANDARD_TILE_COPIES } from './deck'
import { DEFAULT_PLACEMENT_RULE } from './placement'

const valid = {
  kind: 'singleplayer',
  mode: 'classic',
  players: 3,
  playerNames: ['Ember', 'Flux'],
  platesPerRound: 5,
  tileCopies: 4,
  plateCopies: 2,
  tileSlots: 16,
  plateSlots: 1,
  initialStems: 2,
  stemsPerInternalAnchor: 4,
  stemsPerExternalAnchor: 1,
  placementRule: 'strict',
  strictEnclosureBonus: 0,
  pointsPerInternalAnchor: 2,
  pointsPerExternalAnchor: 1,
  firstPassFine: 2,
  minGroupSize: 4,
  // Indexed by group size, and zeroed at or below the minimum — hence the leading run of noughts.
  groupBonuses: [0, 0, 0, 0, 0, 5, 7],
  fineUnplaced: false,
  rewardStems: true,
  allowUndo: false,
  createdAt: 1_700_000_000_000,
}

describe('parsing settings that came back from storage', () => {
  it('accepts a well-formed record unchanged', () => {
    expect(parseGameSettings(valid)).toEqual(valid)
  })

  it('rejects anything that is not an object', () => {
    for (const junk of [null, undefined, 0, '', 'classic', [], true, NaN]) {
      expect(parseGameSettings(junk)).toBeNull()
    }
  })

  it('rejects an unknown kind or mode outright', () => {
    // These name what the game *is*. Substituting a default would drop the player into a
    // different game from the one they started, so the whole record is refused.
    expect(parseGameSettings({ ...valid, kind: 'co-op' })).toBeNull()
    expect(parseGameSettings({ ...valid, mode: 'blitz' })).toBeNull()
    expect(parseGameSettings({ ...valid, kind: undefined })).toBeNull()
    expect(parseGameSettings({ ...valid, mode: 42 })).toBeNull()
  })

  it('falls back rather than failing on a bad plate count', () => {
    // A dial, not an identity: worth repairing instead of discarding the game.
    for (const bad of [0, 2, 7, 4.5, -4, '4', null, undefined, NaN]) {
      const parsed = parseGameSettings({ ...valid, platesPerRound: bad })
      expect(parsed?.platesPerRound).toBe(DEFAULT_PLATES_PER_ROUND)
    }
  })

  it('falls back rather than failing on a bad stem count', () => {
    // A dial like platesPerRound, not an identity: worth repairing instead of discarding the game.
    for (const bad of [0, 5, 2.5, -1, '3', null, undefined, NaN]) {
      const parsed = parseGameSettings({ ...valid, initialStems: bad })
      expect(parsed?.initialStems).toBe(DEFAULT_STEM_COUNT)
    }
  })

  it('tolerates a missing or nonsense timestamp', () => {
    expect(parseGameSettings({ ...valid, createdAt: undefined })?.createdAt).toBe(0)
    expect(parseGameSettings({ ...valid, createdAt: Infinity })?.createdAt).toBe(0)
    expect(parseGameSettings({ ...valid, createdAt: 'yesterday' })?.createdAt).toBe(0)
  })

  it('ignores extra keys from a future or past shape', () => {
    // `seed` used to be one of these. It is a field now, so the stand-ins have to be things that
    // genuinely are not — a setting that was never added, and one that has not been yet.
    const parsed = parseGameSettings({ ...valid, players: 3, sourceLots: 9 })
    expect(parsed).toEqual(valid)
  })

  it('round-trips through JSON, which is how it is actually stored', () => {
    const parsed = parseGameSettings(JSON.parse(JSON.stringify(valid)))
    expect(parsed).toEqual(valid)
  })
})

describe('defaults', () => {
  it('start a playable singleplayer game', () => {
    const s = defaultGameSettings(123)
    expect(s.kind).toBe('singleplayer')
    expect(s.platesPerRound).toBe(DEFAULT_PLATES_PER_ROUND)
    expect(s.initialStems).toBe(DEFAULT_STEM_COUNT)
    expect(s.placementRule).toBe(DEFAULT_PLACEMENT_RULE)
    expect(s.stemsPerInternalAnchor).toBe(DEFAULT_STEMS_PER_INTERNAL_ANCHOR)
    expect(s.stemsPerExternalAnchor).toBe(DEFAULT_STEMS_PER_EXTERNAL_ANCHOR)
    expect(s.strictEnclosureBonus).toBe(DEFAULT_STRICT_ENCLOSURE_BONUS)
    expect(s.createdAt).toBe(123)
    expect(parseGameSettings(s)).toEqual(s)
  })
})

describe('rounds', () => {
  it('are defined for every mode the menu offers', () => {
    for (const mode of SINGLEPLAYER_MODES) {
      expect(roundsOf(mode.id)).toBe(mode.rounds)
      expect(mode.rounds).toBeGreaterThan(0)
    }
  })
})

describe('the placement rule is a dial, not an identity', () => {
  it('keeps a recognised value', () => {
    expect(parseGameSettings({ ...valid, placementRule: 'strict' })?.placementRule).toBe('strict')
    expect(parseGameSettings({ ...valid, placementRule: 'regular' })?.placementRule).toBe('regular')
  })

  it('falls back rather than discarding the game', () => {
    for (const bad of [undefined, null, '', 'lenient', 3, {}]) {
      const parsed = parseGameSettings({ ...valid, placementRule: bad })
      expect(parsed).not.toBeNull()
      expect(parsed?.placementRule).toBe(DEFAULT_PLACEMENT_RULE)
    }
  })

  it('gives a game saved before the setting existed the default', () => {
    const older: Record<string, unknown> = { ...valid }
    delete older.placementRule
    expect(parseGameSettings(older)?.placementRule).toBe(DEFAULT_PLACEMENT_RULE)
  })
})

describe('the stem-per-anchor rates', () => {
  it('keep a value in range', () => {
    for (const n of [1, 2, 3, 4]) {
      const parsed = parseGameSettings({ ...valid, stemsPerInternalAnchor: n, stemsPerExternalAnchor: n })
      expect(parsed?.stemsPerInternalAnchor).toBe(n)
      expect(parsed?.stemsPerExternalAnchor).toBe(n)
    }
  })

  it('fall back rather than discarding the game', () => {
    for (const bad of [undefined, null, 0, 5, -1, 2.5, '3', {}]) {
      const parsed = parseGameSettings({
        ...valid, stemsPerInternalAnchor: bad, stemsPerExternalAnchor: bad,
      })
      expect(parsed).not.toBeNull()
      expect(parsed?.stemsPerInternalAnchor).toBe(DEFAULT_STEMS_PER_INTERNAL_ANCHOR)
      expect(parsed?.stemsPerExternalAnchor).toBe(DEFAULT_STEMS_PER_EXTERNAL_ANCHOR)
    }
  })

  it('are independent of each other', () => {
    const parsed = parseGameSettings({ ...valid, stemsPerInternalAnchor: 1, stemsPerExternalAnchor: 4 })
    expect(parsed?.stemsPerInternalAnchor).toBe(1)
    expect(parsed?.stemsPerExternalAnchor).toBe(4)
  })
})

describe('the strict-enclosure bonus', () => {
  const regular = { ...valid, placementRule: 'regular' }

  it('is kept under the regular rule', () => {
    expect(parseGameSettings({ ...regular, strictEnclosureBonus: 1 })?.strictEnclosureBonus).toBe(1)
    expect(parseGameSettings({ ...regular, strictEnclosureBonus: 0 })?.strictEnclosureBonus).toBe(0)
  })

  it('is forced to zero under the strict rule, whatever was stored', () => {
    // Strict placement already guarantees a connected ring, so the bonus would be the base rate
    // under another name. Normalised on the way in rather than trusted.
    const parsed = parseGameSettings({ ...valid, placementRule: 'strict', strictEnclosureBonus: 1 })
    expect(parsed?.strictEnclosureBonus).toBe(0)
  })

  it('falls back for a value outside 0 or 1', () => {
    for (const bad of [undefined, null, 2, -1, 0.5, '1', {}]) {
      const parsed = parseGameSettings({ ...regular, strictEnclosureBonus: bad })
      expect(parsed?.strictEnclosureBonus).toBe(DEFAULT_STRICT_ENCLOSURE_BONUS)
    }
  })

  it('defaults on for a game saved before the setting existed', () => {
    const older: Record<string, unknown> = { ...regular }
    delete older.strictEnclosureBonus
    expect(parseGameSettings(older)?.strictEnclosureBonus).toBe(DEFAULT_STRICT_ENCLOSURE_BONUS)
  })
})

describe('the round anchor points', () => {
  it('keeps every offered rate', () => {
    for (const points of [0, 1, 2]) {
      const parsed = parseGameSettings({
        ...valid,
        pointsPerInternalAnchor: points,
        pointsPerExternalAnchor: points,
      })
      expect(parsed?.pointsPerInternalAnchor).toBe(points)
      expect(parsed?.pointsPerExternalAnchor).toBe(points)
    }
  })

  it('falls back for a value that is not on offer', () => {
    for (const bad of [undefined, null, 3, -1, 0.5, '1', {}]) {
      const parsed = parseGameSettings({
        ...valid,
        pointsPerInternalAnchor: bad,
        pointsPerExternalAnchor: bad,
      })
      expect(parsed?.pointsPerInternalAnchor).toBe(DEFAULT_POINTS_PER_INTERNAL_ANCHOR)
      expect(parsed?.pointsPerExternalAnchor).toBe(DEFAULT_POINTS_PER_EXTERNAL_ANCHOR)
    }
  })

  it('defaults for a game saved before the setting existed', () => {
    const older: Record<string, unknown> = { ...valid }
    delete older.pointsPerInternalAnchor
    delete older.pointsPerExternalAnchor
    expect(parseGameSettings(older)?.pointsPerInternalAnchor)
      .toBe(DEFAULT_POINTS_PER_INTERNAL_ANCHOR)
    expect(parseGameSettings(older)?.pointsPerExternalAnchor)
      .toBe(DEFAULT_POINTS_PER_EXTERNAL_ANCHOR)
  })

  /* An external anchor is a by-product of loose placement, not something to chase by default. */
  it('pays for an internal anchor and not an external one by default', () => {
    expect(DEFAULT_POINTS_PER_INTERNAL_ANCHOR).toBe(1)
    expect(DEFAULT_POINTS_PER_EXTERNAL_ANCHOR).toBe(0)
  })
})

describe('the first-pass fine', () => {
  it('is kept at a table', () => {
    for (const fine of [0, 1, 2]) {
      expect(parseGameSettings({ ...valid, players: 3, firstPassFine: fine })?.firstPassFine).toBe(fine)
    }
  })

  it('is forced to zero in a solo game, whatever was stored', () => {
    // With one seat every pass is the first one, so the fine would be a charge for finishing a round
    // and the turn order it buys means nothing. Normalised on the way in rather than trusted.
    const parsed = parseGameSettings({ ...valid, players: SOLO, firstPassFine: 2 })
    expect(parsed?.firstPassFine).toBe(0)
  })

  it('falls back for a value that is not on offer', () => {
    for (const bad of [undefined, null, 3, -1, 0.5, '1', {}]) {
      const parsed = parseGameSettings({ ...valid, players: 3, firstPassFine: bad })
      expect(parsed?.firstPassFine).toBe(DEFAULT_FIRST_PASS_FINE)
    }
  })

  it('defaults for a game saved before the setting existed', () => {
    const older: Record<string, unknown> = { ...valid, players: 3 }
    delete older.firstPassFine
    expect(parseGameSettings(older)?.firstPassFine).toBe(DEFAULT_FIRST_PASS_FINE)
  })
})

describe('the final-score dials', () => {
  it('falls back rather than failing on a bad minimum', () => {
    for (const bad of [1, 5, 3.5, -3, '3', null, undefined, NaN]) {
      expect(parseGameSettings({ ...valid, minGroupSize: bad })?.minGroupSize)
        .toBe(DEFAULT_MIN_GROUP_SIZE)
    }
  })

  /*
   * All or nothing. A half-repaired table is a scoring rule nobody chose, and the player would have
   * no way to see which entries had been quietly rewritten.
   */
  it('replaces a malformed bonus table entirely rather than patching it', () => {
    for (const bad of [[], [1, 2], 'six', null, [0, 0, 0, 0, 0, 0, 99], { 6: 6 }]) {
      expect(parseGameSettings({ ...valid, groupBonuses: bad })?.groupBonuses)
        .toEqual(effectiveGroupBonuses(valid.minGroupSize, DEFAULT_GROUP_BONUSES))
    }
  })

  it('zeroes any bonus at or below the minimum on the way in', () => {
    const parsed = parseGameSettings({
      ...valid,
      minGroupSize: 4,
      groupBonuses: [0, 0, 9, 9, 9, 5, 7],
    })
    // Sizes 2, 3 and 4 cannot earn a bonus when 4 is the baseline that scores.
    expect(parsed?.groupBonuses).toEqual([0, 0, 0, 0, 0, 5, 7])
  })

  it('defaults to paying only for a full group', () => {
    const fresh = defaultGameSettings(0)
    expect(fresh.minGroupSize).toBe(3)
    expect(fresh.groupBonuses).toEqual([0, 0, 0, 0, 0, 0, 6])
  })
})

describe('effectiveGroupBonuses', () => {
  it('keeps everything above the minimum', () => {
    expect(effectiveGroupBonuses(3, [0, 0, 0, 0, 3, 5, 7])).toEqual([0, 0, 0, 0, 3, 5, 7])
  })

  it('clears the minimum itself, which is the baseline rather than an achievement', () => {
    expect(effectiveGroupBonuses(4, [0, 0, 0, 0, 3, 5, 7])).toEqual([0, 0, 0, 0, 0, 5, 7])
  })
})

describe('the end-of-game switches', () => {
  /*
   * Both are on by default, so anything that is not an explicit `false` leaves them on — a blob
   * written before they existed should play the way a new game does rather than quietly lose them.
   */
  it('stays on for a record that predates them', () => {
    const older: Record<string, unknown> = { ...valid }
    delete older.fineUnplaced
    delete older.rewardStems
    const parsed = parseGameSettings(older)
    expect(parsed?.fineUnplaced).toBe(true)
    expect(parsed?.rewardStems).toBe(true)
  })

  it('honours an explicit false', () => {
    const parsed = parseGameSettings({ ...valid, fineUnplaced: false, rewardStems: false })
    expect([parsed?.fineUnplaced, parsed?.rewardStems]).toEqual([false, false])
  })

  it('treats junk as on rather than discarding the game', () => {
    for (const junk of [0, 'no', null, undefined, NaN]) {
      expect(parseGameSettings({ ...valid, rewardStems: junk })?.rewardStems).toBe(true)
    }
  })

  it('defaults both on for a fresh game', () => {
    const fresh = defaultGameSettings(0)
    expect([fresh.fineUnplaced, fresh.rewardStems]).toEqual([true, true])
  })
})

describe('undo, which defaults the other way', () => {
  /*
   * The two switches above are on unless turned off, so a record written before they existed keeps
   * playing the real game. Undo is the opposite: a record that never mentioned it must not acquire it,
   * because it changes what a turn is rather than how one scores.
   */
  it('stays off for a record that predates it', () => {
    const older: Record<string, unknown> = { ...valid }
    delete older.allowUndo
    expect(parseGameSettings(older)?.allowUndo).toBe(false)
  })

  it('is off for a fresh game', () => {
    expect(defaultGameSettings(0).allowUndo).toBe(false)
  })

  it('needs an explicit true, and takes nothing else for one', () => {
    expect(parseGameSettings({ ...valid, allowUndo: true })?.allowUndo).toBe(true)
    for (const junk of [1, 'yes', 'true', {}, [], null, undefined, NaN]) {
      expect(parseGameSettings({ ...valid, allowUndo: junk })?.allowUndo).toBe(false)
    }
  })
})

describe('the drawer\'s size', () => {
  it('falls back rather than failing on a bad count', () => {
    // 18 is in the list because it *used* to be offered: a stored game from then is not a licence.
    for (const bad of [0, 13, 18, 24, 16.5, '16', null, undefined, NaN]) {
      expect(parseGameSettings({ ...valid, tileSlots: bad })?.tileSlots).toBe(DEFAULT_TILE_SLOTS)
      expect(parseGameSettings({ ...valid, plateSlots: bad })?.plateSlots).toBe(DEFAULT_PLATE_SLOTS)
    }
  })

  it('keeps an offered count', () => {
    // Both offered and *not* the default, so a silent fallback would still fail this.
    expect(parseGameSettings({ ...valid, tileSlots: 10 })?.tileSlots).toBe(10)
    expect(parseGameSettings({ ...valid, plateSlots: 3 })?.plateSlots).toBe(3)
  })

  it('defaults to the drawer the game shipped with', () => {
    const fresh = defaultGameSettings(0)
    expect([fresh.tileSlots, fresh.plateSlots]).toEqual([12, 2])
  })

  /* Two rows deep, so every offered count has to divide into whole columns. */
  it('offers only even tile counts', () => {
    expect(TILE_SLOT_CHOICES.every(count => count % 2 === 0)).toBe(true)
  })
})

describe('who is at the table', () => {
  it('keeps an offered count', () => {
    for (const players of [2, 3, 4]) {
      expect(parseGameSettings({ ...valid, players })?.players).toBe(players)
    }
    expect(parseGameSettings({ ...valid, players: SOLO })?.players).toBe(SOLO)
  })

  /*
   * The fallback follows the *kind* rather than taking a default of its own. A game saved before this
   * existed was a solo game, and seating two at it would be a different game rather than a repaired
   * one.
   */
  it('falls back to what the kind implies', () => {
    const { players, ...without } = valid
    void players
    expect(parseGameSettings({ ...without, kind: 'singleplayer' })?.players).toBe(SOLO)
    expect(parseGameSettings({ ...without, kind: 'multiplayer' })?.players)
      .toBe(DEFAULT_PLAYER_COUNT)
    for (const bad of [0, 5, 2.5, '2', null]) {
      expect(parseGameSettings({ ...valid, kind: 'singleplayer', players: bad })?.players).toBe(SOLO)
    }
  })

  it('keeps the names it was given, trimmed', () => {
    const parsed = parseGameSettings({ ...valid, players: 3, playerNames: ['  Ember ', 'Flux'] })
    expect(parsed?.playerNames).toEqual(['Ember', 'Flux'])
  })

  /* All or nothing, like the bonus table: a half-repaired list seats someone under a name nobody
   * chose, and gives them no way to see it happened. */
  it('drops a list it cannot read rather than patching it', () => {
    for (const bad of [['a', 2], 'Ember', { 0: 'Ember' }, null]) {
      expect(parseGameSettings({ ...valid, playerNames: bad })?.playerNames).toEqual([])
    }
    // More names than seats is not a shorter table, it is a list from a different game.
    expect(parseGameSettings({ ...valid, players: 2, playerNames: ['a', 'b', 'c'] })?.playerNames)
      .toEqual([])
  })

  it('bounds a name the way the field does', () => {
    const parsed = parseGameSettings({ ...valid, playerNames: ['x'.repeat(60)] })
    expect(parsed?.playerNames[0]).toHaveLength(MAX_NAME_LENGTH)
  })
})

describe('the seed a game is dealt from', () => {
  /**
   * It is not a setting, and reading one out of a stored blob must not resurrect it.
   *
   * A game has two seeds and neither belongs here: the desks are built from the server's, which no
   * client ever sees, and the opening plates from the game's id, which both ends already share. A
   * third copy in the settings is the one that would go stale.
   */
  it('is not one of them, however hard a stored blob insists', () => {
    const parsed = parseGameSettings({ ...valid, seed: 'from-an-older-build' })
    expect(parsed).not.toBeNull()
    expect(parsed).not.toHaveProperty('seed')
  })
})

describe('how much material the game is dealt from', () => {
  it('falls back rather than failing on a bad count', () => {
    for (const bad of [0, 5, 2.5, '3', null, undefined, NaN]) {
      expect(parseGameSettings({ ...valid, tileCopies: bad })?.tileCopies)
        .toBe(DEFAULT_TILE_COPIES)
      expect(parseGameSettings({ ...valid, plateCopies: bad })?.plateCopies)
        .toBe(DEFAULT_PLATE_COPIES)
    }
  })

  it('keeps an offered count', () => {
    // Both offered and *not* the default, so a silent fallback would still fail this.
    expect(parseGameSettings({ ...valid, tileCopies: 2 })?.tileCopies).toBe(2)
    expect(parseGameSettings({ ...valid, plateCopies: 3 })?.plateCopies).toBe(3)
  })

  it('defaults to the bags the game shipped with', () => {
    const fresh = defaultGameSettings(0)
    expect([fresh.tileCopies, fresh.plateCopies]).toEqual([3, 1])
  })

  /*
   * The menu shows totals while the setting holds copies, so these two lists are the translation
   * between them. A wrong entry here is a panel that reports a bag size the game is not playing with
   * — invisible, since nothing counts the tiles on screen.
   */
  it('labels every choice with the bag size it actually means', () => {
    expect(TILE_BAG_LABELS).toEqual(['72', '108', '144'])
    expect(PLATE_BAG_LABELS).toEqual(['36', '72', '108'])

    expect(TILE_BAG_LABELS).toHaveLength(TILE_COPIES_CHOICES.length)
    expect(PLATE_BAG_LABELS).toHaveLength(PLATE_COPIES_CHOICES.length)
    for (const [index, copies] of TILE_COPIES_CHOICES.entries()) {
      expect(TILE_BAG_LABELS[index]).toBe(String(copies * 36))
    }
    for (const [index, copies] of PLATE_COPIES_CHOICES.entries()) {
      expect(PLATE_BAG_LABELS[index]).toBe(String(copies * 36))
    }
  })

  /* The default has to be the standard bag, or a fresh game is not the game the rules describe. */
  it('takes its defaults from the deck itself', () => {
    expect([DEFAULT_TILE_COPIES, DEFAULT_PLATE_COPIES])
      .toEqual([STANDARD_TILE_COPIES, STANDARD_PLATE_COPIES])
  })
})
