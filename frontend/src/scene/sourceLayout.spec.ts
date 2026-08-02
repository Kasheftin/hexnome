import { describe, expect, it } from 'vitest'
import { SOURCE_BOTTOM_GAP_PX, SOURCE_LOT_MAX_PX, SOURCE_TOP_PX } from './constants'
import { createDrawerLayout, type DrawerShape } from './drawerLayout'
import { createSourceLayout } from './sourceLayout'

const DEFAULT: DrawerShape = { tileSlots: 16, plateSlots: 2 }
const LARGEST: DrawerShape = { tileSlots: 18, plateSlots: 3 }

/** Windows worth caring about, from a desktop down to something uncomfortably small. */
const HEIGHTS = [1080, 900, 800, 768, 720, 640, 560, 500]
const WIDTHS = [1920, 1440, 1366, 1280, 1024, 900]

describe('fitting the lots', () => {
  it('uses the full lot size when there is room', () => {
    expect(createSourceLayout(1920, 1400, 4, DEFAULT).lotWidth).toBe(SOURCE_LOT_MAX_PX)
  })

  it('shrinks the lots as the column gets more of them', () => {
    const four = createSourceLayout(1920, 900, 4, DEFAULT).lotWidth
    const six = createSourceLayout(1920, 900, 6, DEFAULT).lotWidth
    expect(six).toBeLessThan(four)
  })

  it('keeps the plate aspect whatever the size', () => {
    const big = createSourceLayout(1920, 1400, 4, DEFAULT)
    const small = createSourceLayout(1920, 560, 6, DEFAULT)
    expect(small.lotHeight / small.lotWidth).toBeCloseTo(big.lotHeight / big.lotWidth, 6)
  })
})

/*
 * The rule that prompted this. The column used to hold its lots at a readable minimum and then run on
 * past the drawer, which overlapped it — two panels fighting for the same pixels, which is worse than
 * small lots. Fitting now wins outright, so this must hold at every size.
 */
describe('the column never reaches the drawer', () => {
  it('stops above the drawer at every window worth caring about', () => {
    for (const width of WIDTHS) {
      for (const height of HEIGHTS) {
        for (const lots of [3, 4, 5, 6]) {
          for (const shape of [DEFAULT, LARGEST]) {
            const drawer = createDrawerLayout(width, height, shape)
            const column = createSourceLayout(width, height, lots, shape)
            const bottom = column.top + column.height
            // Either the column ends above the drawer, or it is clear of it horizontally.
            const clearsSideways = column.left + column.width < drawer.left
            expect(clearsSideways || bottom <= drawer.top).toBe(true)
          }
        }
      }
    }
  })

  it('keeps its lots positive rather than inverting on a tiny window', () => {
    const column = createSourceLayout(600, 300, 6, LARGEST)
    expect(column.lotWidth).toBeGreaterThan(0)
    expect(column.lotHeight).toBeGreaterThan(0)
    expect(column.height).toBeGreaterThan(0)
  })

  it('stays below the top of the window', () => {
    const column = createSourceLayout(1024, 700, 6, LARGEST)
    expect(column.top).toBe(SOURCE_TOP_PX)
  })
})

/*
 * One-way coupling, and it has to stay that way: the column reads the drawer's top, so a drawer that
 * shrinks to fit hands the column *more* room. The drawer's own size depends only on the canvas.
 */
describe('a shrunken drawer gives the column more room', () => {
  it('lets the lots grow when the drawer has been scaled down', () => {
    /*
     * One window, two drawer settings. The larger drawer wants more width, so it scales down harder
     * and ends up *shorter* — which pushes its top edge down and hands the column more height.
     */
    const beside = { width: 1024, height: 800 }
    const withDefault = createSourceLayout(beside.width, beside.height, 6, DEFAULT)
    const withLargest = createSourceLayout(beside.width, beside.height, 6, LARGEST)

    expect(createDrawerLayout(beside.width, beside.height, LARGEST).height)
      .toBeLessThan(createDrawerLayout(beside.width, beside.height, DEFAULT).height)
    expect(withLargest.lotWidth).toBeGreaterThan(withDefault.lotWidth)
  })

  it('never lets the column overlap however wide the drawer is', () => {
    for (const shape of [DEFAULT, LARGEST]) {
      const drawer = createDrawerLayout(1024, 700, shape)
      const column = createSourceLayout(1024, 700, 6, shape)
      expect(column.top + column.height).toBeLessThanOrEqual(drawer.top - SOURCE_BOTTOM_GAP_PX + 0.5)
    }
  })
})
