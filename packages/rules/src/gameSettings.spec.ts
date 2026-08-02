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
  TILE_SLOT_CHOICES,
  DEFAULT_STRICT_ENCLOSURE_BONUS,
  SINGLEPLAYER_MODES,
  effectiveGroupBonuses,
  defaultGameSettings,
  parseGameSettings,
  roundsOf,
} from './gameSettings'
import { DEFAULT_PLACEMENT_RULE } from './placement'

const valid = {
  kind: 'singleplayer',
  mode: 'classic',
  platesPerRound: 5,
  tileSlots: 18,
  plateSlots: 1,
  initialStems: 2,
  stemsPerInternalAnchor: 4,
  stemsPerExternalAnchor: 1,
  placementRule: 'strict',
  strictEnclosureBonus: 0,
  minGroupSize: 4,
  // Indexed by group size, and zeroed at or below the minimum — hence the leading run of noughts.
  groupBonuses: [0, 0, 0, 0, 0, 5, 7],
  fineUnplaced: false,
  rewardStems: true,
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
    const parsed = parseGameSettings({ ...valid, seed: 'abc', players: 3 })
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

describe('the drawer\'s size', () => {
  it('falls back rather than failing on a bad count', () => {
    for (const bad of [0, 13, 24, 16.5, '16', null, undefined, NaN]) {
      expect(parseGameSettings({ ...valid, tileSlots: bad })?.tileSlots).toBe(DEFAULT_TILE_SLOTS)
      expect(parseGameSettings({ ...valid, plateSlots: bad })?.plateSlots).toBe(DEFAULT_PLATE_SLOTS)
    }
  })

  it('keeps an offered count', () => {
    expect(parseGameSettings({ ...valid, tileSlots: 12 })?.tileSlots).toBe(12)
    expect(parseGameSettings({ ...valid, plateSlots: 3 })?.plateSlots).toBe(3)
  })

  it('defaults to the drawer the game shipped with', () => {
    const fresh = defaultGameSettings(0)
    expect([fresh.tileSlots, fresh.plateSlots]).toEqual([16, 2])
  })

  /* Two rows deep, so every offered count has to divide into whole columns. */
  it('offers only even tile counts', () => {
    expect(TILE_SLOT_CHOICES.every(count => count % 2 === 0)).toBe(true)
  })
})
