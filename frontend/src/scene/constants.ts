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
export const VIEW_HEIGHT_DEFAULT = 24
export const VIEW_HEIGHT_MIN = 4
export const VIEW_HEIGHT_MAX = 70

/**
 * How many cells of board to keep beyond the viewport at all times.
 *
 * The extent it is measured against is `BOARD_HALF_COLS` in `@hexnome/rules/board` — the playfield
 * is a rules input as much as a scene one, because it decides whether a plate has room, and the
 * server has to agree with this end about it.
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

/**
 * The **token's** rim — a plate's own tile — as `TILE_BEVEL` is a loose tile's.
 *
 * Same width, opposite curvature: the token is the cavity that tile would leave, so its rim rolls
 * inward and its shading inverts. See scene/tokenGeometry.ts, where the shape and the reasoning live.
 *
 * `TOKEN_RIM` matches `TILE_BEVEL` exactly, because the point is that the two are the same moulding
 * seen from opposite sides. `TOKEN_RIM_DEPTH` does not: a loose tile's rim rolls a full quarter circle
 * through 0.15 of height, and a token repeating that would stand a fifth of a cell proud of a plate
 * 0.08 thick. Flattening the quarter circle into a quarter ellipse keeps the shading — which is the
 * only part of it a top-down camera can see — and drops the rest.
 */
export const TOKEN_RIM = TILE_BEVEL
export const TOKEN_RIM_DEPTH = 0.06

/* ── Stems (the jokers) ──────────────────────────────────────────────────────── */

/**
 * A stem is a **coin**, not a tile: a low cylinder rather than a hexagonal prism.
 *
 * The shape is the whole tell. Everything else on the table is a hexagon that tessellates with
 * everything else; a stem never joins the board, so making it round says at a glance that it plays by
 * different rules — before a player has read anything.
 *
 * It occupies a tile slot, so it is sized against the tile it displaces rather than against the slot.
 */
export const STEM_RADIUS = TILE_SIZE * 0.72
export const STEM_THICKNESS = TILE_THICKNESS * 0.85
/** Round enough that no facet is visible at the sizes a coin is drawn. */
export const STEM_SEGMENTS = 48

/**
 * The emblem's size on the coin face, in **coin radii**.
 *
 * `createSymbolPlane` fits an image by its bounding-box *diagonal*, so for the square stem art the
 * emblem spans `scale / √2` of the coin's diameter. Two numbers worth knowing while tuning:
 *
 * - `1.41` (≈ √2) fills the coin exactly, edge to edge, hiding the metal entirely.
 * - `1.30` leaves a thin ring of rim showing, which is the default.
 *
 * Below about 1.0 the coin reads as mostly bare metal with a small badge on it.
 */
export const STEM_SYMBOL_SCALE = 1.3

/**
 * Nudge the emblem across the coin face, in fractions of `STEM_RADIUS`. Positive is **up the screen**.
 *
 * Same convention as `SYMBOL_OFFSET_UP` for tiles, and flipped to world −Z in the same one place — see
 * `createSymbolPlane`. Here because the art is provisional and its optical centre may not be its
 * bounding-box centre.
 */
export const STEM_SYMBOL_OFFSET_UP = 0

/** Provisional art, from `external assets/joker.png` — see docs/art-spec.md. */
export const STEM_TEXTURE_URL = '/textures/stem.png'

/**
 * The six tile colours, in palette order — a tile's `color` is an index into this list.
 *
 * **HSL, in degrees and percent**, so the palette can be dialled by hand: `l` alone walks a colour
 * darker or lighter without touching what colour it is, and `s` alone takes it toward grey. In hex
 * neither move is one edit — going a step darker means recomputing all three channels, which is why
 * these started life as hand-picked hexes and stayed wherever they first landed.
 *
 * `name` is user-facing: the action bar prints it when it names a draft ("all indigo"), and the scoring
 * panels name their colour targets the same way — so it reads as prose rather than as a swatch label.
 *
 * These are sRGB and the tiles are **lit**, so what lands on screen is not the swatch. Indigo is
 * RGB(97, 62, 204) as a value and measures RGB(116, 68, 204) on the board: brighter in red and green,
 * with blue unmoved. Tune against the render, not against the numbers here.
 *
 * The rules never see any of this: `game/` knows a colour only as an index (docs/tech-spec.md, "The one
 * hard architectural rule"). The list length is pinned to `TILE_COLOR_COUNT` by an assertion in
 * scene/tileMaterials.ts — adding or removing an entry here is a typecheck error until both agree.
 */
