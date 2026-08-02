import { describe, expect, it } from 'vitest'
import { axialKey, hexRectangle } from '@hexnome/rules/hex'
import { plateCells } from '@hexnome/rules/plate'
import { createTableau, type PlateLocation, type TileSpec } from '@hexnome/rules/tableau'
import { describeBoard, tilesInReadingOrder } from './boardDiagram'
import { HEX_SIZE } from './constants'

const RED: TileSpec = { color: 0, value: 1 }
const BLUE: TileSpec = { color: 3, value: 2 }

const onBoard = (q: number, r: number): PlateLocation => ({ kind: 'board', hole: { q, r } })

function table() {
  return createTableau({
    cells: hexRectangle(8, 8),
    drawerSlots: 16,
    plateSlots: 2,
    sourceLots: 0,
    sourceTilesPerLot: 0,
  })
}

describe('describing a board', () => {
  it('is empty for an empty board', () => {
    const diagram = describeBoard(table(), HEX_SIZE)
    expect(diagram.plates).toEqual([])
    expect(diagram.tiles).toEqual([])
    expect(diagram.bounds).toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 })
  })

  it('gives every placed plate its seven cells', () => {
    const t = table()
    t.addPlate(onBoard(0, 0))
    const diagram = describeBoard(t, HEX_SIZE)
    expect(diagram.plates).toHaveLength(1)
    expect(diagram.plates[0]!.cells).toHaveLength(7)
    expect(diagram.plates[0]!.hole).toEqual({ q: 0, r: 0 })
  })

  /* A plate in a bay is not on the board and has no cells to draw. */
  it('ignores plates that are not on the board', () => {
    const t = table()
    t.addPlate({ kind: 'plateSlot', slot: 0 })
    expect(describeBoard(t, HEX_SIZE).plates).toEqual([])
  })

  it('places a tile at its true cell', () => {
    const t = table()
    const p = t.addPlate(onBoard(0, 0))!
    const tile = t.addTile(RED, { kind: 'onPlate', plateId: p.id, petal: 0 })!
    const diagram = describeBoard(t, HEX_SIZE)
    expect(diagram.tiles).toHaveLength(1)
    expect(diagram.tiles[0]!.cell).toEqual(t.cellOfTile(tile.id))
  })

  /*
   * The one bug that would draw a plausible but wrong board. `cellOfTile` resolves a petal *through*
   * the plate's rotation, so a rotated plate's tile must land somewhere else than petal 0's cell.
   */
  it('follows a rotated plate, rather than drawing the unrotated petal', () => {
    const straight = table()
    const a = straight.addPlate(onBoard(0, 0))!
    straight.addTile(RED, { kind: 'onPlate', plateId: a.id, petal: 0 })

    const turned = table()
    const b = turned.addPlate(onBoard(0, 0))!
    turned.rotatePlate(b.id, 1)
    turned.addTile(RED, { kind: 'onPlate', plateId: b.id, petal: 0 })

    const cellA = describeBoard(straight, HEX_SIZE).tiles[0]!.cell
    const cellB = describeBoard(turned, HEX_SIZE).tiles[0]!.cell
    expect(axialKey(cellA)).not.toBe(axialKey(cellB))
    // And it agrees with the model rather than with the renderer's own arithmetic.
    expect(cellB).toEqual(turned.cellOfTile(turned.tilesOnBoard()[0]!.id))
  })

  it('includes the plate\'s own token', () => {
    const t = table()
    const p = t.addPlate(onBoard(0, 0))!
    t.addTile(RED, { kind: 'onPlate', plateId: p.id, petal: 2 }, { fixed: true })
    const diagram = describeBoard(t, HEX_SIZE)
    expect(diagram.tiles.map(tile => tile.fixed)).toEqual([true])
  })

  it('reports each plate\'s hole as an internal anchor', () => {
    const t = table()
    t.addPlate(onBoard(0, 0))
    const internal = describeBoard(t, HEX_SIZE).anchors.filter(a => a.kind === 'internal')
    expect(internal).toHaveLength(1)
    expect(internal[0]).toEqual({ cell: { q: 0, r: 0 }, kind: 'internal', lit: false })
  })

  it('lights an anchor once all six around it are filled', () => {
    const t = table()
    const p = t.addPlate(onBoard(0, 0))!
    for (let petal = 0; petal < 6; petal++) {
      t.addTile({ color: petal, value: 1 }, { kind: 'onPlate', plateId: p.id, petal })
    }
    const hole = describeBoard(t, HEX_SIZE).anchors.find(a => a.kind === 'internal')
    expect(hole?.lit).toBe(true)
  })

  describe('framing', () => {
    it('encloses every cell of every plate', () => {
      const t = table()
      t.addPlate(onBoard(0, 0))
      const { bounds } = describeBoard(t, HEX_SIZE)
      // Every covered cell centre must sit strictly inside, the bounds covering whole hexagons.
      for (const cell of plateCells({ q: 0, r: 0 })) {
        const { x, z } = { x: HEX_SIZE * Math.sqrt(3) * (cell.q + cell.r / 2), z: HEX_SIZE * 1.5 * cell.r }
        expect(x).toBeGreaterThan(bounds.minX)
        expect(x).toBeLessThan(bounds.maxX)
        expect(z).toBeGreaterThan(bounds.minZ)
        expect(z).toBeLessThan(bounds.maxZ)
      }
    })

    it('grows to take in a second plate', () => {
      const one = table()
      one.addPlate(onBoard(0, 0))
      const two = table()
      two.addPlate(onBoard(0, 0))
      two.addPlate(onBoard(1, 2))
      expect(describeBoard(two, HEX_SIZE).bounds.maxX)
        .toBeGreaterThan(describeBoard(one, HEX_SIZE).bounds.maxX)
    })
  })
})

describe('reading order', () => {
  /*
   * The reveal follows this order, so it has to sweep rather than hop. Tiles are added here in an
   * order deliberately unlike their layout, which is what a real game produces.
   */
  it('runs down the board and then across, whatever order tiles were placed in', () => {
    const t = table()
    const p = t.addPlate(onBoard(0, 0))!
    // Petals 0..5 are E, NE, NW, W, SW, SE — so placing in petal order is not reading order.
    for (let petal = 0; petal < 6; petal++) {
      t.addTile({ color: petal, value: 1 }, { kind: 'onPlate', plateId: p.id, petal })
    }

    const cells = tilesInReadingOrder(t).map(tile => t.cellOfTile(tile.id)!)
    const rows = cells.map(c => c.r)
    expect([...rows].sort((a, b) => a - b)).toEqual(rows)

    // Within a row, left to right.
    for (let i = 1; i < cells.length; i++) {
      if (cells[i]!.r === cells[i - 1]!.r) expect(cells[i]!.q).toBeGreaterThan(cells[i - 1]!.q)
    }
  })

  it('returns every board tile exactly once', () => {
    const t = table()
    const p = t.addPlate(onBoard(0, 0))!
    t.addTile(RED, { kind: 'onPlate', plateId: p.id, petal: 0 })
    t.addTile(BLUE, { kind: 'onPlate', plateId: p.id, petal: 3 })
    expect(tilesInReadingOrder(t).map(tile => tile.id).sort())
      .toEqual(t.tilesOnBoard().map(tile => tile.id).sort())
  })
})
