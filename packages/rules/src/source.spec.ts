import { describe, expect, it } from 'vitest'
import { createBag } from './bag'
import { hexRectangle } from './hex'
import {
  hasRoomToShift,
  occupiedLots,
  platesToReveal,
  pushLot,
  shiftLotsDown,
  shouldRefill,
  sourceContents,
  topLotIsShort,
} from './source'
import { createTableau, type TileSpec } from './tableau'

const PLATES_PER_ROUND = 4
const TILES_PER_LOT = 4

function table() {
  return createTableau({
    cells: hexRectangle(6, 6),
    drawerSlots: 16,
    plateSlots: 2,
    sourceLots: PLATES_PER_ROUND,
    sourceTilesPerLot: TILES_PER_LOT,
  })
}

/** Distinguishable tiles, so a lot's contents can be identified after it moves. */
function heap(mark: number): TileSpec[] {
  return Array.from({ length: TILES_PER_LOT }, (_, i) => ({ color: mark, value: i + 1 }))
}

/** Which mark sits in each lot, bottom slot last. `null` for an empty slot. */
function marks(t: ReturnType<typeof table>): (number | null)[] {
  return Array.from({ length: t.sourceLots }, (_, lot) => {
    const tiles = t.tilesInSourceLot(lot)
    return tiles[0]?.color ?? null
  })
}

describe('the opening deal', () => {
  it('puts one face-down plate with a full heap at the top', () => {
    const t = table()
    expect(pushLot(t, heap(1))).toBe(true)
    expect(t.plateInSourceLot(0)?.faceDown).toBe(true)
    expect(t.tilesInSourceLot(0)).toHaveLength(TILES_PER_LOT)
    expect(marks(t)).toEqual([1, null, null, null])
  })

  it('creates no tile for the plate itself, so nothing can read it', () => {
    const t = table()
    pushLot(t, heap(1))
    expect(t.tiles().every(tile => tile.location.kind === 'source')).toBe(true)
    expect(t.tiles()).toHaveLength(TILES_PER_LOT)
  })
})

describe('when a restock is due', () => {
  it('is not due while the newest lot is untouched', () => {
    const t = table()
    pushLot(t, heap(1))
    expect(topLotIsShort(t)).toBe(false)
    expect(shouldRefill(t, { platesDealt: 1, platesPerRound: PLATES_PER_ROUND })).toBe(false)
  })

  it('is due once a tile leaves the newest lot', () => {
    const t = table()
    pushLot(t, heap(1))
    const first = t.tilesInSourceLot(0)[0]
    t.moveTile(first!.id, { kind: 'drawer', slot: 0 })
    expect(topLotIsShort(t)).toBe(true)
    expect(shouldRefill(t, { platesDealt: 1, platesPerRound: PLATES_PER_ROUND })).toBe(true)
  })

  it('ignores drafting from a lower lot', () => {
    // Only the topmost lot's fullness matters: the source restocks when its newest offering is
    // touched, not whenever anything anywhere is taken.
    const t = table()
    pushLot(t, heap(1))
    t.moveTile(t.tilesInSourceLot(0)[0]!.id, { kind: 'drawer', slot: 0 })
    pushLot(t, heap(2))
    expect(marks(t)).toEqual([2, 1, null, null])

    // Take from lot 1, the older one. Lot 0 is still full.
    t.moveTile(t.tilesInSourceLot(1)[0]!.id, { kind: 'drawer', slot: 1 })
    expect(topLotIsShort(t)).toBe(false)
    expect(shouldRefill(t, { platesDealt: 2, platesPerRound: PLATES_PER_ROUND })).toBe(false)
  })

  it('stops once the round has dealt its plates', () => {
    const t = table()
    pushLot(t, heap(1))
    t.moveTile(t.tilesInSourceLot(0)[0]!.id, { kind: 'drawer', slot: 0 })
    expect(topLotIsShort(t)).toBe(true)
    // The budget, not the capacity, is what closes it.
    expect(shouldRefill(t, { platesDealt: PLATES_PER_ROUND, platesPerRound: PLATES_PER_ROUND }))
      .toBe(false)
  })
})