export const TILE_COLORS = [
  { name: 'Orange', h: 25, s: 60, l: 40 },
  { name: 'Lime', h: 76, s: 60, l: 30 },
  { name: 'Green', h: 149, s: 60, l: 30 },
  { name: 'Blue', h: 197, s: 60, l: 30 },
  { name: 'Indigo', h: 255, s: 60, l: 50 },
  { name: 'Magenta', h: 320, s: 60, l: 50 },
] as const

/**
 * A palette entry as a CSS colour — for the DOM, and for three, which parses the same string.
 *
 * **Keep the commas and the bare hue.** This is the only syntax three's `Color.setStyle` accepts;
 * `hsl(25 64% 42%)` and `hsl(25deg, …)` are both valid modern CSS and both make it give up and leave
 * the colour **white**, with no warning. Generating the string here rather than storing it is what
 * keeps that from ever being typed by hand — and `tileColors.spec.ts` fails if it stops parsing.
 *
 * Takes the entry rather than the index, so each caller keeps whatever it already does about a colour
 * that is not in the palette: the board falls back to the first colour, the flat chips to grey.
 */
export function tileColorCss(color: { h: number, s: number, l: number }): string {
  return `hsl(${color.h}, ${color.s}%, ${color.l}%)`
}


/* ── Drawer ──────────────────────────────────────────────────────────────────── */

export const DRAWER_ROWS = 2

/**
 * Horizontal slot pitch, in **screen pixels**.
 *
 * The drawer is UI: it keeps its size and place on screen while the board pans and
 * zooms beneath it, so its layout is specified in pixels and converted to world units
 * every frame (scene/screenProjection.ts).
 */
export const DRAWER_SLOT_PX = 87
export const DRAWER_PADDING_PX = 13
/** Gap between the drawer and the bottom of the canvas. */
export const DRAWER_BOTTOM_PX = 22

/**
 * Breathing room either side of the drawer, and the most of the window's height it may take.
 *
 * Both feed the fit factor in `drawerLayout.ts`. The sizes above are what the drawer *wants* to be;
 * these two decide when it has to settle for less. The height cap is nearly a no-op at 720px tall —
 * deliberately, since it exists only to stop a wide, short window handing the whole screen to a panel
 * that is meant to sit under the board.
 */
export const DRAWER_SIDE_GAP_PX = 16
export const DRAWER_MAX_HEIGHT_FRACTION = 0.32

/**
 * Tile width as a fraction of its slot, leaving the slot outline visible around it.
 *
 * Raised from 0.9 with the slot pitch: at 83px and 0.9 the tiles were 65px across with 18px of air
 * between them, which read as a sparse grid rather than a full drawer. 87 and 0.95 puts 72px tiles
 * 15px apart — bigger tiles and a smaller gap, from the two halves moving in opposite directions.
 */
export const DRAWER_TILE_FILL = 0.95

/**
 * Plate slots in the drawer, and their width in screen pixels.
 *
 * A plate is a seven-cell flower, so it is about three hexes across: `5.196 · HEX_SIZE`
 * wide against a tile's `1.732`. It needs roughly triple a tile slot, which is why the
 * plate slots sit in one row spanning the drawer's full height rather than in the tile
 * grid.
 *
 * Scaled with the tile slots, so the bay stays very nearly plate-shaped. A plate is 1.039 times
 * wider than tall, and two rows of 87px slots make the bay 201px tall — so 208 keeps the plate
 * filling its bay rather than floating in a portrait box with slack above and below.
 *
 * It moves whenever `DRAWER_SLOT_PX` does, and for that reason: the bay's height is two tile rows, so
 * a width that stayed put would turn the bay from plate-shaped into portrait.
 */
