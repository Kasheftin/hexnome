/**
 * Presentation tunables. Starting values from docs/tech-spec.md — these are
 * meant to be dialled in against pixels, not derived.
 */

/**
 * Hex circumradius in world units, which for a regular hexagon equals its edge
 * length. A cell is therefore `√3` wide and `2` tall — the ratio the tile art is
 * drawn to (200 × 230.94 px).
 */
export const HEX_SIZE = 1

/**
 * Camera tilt off vertical, in degrees.
 *
 * **Zero on purpose.** An orthographic camera tilted by `t` compresses the board's
 * Z axis by `cos(t)`, so at 20° a 200 × 231 hex projected to 200 × 217 — visibly
 * squashed. Straight down is the only angle that shows the hexagons at their true
 * proportions.
 *
 * If a tilt comes back later (to show the sides of thick tiles), the fix is to
 * scale the board by `1 / cos(t)` in Z so the projection stays proportional. That
 * works perfectly for flat plates; for 3D tiles it slightly shears the geometry,
 * which is a trade to make with real tiles on screen.
 */
export const BOARD_TILT_DEG = 0

/** Distance from the camera to its target. Orthographic, so this only affects clipping. */
export const CAMERA_DISTANCE = 60

/**
 * Visible world height at default zoom, in world units. A cell is 2 tall.
 *
 * VIEW_HEIGHT_MAX is an upper bound only — the camera also caps zoom-out at whatever
 * keeps the board edge off screen, which at most aspect ratios is the tighter limit.
 */
export const VIEW_HEIGHT_DEFAULT = 12
export const VIEW_HEIGHT_MIN = 4
export const VIEW_HEIGHT_MAX = 70

/**
 * Half-extent of the board, in cells, measured from the centre.
 *
 * The playfield is a **rectangle** in world space, not a hex disc: 20 cells in every
 * direction comes to 1661 plates. Large enough that, with panning
 * clamped by PAN_MARGIN_CELLS, the edge can never be reached — so the board reads as
 * endless without pretending to be infinite.
 */
export const BOARD_HALF_COLS = 20
export const BOARD_HALF_ROWS = 20

/**
 * How many cells of board to keep beyond the viewport at all times.
 *
 * Both pan and zoom are clamped against the board bounds inset by this much, so the
 * outermost ring of plates never comes into view. Zoom has to be clamped too: a view
 * larger than the board could not be kept inside it by clamping pan alone.
 */
export const PAN_MARGIN_CELLS = 2

/**
 * Tile circumradius, as a fraction of the cell. Under 1 so the plate's brass frame
 * stays visible around a placed tile.
 */
export const TILE_SIZE = HEX_SIZE * 0.86

/** Tile thickness in world units. The cell is 2 tall, so this is ~20% of that. */
export const TILE_THICKNESS = 0.4

/**
 * Edge bevel, in world units — a substantial fraction of the tile, not a token
 * chamfer.
 *
 * This is what makes the tile read as glossy. The board camera looks straight down
 * at a flat top face, so the top has a single normal and therefore a single, uniform
 * shade: no highlight can appear there. The bevel is the only part of the tile whose
 * normals sweep through a range, so it is the only part that can catch a moving
 * highlight. At 5% of the radius it was too thin to see at all; at ~17% the rim
 * occupies enough of the tile to read as the pillowed roll-over the Azul pieces have.
 */
export const TILE_BEVEL = 0.15

/** Height of a tile's centre when resting on a plate. */
export const TILE_REST_HEIGHT = 0.04 + TILE_THICKNESS / 2

/**
 * Height of a tile's centre while dragged.
 *
 * Free to be generous now that the camera looks straight down: with zero tilt,
 * changing height does not move a thing's screen position, so a lifted tile stays
 * exactly under the cursor. Under the old 20° tilt this would have slid it sideways.
 */
export const TILE_DRAG_HEIGHT = 1.1

/**
 * Strength of the reflected environment on the glossy tiles: the single knob for
 * tile gloss.
 *
 * Can sit at full strength because the studio environment is mostly dark and keeps
 * the region directly overhead empty (scene/studioEnvironment.ts). With three's
 * bright `RoomEnvironment` this had to be dialled to near zero — a flat top face
 * under a top-down orthographic camera mirrors whatever is straight above it,
 * uniformly, so a bright ceiling rendered every tile neutral white.
 */
