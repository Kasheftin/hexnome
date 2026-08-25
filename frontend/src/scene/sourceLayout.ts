import {
  PLATE_WORLD_HEIGHT,
  PLATE_WORLD_WIDTH,
  SOURCE_BOTTOM_GAP_PX,
  SOURCE_LEFT_PX,
  SOURCE_LOT_GAP_PX,
  SOURCE_LOT_MAX_PX,
  SOURCE_LOT_MIN_PX,
  SOURCE_PADDING_PX,
  SOURCE_SIZING_CAP,
  SOURCE_PLATE_FILL,
  SOURCE_TOP_PX,
} from './constants'
import { createDrawerLayout, type DrawerShape } from './drawerLayout'

/**
 * The shared source's geometry, in **screen pixels**.
 *
 * A column of six lots down the left, under the title. Like the drawer, it is UI: it keeps its size
 * and place on screen while the board pans and zooms beneath it, so it is specified in pixels and
 * converted to world units each frame (scene/screenProjection.ts). Everything that draws or
 * hit-tests it works from this one description, so the visible lots and the drop targets cannot
 * drift apart.
 */
export interface SourceLayout {
  readonly left: number
  readonly top: number
  readonly width: number
  /**
   * What the panel occupies on screen. Never runs past the drawer.
   *
   * Not the same as {@link contentHeight} once the lots stop fitting — that is the whole point of the
   * split, and mixing the two up is how a scrolling panel ends up overlapping its neighbour again.
   */
  readonly height: number
  /**
   * How tall the lots are, stacked. May exceed {@link height}, and that difference is the scroll.
   */
  readonly contentHeight: number
  /** How far the column can scroll. Zero when everything fits, which is the common case. */
  readonly maxScroll: number
  /** How far it currently is scrolled, already clamped to `[0, maxScroll]`. */
  readonly scrollTop: number
  readonly lotCount: number
  readonly lotWidth: number
  readonly lotHeight: number
  /** Width a plate is drawn at inside a lot. Drives its world scale. */
  readonly plateWidth: number
  /**
   * Height of that plate. Not the same as its width — a flower is 1.039 times wider than tall.
   *
   * This, not the lot height, is what bounds the loose-tile heap: the tiles have to look like they are
   * lying *on* the plate, and the plate is the shorter of the two.
   */
  readonly plateHeight: number
  /**
   * Centre of a lot, in **content pixels** — as if the column were never scrolled.
   *
   * Deliberately not the on-screen position, and this is the one surprising thing in here. Views
   * *ease* toward their target (`TableauView.vue`, `easeScreen`), so a target that moved with the
   * scrollbar would make every tile rubber-band along behind the gesture. Callers subtract
   * {@link scrollTop} **after** easing, which turns scrolling into a rigid translation with no lag.
   */
  lotCentre(lot: number): { x: number, y: number }
  /**
   * Is this screen point anywhere over the column, padding included?
   *
   * Unscrolled, because the frame does not move — only what is behind it does. Doubles as the test for
   * whether a lot is visible at all: a raycast ignores clipping planes, so without this a tile scrolled
   * out of sight would still answer a click.
   */
  contains(x: number, y: number): boolean
}

/**
 * A plate is very slightly taller than it is wide relative to nothing — 5 against 5.196 in units of
 * HEX_SIZE. Lots use the real ratio, or a plate sits off-centre in its lot.
 */
const LOT_ASPECT = PLATE_WORLD_HEIGHT / PLATE_WORLD_WIDTH

/**
 * @param lots how many slots the column shows — one per plate the round deals, so it varies with the
 * `platesPerRound` setting rather than being fixed. Fewer slots means taller lots and bigger tiles.
 */