export const PLATE_SLOT_PX = 208
/** Gap between the plate slots and the tile grid. */
export const DRAWER_GROUP_GAP_PX = 16
/** Plate width as a fraction of its slot. */
export const PLATE_SLOT_FILL = 0.92

/* ── Shared source (the pick-from column) ────────────────────────────────────── */

/*
 * How many lots the source shows is **not a constant** — it is one per plate the round deals, so it
 * comes from the `platesPerRound` setting. See game/source.ts for why those are the same number.
 *
 * It is a column down the left, under the title, rather than a row: six lots side by side would be
 * wider than the board and would fight the drawer for the bottom of the screen. Vertical also matches
 * what it is — a stack you work down, newest on top.
 */

/** Flush with the header, which `.top` also puts 16px from the left edge. */
export const SOURCE_LEFT_PX = 16
/**
 * Air between the header's bottom edge and the top of the column.
 *
 * The column's actual top is **measured**, not stated — `scene/headerBox.ts` watches the header and
 * the layout puts the column this far below wherever it ends. A constant could not work: the header
 * wraps to two rows on a narrow screen and to three when the scoring panel is closed and its strip
 * moves up into it, so any single number was wrong in some state. The overlap that caused grew every
 * time the header gained anything — 18px, then 54px after the type scale, then 70px when its icons
 * went from 24 to 40.
 */
/**
 * The most lots the column sizes itself to fit at once.
 *
 * Beyond this it scrolls rather than shrinking. It is the **binding constraint on lot size** at every
 * ordinary window: a lot is the available height divided by this, so raising `SOURCE_LOT_MAX_PX`
 * alone changes nothing until the division stops being the smaller of the two.
 *
 * Five rather than six, which is what bought the heaped tiles their size. Those are drawn at drawer
 * size and clamped by the plate's height, so a lot that is one-sixth of the column was clamping them
 * to about four-fifths of the tiles they would become the moment they were drafted. A fifth of the
 * height is a lot half again as tall, and the clamp lets go on a tall window.
 *
 * The cost is a row: a round dealing more than five plates now scrolls to show its last. That is the
 * trade — a column that shows one fewer lot at a size worth reading, rather than every lot small.
 */
export const SOURCE_SIZING_CAP = 5

export const SOURCE_HEADER_GAP_PX = 16
/**
 * Where the column starts before the header has been measured, which is one frame at most.
 *
 * 104 = the header's own 16px offset + 88 for two rows + the gap above. Only a seed: a wrong guess
 * here shows for a frame, where a wrong *constant* showed for the life of the screen.
 */
export const SOURCE_TOP_PX = 104
export const SOURCE_PADDING_PX = 9
/** Between lots. Small: they read as one stack, not a set of unrelated panels. */
export const SOURCE_LOT_GAP_PX = 5
/** Clearance kept below the column — from the drawer if it is in the way, else the canvas edge. */
export const SOURCE_BOTTOM_GAP_PX = 12

/**
 * Lot width bounds, in screen pixels.
 *
 * Lots are sized to fit the available height rather than fixed, because six of them stacked is a
 * *vertical* constraint and the viewport is the thing that varies. The min stops the plates becoming
 * unreadable on a short screen, accepting that the column may then be clipped rather than pretending
 * six fit where they do not.
 *
 * The max is set by tile parity, not by taste, and it is a **floor on the cap** rather than a limit
 * anybody chose. A heaped tile is drawn at drawer size and clamped to `plateHeight / SOURCE_HEAP_SPAN`
 * (see sourceTileScale in TableauView.vue), so parity needs
 *
 *     lotWidth >= DRAWER_SLOT_PX / 2 * DRAWER_TILE_FILL * SOURCE_HEAP_SPAN
 *                 / (SOURCE_PLATE_FILL * LOT_ASPECT)
 *
 * which at the current drawer is 231px. Capping below that would make parity unreachable at *any*
 * viewport, which is what the old 176 did once the drawer tiles grew: the lots had the room and the
 * cap held them back. It moves with the drawer, and this is the arithmetic to redo when that changes.
 */
