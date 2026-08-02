import { describe, expect, it } from 'vitest'
import { PLATE_SLOT_CHOICES, TILE_SLOT_CHOICES } from '@hexnome/rules/gameSettings'
import { DRAWER_SIDE_GAP_PX } from './constants'
import { createDrawerLayout, type DrawerShape } from './drawerLayout'

const DEFAULT: DrawerShape = { tileSlots: 16, plateSlots: 2 }
const LARGEST: DrawerShape = { tileSlots: 18, plateSlots: 3 }
const SMALLEST: DrawerShape = { tileSlots: 12, plateSlots: 1 }

/** Every drawer a player can actually ask for. */
function everyShape(): DrawerShape[] {
  return TILE_SLOT_CHOICES.flatMap(tileSlots =>
    PLATE_SLOT_CHOICES.map(plateSlots => ({ tileSlots, plateSlots })))
}

describe('when the drawer fits', () => {
  it('is left at its designed size', () => {
    expect(createDrawerLayout(1920, 1080, LARGEST).scale).toBe(1)
  })

  /* The panel is not a thing to stretch: the constants are the intended size, not a minimum. */
  it('never grows past its designed size, however much room there is', () => {
    expect(createDrawerLayout(5000, 4000, SMALLEST).scale).toBe(1)
  })

  it('leaves the default drawer on a big screen exactly as it was', () => {
    const layout = createDrawerLayout(1920, 1080, DEFAULT)
    expect(layout.scale).toBe(1)
    expect(layout.slotSize).toBe(83)
    expect(layout.plateSlotWidth).toBe(198)
  })

  it('centres it horizontally', () => {
    const layout = createDrawerLayout(1920, 1080, DEFAULT)
    expect(layout.left + layout.width / 2).toBeCloseTo(960)
  })
})

describe('when it does not fit', () => {
  /* The case that prompted this: 18 tiles and 3 bays want 1383px, more than a 1366 laptop has. */
  it('shrinks the largest drawer onto a laptop', () => {
    const layout = createDrawerLayout(1366, 768, LARGEST)
    expect(layout.scale).toBeLessThan(1)
    expect(layout.width).toBeLessThanOrEqual(1366)
  })

  it('fits every drawer a player can choose, at every width worth caring about', () => {
    for (const shape of everyShape()) {
      for (const width of [1920, 1600, 1440, 1366, 1280, 1024, 900, 800, 640]) {
        const layout = createDrawerLayout(width, 900, shape)
        expect(layout.width).toBeLessThanOrEqual(width)
        expect(layout.left).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('keeps the side gap it was given', () => {
    const layout = createDrawerLayout(800, 900, LARGEST)
    expect(layout.left).toBeGreaterThanOrEqual(DRAWER_SIDE_GAP_PX - 0.5)
  })

  it('keeps its proportions rather than squashing one axis', () => {
    const full = createDrawerLayout(1920, 1080, LARGEST)
    const small = createDrawerLayout(900, 1080, LARGEST)
    expect(small.width / small.height).toBeCloseTo(full.width / full.height, 5)
  })

  /* A wide but short window: the height term takes over so the drawer cannot eat the board. */
  it('shrinks by height when the window is short rather than narrow', () => {
    const layout = createDrawerLayout(1920, 400, DEFAULT)
    expect(layout.scale).toBeLessThan(1)
    expect(layout.height).toBeLessThanOrEqual(400 * 0.33)
  })
})

/*
 * The property the whole design rests on: the panel's picture and its drop targets are the same
 * rectangles. If the fit factor reached one and not the other, tiles would land in the wrong slot —
 * which is exactly the sort of bug that looks like a rendering glitch.
 */
describe('the drop targets follow the drawing', () => {
  it('resolves the centre of every tile slot back to that slot, at any scale', () => {
    for (const width of [1920, 1280, 900, 640]) {
      const layout = createDrawerLayout(width, 900, LARGEST)
      for (let slot = 0; slot < layout.slotCount; slot++) {
        const { x, y } = layout.slotCentre(slot)
        expect(layout.slotAt(x, y)).toBe(slot)
      }
    }
  })

  it('resolves the centre of every bay back to that bay, at any scale', () => {
    for (const width of [1920, 1280, 900, 640]) {
      const layout = createDrawerLayout(width, 900, LARGEST)
      for (let slot = 0; slot < layout.plateSlotCount; slot++) {
        const { x, y } = layout.plateSlotCentre(slot)
        expect(layout.plateSlotAt(x, y)).toBe(slot)
      }
    }
  })

  it('keeps every slot inside the panel', () => {
    const layout = createDrawerLayout(900, 900, LARGEST)
    for (let slot = 0; slot < layout.slotCount; slot++) {
      const { x, y } = layout.slotCentre(slot)
      expect(layout.contains(x, y)).toBe(true)
    }
  })

  it('reports nothing for a point outside the grid', () => {
    const layout = createDrawerLayout(1920, 1080, DEFAULT)
    expect(layout.slotAt(0, 0)).toBeNull()
    expect(layout.plateSlotAt(0, 0)).toBeNull()
  })
})

describe('degenerate windows', () => {
  /*
   * `sizes.width` is 0 for the first frame or two, before the canvas has been measured. A factor of
   * zero there would give a panel with no area and slot centres at NaN.
   */
  it('produces finite, positive geometry for an unmeasured canvas', () => {
    const layout = createDrawerLayout(0, 0, DEFAULT)
    expect(layout.scale).toBeGreaterThan(0)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
    expect(Number.isFinite(layout.slotCentre(0).x)).toBe(true)
  })

  it('survives a single-slot drawer', () => {
    const layout = createDrawerLayout(1920, 1080, { tileSlots: 1, plateSlots: 1 })
    expect(layout.slotCount).toBe(1)
    const centre = layout.slotCentre(0)
    expect(layout.slotAt(centre.x, centre.y)).toBe(0)
  })
})