export function createSourceLayout(
  canvasWidth: number,
  canvasHeight: number,
  lots: number,
  drawerShape: DrawerShape,
  scroll = 0,
  /**
   * Where the column starts, in screen pixels.
   *
   * **Measured, not assumed** — `scene/headerBox.ts` watches the header and the caller passes its
   * bottom edge plus a gap. A constant cannot work here: the header wraps to two rows on a narrow
   * screen and to three when the scoring strip moves up into it, so any single value is wrong in some
   * state, and the column ends up under it.
   *
   * Defaults to the old constant so the specs — and the first frame, before the observer has fired —
   * still have an answer.
   */
  top = SOURCE_TOP_PX,
  /**
   * How many rows the column actually draws — the lots that hold something.
   *
   * **Separate from `lots`, and that separation is the point.** `lots` is the round's capacity and is
   * what sizes a lot; `rows` is how many are worth showing. Sizing from `rows` instead would make
   * every plate grow as the column emptied, which is a size change nobody asked for in the middle of
   * a turn.
   *
   * Never below one: an empty column still draws a single bay, which is where the "nothing left"
   * placeholder sits.
   */
  rows = lots,
): SourceLayout {
  /**
   * What a lot is sized against — the round's capacity, but **capped**.
   *
   * Sizing for every slot is right while a round deals a handful. Quick mode deals up to twenty, and
   * dividing the column twenty ways puts every lot on the floor (`SOURCE_LOT_MIN_PX`) even when two
   * are on screen — a quick game's plates would be permanently smaller than a classic game's, for a
   * column that is nearly empty most of the time.
   *
   * So size for as many as comfortably fit and let the rest scroll, which is what the scrollbar is
   * for. Above the cap the column grows downward instead of shrinking its contents.
   */
  const capacity = Math.min(SOURCE_SIZING_CAP, Math.max(1, Math.floor(lots)))
  /** What is drawn. One even when nothing is left, so the placeholder has a bay to sit in. */
  const lotCount = Math.max(1, Math.floor(rows))
  /**
   * How far down the column may run.
   *
   * The drawer is bottom-centre and this column is on the left, so on a wide screen they never
   * meet and the column can use the full height. On a narrow one they would overlap, and the
   * column stops above the drawer instead. Tested against the column's *widest* possible form
   * rather than its actual width, because the actual width depends on the height this decides —
   * using it would be circular.
   */
  // The drawer's real shape, not a default: a twenty-slot panel is wider and meets the column sooner.
  const drawer = createDrawerLayout(canvasWidth, canvasHeight, drawerShape)
  const widestPanel = SOURCE_LOT_MAX_PX + SOURCE_PADDING_PX * 2
  const meetsDrawer = SOURCE_LEFT_PX + widestPanel + SOURCE_BOTTOM_GAP_PX > drawer.left
  const bottomLimit = meetsDrawer
    ? drawer.top - SOURCE_BOTTOM_GAP_PX
    : canvasHeight - SOURCE_BOTTOM_GAP_PX

  // Fit the lots to what is left, then let the panel hug them.
  const available = Math.max(0, bottomLimit - top)
  const forLots = available - SOURCE_PADDING_PX * 2 - SOURCE_LOT_GAP_PX * (capacity - 1)
  /*
   * Clamp the *width* and re-derive the height from it, so clamping never distorts the aspect.
   *
   * **The floor is back, and this time it has somewhere to put the overflow.** It was tried once
   * before and reverted: the lots held a readable size, the column ran on past the drawer, and the two
   * panels fought over the same pixels — worse than small lots. So fitting won outright, and the
   * column degraded smoothly to unreadable instead. At 1024x700 with six lots that is a 59px lot; a
   * phone held sideways gets 21px.
   *
   * A floor was never the wrong idea, it was homeless. Now the column scrolls, so the overflow has a
   * home and the panel itself still stops dead above the drawer — see `height` below.
   */
  const lotWidth = Math.min(SOURCE_LOT_MAX_PX, Math.max(SOURCE_LOT_MIN_PX, forLots / capacity / LOT_ASPECT))
  const lotHeight = lotWidth * LOT_ASPECT

  const width = lotWidth + SOURCE_PADDING_PX * 2
  const contentHeight = lotCount * lotHeight
    + SOURCE_LOT_GAP_PX * (lotCount - 1)
    + SOURCE_PADDING_PX * 2
  /*
   * The panel takes what it needs or what it is allowed, whichever is less — so the old promise that
   * it never reaches the drawer now holds *by construction* rather than by shrinking its contents.
   *
   * `available` is never zero at any window worth caring about (it bottoms out around 104px on a
   * 600x300 one), so this stays positive without a guard.
   */
  const height = Math.min(contentHeight, available)
  const maxScroll = Math.max(0, contentHeight - height)
  const scrollTop = Math.min(maxScroll, Math.max(0, scroll))
  const left = SOURCE_LEFT_PX

  const lotsLeft = left + SOURCE_PADDING_PX
  const lotsTop = top + SOURCE_PADDING_PX
  const pitch = lotHeight + SOURCE_LOT_GAP_PX

  return {
    left,
    top,
    width,
    height,
    contentHeight,
    maxScroll,
    scrollTop,
    lotCount,
    lotWidth,
    lotHeight,
    plateWidth: lotWidth * SOURCE_PLATE_FILL,
    plateHeight: lotWidth * SOURCE_PLATE_FILL * LOT_ASPECT,

    lotCentre(lot) {
      return {
        x: lotsLeft + lotWidth / 2,
        y: lotsTop + pitch * lot + lotHeight / 2,
      }
    },

    /**
     * Deliberately the whole panel, padding included — same reasoning as the drawer. A press on the
     * column's frame is not a drop target, but it must not fall through and pan the board either.
     */
    contains(x, y) {
      return x >= left && x <= left + width && y >= top && y <= top + height
    },
  }
}
