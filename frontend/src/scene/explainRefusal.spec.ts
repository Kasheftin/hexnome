import { describe, expect, it } from 'vitest'
import type { TileRefusal } from '@hexnome/rules/tableau'
import { describeTileRefusal, tileName } from './explainRefusal'

/**
 * The sentence a refused drop prints.
 *
 * Worth pinning because it is the whole point of the feature: a message that named the wrong rule, or
 * the wrong tile, would send someone looking in the wrong place — which is worse than the red
 * highlight it replaces.
 */

const green3 = { color: 2, value: 3 }
const blue3 = { color: 3, value: 3 }
const cell = { q: 0, r: 0 }

describe('naming a tile', () => {
  it('uses the palette, so it can be checked against the screen', () => {
    expect(tileName(green3)).toBe('Green-3')
    expect(tileName({ color: 0, value: 6 })).toBe('Orange-6')
  })

  it('says something rather than nothing for a colour off the end of the palette', () => {
    expect(tileName({ color: 99, value: 1 })).toBe('colour 99-1')
  })
})

describe('the sentence', () => {
  it('spells out a reward that will not fit, with the arithmetic', () => {
    const refusal: TileRefusal = { kind: 'rewardWontFit', stems: 3, freeSlots: 0, emptying: 1 }
    const said = describeTileRefusal(refusal)
    expect(said).toContain('3 stems')
    expect(said).toContain('room for 1')
    expect(said).toContain('1 this turn empties')
  })

  /* The tile's own slot and its payment both count, so the sentence has to be able to say "2". */
  it('counts every slot the turn frees, not only the tile´s own', () => {
    const said = describeTileRefusal({ kind: 'rewardWontFit', stems: 5, freeSlots: 1, emptying: 2 })
    expect(said).toContain('room for 3')
    expect(said).toContain('1 free, plus 2 this turn empties')
  })

  it('drops the parenthetical when the turn frees nothing', () => {
    const said = describeTileRefusal({ kind: 'rewardWontFit', stems: 2, freeSlots: 1, emptying: 0 })
    expect(said).toContain('2 stems')
    expect(said).not.toContain('empties')
  })

  it('lists what a tile was asked to agree with', () => {
    const said = describeTileRefusal({
      kind: 'neighboursDisagree',
      rule: 'regular',
      cell,
      spec: green3,
      neighbours: [blue3],
      disagreeing: [blue3],
    })
    expect(said).toContain('Green-3')
    expect(said).toContain('Blue-3')
  })

  /* Under strict the objection is to specific neighbours, so those are what it names. */
  it('names the offenders under the strict rule', () => {
    const said = describeTileRefusal({
      kind: 'neighboursDisagree',
      rule: 'strict',
      cell,
      spec: green3,
      neighbours: [blue3, { color: 5, value: 1 }],
      disagreeing: [{ color: 5, value: 1 }],
    })
    expect(said).toContain('strict')
    expect(said).toContain('Magenta-1')
    expect(said).not.toContain('Blue-3')
  })

  it('names the duplicated kind and the group it would land in', () => {
    const said = describeTileRefusal({
      kind: 'duplicateInGroup',
      cell,
      spec: { color: 2, value: 4 },
      clash: {
        axis: 'color',
        duplicate: { color: 2, value: 1 },
        group: [{ color: 2, value: 4 }, { color: 2, value: 1 }, { color: 2, value: 1 }],
      },
    })
    expect(said).toContain('two Green-1s')
    expect(said).toContain('colour group')
    expect(said).toContain('Green-4, Green-1, Green-1')
  })

  it('covers the dull ones too', () => {
    expect(describeTileRefusal({ kind: 'noSuchPlace', where: { kind: 'drawer', slot: 99 } }))
      .toContain('no drawer slot')
    expect(describeTileRefusal({ kind: 'occupied', where: { kind: 'drawer', slot: 1 }, by: 't1' }))
      .toContain('already')
  })
})
