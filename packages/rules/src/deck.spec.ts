import { describe, expect, it } from 'vitest'
import {
  DISTINCT_TILES,
  MAX_PLAYERS,
  STARTING_PLATE_VALUE,
  TILE_COLOR_COUNT,
  TILE_VALUE_COUNT,
  openingPlateCodes,
} from './deck'
import { tileFromCode } from './desk'

const SEED = '3f2a1c8e-5b6d-4e7f-9a0b-1c2d3e4f5a6b'

describe('the counts a game is built from', () => {
  it('are six by six', () => {
    expect([TILE_COLOR_COUNT, TILE_VALUE_COUNT]).toEqual([6, 6])
    expect(DISTINCT_TILES).toBe(36)
  })

  /* Six colours, one plate each: a seventh player would have to double up. */
  it('cap a table at one colour per player', () => {
    expect(MAX_PLAYERS).toBe(TILE_COLOR_COUNT)
  })
})

describe('the plates the players open on', () => {
  it('gives each player a value-1 plate of their own colour', () => {
    for (const players of [1, 2, 4, 6]) {
      const codes = openingPlateCodes(SEED, players)
      expect(codes).toHaveLength(players)

      const specs = codes.map(tileFromCode)
      expect(specs.every(spec => spec?.value === STARTING_PLATE_VALUE)).toBe(true)
      expect(new Set(specs.map(spec => spec?.color)).size).toBe(players)
    }
  })

  it('is decided by the seed, so a replay opens the same way', () => {
    expect(openingPlateCodes(SEED, 3)).toEqual(openingPlateCodes(SEED, 3))
    expect(openingPlateCodes(SEED, 3)).not.toEqual(openingPlateCodes(`${SEED}x`, 3))
  })

  /*
   * The opening comes off its own stream, not off the desk. If it shared one, knowing which colour you
   * opened with would say something about the order of a bag the client is not supposed to see.
   */
  it('takes a prefix, so a bigger table opens the smaller one\'s hands', () => {
    expect(openingPlateCodes(SEED, 6).slice(0, 2)).toEqual(openingPlateCodes(SEED, 2))
  })

  it('seats at most six however many are asked for', () => {
    expect(openingPlateCodes(SEED, 99)).toHaveLength(MAX_PLAYERS)
    expect(openingPlateCodes(SEED, 0)).toEqual([])
    expect(openingPlateCodes(SEED, -1)).toEqual([])
  })
})
