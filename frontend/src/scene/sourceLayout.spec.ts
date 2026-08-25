import { describe, expect, it } from 'vitest'
import {
  SOURCE_BOTTOM_GAP_PX,
  SOURCE_LOT_MAX_PX,
  SOURCE_LOT_MIN_PX,
  SOURCE_TOP_PX,
} from './constants'
import { createDrawerLayout, type DrawerShape } from './drawerLayout'
import { createSourceLayout } from './sourceLayout'

const DEFAULT: DrawerShape = { tileSlots: 12, plateSlots: 2 }
const LARGEST: DrawerShape = { tileSlots: 16, plateSlots: 3 }

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

  it('stops shrinking at the floor however cramped the window', () => {
    for (const width of WIDTHS) {
      for (const height of HEIGHTS) {
        for (const lots of [3, 4, 5, 6]) {
          const lot = createSourceLayout(width, height, lots, LARGEST).lotWidth
          expect(lot).toBeGreaterThanOrEqual(SOURCE_LOT_MIN_PX)
          expect(lot).toBeLessThanOrEqual(SOURCE_LOT_MAX_PX)
        }
      }
    }
  })
})

/*
 * The floor is only affordable because the overflow has somewhere to go. These are the properties that
 * make that true — and the last one is what keeps the pieces from lagging behind the scrollbar.
 */
describe('scrolling', () => {
  /** A phone held sideways: the case the floor exists for. Six lots at 104px cannot all be shown. */
  const cramped = () => createSourceLayout(844, 390, 6, DEFAULT)

  it('does not scroll when everything fits', () => {
    const roomy = createSourceLayout(1920, 1400, 4, DEFAULT)
    expect(roomy.maxScroll).toBe(0)
    expect(roomy.contentHeight).toBe(roomy.height)
  })

  it('overflows rather than shrinking once the floor binds', () => {
    const column = cramped()
    expect(column.lotWidth).toBe(SOURCE_LOT_MIN_PX)
    expect(column.contentHeight).toBeGreaterThan(column.height)
    expect(column.maxScroll).toBe(column.contentHeight - column.height)
  })

  it('clamps the scroll at both ends', () => {
    const max = cramped().maxScroll
    expect(createSourceLayout(844, 390, 6, DEFAULT, -50).scrollTop).toBe(0)
    expect(createSourceLayout(844, 390, 6, DEFAULT, 99999).scrollTop).toBe(max)
    expect(createSourceLayout(844, 390, 6, DEFAULT, 100).scrollTop).toBe(100)
  })

  it('pins the scroll to zero where there is nothing to scroll', () => {
    expect(createSourceLayout(1920, 1400, 4, DEFAULT, 500).scrollTop).toBe(0)
  })

  /*
   * The property the whole design rests on. Views ease toward `lotCentre`, so if scrolling moved that
   * target every piece would rubber-band along behind the gesture instead of tracking it rigidly.
   * Callers subtract `scrollTop` after easing, which only works while this stays true.
   */
  it('leaves lotCentre in content space, untouched by the scroll', () => {
    const still = createSourceLayout(844, 390, 6, DEFAULT, 0)
    const scrolled = createSourceLayout(844, 390, 6, DEFAULT, 200)
    for (let lot = 0; lot < still.lotCount; lot++) {
      expect(scrolled.lotCentre(lot)).toEqual(still.lotCentre(lot))
    }
  })

  it('keeps the panel frame put, since only its contents move', () => {
    const still = createSourceLayout(844, 390, 6, DEFAULT, 0)
    const scrolled = createSourceLayout(844, 390, 6, DEFAULT, 200)
    expect(scrolled.height).toBe(still.height)
    expect(scrolled.contains(still.left + 2, still.top + 2)).toBe(true)
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
     *
     * Narrow enough that the wider drawer is forced to scale — at 1440 both fit unscaled and there is
     * no difference to measure — but tall enough that the lots are still being fitted rather than held
     * at the floor. Where the floor has taken over, the extra room shows up as less scrolling
     * instead; that is the sibling test.
     */
    const beside = { width: 1024, height: 1000 }
    const withDefault = createSourceLayout(beside.width, beside.height, 6, DEFAULT)
    const withLargest = createSourceLayout(beside.width, beside.height, 6, LARGEST)

    expect(createDrawerLayout(beside.width, beside.height, LARGEST).height)
      .toBeLessThan(createDrawerLayout(beside.width, beside.height, DEFAULT).height)
    expect(withLargest.lotWidth).toBeGreaterThan(withDefault.lotWidth)
  })

  /*
   * The same coupling, observed below the floor. Once the lots have stopped shrinking there is nothing
   * left for extra room to do *except* shorten the scroll, so that is where it has to show up — and if
   * it did not, the column would be ignoring the drawer's size again.
   */
  it('needs less scrolling when the drawer has been scaled down', () => {
    const withDefault = createSourceLayout(1024, 700, 6, DEFAULT)
    const withLargest = createSourceLayout(1024, 700, 6, LARGEST)

    expect(withDefault.lotWidth).toBe(SOURCE_LOT_MIN_PX)
    expect(withLargest.lotWidth).toBe(SOURCE_LOT_MIN_PX)
    expect(withLargest.maxScroll).toBeLessThan(withDefault.maxScroll)
  })

  it('never lets the column overlap however wide the drawer is', () => {
    for (const shape of [DEFAULT, LARGEST]) {
      const drawer = createDrawerLayout(1024, 700, shape)
      const column = createSourceLayout(1024, 700, 6, shape)
      expect(column.top + column.height).toBeLessThanOrEqual(drawer.top - SOURCE_BOTTOM_GAP_PX + 0.5)
    }
  })
})