export const TILE_ENV_INTENSITY = 1

/** Height of the drop-target ring. Above the plates, below a dragged tile. */
export const HIGHLIGHT_Y = 0.05

/* ── Drawer ──────────────────────────────────────────────────────────────────── */

export const DRAWER_COLS = 8
export const DRAWER_ROWS = 2

/**
 * Horizontal slot pitch, in **screen pixels**.
 *
 * The drawer is UI: it keeps its size and place on screen while the board pans and
 * zooms beneath it, so its layout is specified in pixels and converted to world units
 * every frame (scene/screenProjection.ts).
 */
export const DRAWER_SLOT_PX = 64
export const DRAWER_PADDING_PX = 13
/** Gap between the drawer and the bottom of the canvas. */
export const DRAWER_BOTTOM_PX = 22

/** Tile width as a fraction of its slot, leaving the slot outline visible around it. */
export const DRAWER_TILE_FILL = 0.9

/**
 * Plate slots in the drawer, and their width in screen pixels.
 *
 * A plate is a seven-cell flower, so it is about three hexes across: `5.196 · HEX_SIZE`
 * wide against a tile's `1.732`. It needs roughly triple a tile slot, which is why the
 * plate slots sit in one row spanning the drawer's full height rather than in the tile
 * grid.
 */
export const PLATE_SLOTS = 2
export const PLATE_SLOT_PX = 152
/** Gap between the plate slots and the tile grid. */
export const DRAWER_GROUP_GAP_PX = 16
/** Plate width as a fraction of its slot. */
export const PLATE_SLOT_FILL = 0.92

/** World width of a plate flower, in units of HEX_SIZE: hole plus two petals across. */
export const PLATE_WORLD_WIDTH = 3 * Math.sqrt(3)

/** Height of a plate's base. Above the board cells, below the tiles that sit in it. */
export const PLATE_BASE_Y = 0.05
/** How far a tile floats above its plate's base, at plate scale 1. */
export const PLATE_TILE_LIFT = 0.19

/**
 * Heights, which under a top-down orthographic camera are purely a draw order.
 *
 * The drawer floats above the board, and a held tile above everything — so a tile
 * dragged out of the drawer passes over its neighbours rather than under them.
 */
export const DRAWER_CHROME_Y = 1.8
export const DRAWER_TILE_Y = 2
export const HELD_TILE_Y = 3

export const HIGHLIGHT_COLORS = {
  valid: '#8fe6c0',
  invalid: '#6a4b4b',
} as const

/**
 * The six value symbols, in value order 1–6. Cropped to content and downscaled from
 * the originals in `external assets/tiles/` — see docs/art-spec.md.
 */
export const SYMBOL_TEXTURE_URLS = [
  '/textures/symbols/1.png',
  '/textures/symbols/2.png',
  '/textures/symbols/3.png',
  '/textures/symbols/4.png',
  '/textures/symbols/5.png',
  '/textures/symbols/6.png',
]

/**
 * Tile textures. Each is a full-bleed pointy-top hexagon with transparent corners,
 * drawn to a `√3 : 2` bounding box.
 *
 * Cells pick one by position hash, so adding more files here is all it takes to get
 * real variety across the board — no other change needed.
 */
export const PLATE_TEXTURE_URLS = [
  '/textures/plate-full.png',
]

/**
 * Plate size as a fraction of the cell. Slightly under 1 so neighbours do not
 * share an exact edge, which leaves a hairline seam instead of two frames fusing.
 */
export const PLATE_INSET = 0.985

/** Plates sit just above the floor plane to avoid z-fighting with it. */
export const PLATE_Y = 0.02

/**
 * Per-plate brightness variation, ± this fraction. Keeps 169 copies of one texture
 * from reading as a single flat sheet. Subtle on purpose — brass should not shift
 * hue from cell to cell.
 */
export const PLATE_TINT_JITTER = 0.05

export const COLORS = {
  /** Dark slate, from screen1.png — what shows beyond the plated board. */
  boardBackground: '#15181d',
  gridLine: '#2a2f38',
  canvasClear: '#0d0f13',
  cube: '#e8c878',
} as const
