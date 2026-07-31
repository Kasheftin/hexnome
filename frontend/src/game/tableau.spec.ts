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
    expect(t.discard(tile.id)).toEqual({ kind: 'tile', plate: null, tiles: [RED] })
    expect(t.tiles()).toHaveLength(0)
    expect(t.canPlaceTile(inDrawer(2))).toBe(true)
  })

  it('removes a stem and frees its slot', () => {
    const t = tableau()
    const stem = t.addStem(2)!
    // Removed, but nothing recyclable — which is a different answer from "no such id".
    expect(t.discard(stem.id)).toEqual({ kind: 'stem', plate: null, tiles: [] })
    expect(t.stems()).toHaveLength(0)
    expect(t.canPlaceTile(inDrawer(2))).toBe(true)
  })

  it('takes a plate\'s tiles with it, since they are addressed against it', () => {
    const t = tableau()
    const p = t.addPlate(inPlateSlot(0))!
    t.addTile(RED, onPetal(p.id, 0), { fixed: true })
    t.addTile(BLUE, onPetal(p.id, 1))
    expect(t.discard(p.id)).toBeTruthy()
    expect(t.plates()).toHaveLength(0)
    expect(t.tiles()).toHaveLength(0)
    expect(t.freePlateSlots()).toEqual([0, 1])
  })

  it('reports a plate as its own token, carrying its petal', () => {
    const t = tableau()
    const p = t.addPlate(inPlateSlot(0))!
    t.addTile(RED, onPetal(p.id, 3), { fixed: true })
    expect(t.discard(p.id)).toEqual({ kind: 'plate', plate: { ...RED, petal: 3 }, tiles: [] })
  })

  it('keeps the plate\'s own token out of the loose tiles', () => {
    const t = tableau()
    const p = t.addPlate(inPlateSlot(0))!
    t.addTile(RED, onPetal(p.id, 0), { fixed: true })
    t.addTile(BLUE, onPetal(p.id, 1))
    const receipt = t.discard(p.id)!
    // Counting the token in both buckets is how a recycled plate would duplicate a tile into the deck.
    expect(receipt.plate).toEqual({ ...RED, petal: 0 })
    expect(receipt.tiles).toEqual([BLUE])
  })

  it('reports a face-down plate as having no token, since the model never held one', () => {
    const t = tableau()
    const p = t.addPlate(inPlateSlot(0), { faceDown: true })!
    expect(t.discard(p.id)).toEqual({ kind: 'plate', plate: null, tiles: [] })
  })

  it('frees the board cells a discarded plate covered', () => {
    const t = tableau()
    const p = t.addPlate(onBoard(0, 0))!
    t.discard(p.id)
    for (const cell of plateCells({ q: 0, r: 0 })) expect(t.coverageAt(cell)).toBeUndefined()
  })

  it('reports an unknown id rather than pretending', () => {
    expect(tableau().discard('nope')).toBeNull()
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

/**
 * Distance in cells between two holes. Local to the spec: the rule under test is about *touching*,
 * and this only exists to describe the answer compactly.
 */
function holeDistance(a: { q: number, r: number }, b: { q: number, r: number }): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr))
}

