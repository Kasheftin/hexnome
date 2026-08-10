import { describe, expect, it } from 'vitest'
import { hexRectangle } from './hex'
import { createTableau, type TableauOptions, type TileLocation } from './tableau'

/**
 * Why a placement was refused.
 *
 * The board says no with one red highlight whatever the reason, so a report of "this move should be
 * legal" is unanswerable without reading the model. These tests are about the *explanation* — that it
 * names the right rule and carries enough to act on.
 *
 * `canPlaceTile` is defined as `whyNotPlaceTile` returning null, so the two agreeing is a fact about
 * the code rather than something to test. What is worth testing is that each reason is reachable and
 * says what it means.
 */

function tableau(options: Partial<TableauOptions> = {}) {
  return createTableau({
    cells: hexRectangle(6, 6),
    drawerSlots: 16,
    plateSlots: 2,
    ...options,
  })
}

const onPetal = (plateId: string, petal: number): TileLocation =>
  ({ kind: 'onPlate', plateId, petal })

/*
 * Palette indices, so the scenarios read like the screen: see scene/constants.ts. The rules know a
 * colour only as a number, which is exactly why the console output translates them.
 */
const GREEN = 2
const BLUE = 3
const MAGENTA = 5

const green = (value: number) => ({ color: GREEN, value })
const blue = (value: number) => ({ color: BLUE, value })

/**
 * The reported scenario: an empty cell with a green-1 on one side and a blue-3 on the other.
 *
 * Consecutive petals of one plate are adjacent around its ring, so petals 0 and 2 are the two sides
 * of petal 1.
 */
function twoSided() {
  const t = tableau()
  const plate = t.addPlate({ kind: 'board', hole: { q: 0, r: 0 } })!
  t.addTile(green(1), onPetal(plate.id, 0))
  t.addTile(blue(3), onPetal(plate.id, 2))
  return { t, plate }
}

describe('the two-sided cell from the bug report', () => {
  /* Agrees with the green by colour and with the blue by value: allowed, and doubly so. */
  it('takes a tile that matches both neighbours', () => {
    const { t, plate } = twoSided()
    const tile = t.addTile(green(3), { kind: 'drawer', slot: 0 })!
    expect(t.whyNotPlaceTile(onPetal(plate.id, 1), tile.id)).toBeNull()
  })

  it('takes a tile that matches only one of them', () => {
    const { t, plate } = twoSided()
    const tile = t.addTile(green(5), { kind: 'drawer', slot: 0 })!
    expect(t.whyNotPlaceTile(onPetal(plate.id, 1), tile.id)).toBeNull()
  })

  it('refuses one that matches neither, and says which neighbours it asked', () => {
    const { t, plate } = twoSided()
    const tile = t.addTile({ color: MAGENTA, value: 5 }, { kind: 'drawer', slot: 0 })!
    const refusal = t.whyNotPlaceTile(onPetal(plate.id, 1), tile.id)

    expect(refusal).toMatchObject({ kind: 'neighboursDisagree', rule: 'regular' })
    expect(refusal?.kind === 'neighboursDisagree' && refusal.neighbours).toHaveLength(2)
    expect(refusal?.kind === 'neighboursDisagree' && refusal.disagreeing).toHaveLength(2)
  })
})

describe('a group that would hold the same tile twice', () => {
  /*
   * The bridging case from the rules: neither of the two green-1s is beside the other, so both are
   * legal until something joins them into one colour group.
   */
  it('names the duplicate and the group it lands in', () => {
    const t = tableau()
    const plate = t.addPlate({ kind: 'board', hole: { q: 0, r: 0 } })!
    t.addTile(green(1), onPetal(plate.id, 0))
    t.addTile(green(1), onPetal(plate.id, 2))
    const tile = t.addTile(green(4), { kind: 'drawer', slot: 0 })!

    const refusal = t.whyNotPlaceTile(onPetal(plate.id, 1), tile.id)
    expect(refusal).toMatchObject({
      kind: 'duplicateInGroup',
      clash: { axis: 'color', duplicate: { color: GREEN, value: 1 } },
    })
    // Green-4 bridging two green-1s: three tiles in the group, one kind twice.
    expect(refusal?.kind === 'duplicateInGroup' && refusal.clash.group).toHaveLength(3)
  })
})

/**
 * The refusal that looks like a bug in the placement rules and is not.
 *
 * Stems live in drawer slots, so a placement paying more than the drawer can hold is refused rather
 * than losing them. Nothing on screen connects a full drawer to a red cell, which is what makes this
 * the reason most worth reporting by name.
 */
describe('a reward with nowhere to go', () => {
  /** Five petals filled and the sixth tile waiting in the drawer: placing it encloses the plate. */
  function aboutToEnclose(drawerSlots: number) {
    const t = tableau({ drawerSlots, stemsPerInternalAnchor: 3 })
    const plate = t.addPlate({ kind: 'board', hole: { q: 0, r: 0 } })!
    // Every petal a different value of one colour, so nothing collides and everything agrees.
    for (let petal = 0; petal < 5; petal++) t.addTile(green(petal + 1), onPetal(plate.id, petal))
    const tile = t.addTile(green(6), { kind: 'drawer', slot: 0 })!
    return { t, plate, tile }
  }

  it('lets the placement through when the stems fit', () => {
    const { t, plate, tile } = aboutToEnclose(16)
    expect(t.whyNotPlaceTile(onPetal(plate.id, 5), tile.id)).toBeNull()
  })

  it('refuses it when they do not, and says how short the drawer is', () => {
    // One slot, holding the tile itself: it frees that one slot, and three stems need three. Nothing
    // else is in the drawer, so the payment has nothing to spend out of it and frees nothing more.
    const { t, plate, tile } = aboutToEnclose(1)
    const refusal = t.whyNotPlaceTile(onPetal(plate.id, 5), tile.id)

    expect(refusal).toMatchObject({ kind: 'rewardWontFit', stems: 3, freeSlots: 0, emptying: 1 })
  })

  /* The rule the placement rules would have allowed: nothing here is about neighbours or groups. */
  it('is not a placement-rule refusal in disguise', () => {
    const { t, plate, tile } = aboutToEnclose(1)
    const roomy = aboutToEnclose(16)
    expect(roomy.t.whyNotPlaceTile(onPetal(roomy.plate.id, 5), roomy.tile.id)).toBeNull()
    expect(t.whyNotPlaceTile(onPetal(plate.id, 5), tile.id)).not.toBeNull()
  })
})

describe('the plain refusals', () => {
  it('reports a petal that does not exist', () => {
    const t = tableau()
    const plate = t.addPlate({ kind: 'board', hole: { q: 0, r: 0 } })!
    expect(t.whyNotPlaceTile(onPetal(plate.id, 6))).toMatchObject({ kind: 'noSuchPlace' })
    expect(t.whyNotPlaceTile(onPetal('nope', 0))).toMatchObject({ kind: 'noSuchPlace' })
    expect(t.whyNotPlaceTile({ kind: 'drawer', slot: 99 })).toMatchObject({ kind: 'noSuchPlace' })
  })

  it('reports what is already there', () => {
    const t = tableau()
    const sitting = t.addTile(green(1), { kind: 'drawer', slot: 3 })!
    const refusal = t.whyNotPlaceTile({ kind: 'drawer', slot: 3 })
    expect(refusal).toMatchObject({ kind: 'occupied', by: sitting.id })
  })

  it('says nothing about a move that is fine', () => {
    const t = tableau()
    expect(t.whyNotPlaceTile({ kind: 'drawer', slot: 3 })).toBeNull()
  })
})