export const SOURCE_LOT_MAX_PX = 232
/**
 * The floor, in screen pixels — below this the column scrolls instead of shrinking further.
 *
 * Chosen against the real numbers rather than by feel. A 390x844 phone held upright fits six lots at
 * 107px naturally, so a floor just under that leaves **the commonest phone case untouched** and no
 * scrollbar appears. What it rescues is everything narrower in the other direction: the same phone
 * turned sideways fits six lots at 21px, and a 1024x700 laptop at 59px.
 */
export const SOURCE_LOT_MIN_PX = 104
/**
 * Plate width as a fraction of its lot.
 *
 * Fuller than the drawer's bays, because here the plate has to be a surface for the heap rather than
 * just an object on display: the tiles spread to about 4.3 tile-radii across, and a plate much smaller
 * than that has tiles hanging over its edge with nothing under them.
 */
export const SOURCE_PLATE_FILL = 0.95

/** World width of a plate flower, in units of HEX_SIZE: hole plus two petals across. */
export const PLATE_WORLD_WIDTH = 3 * Math.sqrt(3)

/**
 * World height of a plate flower, in units of HEX_SIZE.
 *
 * Petal centres reach ±1.5 in z (`axialToWorld` of `(0, ±1)`), and each hex adds its own
 * circumradius of 1 beyond that, so the flower spans 5 — very slightly less than its 5.196 width.
 * A plate is nearly square but not quite, and the pick area's lots have to use the real ratio or
 * the plates in them sit off-centre.
 */
export const PLATE_WORLD_HEIGHT = 5

/**
 * World height of a plate's underside. Just clear of the board plane rather than level with
 * it — coplanar faces z-fight along their shared silhouette.
 */
export const PLATE_BASE_Y = 0.03

/**
 * The plate palette. Both faces are the same brown cardboard.
 *
 * A slab carrying seven inset cell marks, each an inset hex with a concentric outline. The two faces
 * differ in **exactly one thing**: the centre mark's colour.
 *
 * - Face **down**: all seven the same. Nothing can be placed on a face-down plate, so singling out a
 *   cell would imply a structure that is not there.
 * - Face **up**: the centre gets no fill at all — its outline is drawn and the slab shows through,
 *   under the anchor emblem that sits there.
 *
 * There used to be a third tone, `hole`, a darker socket for that centre. Its job was to say "this cell
 * can never be filled", and the emblem now says it far more plainly than a slightly darker hexagon ever
 * did — so the tone was removed rather than left behind doing nothing.
 *
 * Two tones, no more. Anything more and the faces stop reading as one object seen from two sides, which
 * a painted front and a plain back demonstrated: it looked like two kinds of piece.
 */
export const PLATE_TONES = {
  slab: '#6d5636',
  socket: '#54422b',
} as const

/**
 * The cell mark, in units of HEX_SIZE: an inset hex, a gap of bare slab, then a thin outline.
 *
 * The outline stops at 0.95 because neighbouring cells are only `√3` apart: at 1.0 the outlines of
 * adjacent cells would touch.
 */
export const PLATE_CELL_MARK_R = 0.62
export const PLATE_CELL_RING_R = [0.84, 0.95] as const

/**
 * Thickness of the plate's slab body, and how far it is shrunk about its centre.
 *
 * A thin solid, not a decal: the flower-shaped slab is what makes a plate read as one
 * physical piece rather than seven loose hexes. Its bevelled edge catches the key light,
 * which is what sells the thickness under a top-down camera.
 *
 * PLATE_BASE_MARGIN is an inward **edge offset**, in world units — not a scale factor. The
 * rim left around each petal socket is `0.0866 − margin`, uniform on every side. Scaling the
 * outline instead moves inner and outer features by different amounts and leaves the sockets
 * flush against the slab's edge; see scene/plateBaseGeometry.ts.
 */