describe('the board is one connected sheet', () => {
  const big = () => createTableau({ cells: hexRectangle(10, 10), drawerSlots: 16, plateSlots: 2 })

  it('lets the first plate land anywhere, having nothing to touch', () => {
    const t = big()
    expect(t.canPlacePlate(onBoard(0, 0))).toBe(true)
    expect(t.canPlacePlate(onBoard(5, -2))).toBe(true)
  })

  it('refuses a second plate that touches nothing', () => {
    const t = big()
    t.addPlate(onBoard(0, 0))
    // Four cells away: the two flowers come no closer than a cell apart, so no shared edge.
    expect(t.canPlacePlate(onBoard(4, -4))).toBe(false)
    expect(t.addPlate(onBoard(4, -4))).toBeUndefined()
  })

  it('accepts one that shares an edge', () => {
    const t = big()
    t.addPlate(onBoard(0, 0))
    // The tessellating neighbour: flowers interlock with no gap between them.
    expect(t.canPlacePlate(onBoard(1, 2))).toBe(true)
    expect(t.addPlate(onBoard(1, 2))).toBeDefined()
  })

  it('is exactly the ring at distance three — nearer overlaps, further cannot touch', () => {
    const t = big()
    t.addPlate(onBoard(0, 0))
    const legal: string[] = []
    for (let q = -6; q <= 6; q++) {
      for (let r = -6; r <= 6; r++) {
        if (t.canPlacePlate(onBoard(q, r))) legal.push(`${q},${r}`)
      }
    }
    expect(legal).toHaveLength(18)
    for (const key of legal) {
      const [q, r] = key.split(',').map(Number) as [number, number]
      expect(holeDistance({ q, r }, { q: 0, r: 0 })).toBe(3)
    }
  })

  it('does not let a plate count itself as its own connection', () => {
    const t = big()
    const only = t.addPlate(onBoard(0, 0))!
    // The lone plate may go anywhere: excluding itself leaves nothing to connect to.
    expect(t.canPlacePlate(onBoard(4, -4), only.id)).toBe(true)
    expect(t.movePlate(only.id, onBoard(4, -4))).toBe(true)
  })

  it('keeps a plate able to stay exactly where it is', () => {
    const t = big()
    const first = t.addPlate(onBoard(0, 0))!
    const second = t.addPlate(onBoard(1, 2))!
    expect(t.canPlacePlate(onBoard(1, 2), second.id)).toBe(true)
    expect(t.canPlacePlate(onBoard(0, 0), first.id)).toBe(true)
  })

  it('grows outward: a third plate may touch either of the first two', () => {
    const t = big()
    t.addPlate(onBoard(0, 0))
    t.addPlate(onBoard(1, 2))
    // Distance 3 from the second and 6 from the first — reachable only through the second.
    expect(t.canPlacePlate(onBoard(2, 4))).toBe(true)
    // Distance 6 from both: an island.
    expect(t.canPlacePlate(onBoard(6, -6))).toBe(false)
  })

  it('still refuses an overlap, connected or not', () => {
    const t = big()
    t.addPlate(onBoard(0, 0))
    // Distance 2 shares cells, so it is out on the older rule before the new one is reached.
    expect(t.canPlacePlate(onBoard(2, 0))).toBe(false)
    expect(t.canPlacePlate(onBoard(1, 1))).toBe(false)
  })
})