describe('shifting down', () => {
  it('moves every lot one slot and frees the top', () => {
    const t = table()
    pushLot(t, heap(1))
    shiftLotsDown(t)
    expect(marks(t)).toEqual([null, 1, null, null])
    expect(t.plateInSourceLot(0)).toBeUndefined()
    expect(t.plateInSourceLot(1)).toBeDefined()
  })

  it('keeps a heap intact, tile indices included', () => {
    const t = table()
    pushLot(t, heap(7))
    const before = t.tilesInSourceLot(0).map(tile =>
      tile.location.kind === 'source' ? `${tile.value}@${tile.location.index}` : '')
    shiftLotsDown(t)
    const after = t.tilesInSourceLot(1).map(tile =>
      tile.location.kind === 'source' ? `${tile.value}@${tile.location.index}` : '')
    expect(after).toEqual(before)
  })

  it('fills the column exactly over a whole round, losing nothing off the bottom', () => {
    const t = table()
    for (let dealt = 1; dealt <= PLATES_PER_ROUND; dealt++) {
      expect(pushLot(t, heap(dealt))).toBe(true)
    }
    // Newest at the top, oldest at the bottom, and all four survived.
    expect(marks(t)).toEqual([4, 3, 2, 1])
    expect(t.plates()).toHaveLength(PLATES_PER_ROUND)
    expect(t.tiles()).toHaveLength(PLATES_PER_ROUND * TILES_PER_LOT)
  })

  it('refuses to push once the column is full', () => {
    const t = table()
    for (let dealt = 1; dealt <= PLATES_PER_ROUND; dealt++) pushLot(t, heap(dealt))
    expect(hasRoomToShift(t)).toBe(false)
    // The bottom lot is occupied, so a shift would drop it. pushLot reports the failure rather than
    // silently discarding a lot.
    expect(pushLot(t, heap(99))).toBe(false)
    expect(marks(t)).toEqual([4, 3, 2, 1])
  })
})

describe('a round played through the bag', () => {
  it('deals a plate and a heap per restock, in deck order', () => {
    const t = table()
    const tileBag = createBag(Array.from({ length: 40 }, (_, i) => ({ color: i, value: 1 })))

    pushLot(t, tileBag.take(TILES_PER_LOT))
    expect(t.tilesInSourceLot(0).map(x => x.color)).toEqual([0, 1, 2, 3])

    t.moveTile(t.tilesInSourceLot(0)[0]!.id, { kind: 'drawer', slot: 0 })
    expect(shouldRefill(t, { platesDealt: 1, platesPerRound: PLATES_PER_ROUND })).toBe(true)
    pushLot(t, tileBag.take(TILES_PER_LOT))

    // The next four off the top, and the older lot moved down with its remaining three.
    expect(t.tilesInSourceLot(0).map(x => x.color)).toEqual([4, 5, 6, 7])
    expect(t.tilesInSourceLot(1)).toHaveLength(3)
    expect(tileBag.drawn()).toBe(8)
  })
})

describe('turning a plate over', () => {
  it('waits while tiles are still heaped on it', () => {
    const t = table()
    pushLot(t, heap(1))
    expect(platesToReveal(t)).toHaveLength(0)
  })

  it('flips once the lot is picked clean', () => {
    const t = table()
    pushLot(t, heap(1))
    t.tilesInSourceLot(0).forEach((tile, i) => t.moveTile(tile.id, { kind: 'drawer', slot: i }))
    const ready = platesToReveal(t)
    expect(ready).toHaveLength(1)
    expect(ready[0]!.id).toBe(t.plateInSourceLot(0)!.id)
  })

  it('gives the plate its token, which then drafts like any other item', () => {
    const t = table()
    pushLot(t, heap(1))
    t.tilesInSourceLot(0).forEach((tile, i) => t.moveTile(tile.id, { kind: 'drawer', slot: i }))
    const plate = platesToReveal(t)[0]!

    expect(t.plateToken(plate.id)).toBeUndefined()
    expect(t.revealPlate(plate.id, { color: 1, value: 4 }, 2)).toBe(true)

    expect(t.plate(plate.id)!.faceDown).toBe(false)
    const token = t.plateToken(plate.id)!
    expect({ color: token.color, value: token.value }).toEqual({ color: 1, value: 4 })
    // The token is welded to its plate, exactly like a plate dealt face up.
    expect(token.fixed).toBe(true)
    expect(t.canDragTile(token.id)).toBe(false)
  })

  it('refuses to reveal twice, so a token cannot be duplicated', () => {
    const t = table()
    pushLot(t, heap(1))
    const plate = t.plateInSourceLot(0)!
    expect(t.revealPlate(plate.id, { color: 1, value: 4 }, 0)).toBe(true)
    expect(t.revealPlate(plate.id, { color: 2, value: 5 }, 1)).toBe(false)
    expect(t.tiles().filter(x => x.fixed)).toHaveLength(1)
  })

  it('is no longer listed once revealed', () => {
    const t = table()
    pushLot(t, heap(1))
    const plate = t.plateInSourceLot(0)!
    t.revealPlate(plate.id, { color: 1, value: 4 }, 0)
    expect(platesToReveal(t)).toHaveLength(0)
  })
})

