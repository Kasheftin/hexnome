import { describe, expect, it } from 'vitest'
import { axialKey, hexRectangle } from './hex'
import { normalizePetal, petalCell, plateCells } from './plate'
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

describe("a plate's own tile is not separable", () => {
  function withOwnTile() {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    const own = t.addTile(RED, onPetal(p.id, 2), { fixed: true })!
    return { t, p, own }
  }

  it('cannot be moved to another petal, or to the drawer', () => {
    const { t, p, own } = withOwnTile()
    expect(t.canDragTile(own.id)).toBe(false)
    expect(t.moveTile(own.id, onPetal(p.id, 4))).toBe(false)
    expect(t.moveTile(own.id, inDrawer(0))).toBe(false)
    expect(t.tile(own.id)!.location).toEqual(onPetal(p.id, 2))
  })

  it('still occupies its petal, so nothing can be dropped on it', () => {
    const { t, p } = withOwnTile()
    expect(t.canPlaceTile(onPetal(p.id, 2))).toBe(false)
  })

  it('is still a full tile, so scoring will see it', () => {
    const { t, own } = withOwnTile()
    expect(t.tiles().some(tile => tile.id === own.id)).toBe(true)
    expect(t.tiles()).toHaveLength(1)
  })

  it('travels with its plate', () => {
    const { t, p, own } = withOwnTile()
    expect(t.movePlate(p.id, onBoard(3, -1))).toBe(true)
    expect(axialKey(t.cellOfTile(own.id)!)).toBe(axialKey(petalCell({ q: 3, r: -1 }, 2)))
  })

  it('does not restrict the player\'s own tiles on the same plate', () => {
    const { t, p } = withOwnTile()
    const mine = t.addTile(BLUE, onPetal(p.id, 5))!
    expect(t.canDragTile(mine.id)).toBe(true)
    expect(t.moveTile(mine.id, inDrawer(0))).toBe(true)
  })

  it('treats ordinary tiles as movable by default', () => {
    const t = tableau()
    const tile = t.addTile(RED, inDrawer(0))!
    expect(tile.fixed).toBe(false)
    expect(t.canDragTile(tile.id)).toBe(true)
  })
})

