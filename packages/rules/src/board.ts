import { hexRectangle, type Axial } from './hex'

/**
 * How big the playfield is, and the cells it comes to.
 *
 * **Here rather than in the scene, because both ends need the same answer.** It was a scene constant
 * while only the browser built a game: the board reads as endless, panning is clamped short of its
 * edge, and 20 in every direction was a decision about how that feels. But `GameOptions.cells` is
 * also what decides whether a plate has room, so a server folding the log needs the identical list —
 * and two lists that are meant to be identical are two lists that will one day differ.
 *
 * The scene still owns how the *camera* treats it (`PAN_MARGIN_CELLS`, the pan and zoom clamps); this
 * owns only the extent, which is the part the rules can see.
 */

/**
 * Half-extent of the board, in cells, measured from the centre.
 *
 * The playfield is a **rectangle** in world space, not a hex disc: 20 cells in every direction comes
 * to 1681 cells. Large enough that, with panning clamped short of the edge, it can never be reached —
 * so the board reads as endless without pretending to be infinite.
 */
export const BOARD_HALF_COLS = 20
export const BOARD_HALF_ROWS = 20

/**
 * The playfield, built once.
 *
 * Shared rather than rebuilt per call, and safe to share because nothing takes a copy or writes to
 * it: `createTableau` reads the list into a set of keys and never touches it again. It matters on the
 * server, which folds a game's log from scratch on every request and would otherwise allocate
 * seventeen hundred objects each time to arrive at the same answer.
 */
const CELLS: readonly Axial[] = Object.freeze(hexRectangle(BOARD_HALF_COLS, BOARD_HALF_ROWS))

/** The cells a game is played on. The same list every time, deliberately. */
export function boardCells(): readonly Axial[] {
  return CELLS
}
