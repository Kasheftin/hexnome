import { describe, expect, it } from 'vitest'
import {
  STANDARD_TILE_COPIES,
  TILE_COLOR_COUNT,
  TILE_VALUE_COUNT,
  createDeck,
} from './deck'
import { PETAL_COUNT } from './plate'
import type { TileSpec } from './tableau'

const ID_A = '3f2a1c8e-5b6d-4e7f-9a0b-1c2d3e4f5a6b'
const ID_B = '00000000-0000-4000-8000-000000000000'

const DISTINCT = TILE_COLOR_COUNT * TILE_VALUE_COUNT
const key = (t: TileSpec): string => `${t.color}:${t.value}`

/**
 * These are the tests that earn the module.
 *
 * Once an id has been handed out, the deck it deals is a promise: come back to this link and get
 * this game. Nothing at runtime can notice that promise being broken — a changed hash or a flipped
 * shuffle direction just quietly deals something else. Pinning the exact output is what turns that
 * into a failing test rather than a player's confusion.
 *
 * So if one of these fails, the question is not "what are the new values" — it is whether existing
 * ids were meant to change. If they were, the pins move and the reason goes in the commit. If not,
 * the code is wrong.
 */
describe('the deck a given id deals', () => {
  it('is exactly this, for these two ids', () => {
    const a = createDeck(ID_A)
    expect(a.plates.slice(0, 5)).toEqual([
      { color: 1, value: 1, petal: 5 },
      { color: 4, value: 4, petal: 2 },
      { color: 2, value: 6, petal: 1 },
      { color: 3, value: 3, petal: 5 },
      { color: 5, value: 5, petal: 4 },
    ])
    expect(a.tiles.slice(0, 5)).toEqual([
      { color: 5, value: 2 },
      { color: 4, value: 3 },
      { color: 1, value: 4 },
      { color: 1, value: 1 },
      { color: 5, value: 2 },
    ])

    // A second id, chosen to be all-zeros where the first is arbitrary: a hash that collapsed on
    // low-entropy input would show up here and not in ID_A.
    const b = createDeck(ID_B)
    expect(b.plates.slice(0, 5)).toEqual([
      { color: 5, value: 5, petal: 3 },
      { color: 3, value: 2, petal: 4 },
      { color: 3, value: 4, petal: 2 },
      { color: 1, value: 6, petal: 0 },
      { color: 0, value: 1, petal: 2 },
    ])
    expect(b.tiles.slice(0, 5)).toEqual([
      { color: 4, value: 4 },
      { color: 3, value: 6 },
      { color: 3, value: 5 },
      { color: 0, value: 4 },
      { color: 0, value: 3 },
    ])
  })

  it('is the same every time it is built', () => {
    expect(createDeck(ID_A)).toEqual(createDeck(ID_A))
  })

  it('is unrelated for ids differing by one character', () => {
    // Consecutive randomUUID() values are unrelated, but a hand-edited or sequentially generated
    // id need not be. A weak hash would deal near-identical decks for near-identical ids.
    const near = `${ID_A.slice(0, -1)}c`
    const one = createDeck(ID_A)
    const two = createDeck(near)

    const samePlate = one.plates.filter((p, i) => key(p) === key(two.plates[i] as TileSpec)).length
    const sameTile = one.tiles.filter((t, i) => key(t) === key(two.tiles[i] as TileSpec)).length

    // Two independent shuffles of 36 distinct items agree in ~1 position on average; 108 tiles with
    // 3 copies each agree in ~3. Anything above a handful means the seeds were correlated.
    expect(samePlate).toBeLessThan(8)
    expect(sameTile).toBeLessThan(16)
  })
})

describe('bag composition', () => {
  it('holds one plate per distinct tile, none missing or repeated', () => {
    const { plates } = createDeck(ID_A)
    expect(plates).toHaveLength(DISTINCT)
    expect(new Set(plates.map(key)).size).toBe(DISTINCT)
  })

  it('holds three copies of each distinct tile', () => {
    const { tiles } = createDeck(ID_A)
    expect(tiles).toHaveLength(DISTINCT * STANDARD_TILE_COPIES)

    const counts = new Map<string, number>()
    for (const tile of tiles) counts.set(key(tile), (counts.get(key(tile)) ?? 0) + 1)
    expect(counts.size).toBe(DISTINCT)
    for (const count of counts.values()) expect(count).toBe(STANDARD_TILE_COPIES)
  })

  it('gives every plate a real petal for its own tile', () => {
    for (const plate of createDeck(ID_A).plates) {
      expect(plate.petal).toBeGreaterThanOrEqual(0)
      expect(plate.petal).toBeLessThan(PETAL_COUNT)
      expect(Number.isInteger(plate.petal)).toBe(true)
    }
  })

  it('uses all six petals across the bag rather than favouring one', () => {
    // Cheap guard against the petal draw being constant or degenerate — a bug that would be easy
    // to miss on screen, since a plate rotates freely anyway.
    const used = new Set(createDeck(ID_A).plates.map(p => p.petal))
    expect(used.size).toBe(PETAL_COUNT)
  })

  it('scales the tile bag with tileCopies, for the modes that will want fewer', () => {
    const { tiles } = createDeck(ID_A, { tileCopies: 1 })
    expect(tiles).toHaveLength(DISTINCT)
    expect(new Set(tiles.map(key)).size).toBe(DISTINCT)
  })
})

describe('the two bags are independent', () => {
  it('so changing the tile count leaves the plate order untouched', () => {
    // The point of separate streams. On a shared stream, drawing a different number of tiles would
    // shift every plate after it — coupling two things the game has no reason to couple.
    expect(createDeck(ID_A, { tileCopies: 1 }).plates).toEqual(createDeck(ID_A).plates)
  })

  it('so the two are not the same permutation of the same 36 items', () => {
    // Both bags shuffle the same 36 distinct pairs. If they shared a stream — or were both seeded
    // from the bare id — a one-copy tile bag would come out in the plate bag's exact order.
    const { plates } = createDeck(ID_A)
    const { tiles } = createDeck(ID_A, { tileCopies: 1 })
    expect(tiles.map(key)).not.toEqual(plates.map(key))
  })
})