describe('rotating a plate', () => {
  it('never changes which cells it covers — a flower is six-fold symmetric', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    const covered = () => plateCells({ q: 0, r: 0 })
      .filter(c => t.coverageAt(c)?.plateId === p.id).length
    expect(covered()).toBe(7)
    for (let i = 0; i < 6; i++) {
      t.rotatePlate(p.id, 1)
      expect(covered()).toBe(7)
    }
  })

  it('leaves placement legality untouched', () => {
    const t = tableau()
    const a = t.addPlate(onBoard(0, 0))!
    t.rotatePlate(a.id, 3)
    // Still blocks the same overlaps, still allows the same neighbour.
    expect(t.canPlacePlate(onBoard(1, 0))).toBe(false)
    expect(t.canPlacePlate(onBoard(1, 2))).toBe(true)
  })

  it('moves a tile to the next cell clockwise per step', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    const tile = t.addTile(RED, onPetal(p.id, 0))!
    // Petal 0 points along direction 0 while unrotated.
    expect(axialKey(t.cellOfTile(tile.id)!)).toBe(axialKey(petalCell({ q: 0, r: 0 }, 0)))
    // One clockwise step: logical petal p points in direction p − rotation.
    t.rotatePlate(p.id, 1)
    expect(axialKey(t.cellOfTile(tile.id)!)).toBe(axialKey(petalCell({ q: 0, r: 0 }, 5)))
    t.rotatePlate(p.id, 1)
    expect(axialKey(t.cellOfTile(tile.id)!)).toBe(axialKey(petalCell({ q: 0, r: 0 }, 4)))
  })

  it('returns to where it started after six steps', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    const tile = t.addTile(RED, onPetal(p.id, 2))!
    const before = axialKey(t.cellOfTile(tile.id)!)
    for (let i = 0; i < 6; i++) t.rotatePlate(p.id, 1)
    expect(axialKey(t.cellOfTile(tile.id)!)).toBe(before)
  })

  it('is symmetric: clockwise then counter-clockwise is a no-op', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    const tile = t.addTile(RED, onPetal(p.id, 4))!
    const before = axialKey(t.cellOfTile(tile.id)!)
    t.rotatePlate(p.id, 1)
    t.rotatePlate(p.id, -1)
    expect(axialKey(t.cellOfTile(tile.id)!)).toBe(before)
    expect(t.plate(p.id)!.rotation).toBe(0)
  })

  it('keeps a running total rather than wrapping, so the angle stays continuous', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    for (let i = 0; i < 8; i++) t.rotatePlate(p.id, 1)
    expect(t.plate(p.id)!.rotation).toBe(8)
    t.rotatePlate(p.id, -20)
    expect(t.plate(p.id)!.rotation).toBe(-12)
  })

  it('keeps cell and petal mappings mutually inverse at every rotation', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    // One tile, walked around the petals — the two mappings must round-trip through it.
    const tile = t.addTile(BLUE, onPetal(p.id, 0))!
    const hole = { q: 0, r: 0 }

    for (let rot = 0; rot < 6; rot++) {
      for (let petal = 0; petal < 6; petal++) {
        expect(t.moveTile(tile.id, onPetal(p.id, petal))).toBe(true)
        const cell = t.cellOfTile(tile.id)!
        // cell -> petal must undo petal -> cell.
        expect(t.petalAt(cell)).toEqual(onPetal(p.id, petal))
        // …and that cell is the one the sign convention predicts.
        expect(axialKey(cell)).toBe(axialKey(petalCell(hole, normalizePetal(petal - rot))))
      }
      t.rotatePlate(p.id, 1)
    }
  })

  it('survives a move, keeping its rotation', () => {
    const t = tableau()
    const p = t.addPlate(inPlateSlot(0))!
    t.rotatePlate(p.id, 2)
    expect(t.movePlate(p.id, onBoard(0, 0))).toBe(true)
    expect(t.plate(p.id)!.rotation).toBe(2)
  })

  it('rejects a zero or fractional step', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    expect(t.rotatePlate(p.id, 0)).toBe(false)
    expect(t.rotatePlate(p.id, 0.5)).toBe(false)
    expect(t.rotatePlate('nope', 1)).toBe(false)
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

describe('the shared source', () => {
  function withSource() {
    return createTableau({
      cells: hexRectangle(6, 6),
      drawerSlots: 16,
      plateSlots: 2,
      sourceLots: 6,
      sourceTilesPerLot: 4,
    })
  }

  const inLot = (lot: number): PlateLocation => ({ kind: 'source', lot })
  const looseIn = (lot: number, index: number): TileLocation =>
    ({ kind: 'source', lot, index })

  it('holds at most one plate per lot, and only in a lot that exists', () => {
    const t = withSource()
    expect(t.addPlate(inLot(0))).toBeDefined()
    expect(t.canPlacePlate(inLot(0))).toBe(false)
    expect(t.addPlate(inLot(6))).toBeUndefined()
    expect(t.addPlate(inLot(-1))).toBeUndefined()
  })

  it('heaps loose tiles in a lot without using its plate petals', () => {
    const t = withSource()
    const plate = t.addPlate(inLot(2), { faceDown: true })!
    for (let index = 0; index < 4; index++) {
      expect(t.addTile(RED, looseIn(2, index))).toBeDefined()
    }
    expect(t.tilesInSourceLot(2)).toHaveLength(4)
    // The point of a separate location kind: none of this touched the plate.
    expect(t.tiles().filter(tile => tile.location.kind === 'onPlate')).toHaveLength(0)
    expect(t.plateInSourceLot(2)!.id).toBe(plate.id)
  })

  it('refuses a fifth loose tile, and a second in one index', () => {
    const t = withSource()
    for (let index = 0; index < 4; index++) t.addTile(RED, looseIn(1, index))
    expect(t.addTile(BLUE, looseIn(1, 4))).toBeUndefined()
    expect(t.addTile(BLUE, looseIn(1, 0))).toBeUndefined()
  })

  it('keeps a lot separate from every other lot', () => {
    const t = withSource()
    t.addTile(RED, looseIn(0, 0))
    expect(t.addTile(BLUE, looseIn(1, 0))).toBeDefined()
    expect(t.tilesInSourceLot(0)).toHaveLength(1)
    expect(t.tilesInSourceLot(1)).toHaveLength(1)
    expect(t.plateInSourceLot(3)).toBeUndefined()
  })

  it('leaves source items undraggable, since drafting is not a drag', () => {
    const t = withSource()
    const plate = t.addPlate(inLot(0), { faceDown: true })!
    const tile = t.addTile(RED, looseIn(0, 0))!
    expect(t.canDragPlate(plate.id)).toBe(false)
    expect(t.canDragTile(tile.id)).toBe(false)
  })

  it('but still movable, which is how drafting will take them', () => {
    // The distinction that matters: undraggable is an affordance, not an invariant. If moveTile
    // refused source tiles, drafting would have no mechanism at all.
    const t = withSource()
    const tile = t.addTile(RED, looseIn(0, 0))!
    expect(t.moveTile(tile.id, inDrawer(0))).toBe(true)
    expect(t.canDragTile(tile.id)).toBe(true)
    expect(t.tilesInSourceLot(0)).toHaveLength(0)
  })

  it('still refuses to move a plate own tile, which is an invariant', () => {
    const t = withSource()
    const plate = t.addPlate(inPlateSlot(0))!
    const own = t.addTile(RED, onPetal(plate.id, 0), { fixed: true })!
    expect(t.moveTile(own.id, inDrawer(0))).toBe(false)
  })

  it('lets a plate leave the source and become draggable', () => {
    const t = withSource()
    const plate = t.addPlate(inLot(0), { faceDown: true })!
    expect(t.movePlate(plate.id, inPlateSlot(0))).toBe(true)
    expect(t.canDragPlate(plate.id)).toBe(true)
    expect(t.plateInSourceLot(0)).toBeUndefined()
    // faceDown is a property of the plate, not of where it is, so it survives the move.
    expect(t.plate(plate.id)!.faceDown).toBe(true)
  })

  it('creates no tile for a face-down plate, so its value cannot be read', () => {
    const t = withSource()
    t.addPlate(inLot(0), { faceDown: true })
    expect(t.tiles()).toHaveLength(0)
  })

  it('has no source at all unless one was configured', () => {
    const t = tableau()
    expect(t.sourceLots).toBe(0)
    expect(t.addPlate({ kind: 'source', lot: 0 })).toBeUndefined()
    expect(t.canPlaceTile({ kind: 'source', lot: 0, index: 0 })).toBe(false)
  })
})

describe('stems', () => {
  it('take a drawer slot, and a tile cannot then use it', () => {
    const t = tableau()
    const stem = t.addStem(3)!
    expect(stem.slot).toBe(3)
    expect(t.stems()).toHaveLength(1)
    // One occupancy index for both, so the slot cannot hold two things.
    expect(t.canPlaceTile(inDrawer(3))).toBe(false)
    expect(t.addTile(RED, inDrawer(3))).toBeUndefined()
    expect(t.freeDrawerSlots()).not.toContain(3)
  })

  it('cannot take a slot a tile already holds', () => {
    const t = tableau()
    t.addTile(RED, inDrawer(0))
    expect(t.addStem(0)).toBeUndefined()
  })

  it('refuses a slot that does not exist', () => {
    const t = tableau()
    expect(t.addStem(16)).toBeUndefined()
    expect(t.addStem(-1)).toBeUndefined()
  })

  it('moves between drawer slots, freeing the one it left', () => {
    const t = tableau()
    const stem = t.addStem(3)!
    expect(t.moveStem(stem.id, 7)).toBe(true)
    expect(t.stems()[0]!.slot).toBe(7)
    expect(t.canPlaceTile(inDrawer(3))).toBe(true)
    expect(t.canPlaceTile(inDrawer(7))).toBe(false)
  })

  it('will not move onto an occupied slot', () => {
    const t = tableau()
    const stem = t.addStem(3)!
    t.addTile(RED, inDrawer(4))
    expect(t.moveStem(stem.id, 4)).toBe(false)
    expect(t.stems()[0]!.slot).toBe(3)
  })

  it('has nowhere to go but a drawer slot', () => {
    // The rule is in the signature: moveStem takes a slot number, so "stem onto the board" is not
    // something a caller can even express.
    const t = tableau()
    const stem = t.addStem(0)!
    expect(t.moveStem(stem.id, 99)).toBe(false)
    expect(t.stems()[0]!.slot).toBe(0)
  })

  it('is not a tile, so drafting and scoring never see it', () => {
    const t = tableau()
    t.addStem(0)
    expect(t.tiles()).toHaveLength(0)
  })
})

describe('discarding', () => {
  it('removes a drawer tile and frees its slot', () => {
    const t = tableau()
    const tile = t.addTile(RED, inDrawer(2))!
    expect(t.discard(tile.id)).toBe(true)
    expect(t.tiles()).toHaveLength(0)
    expect(t.canPlaceTile(inDrawer(2))).toBe(true)
  })

  it('removes a stem and frees its slot', () => {
    const t = tableau()
    const stem = t.addStem(2)!
    expect(t.discard(stem.id)).toBe(true)
    expect(t.stems()).toHaveLength(0)
    expect(t.canPlaceTile(inDrawer(2))).toBe(true)
  })

  it('takes a plate\'s tiles with it, since they are addressed against it', () => {
    const t = tableau()
    const p = t.addPlate(inPlateSlot(0))!
    t.addTile(RED, onPetal(p.id, 0), { fixed: true })
    t.addTile(BLUE, onPetal(p.id, 1))
    expect(t.discard(p.id)).toBe(true)
    expect(t.plates()).toHaveLength(0)
    expect(t.tiles()).toHaveLength(0)
    expect(t.freePlateSlots()).toEqual([0, 1])
  })

  it('frees the board cells a discarded plate covered', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    t.discard(p.id)
    for (const cell of plateCells({ q: 0, r: 0 })) expect(t.coverageAt(cell)).toBeUndefined()
  })

  it('reports an unknown id rather than pretending', () => {
    expect(tableau().discard('nope')).toBe(false)
  })
})

