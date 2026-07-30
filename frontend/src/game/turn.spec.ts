import { describe, expect, it } from 'vitest'
import { hasRealAction, turnOptions } from './turn'

describe('which actions are open', () => {
  const base = { sourceTiles: 4, drawerItems: 2, freeDrawerSlots: 14 }

  it('opens everything when there is something to draft and something to place', () => {
    expect(turnOptions(base)).toEqual({ take: true, put: true, pass: true })
  })

  it('closes put when the drawer is empty', () => {
    // The opening position: nothing has been drafted yet, so the only real action is a draft.
    expect(turnOptions({ ...base, drawerItems: 0 }).put).toBe(false)
    expect(turnOptions({ ...base, drawerItems: 0 }).take).toBe(true)
  })

  it('closes take when the source is empty', () => {
    expect(turnOptions({ ...base, sourceTiles: 0 }).take).toBe(false)
  })

  it('closes take when the drawer has no room, even with tiles showing', () => {
    // Choosing it would lead to a draft that could never be confirmed.
    expect(turnOptions({ ...base, freeDrawerSlots: 0 }).take).toBe(false)
  })

  it('always leaves pass open', () => {
    expect(turnOptions({ sourceTiles: 0, drawerItems: 0, freeDrawerSlots: 0 }).pass).toBe(true)
  })
})

describe('a turn with nothing to do', () => {
  it('is one where only pass remains', () => {
    expect(hasRealAction(turnOptions({ sourceTiles: 0, drawerItems: 0, freeDrawerSlots: 5 })))
      .toBe(false)
    expect(hasRealAction(turnOptions({ sourceTiles: 1, drawerItems: 0, freeDrawerSlots: 5 })))
      .toBe(true)
  })
})