describe('a tile has to agree with its neighbours', () => {
  /** Two plates side by side on the flower sublattice, so their petals touch. */
  function pair(rule?: 'regular' | 'strict') {
    const t = createTableau({
      cells: hexRectangle(10, 10), drawerSlots: 16, plateSlots: 2, placementRule: rule,
    })
    const a = t.addPlate(onBoard(0, 0))!
    const b = t.addPlate(onBoard(1, 2))!
    return { t, a, b }
  }

  it('lets a tile land where nothing is adjacent', () => {
    const { t, a } = pair()
    const loose = t.addTile(BLUE, inDrawer(0))!
    expect(t.canPlaceTile(onPetal(a.id, 0), loose.id)).toBe(true)
  })

  it('regular: accepts a tile that agrees with one of its neighbours', () => {
    const { t, a } = pair('regular')
    // Petals 0 and 1 of the same plate are adjacent cells.
    t.addTile({ color: 1, value: 5 }, onPetal(a.id, 0))
    t.addTile({ color: 3, value: 2 }, onPetal(a.id, 1))
    const sharesColor = t.addTile({ color: 1, value: 6 }, inDrawer(0))!
    expect(t.canPlaceTile(onPetal(a.id, 5), sharesColor.id)).toBe(true)
  })

  it('regular: refuses one that agrees with none of them', () => {
    const { t, a } = pair('regular')
    t.addTile({ color: 1, value: 5 }, onPetal(a.id, 0))
    const stranger = t.addTile({ color: 3, value: 6 }, inDrawer(0))!
    expect(t.canPlaceTile(onPetal(a.id, 5), stranger.id)).toBe(false)
    expect(t.moveTile(stranger.id, onPetal(a.id, 5))).toBe(false)
  })

  it('strict: refuses when only some neighbours agree', () => {
    const strictish = createTableau({
      cells: hexRectangle(10, 10), drawerSlots: 16, plateSlots: 2, placementRule: 'strict',
    })
    const plate = strictish.addPlate(onBoard(0, 0))!
    strictish.addTile({ color: 1, value: 5 }, onPetal(plate.id, 0))
    strictish.addTile({ color: 3, value: 2 }, onPetal(plate.id, 4))
    const half = strictish.addTile({ color: 1, value: 6 }, inDrawer(0))!
    // Petal 5 touches both petal 0 and petal 4. Blue agrees with the first, not the second.
    expect(strictish.canPlaceTile(onPetal(plate.id, 5), half.id)).toBe(false)
    // The same tile is fine under the looser rule.
    const { t, a } = pair('regular')
    t.addTile({ color: 1, value: 5 }, onPetal(a.id, 0))
    t.addTile({ color: 3, value: 2 }, onPetal(a.id, 4))
    const same = t.addTile({ color: 1, value: 6 }, inDrawer(0))!
    expect(t.canPlaceTile(onPetal(a.id, 5), same.id)).toBe(true)
  })

  it('counts neighbours across a plate boundary, not just within one plate', () => {
    const { t, a, b } = pair('regular')
    // Plate b's petal 2 sits on (1,1), which touches two of plate a's cells: petal 0 at (1,0) and
    // petal 5 at (0,1). Groups spanning plates is the point of the flower layout, so the rule has to
    // see across the seam. Two *different* blues, since a wall of identical tiles is itself illegal.
    t.addTile({ color: 1, value: 5 }, onPetal(a.id, 0))
    t.addTile({ color: 1, value: 2 }, onPetal(a.id, 5))
    const stranger = t.addTile({ color: 3, value: 6 }, inDrawer(0))!
    expect(t.canPlaceTile(onPetal(b.id, 2), stranger.id)).toBe(false)
    const kin = t.addTile({ color: 1, value: 6 }, inDrawer(1))!
    expect(t.canPlaceTile(onPetal(b.id, 2), kin.id)).toBe(true)
    // A petal of b facing away from a has no neighbours at all, so anything may go there.
    expect(t.canPlaceTile(onPetal(b.id, 0), stranger.id)).toBe(true)
  })

  it('does not let a tile count itself when it is already on the board', () => {
    const { t, a } = pair('regular')
    const only = t.addTile({ color: 1, value: 5 }, onPetal(a.id, 0))!
    // Moving it one petal along: its own old cell is adjacent, and must not vouch for it.
    expect(t.canPlaceTile(onPetal(a.id, 1), only.id)).toBe(true)
  })

  it('leaves the drawer and the source alone', () => {
    const { t } = pair('strict')
    const loose = t.addTile({ color: 3, value: 6 }, inDrawer(0))!
    expect(t.canPlaceTile(inDrawer(5), loose.id)).toBe(true)
  })

  it('checks a plate through the tile it carries', () => {
    const t = createTableau({
      cells: hexRectangle(10, 10), drawerSlots: 16, plateSlots: 2, placementRule: 'regular',
    })
    const onTable = t.addPlate(onBoard(0, 0))!
    t.addTile({ color: 1, value: 5 }, onPetal(onTable.id, 0))
    t.addTile({ color: 1, value: 2 }, onPetal(onTable.id, 5))

    // Petal 2 is the one that lands on (1,1), against the filled plate. A token anywhere else on
    // the incoming plate would touch nothing, and the placement would be free.
    const held = t.addPlate(inPlateSlot(0))!
    t.addTile({ color: 3, value: 6 }, onPetal(held.id, 2), { fixed: true })
    expect(t.canPlacePlate(onBoard(1, 2), held.id)).toBe(false)

    const friendly = t.addPlate(inPlateSlot(1))!
    t.addTile({ color: 1, value: 3 }, onPetal(friendly.id, 2), { fixed: true })
    expect(t.canPlacePlate(onBoard(1, 2), friendly.id)).toBe(true)
  })

  it('follows the token round when the plate is turned', () => {
    const t = createTableau({
      cells: hexRectangle(10, 10), drawerSlots: 16, plateSlots: 2, placementRule: 'regular',
    })
    const onTable = t.addPlate(onBoard(0, 0))!
    t.addTile({ color: 1, value: 5 }, onPetal(onTable.id, 0))
    t.addTile({ color: 1, value: 2 }, onPetal(onTable.id, 5))

    const held = t.addPlate(inPlateSlot(0))!
    t.addTile({ color: 3, value: 6 }, onPetal(held.id, 2), { fixed: true })
    // Facing the blues, its stranger token is refused.
    expect(t.canPlacePlate(onBoard(1, 2), held.id)).toBe(false)
    // Turned, the token points somewhere with no neighbours, and the same hole opens up.
    t.rotatePlate(held.id, 3)
    expect(t.canPlacePlate(onBoard(1, 2), held.id)).toBe(true)
  })

  it('defaults to regular', () => {
    const t = createTableau({ cells: hexRectangle(10, 10), drawerSlots: 16, plateSlots: 2 })
    const plate = t.addPlate(onBoard(0, 0))!
    t.addTile({ color: 1, value: 5 }, onPetal(plate.id, 0))
    t.addTile({ color: 3, value: 2 }, onPetal(plate.id, 4))
    const half = t.addTile({ color: 1, value: 6 }, inDrawer(0))!
    // Accepted, so the default is the looser rule.
    expect(t.canPlaceTile(onPetal(plate.id, 5), half.id)).toBe(true)
  })
})