describe('rearranging the drawer', () => {
  it('reports what sits in a slot, and in a bay', () => {
    const t = tableau()
    const tile = t.addTile(RED, inDrawer(3))!
    const stem = t.addStem(4)!
    const plate = t.addPlate(inPlateSlot(1))!
    expect(t.drawerSlotOccupant(3)).toBe(tile.id)
    expect(t.drawerSlotOccupant(4)).toBe(stem.id)
    expect(t.drawerSlotOccupant(5)).toBeUndefined()
    expect(t.plateSlotOccupant(1)).toBe(plate.id)
    expect(t.plateSlotOccupant(0)).toBeUndefined()
  })

  it('swaps two tiles', () => {
    const t = tableau()
    const a = t.addTile(RED, inDrawer(0))!
    const b = t.addTile(BLUE, inDrawer(7))!
    expect(t.swapDrawerItems(a.id, b.id)).toBe(true)
    expect(t.tile(a.id)!.location).toEqual(inDrawer(7))
    expect(t.tile(b.id)!.location).toEqual(inDrawer(0))
    expect(t.drawerSlotOccupant(0)).toBe(b.id)
    expect(t.drawerSlotOccupant(7)).toBe(a.id)
  })

  it('swaps a tile with a stem, since they share a kind of seat', () => {
    const t = tableau()
    const tile = t.addTile(RED, inDrawer(0))!
    const stem = t.addStem(1)!
    expect(t.swapDrawerItems(tile.id, stem.id)).toBe(true)
    expect(t.tile(tile.id)!.location).toEqual(inDrawer(1))
    expect(t.stems()[0]!.slot).toBe(0)
    expect(t.drawerSlotOccupant(0)).toBe(stem.id)
    expect(t.drawerSlotOccupant(1)).toBe(tile.id)
  })

  it('swaps two plates between bays', () => {
    const t = tableau()
    const a = t.addPlate(inPlateSlot(0))!
    const b = t.addPlate(inPlateSlot(1))!
    expect(t.swapDrawerItems(a.id, b.id)).toBe(true)
    expect(t.plate(a.id)!.location).toEqual(inPlateSlot(1))
    expect(t.plate(b.id)!.location).toEqual(inPlateSlot(0))
  })

  it('works in a completely full drawer, which is the whole point', () => {
    const t = tableau()
    const ids = Array.from({ length: 16 }, (_, slot) => t.addTile(RED, inDrawer(slot))!.id)
    expect(t.freeDrawerSlots()).toEqual([])
    expect(t.swapDrawerItems(ids[0]!, ids[15]!)).toBe(true)
    expect(t.tile(ids[0]!)!.location).toEqual(inDrawer(15))
    expect(t.tile(ids[15]!)!.location).toEqual(inDrawer(0))
    // Nothing was dropped on the floor along the way.
    expect(t.freeDrawerSlots()).toEqual([])
  })

  it('refuses a tile and a plate, whose seats are different', () => {
    const t = tableau()
    const tile = t.addTile(RED, inDrawer(0))!
    const plate = t.addPlate(inPlateSlot(0))!
    expect(t.swapDrawerItems(tile.id, plate.id)).toBe(false)
    expect(t.tile(tile.id)!.location).toEqual(inDrawer(0))
    expect(t.plate(plate.id)!.location).toEqual(inPlateSlot(0))
  })

  it('refuses anything not in the drawer', () => {
    const t = tableau()
    const inBay = t.addPlate(inPlateSlot(0))!
    const onTable = t.addPlate(onBoard(0, 0))!
    const held = t.addTile(RED, inDrawer(0))!
    const placed = t.addTile(BLUE, onPetal(onTable.id, 1))!
    expect(t.swapDrawerItems(inBay.id, onTable.id)).toBe(false)
    expect(t.swapDrawerItems(held.id, placed.id)).toBe(false)
  })

  it('refuses a plate\'s own tile, which has no seat of its own', () => {
    const t = tableau()
    const plate = t.addPlate(inPlateSlot(0))!
    const token = t.addTile(RED, onPetal(plate.id, 0), { fixed: true })!
    const loose = t.addTile(BLUE, inDrawer(0))!
    expect(t.swapDrawerItems(token.id, loose.id)).toBe(false)
  })

  it('refuses to swap something with itself, and unknown ids', () => {
    const t = tableau()
    const tile = t.addTile(RED, inDrawer(0))!
    expect(t.swapDrawerItems(tile.id, tile.id)).toBe(false)
    expect(t.swapDrawerItems(tile.id, 'nope')).toBe(false)
  })
})
