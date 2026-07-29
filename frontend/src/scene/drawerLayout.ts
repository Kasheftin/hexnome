import {
  DRAWER_BOTTOM_PX,
  DRAWER_COLS,
  DRAWER_GROUP_GAP_PX,
  DRAWER_PADDING_PX,
  DRAWER_ROWS,
  DRAWER_SLOT_PX,
  PLATE_SLOTS,
  PLATE_SLOT_PX,
} from './constants'

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

export function createDrawerLayout(canvasWidth: number, canvasHeight: number): DrawerLayout {
  const plateAreaWidth = PLATE_SLOTS * PLATE_SLOT_PX
  const tileGridWidth = DRAWER_COLS * DRAWER_SLOT_PX
  const contentWidth = plateAreaWidth + DRAWER_GROUP_GAP_PX + tileGridWidth
  const contentHeight = DRAWER_ROWS * SLOT_PITCH_Y
  const width = contentWidth + DRAWER_PADDING_PX * 2
  const height = contentHeight + DRAWER_PADDING_PX * 2
  const left = (canvasWidth - width) / 2
  const top = canvasHeight - DRAWER_BOTTOM_PX - height

  // Plate slots on the left, tile grid to their right.
  const plateLeft = left + DRAWER_PADDING_PX
  const gridLeft = plateLeft + plateAreaWidth + DRAWER_GROUP_GAP_PX
  const gridTop = top + DRAWER_PADDING_PX

  return {
    left,
    top,
    width,
    height,
    slotCount: DRAWER_COLS * DRAWER_ROWS,
    plateSlotCount: PLATE_SLOTS,
    plateSlotHeight: contentHeight,

    plateSlotCentre(slot) {
      return {
        x: plateLeft + PLATE_SLOT_PX * (slot + 0.5),
        y: gridTop + contentHeight / 2,
      }
    },

    plateSlotAt(x, y) {
      if (y < gridTop || y > gridTop + contentHeight) return null
      const slot = Math.floor((x - plateLeft) / PLATE_SLOT_PX)
      return slot < 0 || slot >= PLATE_SLOTS ? null : slot
    },

    slotCentre(slot) {
      const col = slot % DRAWER_COLS
      const row = Math.floor(slot / DRAWER_COLS)
      return {
        x: gridLeft + DRAWER_SLOT_PX * (col + 0.5),
        y: gridTop + SLOT_PITCH_Y * (row + 0.5),
      }
    },

    slotAt(x, y) {
      const col = Math.floor((x - gridLeft) / DRAWER_SLOT_PX)
      const row = Math.floor((y - gridTop) / SLOT_PITCH_Y)
      if (col < 0 || col >= DRAWER_COLS || row < 0 || row >= DRAWER_ROWS) return null
      return row * DRAWER_COLS + col
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
