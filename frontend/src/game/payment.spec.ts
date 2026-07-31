import { describe, expect, it } from 'vitest'
import {
  canConfirmPayment,
  paymentAttribute,
  paymentCost,
  paymentStates,
  togglePayment,
  type Payer,
} from './payment'

const BLUE = 1
const YELLOW = 3
const RED = 4

const tile = (id: string, color: number, value: number): Payer =>
  ({ id, kind: 'tile', color, value })
const plate = (id: string, color: number, value: number): Payer =>
  ({ id, kind: 'plate', color, value })
const stem = (id: string): Payer => ({ id, kind: 'stem' })

const BLUE_3 = { color: BLUE, value: 3 }

describe('what a placement costs', () => {
  it('is one less than its value', () => {
    expect(paymentCost({ color: 0, value: 1 })).toBe(0)
    expect(paymentCost({ color: 0, value: 3 })).toBe(2)
    expect(paymentCost({ color: 0, value: 6 })).toBe(5)
  })

  it('lets a value-1 item go down for free, with nothing selected', () => {
    expect(canConfirmPayment({ color: BLUE, value: 1 }, [tile('a', RED, 4)], [])).toBe(true)
  })
})

describe('paying for a blue-3', () => {
  it('takes two objects — not three', () => {
    const purse = [stem('s1'), stem('s2'), stem('s3')]
    expect(canConfirmPayment(BLUE_3, purse, ['s1'])).toBe(false)
    expect(canConfirmPayment(BLUE_3, purse, ['s1', 's2'])).toBe(true)
    expect(canConfirmPayment(BLUE_3, purse, ['s1', 's2', 's3'])).toBe(false)
  })

  it('accepts a stem and a blue-2 plate', () => {
    // The worked example: a plate pays by its token, and mixes freely with a wild stem.
    const purse = [stem('s1'), plate('p', BLUE, 2)]
    expect(canConfirmPayment(BLUE_3, purse, ['s1', 'p'])).toBe(true)
    expect(paymentAttribute(BLUE_3, purse, ['s1', 'p'])).toBe('color')
  })

  it('accepts two 3s of other colours', () => {
    const purse = [tile('y', YELLOW, 3), tile('r', RED, 3)]
    expect(canConfirmPayment(BLUE_3, purse, ['y', 'r'])).toBe(true)
    expect(paymentAttribute(BLUE_3, purse, ['y', 'r'])).toBe('value')
  })

  it('refuses another blue-3, whether tile or plate', () => {
    const purse = [tile('t', BLUE, 3), plate('p', BLUE, 3), stem('s')]
    // Equal to what is being placed, so barred outright — the plate no less than the tile.
    expect(paymentStates(BLUE_3, purse, []).get('t')).toBe('inactive')
    expect(paymentStates(BLUE_3, purse, []).get('p')).toBe('inactive')
    expect(canConfirmPayment(BLUE_3, purse, ['t', 's'])).toBe(false)
  })

  it('refuses two yellow-3s, because they are equal to each other', () => {
    const purse = [tile('y1', YELLOW, 3), tile('y2', YELLOW, 3)]
    expect(canConfirmPayment(BLUE_3, purse, ['y1', 'y2'])).toBe(false)
    // And the second one is not even offered once the first is taken.
    expect(paymentStates(BLUE_3, purse, ['y1']).get('y2')).toBe('inactive')
  })

  it('refuses payers that share neither attribute', () => {
    const purse = [tile('x', RED, 5), stem('s')]
    expect(paymentStates(BLUE_3, purse, []).get('x')).toBe('inactive')
    expect(canConfirmPayment(BLUE_3, purse, ['x', 's'])).toBe(false)
  })
})

describe('the strategy pins on the first real payer', () => {
  const purse = [tile('blue1', BLUE, 1), tile('yellow3', YELLOW, 3), stem('s')]

  it('offers both readings while only stems are picked', () => {
    expect(paymentAttribute(BLUE_3, purse, ['s'])).toBeNull()
    const states = paymentStates(BLUE_3, purse, ['s'])
    expect(states.get('blue1')).toBe('active')
    expect(states.get('yellow3')).toBe('active')
  })

  it('closes the other reading as soon as a real payer is picked', () => {
    // Nothing can share both attributes with the target — that would make it equal to it — so one
    // pick settles the strategy outright.
    const states = paymentStates(BLUE_3, purse, ['blue1'])
    expect(paymentAttribute(BLUE_3, purse, ['blue1'])).toBe('color')
    expect(states.get('yellow3')).toBe('inactive')
    expect(states.get('s')).toBe('active')
  })

  it('re-opens it when that payer is dropped', () => {
    const after = togglePayment(BLUE_3, purse, ['blue1'], 'blue1')
    expect(after).toEqual([])
    expect(paymentStates(BLUE_3, purse, after).get('yellow3')).toBe('active')
  })
})

describe('the purse closes once the price is met', () => {
  it('offers nothing further', () => {
    const purse = [stem('s1'), stem('s2'), tile('b', BLUE, 2)]
    const states = paymentStates(BLUE_3, purse, ['s1', 's2'])
    expect(states.get('b')).toBe('inactive')
    expect(togglePayment(BLUE_3, purse, ['s1', 's2'], 'b')).toEqual(['s1', 's2'])
  })

  it('offers nothing at all when the placement is free', () => {
    const purse = [stem('s1'), tile('b', BLUE, 2)]
    const states = paymentStates({ color: BLUE, value: 1 }, purse, [])
    expect([...states.values()]).toEqual(['inactive', 'inactive'])
  })
})

describe('stems', () => {
  it('are wild: no matching, and any number of them', () => {
    const purse = [stem('s1'), stem('s2'), stem('s3'), stem('s4'), stem('s5')]
    const five = { color: RED, value: 6 }
    expect(canConfirmPayment(five, purse, purse.map(p => p.id))).toBe(true)
  })

  it('are exempt from the equal-items rule, having nothing to be equal by', () => {
    const purse = [stem('s1'), stem('s2')]
    expect(canConfirmPayment(BLUE_3, purse, ['s1', 's2'])).toBe(true)
  })
})