describe('a group may not contain the same tile twice', () => {
  /**
   * Two plates on the flower sublattice. Plate a's petal 0 is (1,0) and its petal 5 is (0,1);
   * plate b's petal 2 is (1,1), which touches both — so the three cells form a little chain.
   */
  function pair() {
    const t = createTableau({ cells: hexRectangle(10, 10), drawerSlots: 16, plateSlots: 2 })
    const a = t.addPlate(onBoard(0, 0))!
    const b = t.addPlate(onBoard(1, 2))!
    return { t, a, b }
  }

  it('refuses a tile next to its own copy', () => {
    const { t, a } = pair()
    t.addTile({ color: 1, value: 3 }, onPetal(a.id, 0))
    const twin = t.addTile({ color: 1, value: 3 }, inDrawer(0))!
    // Petals 0 and 1 are adjacent cells, so the two would be connected in both groups at once.
    expect(t.canPlaceTile(onPetal(a.id, 1), twin.id)).toBe(false)
  })

  it('refuses the bridge that joins two distant copies', () => {
    const { t, a, b } = pair()
    // Blue-1 at (1,0) and Blue-1 at (1,1): not adjacent to each other, so both may stand.
    t.addTile({ color: 1, value: 1 }, onPetal(a.id, 0))
    t.addTile({ color: 1, value: 1 }, onPetal(b.id, 2))
    // (0,1) touches (1,0) and (1,1). A blue tile there joins the two Blue-1s into one colour group.
    const bridge = t.addTile({ color: 1, value: 2 }, inDrawer(0))!
    expect(t.canPlaceTile(onPetal(a.id, 5), bridge.id)).toBe(false)
    // Another colour does not join the two by colour — but a value-1 tile joins them by *value*,
    // so the same cell is refused for the other of the two reasons.
    const neutral = t.addTile({ color: 3, value: 1 }, inDrawer(1))!
    expect(t.canPlaceTile(onPetal(a.id, 5), neutral.id)).toBe(false)
  })

  it('allows two copies to stand while nothing connects them', () => {
    const { t, a, b } = pair()
    t.addTile({ color: 1, value: 1 }, onPetal(a.id, 0))
    const twin = t.addTile({ color: 1, value: 1 }, inDrawer(0))!
    // Plate b's petal 0 is (2,2), three cells from (1,0): nothing links them, so both may stand.
    expect(t.canPlaceTile(onPetal(b.id, 0), twin.id)).toBe(true)
  })

  it('checks the value group as well as the colour group', () => {
    const { t, a, b } = pair()
    // Two Red-4s that do not touch, then a Green-4 bridging them by value.
    t.addTile({ color: 4, value: 4 }, onPetal(a.id, 0))
    t.addTile({ color: 4, value: 4 }, onPetal(b.id, 2))
    const bridge = t.addTile({ color: 2, value: 4 }, inDrawer(0))!
    expect(t.canPlaceTile(onPetal(a.id, 5), bridge.id)).toBe(false)
  })

  it('applies to a plate through the tile it carries', () => {
    const t = createTableau({ cells: hexRectangle(10, 10), drawerSlots: 16, plateSlots: 2 })
    const onTable = t.addPlate(onBoard(0, 0))!
    t.addTile({ color: 1, value: 3 }, onPetal(onTable.id, 0))

    // A plate whose token is the same tile, landing where the two would touch.
    const twinPlate = t.addPlate(inPlateSlot(0))!
    t.addTile({ color: 1, value: 3 }, onPetal(twinPlate.id, 2), { fixed: true })
    expect(t.canPlacePlate(onBoard(1, 2), twinPlate.id)).toBe(false)
  })
})