export const PLATE_BASE_THICKNESS = 0.08
export const PLATE_BASE_MARGIN = 0.03
export const PLATE_BASE_BEVEL = 0.018

/** Local heights within a plate, stacked on top of the slab. */
export const PLATE_SOCKET_Y = PLATE_BASE_THICKNESS + 0.002
export const PLATE_RIM_Y = PLATE_BASE_THICKNESS + 0.012

/**
 * Centre height of a tile sitting in a petal, in plate-local units.
 *
 * Set so the tile's underside falls just below the socket face, seating it in the socket
 * rather than hovering over it.
 */
export const PLATE_TILE_LIFT = PLATE_SOCKET_Y + TILE_THICKNESS / 2 - 0.03

/**
 * Where a plate's **own** tile sits — its token, which is drawn flat.
 *
 * A token has no thickness, so its origin *is* its face and it needs no half-thickness lift: it rests
 * just clear of the socket mark beneath it. The gap is small but far above the depth buffer's
 * resolution over this camera's range, so nothing z-fights.
 */
export const PLATE_TOKEN_LIFT = PLATE_SOCKET_Y + 0.012

/**
 * Height of the drop-target ring.
 *
 * Above a plate's brass socket rims, not just above the board cells. The rims are opaque and
 * write depth, so a marker below them is simply invisible on a plate — which is where tiles
 * are dropped. Under a top-down orthographic camera height costs nothing in apparent
 * position, so this can be as high as it needs to be.
 */
export const HIGHLIGHT_Y = PLATE_BASE_Y + PLATE_RIM_Y + 0.02

/** How briskly a plate eases into a new rotation. Higher is snappier. */
export const PLATE_SPIN_EASE = 13

/**
 * Heights, which under a top-down orthographic camera are purely a draw order.
 *
 * The drawer floats above the board, and a held tile above everything — so a tile
 * dragged out of the drawer passes over its neighbours rather than under them.
 */
export const DRAWER_CHROME_Y = 1.8
export const DRAWER_TILE_Y = 2
export const HELD_TILE_Y = 3

/**
 * The shared source, on the same tier as the drawer: both are screen-anchored UI above the board.
 *
 * A hair below the drawer so that if the two ever overlap — a very short viewport — the drawer wins,
 * since that is where the piece you are moving ends up.
 */
export const SOURCE_CHROME_Y = 1.75
export const SOURCE_PLATE_Y = 1.9
/**
 * Loose tiles sit above their lot's plate, and each one above the last.
 *
 * They genuinely overlap — that is what a heap looks like — so without a per-tile step they would
 * z-fight against each other wherever they cross.
 */
export const SOURCE_TILE_Y = 1.95
export const SOURCE_TILE_LAYER_STEP = 0.012

/**
 * Extra height for a tile selected during a draft.
 *
 * Enough to clear every layer step, so a selected tile sits above the whole heap. Not decoration: its
 * mint ring was otherwise partly hidden behind whichever tile happened to be heaped on top of it, and
 * a selection indicator that another object can occlude is not an indicator.
 */
export const SOURCE_TILE_SELECT_LIFT = 0.1

/**
 * The scrim that dims the whole source column while it is not draftable.
 *
 * Fading the panel alone was not enough: the lots stayed as bright as anything on the board, and a
 * heap of full-colour tiles reads as grabbable however faint its frame is. This is one quad over the
 * column's rectangle, so the frame, the bays, the plates and the tiles all recede together.
 *
 * **The height is doing real work, and it is bounded at both ends.** It must clear the top of a heap —
 * `SOURCE_TILE_Y + (SOURCE_TILES_PER_LOT - 1) * SOURCE_TILE_LAYER_STEP`, which is 1.986 for four tiles
 * — or the topmost tiles poke through and stay bright. And it must stay below {@link HELD_TILE_Y}, so
 * that with depth testing left on a piece carried across the column passes *over* the scrim instead of
 * being dimmed by it; that is what saves a render-order special case.
 *
 * At 2 the lower margin is 0.014, so deepening a lot past five tiles needs this raised with it.
 */
