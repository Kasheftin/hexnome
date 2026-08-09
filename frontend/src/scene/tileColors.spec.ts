import { Color, SRGBColorSpace } from 'three'
import { describe, expect, it } from 'vitest'
import { TILE_COLORS, tileColorCss } from './constants'

/**
 * The palette is authored in HSL and reaches three as a CSS string, and three's parser is narrow:
 * `Color.setStyle` accepts `hsl(25, 64%, 42%)` and nothing else. `hsl(25 64% 42%)` and `hsl(25deg, …)`
 * are both valid CSS, both what a browser would hand you if you asked it, and both leave the colour
 * **white** with no warning — a white tile on a board where every tile is coloured, from a string that
 * looks right in the DOM.
 *
 * So the test is not "does it parse" but "does it parse *to the colour we asked for*": against
 * `setHSL`, which needs no string at all. White would fail it, and so would any other quiet mangling.
 */
describe('the palette as three sees it', () => {
  it.each(TILE_COLORS.map((entry, index) => [entry.name, index] as const))(
    '%s survives the trip through CSS',
    (_name, index) => {
      const entry = TILE_COLORS[index]!

      const viaCss = new Color(tileColorCss(entry))
      const direct = new Color().setHSL(entry.h / 360, entry.s / 100, entry.l / 100, SRGBColorSpace)

      expect(viaCss.getHexString()).toBe(direct.getHexString())
    },
  )

  it('is not white by accident', () => {
    // The failure the test above exists to catch produces white, so a palette that *is* white would
    // pass it while telling us nothing. None of these are near white, and none should become so.
    for (const entry of TILE_COLORS) {
      expect(new Color(tileColorCss(entry)).getHexString()).not.toBe('ffffff')
    }
  })

  it('quotes the syntax three can read', () => {
    expect(tileColorCss({ h: 25, s: 64, l: 42 })).toBe('hsl(25, 64%, 42%)')
  })
})