describe('enclosing a plate lights its anchor', () => {
  /** A plate on the board with `filled` of its petals already holding distinct tiles. */
  function plateWith(filled: number, stemsPerInternalAnchor = 0) {
    const t = createTableau({
      cells: hexRectangle(10, 10), drawerSlots: 16, plateSlots: 2, stemsPerInternalAnchor,
    })
    const plate = t.addPlate(onBoard(0, 0))!
    // Distinct colours and values so no group or neighbour rule interferes with what is being tested.
    for (let petal = 0; petal < filled; petal++) {
      t.addTile({ color: petal, value: petal + 1 }, onPetal(plate.id, petal))
    }
    return { t, plate }
  }

  it('is false while a petal is empty', () => {
    const { t, plate } = plateWith(5)
    expect(t.plateIsEnclosed(plate.id)).toBe(false)
  })

  it('is true once all six hold a tile', () => {
    const { t, plate } = plateWith(6)
    expect(t.plateIsEnclosed(plate.id)).toBe(true)
  })

  it('goes dark again if a tile leaves', () => {
    const { t, plate } = plateWith(6)
    const tile = t.tiles().find(x => x.location.kind === 'onPlate' && x.location.petal === 3)!
    expect(t.moveTile(tile.id, inDrawer(0))).toBe(true)
    expect(t.plateIsEnclosed(plate.id)).toBe(false)
  })

  it('reports false for a plate that does not exist', () => {
    expect(tableau().plateIsEnclosed('nope')).toBe(false)
  })
})

describe('a placement whose reward has nowhere to go', () => {
  /** Five petals filled, and a drawer stuffed so only `freeSlots` remain. */
  function nearlyEnclosed(stemsPerInternalAnchor: number, freeSlots: number) {
    const t = createTableau({
      cells: hexRectangle(10, 10), drawerSlots: 16, plateSlots: 2, stemsPerInternalAnchor,
    })
    const plate = t.addPlate(onBoard(0, 0))!
    for (let petal = 0; petal < 5; petal++) {
      t.addTile({ color: petal, value: petal + 1 }, onPetal(plate.id, petal))
    }
    // The tile about to be placed. Colour 4 so it agrees with the tile on petal 4, which petal 5
    // touches — otherwise the neighbour rule refuses it first and the reward rule is never reached.
    const held = t.addTile({ color: 4, value: 6 }, inDrawer(0))!
    for (const slot of t.freeDrawerSlots().slice(0, 16 - 1 - freeSlots)) t.addStem(slot)
    return { t, plate, held }
  }

  it('is refused when the stems would not fit', () => {
    // Three stems due, and after the tile vacates its slot there are only two places for them.
    const { t, plate, held } = nearlyEnclosed(3, 1)
    expect(t.canPlaceTile(onPetal(plate.id, 5), held.id)).toBe(false)
    expect(t.moveTile(held.id, onPetal(plate.id, 5))).toBe(false)
  })

  it('is allowed when they fit exactly, counting the slot being vacated', () => {
    // Two free slots plus the one the tile leaves behind is exactly the three needed.
    const { t, plate, held } = nearlyEnclosed(3, 2)
    expect(t.canPlaceTile(onPetal(plate.id, 5), held.id)).toBe(true)
  })

  it('does not restrict a placement that encloses nothing', () => {
    const { t, plate, held } = nearlyEnclosed(4, 0)
    // Petal 5 would enclose and is refused; but with only four petals filled there is no reward due.
    expect(t.canPlaceTile(onPetal(plate.id, 5), held.id)).toBe(false)
    const other = t.addPlate(onBoard(1, 2))!
    expect(t.canPlaceTile(onPetal(other.id, 0), held.id)).toBe(true)
  })

  it('is unrestricted when the game awards nothing', () => {
    const { t, plate, held } = nearlyEnclosed(0, 0)
    expect(t.canPlaceTile(onPetal(plate.id, 5), held.id)).toBe(true)
  })
})