export const SOURCE_SCRIM_Y = 2
export const SOURCE_SCRIM_COLOR = '#05070a'

/**
 * **How strongly the source is dimmed. This is the only knob that matters for that.**
 *
 * `CHROME_PANEL_TONES.dim.fillOpacity` looks like it should do the same job and effectively cannot:
 * the panel fill is `#15171c` over a board that is already near-black, so swinging it from 0.1 to 0.99
 * moves the panel background by about 7/255 — and the scrim then halves even that. Measured, not
 * assumed. Reach for this instead.
 *
 * Roughly what the values look like, as a share of a tile's original brightness: `0.5` half, `0.38`
 * clearly dimmed but the colours still read, `0.28` a light veil, `0.18` barely there.
 */
export const SOURCE_SCRIM_OPACITY = 0.28

/**
 * The drop-target marker: where a held piece would land, and whether it may.
 *
 * **Invalid is a real red, and as loud as valid.** It used to be a desaturated maroon drawn at a third
 * of the opacity, which read as "nothing here" rather than "not there" — fine when the only illegal
 * drop was an obvious overlap, misleading now that plates must also *connect*, since a position can
 * look perfectly free and still be refused. A refusal the player cannot see is a refusal they will
 * blame on the controls.
 */
/* ── Anchors ─────────────────────────────────────────────────────────────────── */

/**
 * The emblem in a plate's centre hole: dark until the plate's six petals are filled, then lit.
 *
 * Two textures rather than one tinted texture, because the difference between them is not a colour —
 * the gem gains an inner glow and highlights the metal around it, which no tint reproduces. They are
 * cropped from the same box in the source art (docs/art-spec.md), so swapping one for the other cannot
 * make the emblem shift.
 */
export const ANCHOR_TEXTURE_URLS = {
  off: '/textures/anchor-off.png',
  on: '/textures/anchor-on.png',
} as const

/**
 * Emblem size in the hole, in **hole radii**, fitted by bounding-box diagonal like every other symbol.
 *
 * The art is a *tall* hexagon — a crest with points above and below — so fitting it by the diagonal
 * leaves it narrower than the hole it sits in. Raise this to push the points over the hole's rim.
 */
export const ANCHOR_SCALE = 1.4

/**
 * Width against height, as a multiplier on the art's own proportions. Above 1 widens it.
 *
 * The crest is drawn markedly taller than the cell it sits in — 816×1220 in the source, so **0.67**
 * wide-to-tall against a regular pointy-top hexagon's **0.87** — which is why it reads as stretched.
 * Two numbers worth knowing while dialling this in:
 *
 * - `1.06` matches the hexagonal *body* to the cell, leaving the points above and below overhanging.
 * - `1.29` matches the whole crest, points included, and visibly squashes the hexagon doing it.
 *
 * Independent of {@link ANCHOR_SCALE}: this changes the shape, that changes the size, and neither
 * needs re-tuning when the other moves.
 */
export const ANCHOR_RATIO = 1.15

/** Nudge up the screen, in hole radii. Same convention as `SYMBOL_OFFSET_UP`. */
export const ANCHOR_OFFSET_UP = 0

/**
 * How an **external** anchor is told apart from an internal one: a tint multiplied over the same art.
 *
 * They pay different amounts, so they have to be distinguishable at a glance — but they are the same
 * kind of thing, so two separate illustrations would overstate the difference and double the art to
 * keep in step. A multiply keeps the emblem identical in every other way.
 *
 * Cool against the internal one's warm brass, and darker, because an external anchor is a *gap* — it
 * sits on bare board rather than on a plate, and reading as slightly recessed suits what it is. Values
 * above 1 brighten, so this can go either way while tuning.
 */
