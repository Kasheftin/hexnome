import type { DrawerLayout } from './drawerLayout'

/**
 * Where a plate bay's two rotate buttons go.
 *
 * They are DOM buttons over a canvas whose drawer **scales to the window** — 1 on a laptop, about
 * 0.38 on a phone. Fixed pixel offsets were right for exactly one of those: at 0.38 a button placed
 * 58px out from a bay whose half-width is 38px sits outside the bay altogether, over its neighbour.
 * So the offsets are the design's, taken at the drawer's own scale, and this returns boxes rather
 * than a scale factor because the touch case does not follow from the design one.
 *
 * ## Why touch does not simply scale
 *
 * Scaling everything is right until a finger has to hit it: at 0.38 a 26px button is 10px across.
 * Nobody can press that. So where nothing can hover — and the buttons are therefore always showing,
 * because a hover is the only thing that used to reveal them — they keep a finger-sized minimum and
 * tuck into the bay's own corners instead of the design's fixed offsets.
 *
 * That is a real trade: at a 76px bay a 30px button covers part of the plate's upper petals, where at
 * full size it sat clear of them. It stays *inside* the bay rather than above it, which costs some of
 * the plate but keeps clear of the action bar — that is anchored to the drawer's top edge and centred
 * on it, so on a narrow screen it crosses right over where these would otherwise want to be.
 */

/** The design, at scale 1: a 26px button tucked 16px in from the bay's top corners. */
const DESIGN_SIZE = 26
/**
 * How far the button sits inside the bay's own corner, on both axes.
 *
 * They used to float *above* the bay — 58px out and 44px up from its centre — which put them over the
 * board rather than over the thing they act on, and left the pair unmoored from any edge. In the
 * corners they read as belonging to the bay, and the same rule serves touch: what used to be a
 * separate layout for fingers is now the same one with a smaller inset.
 */
const DESIGN_INSET = 16
/** The glyph inside it — 15 of the button's 26, kept as the ratio's two halves so 26 gives exactly 15. */
const DESIGN_GLYPH = 15

/** The smallest a button may be when a finger is the only way to press it. */
const TOUCH_MIN_SIZE = 30
/** How far inside the bay's edges a touch button sits, and half the gap left between the pair. */
const TOUCH_INSET = 2

/** One button's box, in px relative to the centre of its bay. */
export interface RotateButtonBox {
  readonly left: number
  readonly top: number
  readonly size: number
  readonly glyph: number
}

export interface RotateButtonBoxes {
  readonly left: RotateButtonBox
  readonly right: RotateButtonBox
}

/**
 * The pair, for a drawer laid out this big.
 *
 * `touch` is the caller's answer to "is a finger the only way in" — see `touchPrimary` in GameView.
 * It is asked in script rather than in a `@media` block because the *positions* are computed from the
 * layout, and a stylesheet cannot see the scale the drawer was laid out at.
 */
export function rotateButtonBoxes(layout: DrawerLayout, touch: boolean): RotateButtonBoxes {
  const size = touch ? touchSize(layout) : DESIGN_SIZE * layout.scale
  const glyph = (size * DESIGN_GLYPH) / DESIGN_SIZE

  /*
   * The bay's upper corners, measured from its own edges.
   *
   * One layout for both cases now. A finger still gets a bigger button and a tighter inset — it needs
   * the room — but the *placement* no longer differs, so a plate does not gain two controls in a
   * different place depending on what is pointing at it.
   */
  const inset = touch ? TOUCH_INSET : DESIGN_INSET * layout.scale
  const halfWidth = layout.plateSlotWidth / 2
  const top = -(layout.plateSlotHeight / 2) + inset
  return {
    left: { left: -halfWidth + inset, top, size, glyph },
    right: { left: halfWidth - inset - size, top, size, glyph },
  }
}

/**
 * Finger-sized, but never so wide that the pair meet in the middle of the bay.
 *
 * Two buttons that overlap are worse than two small ones: the one on top takes both taps. The bay is
 * the binding constraint on a small phone, so it wins over the minimum.
 */
function touchSize(layout: DrawerLayout): number {
  const roomiest = layout.plateSlotWidth / 2 - TOUCH_INSET * 2
  return Math.min(Math.max(TOUCH_MIN_SIZE, DESIGN_SIZE * layout.scale), Math.max(roomiest, 1))
}