describe('what the source is holding', () => {
  it('reports every lot\'s tiles and plates', () => {
    const t = table()
    pushLot(t, heap(1))
    pushLot(t, heap(2))
    const held = sourceContents(t)
    expect(held.plates).toHaveLength(2)
    expect(held.tiles).toHaveLength(2 * TILES_PER_LOT)
  })

  it('reports face-down and revealed plates alike', () => {
    const t = table()
    pushLot(t, heap(1))
    const plate = t.plateInSourceLot(0)!
    for (const tile of t.tilesInSourceLot(0)) t.discard(tile.id)
    t.revealPlate(plate.id, { color: 1, value: 4 }, 0)
    pushLot(t, heap(2))
    expect(sourceContents(t).plates.map(p => p.faceDown)).toEqual([true, false])
  })

  /*
   * The tiles a lot is heaped with are `kind: 'source'`, not `onPlate`, so discarding the plate leaves
   * them behind. A sweep that forgot this would drop four tiles a lot out of the game.
   */
  it('lists heaped tiles separately, since the plate does not carry them off', () => {
    const t = table()
    pushLot(t, heap(1))
    const plate = t.plateInSourceLot(0)!
    expect(t.discard(plate.id)!.tiles).toEqual([])
    expect(t.tilesInSourceLot(0)).toHaveLength(TILES_PER_LOT)
  })

  /*
   * The reason clearing the source is a fix and not only a rule: restocking needs the bottom slot free,
   * so a round that ended with anything left down there would stall the next one.
   */
  it('unblocks restocking once swept, which a leftover bottom lot prevents', () => {
    const t = table()
    for (let i = 0; i < PLATES_PER_ROUND; i++) pushLot(t, heap(i))
    // Draft one tile out of the newest lot, so the *only* thing left blocking a restock is the bottom.
    t.discard(t.tilesInSourceLot(0)[0]!.id)
    const supply = { platesDealt: 0, platesPerRound: PLATES_PER_ROUND }
    expect(topLotIsShort(t)).toBe(true)
    expect(hasRoomToShift(t)).toBe(false)
    expect(shouldRefill(t, supply)).toBe(false)

    const held = sourceContents(t)
    for (const tile of held.tiles) t.discard(tile.id)
    for (const plate of held.plates) t.discard(plate.id)

    expect(hasRoomToShift(t)).toBe(true)
    expect(shouldRefill(t, supply)).toBe(true)
  })
})

/*
 * What the column actually draws. The model keeps `sourceLots` slots and shifts within them; a slot
 * picked clean is not something a player should be shown, so the renderer asks which lots hold
 * anything and draws one row each.
 */
describe('which lots are worth drawing', () => {
  it('has nothing to draw before the first deal', () => {
    expect(occupiedLots(table())).toEqual([])
  })

  it('counts a lot from the moment it is pushed', () => {
    const t = table()
    pushLot(t, heap(1))
    expect(occupiedLots(t)).toEqual([0])
    pushLot(t, heap(2))
    expect(occupiedLots(t)).toEqual([0, 1])
  })

  /* The hole is the whole point: the model leaves the slot, and the renderer must not draw it. */
  it('skips a lot picked clean in the middle', () => {
    const t = table()
    pushLot(t, heap(1))
    pushLot(t, heap(2))
    pushLot(t, heap(3))
    expect(occupiedLots(t)).toEqual([0, 1, 2])

    const plate = t.plateInSourceLot(1)
    if (plate) t.discard(plate.id)
    for (const tile of t.tilesInSourceLot(1)) t.discard(tile.id)

    expect(occupiedLots(t)).toEqual([0, 2])
  })

  /* A plate can go while its heap stays, and a heap with nothing under it is still worth offering. */
  it('still counts a lot whose plate has gone but whose tiles remain', () => {
    const t = table()
    pushLot(t, heap(1))
    const plate = t.plateInSourceLot(0)
    if (plate) t.discard(plate.id)
    expect(t.tilesInSourceLot(0).length).toBeGreaterThan(0)
    expect(occupiedLots(t)).toEqual([0])
  })
})