export const ANCHOR_EXTERNAL_TINT = '#7f9fc4'

/**
 * The bare-cell disc an external anchor is drawn on.
 *
 * An internal anchor has a plate under it. An external one is a hole in the plates by definition, so
 * without something behind it the emblem would float on the board's empty honeycomb. This is that
 * something: a plain dark hex, the size of a plate's cell mark, so the two anchors sit in similarly
 * sized recesses.
 */
export const ANCHOR_EXTERNAL_PAD_COLOR = '#241d12'
export const ANCHOR_EXTERNAL_PAD_R = 0.86

/** Clear of the hole's own face, by the same hair every other decal uses. */
export const ANCHOR_LIFT = 0.008

export const HIGHLIGHT_COLORS = {
  valid: '#8fe6c0',
  invalid: '#ff4d3d',
} as const

/**
 * The `.chrome-panel` look, for the panels drawn in the canvas.
 *
 * **Kept in step with `.chrome-panel` in src/styles/main.scss by hand.** The drawer tray and plate
 * bays are quads in the scene rather than DOM (see scene/chromePanel.ts for why), so they cannot
 * inherit the CSS — but they sit right next to the header and help card, and a border a shade off
 * would be obvious. If you change one, change the other.
 *
 * Pixels, not world units: the panel shader works in screen space so these hold at any zoom.
 */
export const CHROME_PANEL = {
  borderPx: 1,
  radiusPx: 4,
  border: '#3a3222',
  borderOpacity: 1,
  fill: '#15171c',
  fillOpacity: 0.82,
} as const

/**
 * How live a container looks: dimmed, resting, or lit.
 *
 * A turn only makes one area interactive at a time — the source while drafting, your drawer while
 * placing — and the panel border is where that is said. It is the container's own outline, so it can
 * report the container's state without competing with the per-item draft markers inside it, which are
 * saying something narrower ("this tile, specifically").
 *
 * `dim` fades the border only. It does **not** thin the fill: a container is dimmed together with its
 * contents, by a scrim laid over the whole area, and thinning the fill underneath that would only make
 * the panel stop reading as a panel. The border is set higher than it looks here because the scrim
 * knocks it back again on its way through.
 *
 * **To make the dim stronger or weaker, change {@link SOURCE_SCRIM_OPACITY}, not the `fillOpacity`
 * below.** Fill opacity is nearly inert on a near-black fill over a near-black board — it is kept in
 * the shape only because `resting` and `active` genuinely use it.
 *
 * `active` is a lighter brass at the same hue, not the mint of `HIGHLIGHT_COLORS`. Mint here would
 * read as a drop target — it is the colour a valid destination uses — and "this area is live" is a
 * much weaker claim than "release here".
 */
export const CHROME_PANEL_TONES = {
  dim: { border: '#3a3222', borderOpacity: 0.75, fillOpacity: CHROME_PANEL.fillOpacity },
  resting: { border: CHROME_PANEL.border, borderOpacity: CHROME_PANEL.borderOpacity, fillOpacity: CHROME_PANEL.fillOpacity },
  active: { border: '#8f7c46', borderOpacity: 1, fillOpacity: 0.86 },
} as const

export type ChromePanelTone = keyof typeof CHROME_PANEL_TONES

/**
 * The six value symbols, in value order 1–6. Cropped to content and downscaled from
 * the originals in `external assets/tiles2/` by `scripts/prepare-symbols.py` — see
 * docs/art-spec.md.
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
 * How much of a tile a symbol fills, as a fraction of the tile's **apothem**.
 *
 * The apothem, not the circumradius: it is the tile's narrow half-width, so fitting to it keeps a symbol
 * clear of the flats as well as the points. This is the knob that moves all six together.
 */
export const SYMBOL_FIT = 1

