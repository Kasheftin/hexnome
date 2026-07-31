import { describe, expect, it } from 'vitest'
import {
  FIRST_TURN,
  hasRealAction,
  nextRound,
  nextTurn,
  turnOptions,
} from './turn'

describe('which actions are open', () => {
  const base = {
    sourceTiles: 4,
    sourcePlates: 0,
    placeableItems: 2,
    freeDrawerSlots: 14,
    freePlateSlots: 2,
  }

  it('opens everything when there is something to draft and something to place', () => {
    expect(turnOptions(base)).toEqual({ take: true, put: true, pass: true })
  })

  it('closes put when the drawer is empty', () => {
    // The opening position: nothing has been drafted yet, so the only real action is a draft.
    expect(turnOptions({ ...base, placeableItems: 0 }).put).toBe(false)
    expect(turnOptions({ ...base, placeableItems: 0 }).take).toBe(true)
  })

  it('closes take when the source is empty', () => {
    expect(turnOptions({ ...base, sourceTiles: 0 }).take).toBe(false)
  })

  it('closes take when the tile grid is full and only tiles are showing', () => {
    // Choosing it would lead to a draft that could never be confirmed.
    expect(turnOptions({ ...base, freeDrawerSlots: 0 }).take).toBe(false)
  })

  it('keeps take open for a plate when the tile grid is full', () => {
    // Tiles and plates go to different places, so a full tile grid does not close a plate draft.
    expect(turnOptions({ ...base, freeDrawerSlots: 0, sourcePlates: 1 }).take).toBe(true)
  })

  it('keeps take open for tiles when the plate bays are full', () => {
    expect(turnOptions({ ...base, freePlateSlots: 0 }).take).toBe(true)
  })

  it('closes take when neither kind has anywhere to go', () => {
    expect(turnOptions({ ...base, sourcePlates: 3, freeDrawerSlots: 0, freePlateSlots: 0 }).take)
      .toBe(false)
  })

  it('always leaves pass open', () => {
    expect(turnOptions({ ...base, sourceTiles: 0, placeableItems: 0, freeDrawerSlots: 0 }).pass)
      .toBe(true)
  })
})

describe('a turn with nothing to do', () => {
  it('is one where only pass remains', () => {
    const bare = { sourcePlates: 0, freePlateSlots: 2 }
    expect(hasRealAction(turnOptions({ ...bare, sourceTiles: 0, placeableItems: 0, freeDrawerSlots: 5 })))
      .toBe(false)
    expect(hasRealAction(turnOptions({ ...bare, sourceTiles: 1, placeableItems: 0, freeDrawerSlots: 5 })))
      .toBe(true)
  })
})

describe('the round and turn count', () => {
  it('starts on the first turn of the first round', () => {
    expect(FIRST_TURN).toEqual({ round: 1, turn: 1 })
  })

  it('counts turns up within a round', () => {
    expect(nextTurn(nextTurn(FIRST_TURN))).toEqual({ round: 1, turn: 3 })
  })

  it('restarts the turn count on a new round', () => {
    // The decision this type exists to pin down: "round 2, turn 5" is the fifth turn *of round 2*.
    const late = nextTurn(nextTurn(nextTurn(FIRST_TURN)))
    expect(nextRound(late)).toEqual({ round: 2, turn: 1 })
  })

  it('does not mutate what it is given', () => {
    const start = FIRST_TURN
    nextTurn(start)
    nextRound(start)
    expect(start).toEqual({ round: 1, turn: 1 })
  })
})
