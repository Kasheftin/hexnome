import {
  PLATE_WORLD_HEIGHT,
  PLATE_WORLD_WIDTH,
  SOURCE_BOTTOM_GAP_PX,
  SOURCE_LEFT_PX,
  SOURCE_LOT_GAP_PX,
  SOURCE_LOT_MAX_PX,
  SOURCE_LOT_MIN_PX,
  SOURCE_PADDING_PX,
  SOURCE_PLATE_FILL,
  SOURCE_TOP_PX,
} from './constants'
import { createDrawerLayout } from './drawerLayout'

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
  readonly height: number
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
  /** Centre of a lot, in screen pixels. */
  lotCentre(lot: number): { x: number, y: number }
  /** Lot under a screen point, or null if outside the lots. */
  lotAt(x: number, y: number): number | null
  /** Is this screen point anywhere over the column, padding included? */
  contains(x: number, y: number): boolean
}

/**
 * A plate is very slightly taller than it is wide relative to nothing — 5 against 5.196 in units of
 * HEX_SIZE. Lots use the real ratio, or a plate sits off-centre in its lot.
 */
const LOT_ASPECT = PLATE_WORLD_HEIGHT / PLATE_WORLD_WIDTH

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * @param lots how many slots the column shows — one per plate the round deals, so it varies with the
 * `platesPerRound` setting rather than being fixed. Fewer slots means taller lots and bigger tiles.
 */
export function createSourceLayout(
  canvasWidth: number,
  canvasHeight: number,
  lots: number,
): SourceLayout {
  const lotCount = Math.max(1, Math.floor(lots))
  /**
   * How far down the column may run.
   *
   * The drawer is bottom-centre and this column is on the left, so on a wide screen they never
   * meet and the column can use the full height. On a narrow one they would overlap, and the
   * column stops above the drawer instead. Tested against the column's *widest* possible form
   * rather than its actual width, because the actual width depends on the height this decides —
   * using it would be circular.
   */
  const drawer = createDrawerLayout(canvasWidth, canvasHeight)
  const widestPanel = SOURCE_LOT_MAX_PX + SOURCE_PADDING_PX * 2
  const meetsDrawer = SOURCE_LEFT_PX + widestPanel + SOURCE_BOTTOM_GAP_PX > drawer.left
  const bottomLimit = meetsDrawer
    ? drawer.top - SOURCE_BOTTOM_GAP_PX
    : canvasHeight - SOURCE_BOTTOM_GAP_PX

  // Fit the lots to what is left, then let the panel hug them.
  const available = Math.max(0, bottomLimit - SOURCE_TOP_PX)
  const forLots = available - SOURCE_PADDING_PX * 2 - SOURCE_LOT_GAP_PX * (lotCount - 1)
  // Clamp the *width* and re-derive the height from it, so clamping never distorts the aspect.
  const lotWidth = clamp(forLots / lotCount / LOT_ASPECT, SOURCE_LOT_MIN_PX, SOURCE_LOT_MAX_PX)
  const lotHeight = lotWidth * LOT_ASPECT

  const width = lotWidth + SOURCE_PADDING_PX * 2
  const height = lotCount * lotHeight
    + SOURCE_LOT_GAP_PX * (lotCount - 1)
    + SOURCE_PADDING_PX * 2
  const left = SOURCE_LEFT_PX
  const top = SOURCE_TOP_PX

  const lotsLeft = left + SOURCE_PADDING_PX
  const lotsTop = top + SOURCE_PADDING_PX
  const pitch = lotHeight + SOURCE_LOT_GAP_PX

  return {
    left,
    top,
    width,
    height,
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

    lotAt(x, y) {
      if (x < lotsLeft || x > lotsLeft + lotWidth) return null
      const lot = Math.floor((y - lotsTop) / pitch)
      if (lot < 0 || lot >= lotCount) return null
      // Inside the gap between two lots rather than on either.
      if ((y - lotsTop) - lot * pitch > lotHeight) return null
      return lot
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