/**
 * Per-symbol size multiplier, indexed by value **1–6** (so `[0]` is the DNA helix, value 1).
 *
 * A single fit cannot serve all six. `createSymbolPlane` normalises each image by its bounding-box
 * diagonal, which equalises *area* rather than apparent weight — so an open motif like the pentose ring
 * reads smaller than a dense one like the chromosome pair at the identical fit. These are the per-motif
 * corrections, and they are meant to be eyeballed against the screen rather than derived.
 *
 * All 1 means "no correction yet". Raise one to grow that symbol; nothing else is affected, and centring
 * is unaffected at any value — the plane is built centred on the tile's origin.
 */
export const SYMBOL_SCALE: readonly number[] = [
  1, // 1 · DNA helix
  1, // 2 · chromosome pair
  1.2, // 3 · codon
  1.2, // 4 · DNA bases
  1.2, // 5 · pentose sugar
  1.2, // 6 · benzene ring
]

/**
 * Per-symbol vertical nudge, indexed by value **1–6**, in fractions of `HEX_SIZE`.
 *
 * **Positive moves the symbol up the screen.** (In world terms that is −Z: the board lies in the XZ
 * plane and the camera's up vector is `(0, 0, −1)` at zero tilt. The sign is flipped once, in
 * `createSymbolPlane`, so this table stays in the units a person actually thinks in.)
 *
 * The motifs are symmetric left-to-right but several are not top-to-bottom, so their *optical* centre
 * sits off their bounding-box centre — and it is the bounding box that gets centred on the tile. No
 * amount of scaling fixes that; it needs a nudge.
 *
 * Measured against `HEX_SIZE` rather than against the symbol, as asked. That makes a nudge predictable —
 * "a twentieth of a cell down" means the same thing whatever else changes — but it does mean a nudge and
 * a `SYMBOL_SCALE` change are independent: grow a symbol a lot and its nudge may want revisiting.
 */
export const SYMBOL_OFFSET_UP: readonly number[] = [
  0, // 1 · DNA helix
  0, // 2 · chromosome pair
  0.07, // 3 · codon
  0, // 4 · DNA bases
  0.07, // 5 · pentose sugar
  0, // 6 · benzene ring
]

/**
 * The multiplier for a tile value, tolerating anything out of range.
 *
 * Values are 1-based and arrive from the deck, so a stray 0 or 7 would otherwise silently render a
 * zero-sized symbol — an invisible tile is much harder to diagnose than a wrongly-sized one.
 */
export function symbolScaleFor(value: number): number {
  return SYMBOL_SCALE[value - 1] ?? 1
}

/** The vertical nudge for a tile value, in `HEX_SIZE` fractions. Positive is up the screen. */
export function symbolOffsetUpFor(value: number): number {
  return SYMBOL_OFFSET_UP[value - 1] ?? 0
}

export const COLORS = {
  /**
   * The board: dark slate with a faint honeycomb, and nothing else.
   *
   * It exists to show where a plate may go, which is a minor job, so it stays quiet and
   * lets the plates carry the colour. The line is a little brighter than it was now that
   * it is the only thing describing the board rather than an underlay beneath tile art.
   */
  boardBackground: '#12151a',
  gridLine: '#333b47',
  canvasClear: '#0d0f13',
} as const


/* ── spending ────────────────────────────────────────────────────────────────── */

/**
 * How a paid piece leaves the table.
 *
 * Long enough to be read rather than merely noticed: the point is to show the *price*, so the eye
 * should be able to count what left. The turn waits for it — see `GameView.applyPayment` — which is
 * why the arithmetic lives here rather than inside the scene, where the caller could not reach it.
 */
export const DEPART_SECONDS = 0.9
export const DEPART_STAGGER = 0.16
/** How many leave in single file before the rest go together. */
export const DEPART_QUEUE = 7

/** How long spending this many pieces takes, in milliseconds. Zero for nothing. */
export function departureMillis(count: number): number {
  if (count <= 0) return 0
  return (Math.min(count - 1, DEPART_QUEUE) * DEPART_STAGGER + DEPART_SECONDS) * 1000
}