describe('a strict enclosure is worth more', () => {
  /**
   * A plate with five petals filled, ready for a sixth.
   *
   * `linked` builds a ring where every neighbouring pair shares its colour; otherwise the ring is
   * broken in the middle by a tile agreeing with nobody.
   */
  function almost(linked: boolean, opts: { stems: number, bonus: number, freeSlots: number }) {
    const t = createTableau({
      cells: hexRectangle(10, 10),
      drawerSlots: 16,
      plateSlots: 2,
      stemsPerInternalAnchor: opts.stems,
      strictEnclosureBonus: opts.bonus,
    })
    const plate = t.addPlate(onBoard(0, 0))!
    // Petals 0–4, all one colour so each touches the next; distinct values so no duplicate arises.
    for (let petal = 0; petal < 5; petal++) {
      const color = linked || petal !== 2 ? 1 : 3
      t.addTile({ color, value: petal + 1 }, onPetal(plate.id, petal))
    }
    const held = t.addTile({ color: 1, value: 6 }, inDrawer(0))!
    for (const slot of t.freeDrawerSlots().slice(0, 16 - 1 - opts.freeSlots)) t.addStem(slot)
    return { t, plate, held }
  }

  it('reports a fully linked ring as strict', () => {
    const { t, plate, held } = almost(true, { stems: 0, bonus: 0, freeSlots: 9 })
    t.moveTile(held.id, onPetal(plate.id, 5))
    expect(t.plateIsEnclosed(plate.id)).toBe(true)
    expect(t.plateEnclosureIsStrict(plate.id)).toBe(true)
  })

  it('reports a ring with one stranger as not strict', () => {
    const { t, plate, held } = almost(false, { stems: 0, bonus: 0, freeSlots: 9 })
    t.moveTile(held.id, onPetal(plate.id, 5))
    expect(t.plateIsEnclosed(plate.id)).toBe(true)
    expect(t.plateEnclosureIsStrict(plate.id)).toBe(false)
  })

  it('needs room for the bonus as well as the base', () => {
    // Three base plus one bonus is four; three slots plus the vacated one is four, so it fits...
    const fits = almost(true, { stems: 3, bonus: 1, freeSlots: 3 })
    expect(fits.t.canPlaceTile(onPetal(fits.plate.id, 5), fits.held.id)).toBe(true)
    // ...and one slot fewer does not.
    const tight = almost(true, { stems: 3, bonus: 1, freeSlots: 2 })
    expect(tight.t.canPlaceTile(onPetal(tight.plate.id, 5), tight.held.id)).toBe(false)
  })

  it('does not reserve room for a bonus the ring will not earn', () => {
    // Same three slots, but the broken ring pays only the base three — so it fits.
    const broken = almost(false, { stems: 3, bonus: 1, freeSlots: 2 })
    expect(broken.t.canPlaceTile(onPetal(broken.plate.id, 5), broken.held.id)).toBe(true)
  })
})

