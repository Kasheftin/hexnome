import {
  DRAWER_BOTTOM_PX,
  DRAWER_GROUP_GAP_PX,
  DRAWER_MAX_HEIGHT_FRACTION,
  DRAWER_PADDING_PX,
  DRAWER_ROWS,
  DRAWER_SIDE_GAP_PX,
  DRAWER_SLOT_PX,
  PLATE_SLOT_PX,
} from './constants'

/**
 * How many seats the drawer has — a game setting, not a constant.
 *
 * Passed in rather than read from `constants.ts` because it varies per game: the panel is physically
 * wider with twenty tile slots than with twelve, and everything that draws or hit-tests it has to agree
 * about that.
 */
export interface DrawerShape {
  readonly tileSlots: number
  readonly plateSlots: number
}

/**
 * The drawer's geometry, in **screen pixels**.
 *
 * Pixels rather than world units because the drawer is UI: it stays the same size and
 * the same place on screen while the board pans and zooms underneath it. Everything
 * that draws or hit-tests the drawer works from this one description, so the visual
 * slots and the drop targets cannot drift apart.
 */
export interface DrawerLayout {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly slotCount: number
  readonly plateSlotCount: number
  /** Height of a plate slot, which spans the whole tile grid. */
  readonly plateSlotHeight: number
  /**
   * How much the panel had to shrink to fit the window: 1 whenever it fits outright.
   *
   * Exposed because the tiles and plates *inside* the slots are scaled by their own code, and they
   * have to shrink by exactly the same amount or they overflow the sockets they sit in.
   */
  readonly scale: number
  /** A tile slot's pitch, already scaled. */
  readonly slotSize: number
  /** A plate bay's width, already scaled. */
  readonly plateSlotWidth: number
  /** Centre of a tile slot, in screen pixels. */
  slotCentre(slot: number): { x: number, y: number }
  /** Tile slot under a screen point, or null if outside the tile grid. */
  slotAt(x: number, y: number): number | null
  /** Centre of a plate slot, in screen pixels. */
  plateSlotCentre(slot: number): { x: number, y: number }
  /** Plate slot under a screen point, or null if outside the plate slots. */
  plateSlotAt(x: number, y: number): number | null
  /** Is this screen point anywhere over the drawer, padding included? */
  contains(x: number, y: number): boolean
}

/** Vertical pitch. A pointy-top hexagon is `2/√3` taller than it is wide. */
const SLOT_PITCH_Y = (DRAWER_SLOT_PX * 2) / Math.sqrt(3)

/** Never quite zero: a canvas measured at 0 on the first frame must not produce inverted geometry. */
const MIN_SCALE = 0.01

export function createDrawerLayout(
  canvasWidth: number,
  canvasHeight: number,
  shape: DrawerShape,
): DrawerLayout {
  /*
   * Two rows deep, so the columns follow from the count. Every offered count is even and divides
   * exactly; `ceil` only matters if an odd one is ever added, and then the last column is short — which
   * `slotAt` and the grid both account for by checking the true count rather than `cols * rows`.
   */
  const cols = Math.max(1, Math.ceil(shape.tileSlots / DRAWER_ROWS))

  /*
   * The size the drawer wants to be, before the window has a say.
   *
   * A three-bay, sixteen-tile drawer is 1300px across and wants 1332 of canvas once the side gaps
   * are counted — more than a 1280 laptop has, and the settings let a player ask for exactly that.
   * So the panel scales to fit rather than running off the edge.
   *
   * **Capped at 1:** the constants are the intended sizes, not a minimum, so a big window shows the
   * drawer at its designed size rather than a stretched one. There is no lower cap: below about
   * 1000px the tiles simply get small, which is an honest report that the window is too narrow for
   * that drawer rather than a layout that is quietly broken.
   */
  const naturalWidth = shape.plateSlots * PLATE_SLOT_PX + DRAWER_GROUP_GAP_PX + cols * DRAWER_SLOT_PX
    + DRAWER_PADDING_PX * 2
  const naturalHeight = DRAWER_ROWS * SLOT_PITCH_Y + DRAWER_PADDING_PX * 2

  const scale = Math.max(MIN_SCALE, Math.min(
    1,
    (canvasWidth - DRAWER_SIDE_GAP_PX * 2) / naturalWidth,
    (canvasHeight * DRAWER_MAX_HEIGHT_FRACTION) / naturalHeight,
  ))

  // Every pixel dimension below is scaled, so the panel keeps its proportions exactly.
  const slotSize = DRAWER_SLOT_PX * scale
  const plateSlotWidth = PLATE_SLOT_PX * scale
  const padding = DRAWER_PADDING_PX * scale
  const pitchY = SLOT_PITCH_Y * scale

  const plateAreaWidth = shape.plateSlots * plateSlotWidth
  const tileGridWidth = cols * slotSize
  const contentWidth = plateAreaWidth + DRAWER_GROUP_GAP_PX * scale + tileGridWidth
  const contentHeight = DRAWER_ROWS * pitchY
  const width = contentWidth + padding * 2
  const height = contentHeight + padding * 2
  const left = (canvasWidth - width) / 2
  const top = canvasHeight - DRAWER_BOTTOM_PX - height

  // Plate slots on the left, tile grid to their right.
  const plateLeft = left + padding
  const gridLeft = plateLeft + plateAreaWidth + DRAWER_GROUP_GAP_PX * scale
  const gridTop = top + padding

  return {
    left,
    top,
    width,
    height,
    slotCount: shape.tileSlots,
    plateSlotCount: shape.plateSlots,
    plateSlotHeight: contentHeight,
    scale,
    slotSize,
    plateSlotWidth,

    plateSlotCentre(slot) {
      return {
        x: plateLeft + plateSlotWidth * (slot + 0.5),
        y: gridTop + contentHeight / 2,
      }
    },

    plateSlotAt(x, y) {
      if (y < gridTop || y > gridTop + contentHeight) return null
      const slot = Math.floor((x - plateLeft) / plateSlotWidth)
      return slot < 0 || slot >= shape.plateSlots ? null : slot
    },

    slotCentre(slot) {
      const col = slot % cols
      const row = Math.floor(slot / cols)
      return {
        x: gridLeft + slotSize * (col + 0.5),
        y: gridTop + pitchY * (row + 0.5),
      }
    },

    slotAt(x, y) {
      const col = Math.floor((x - gridLeft) / slotSize)
      const row = Math.floor((y - gridTop) / pitchY)
      if (col < 0 || col >= cols || row < 0 || row >= DRAWER_ROWS) return null
      const slot = row * cols + col
      // A short last column has cells with no slot behind them; they are not drop targets.
      return slot < shape.tileSlots ? slot : null
    },

    /**
     * Deliberately the whole panel, padding included. A release over the drawer's frame
     * is not a legal drop, but it must not fall through to the board cell hidden behind
     * the drawer either.
     */
    contains(x, y) {
      return x >= left && x <= left + width && y >= top && y <= top + height
    },
  }
}
