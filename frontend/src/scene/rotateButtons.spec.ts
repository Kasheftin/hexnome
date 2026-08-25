import { describe, expect, it } from 'vitest'
import { PLATE_SLOT_CHOICES, TILE_SLOT_CHOICES } from '@hexnome/rules/gameSettings'
import { createDrawerLayout, type DrawerLayout, type DrawerShape } from './drawerLayout'
import { rotateButtonBoxes } from './rotateButtons'

/**
 * The rotate buttons, against the bay they have to land in.
 *
 * These are the numbers that made the game unfinishable on a phone: the buttons only appeared on
 * hover, and once that was fixed they were still laid out for a drawer at full size, which no phone
 * has. So what is worth asserting is not the arithmetic but the two properties a finger needs —
 * inside the bay, and big enough to hit — held at every window the game runs in.
 */

const DEFAULT: DrawerShape = { tileSlots: 12, plateSlots: 2 }

/** Windows the game is really opened at, smallest first. */
const WINDOWS: readonly (readonly [string, number, number])[] = [
  ['iPhone SE portrait', 375, 667],
  ['iPhone 14 portrait', 390, 844],
  ['iPhone 14 landscape', 844, 390],
  ['iPad portrait', 820, 1180],
  ['laptop', 1280, 800],
  ['desktop', 1920, 1080],
]

function everyShape(): DrawerShape[] {
  return TILE_SLOT_CHOICES.flatMap(tileSlots =>
    PLATE_SLOT_CHOICES.map(plateSlots => ({ tileSlots, plateSlots })))
}

/** A bay's own edges, relative to its centre — what a button has to stay within. */
function bay(layout: DrawerLayout): { halfWidth: number, halfHeight: number } {
  return { halfWidth: layout.plateSlotWidth / 2, halfHeight: layout.plateSlotHeight / 2 }
}

describe('with a pointer, the pair sit in the bay\'s top corners', () => {
  /*
   * They used to float above the bay — 58px out and 44px up from its centre — which put them over the
   * board rather than over the thing they act on. Now they are inset from its own corners, so they
   * read as belonging to the bay whatever size it is.
   */
  it('insets them 16px from a full-size bay\'s top corners', () => {
    const layout = createDrawerLayout(1920, 1080, DEFAULT)
    expect(layout.scale).toBe(1)
    const { halfWidth, halfHeight } = bay(layout)
    const { left, right } = rotateButtonBoxes(layout, false)

    expect(left.left).toBeCloseTo(-halfWidth + 16, 6)
    expect(right.left + right.size).toBeCloseTo(halfWidth - 16, 6)
    expect(left.top).toBeCloseTo(-halfHeight + 16, 6)
    expect(right.top).toBeCloseTo(-halfHeight + 16, 6)
    expect(left.size).toBe(26)
  })

  /**
   * The inset follows the drawer, as the size does. A 1000px window with the biggest drawer scales to
   * about 0.75, and a fixed 16px there would be a fifth of the bay rather than a margin.
   */
  it('scales the inset with the drawer', () => {
    const layout = createDrawerLayout(1000, 800, { tileSlots: 16, plateSlots: 3 })
    expect(layout.scale).toBeLessThan(1)
    const { halfWidth } = bay(layout)

    const { left, right } = rotateButtonBoxes(layout, false)
    expect(right.size).toBeCloseTo(26 * layout.scale, 6)
    expect(left.left).toBeCloseTo(-halfWidth + 16 * layout.scale, 6)
  })

  /** Whatever the pointer, a button belongs inside the bay it acts on. */
  it.each(WINDOWS)('keeps both buttons inside the bay at %s', (_name, width, height) => {
    const layout = createDrawerLayout(width, height, DEFAULT)
    const { halfWidth, halfHeight } = bay(layout)
    const { left, right } = rotateButtonBoxes(layout, false)

    expect(left.left).toBeGreaterThanOrEqual(-halfWidth)
    expect(right.left + right.size).toBeLessThanOrEqual(halfWidth)
    expect(left.top).toBeGreaterThanOrEqual(-halfHeight)
    expect(left.top + left.size).toBeLessThanOrEqual(halfHeight)
  })
})

describe('without a pointer, where the buttons are always showing', () => {
  it.each(WINDOWS)('keeps both buttons inside the bay at %s', (_name, width, height) => {
    const layout = createDrawerLayout(width, height, DEFAULT)
    const { halfWidth, halfHeight } = bay(layout)
    const { left, right } = rotateButtonBoxes(layout, true)

    expect(left.left).toBeGreaterThanOrEqual(-halfWidth)
    expect(right.left + right.size).toBeLessThanOrEqual(halfWidth)
    expect(left.top).toBeGreaterThanOrEqual(-halfHeight)
    expect(left.top + left.size).toBeLessThanOrEqual(halfHeight)
  })

  /**
   * The pair must not meet. Two overlapping buttons are worse than two small ones — whichever paints
   * second takes both taps, so one of the two directions silently stops working.
   */
  it('leaves a gap between the pair for every drawer at every window', () => {
    for (const shape of everyShape()) {
      for (const [name, width, height] of WINDOWS) {
        const { left, right } = rotateButtonBoxes(createDrawerLayout(width, height, shape), true)
        const gap = right.left - (left.left + left.size)
        const where = `${shape.plateSlots}×${shape.tileSlots} at ${name}`
        expect(`${where}: ${gap > 0}`).toBe(`${where}: true`)
      }
    }
  })

  /** 10px was what scaling alone produced on a phone. The point of the touch case is that it does not. */
  it('is big enough to press on a phone', () => {
    const phone = createDrawerLayout(390, 844, DEFAULT)
    expect(rotateButtonBoxes(phone, true).right.size).toBeGreaterThanOrEqual(30)
    // And the naive answer this exists to avoid.
    expect(rotateButtonBoxes(phone, false).right.size).toBeLessThan(12)
  })

  /**
   * Never smaller than the pointer version of itself, at any window.
   *
   * The interesting direction is the one this does not forbid: on a full-size drawer a touch button
   * comes out *bigger* than the design's 26px, because 26px is a comfortable mouse target and a mean
   * finger one, and a tablet with room to spare should spend it.
   */
  it('is never smaller than it would be for a mouse', () => {
    for (const shape of everyShape()) {
      for (const [name, width, height] of WINDOWS) {
        const layout = createDrawerLayout(width, height, shape)
        const touch = rotateButtonBoxes(layout, true).right.size
        const mouse = rotateButtonBoxes(layout, false).right.size
        const where = `${shape.plateSlots}×${shape.tileSlots} at ${name}`
        expect(`${where}: ${touch >= mouse}`).toBe(`${where}: true`)
      }
    }
  })
})