describe('external anchors — bare cells the plates have wrapped', () => {
  const board = (opts: { internal?: number, external?: number, bonus?: number } = {}) =>
    createTableau({
      cells: hexRectangle(12, 12),
      drawerSlots: 16,
      plateSlots: 2,
      stemsPerInternalAnchor: opts.internal ?? 0,
      stemsPerExternalAnchor: opts.external ?? 0,
      strictEnclosureBonus: opts.bonus ?? 0,
    })

  const key = (c: { q: number, r: number }) => `${c.q},${c.r}`

  it('finds one anchor per plate and none else on a lone plate', () => {
    const t = board()
    t.addPlate(onBoard(0, 0))
    const found = t.anchors()
    expect(found).toHaveLength(1)
    expect(found[0]!.kind).toBe('internal')
    expect(key(found[0]!.cell)).toBe('0,0')
  })

  it('finds none where plates interlock, since no cell is left bare', () => {
    const t = board()
    // The six tessellating neighbours: together they leave no gap around the centre.
    for (const [q, r] of [[0, 0], [1, 2], [3, -1], [2, -3], [-1, -2], [-3, 1], [-2, 3]]) {
      t.addPlate(onBoard(q, r))
    }
    expect(t.anchors().filter(a => a.kind === 'external')).toHaveLength(0)
  })

  it('finds the bare cell three off-lattice plates leave between them', () => {
    const t = board()
    // Holes at distance 3 pairwise but off the flower sublattice: their petals ring one bare cell.
    t.addPlate(onBoard(0, 0))
    t.addPlate(onBoard(3, 0))
    t.addPlate(onBoard(0, 3))
    t.addPlate(onBoard(3, -3))
    t.addPlate(onBoard(-3, 3))
    const external = t.anchors().filter(a => a.kind === 'external')
    // Whatever the exact set, every one of them must genuinely be bare and fully surrounded.
    for (const anchor of external) {
      expect(t.coverageAt(anchor.cell)).toBeUndefined()
      for (const step of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
        const around = { q: anchor.cell.q + step[0]!, r: anchor.cell.r + step[1]! }
        expect(t.coverageAt(around)).toBeDefined()
      }
    }
    expect(external.length).toBeGreaterThan(0)
  })

  it('pays the external rate, not the internal one', () => {
    const t = board({ internal: 3, external: 2 })
    t.addPlate(onBoard(0, 0))
    const internal = t.anchors().find(a => a.kind === 'internal')!
    // Reward is only paid on enclosure, so fill the ring first.
    for (let petal = 0; petal < 6; petal++) {
      t.addTile({ color: petal, value: petal + 1 }, onPetal(t.plates()[0]!.id, petal))
    }
    expect(t.anchorIsEnclosed(internal.cell)).toBe(true)
    expect(t.anchorReward(internal)).toBe(3)
    expect(t.anchorReward({ cell: internal.cell, kind: 'external' })).toBe(2)
  })

  it('an unenclosed anchor is worth nothing', () => {
    const t = board({ internal: 3, external: 2 })
    t.addPlate(onBoard(0, 0))
    const internal = t.anchors()[0]!
    expect(t.anchorIsEnclosed(internal.cell)).toBe(false)
    expect(t.anchorReward(internal)).toBe(0)
  })
})

describe('a plate placement reserves room too', () => {
  /** A plate on the board with all six petals filled, and a drawer with `freeSlots` to spare. */
  function enclosedPlate(reward: number, freeSlots: number) {
    const t = createTableau({
      cells: hexRectangle(12, 12),
      drawerSlots: 16,
      plateSlots: 2,
      stemsPerInternalAnchor: reward,
    })
    const plate = t.addPlate(onBoard(0, 0))!
    // One colour, six values: the ring satisfies the neighbour rule, so moving the plate is refused
    // for the reward alone rather than by the tiles disagreeing at the destination.
    for (let petal = 0; petal < 6; petal++) {
      t.addTile({ color: 1, value: petal + 1 }, onPetal(plate.id, petal))
    }
    for (const slot of t.freeDrawerSlots().slice(0, 16 - freeSlots)) t.addStem(slot)
    return { t, plate }
  }

  it('refuses a plate move whose payout would not fit', () => {
    // Moving the plate carries its full ring, so the anchor closes again at the new hole.
    // Nothing is vacated by a plate — it leaves a bay, not a tile slot.
    const { t, plate } = enclosedPlate(3, 2)
    expect(t.canPlacePlate(onBoard(3, 0), plate.id)).toBe(false)
  })

  it('allows it when there is room', () => {
    const { t, plate } = enclosedPlate(3, 3)
    expect(t.canPlacePlate(onBoard(3, 0), plate.id)).toBe(true)
  })

  it('does not charge for staying where it is', () => {
    // The anchor is enclosed before and after, so the move closes nothing new.
    const { t, plate } = enclosedPlate(3, 0)
    expect(t.canPlacePlate(onBoard(0, 0), plate.id)).toBe(true)
  })
})

describe('tiles on the board', () => {
  it('are the ones on a placed plate, and only those', () => {
    const t = tableau()
    const onTable = t.addPlate(onBoard(0, 0))!
    const held = t.addPlate(inPlateSlot(0))!
    const placed = t.addTile(RED, onPetal(onTable.id, 0))!
    const token = t.addTile(BLUE, onPetal(onTable.id, 1), { fixed: true })!
    t.addTile(RED, onPetal(held.id, 0), { fixed: true })
    t.addTile(BLUE, inDrawer(0))

    const ids = t.tilesOnBoard().map(tile => tile.id).sort()
    // The bay plate's token and the drawer tile are not on the board; the placed plate's own is.
    expect(ids).toEqual([placed.id, token.id].sort())
  })

  it('is empty on an empty board', () => {
    const t = tableau()
    t.addTile(RED, inDrawer(0))
    expect(t.tilesOnBoard()).toEqual([])
  })
})
