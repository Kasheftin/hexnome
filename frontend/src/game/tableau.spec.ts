import { describe, expect, it } from 'vitest'
import { axialKey, hexRectangle } from './hex'
import { petalCell, plateCells } from './plate'
import { createTableau, type PlateLocation, type TileLocation } from './tableau'

function tableau() {
  return createTableau({ cells: hexRectangle(6, 6), drawerSlots: 16, plateSlots: 2 })
}

const onBoard = (q: number, r: number): PlateLocation => ({ kind: 'board', hole: { q, r } })
const inPlateSlot = (slot: number): PlateLocation => ({ kind: 'plateSlot', slot })
const inDrawer = (slot: number): TileLocation => ({ kind: 'drawer', slot })
const onPetal = (plateId: string, petal: number): TileLocation =>
  ({ kind: 'onPlate', plateId, petal })

const RED = { color: 4, value: 2 }
const BLUE = { color: 1, value: 5 }

describe('placing a plate', () => {
  it('needs all seven of its cells free', () => {
    const t = tableau()
    expect(t.canPlacePlate(onBoard(0, 0))).toBe(true)
    t.addPlate(onBoard(0, 0))
    // Same hole, and every overlap of the flower, is now blocked.
    expect(t.canPlacePlate(onBoard(0, 0))).toBe(false)
    expect(t.canPlacePlate(onBoard(1, 0))).toBe(false)
    expect(t.canPlacePlate(onBoard(0, 1))).toBe(false)
  })

  it('covers exactly its hole and six petals', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    expect(t.coverageAt({ q: 0, r: 0 })).toEqual({ plateId: p.id, petal: null })
    for (let petal = 0; petal < 6; petal++) {
      expect(t.coverageAt(petalCell({ q: 0, r: 0 }, petal))).toEqual({ plateId: p.id, petal })
    }
    expect(t.coverageAt({ q: 3, r: 0 })).toBeUndefined()
  })

  it('refuses a plate that would hang off the board', () => {
    const t = tableau()
    expect(t.canPlacePlate(onBoard(60, 60))).toBe(false)
  })

  it('fits two plates whose flowers do not overlap', () => {
    const t = tableau()
    expect(t.addPlate(onBoard(0, 0))).toBeDefined()
    // Adjacent position on the flower sublattice — shares edges but no cells.
    expect(t.addPlate(onBoard(1, 2))).toBeDefined()
  })
})

describe('tiles only go into empty petals', () => {
  it('resolves a petal cell to a tile location and the hole to nothing', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    expect(t.petalAt({ q: 0, r: 0 })).toBeNull()
    expect(t.petalAt(petalCell({ q: 0, r: 0 }, 2))).toEqual(onPetal(p.id, 2))
  })

  it('resolves an uncovered board cell to nothing', () => {
    const t = tableau()
    t.addPlate(onBoard(0, 0))
    expect(t.petalAt({ q: 4, r: 0 })).toBeNull()
  })

  it('refuses a second tile in the same petal', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    expect(t.addTile(RED, onPetal(p.id, 0))).toBeDefined()
    expect(t.canPlaceTile(onPetal(p.id, 0))).toBe(false)
    expect(t.addTile(BLUE, onPetal(p.id, 0))).toBeUndefined()
  })

  it('refuses a petal index outside 0–5, and an unknown plate', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    expect(t.canPlaceTile(onPetal(p.id, 6))).toBe(false)
    expect(t.canPlaceTile(onPetal(p.id, -1))).toBe(false)
    expect(t.canPlaceTile(onPetal('nope', 0))).toBe(false)
  })

  it('refuses a second tile in an occupied drawer slot', () => {
    const t = tableau()
    t.addTile(RED, inDrawer(3))
    expect(t.canPlaceTile(inDrawer(3))).toBe(false)
  })
})

describe('a moved plate carries its tiles', () => {
  it('keeps tiles on their petals and moves the cells they occupy', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    const tile = t.addTile(RED, onPetal(p.id, 3))!
    expect(axialKey(t.cellOfTile(tile.id)!)).toBe(axialKey(petalCell({ q: 0, r: 0 }, 3)))

    expect(t.movePlate(p.id, onBoard(3, -1))).toBe(true)
    // The tile's address never changed, but the cell it lands on did.
    expect(t.tile(tile.id)!.location).toEqual(onPetal(p.id, 3))
    expect(axialKey(t.cellOfTile(tile.id)!)).toBe(axialKey(petalCell({ q: 3, r: -1 }, 3)))
  })

  it('frees the cells it left', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    t.movePlate(p.id, onBoard(3, -1))
    for (const cell of plateCells({ q: 0, r: 0 })) {
      expect(t.coverageAt(cell)).toBeUndefined()
    }
  })

  it('has no board cell for a tile whose plate sits in the drawer', () => {
    const t = tableau()
    const p = t.addPlate(inPlateSlot(0))!
    const tile = t.addTile(RED, onPetal(p.id, 1))!
    expect(t.cellOfTile(tile.id)).toBeUndefined()
    // …and it covers nothing on the board.
    expect(t.coverageAt({ q: 0, r: 0 })).toBeUndefined()
  })

  it('refuses moving a plate onto another plate', () => {
    const t = tableau()
    const a = t.addPlate(onBoard(0, 0))!
    t.addPlate(onBoard(1, 2))
    expect(t.movePlate(a.id, onBoard(1, 2))).toBe(false)
    expect(t.plate(a.id)!.location).toEqual(onBoard(0, 0))
  })

  it('allows a plate back onto its own position', () => {
    const t = tableau()
    const a = t.addPlate(onBoard(0, 0))!
    expect(t.movePlate(a.id, onBoard(0, 0))).toBe(true)
  })
})

describe('plate slots', () => {
  it('holds at most one plate per slot', () => {
    const t = tableau()
    expect(t.addPlate(inPlateSlot(0))).toBeDefined()
    expect(t.canPlacePlate(inPlateSlot(0))).toBe(false)
    expect(t.addPlate(inPlateSlot(2))).toBeUndefined()
    expect(t.freePlateSlots()).toEqual([1])
  })

  it('round-trips a plate from slot to board and back', () => {
    const t = tableau()
    const p = t.addPlate(inPlateSlot(1))!
    expect(t.movePlate(p.id, onBoard(0, 0))).toBe(true)
    expect(t.freePlateSlots()).toEqual([0, 1])
    expect(t.movePlate(p.id, inPlateSlot(0))).toBe(true)
    expect(t.coverageAt({ q: 0, r: 0 })).toBeUndefined()
  })
})
