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

describe('with a pointer, the design is left exactly as it was', () => {
  /** The three numbers that used to be written in the stylesheet, reproduced from the design. */
  it('puts a full-size drawer where the hand-written CSS did', () => {
    const boxes = rotateButtonBoxes(createDrawerLayout(1920, 1080, DEFAULT), false)

    expect(boxes.left).toEqual({ left: -71, top: -57, size: 26, glyph: 15 })
    expect(boxes.right).toEqual({ left: 45, top: -57, size: 26, glyph: 15 })
  })

  /**
   * The bug the hover path had too, quietly: a 1000px window with the biggest drawer scales to about
   * 0.75, and the buttons were still placed at 58px out. Nobody noticed because they were only ever
   * a quarter of a bay wrong, but they were wrong.
   */
  it('follows the drawer down when the window is too narrow for it', () => {
    const layout = createDrawerLayout(1000, 800, { tileSlots: 16, plateSlots: 3 })
    expect(layout.scale).toBeLessThan(1)

    const boxes = rotateButtonBoxes(layout, false)
    expect(boxes.right.size).toBeCloseTo(26 * layout.scale, 6)
    expect(boxes.right.left + boxes.right.size / 2).toBeCloseTo(58 * layout.scale, 6)
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
