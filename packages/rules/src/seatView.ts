/**
 * One seat's view of the whole game.
 *
 * Pure data and functions. This module must not import from `vue` or `three` —
 * see docs/tech-spec.md, "The one hard architectural rule". ESLint enforces it.
 *
 * ## The state is global; the view is not
 *
 * There is one tableau and it holds everything: the shared source, every player's board, every
 * player's drawer, all of it. Nothing about the *state* is per-player. What is per-player is which
 * part of it you are looking at, and that is this.
 *
 * A view presents the same `Tableau` interface with a seat already filled in, so the renderer asks
 * for "the board" and gets the board it is pointed at. That keeps the seat out of sixteen call sites
 * and, more usefully, makes *which* seat a single value that can change: pointing the same scene at
 * another player is one assignment, not a re-render through a different component.
 *
 * ## Which seat, and whose turn, are different questions
 *
 * - **`mySeat`** is the chair your token gives you. It may be absent — that is a spectator, and it
 *   costs nothing to allow because a spectator is simply someone for whom it is never their turn.
 * - **the viewed seat** is whose board is on screen. It starts as yours and can be moved.
 *
 * So watching another player is a view at their seat, a spectator is a view with no seat of their
 * own, and a replay is a view over a prefix of the log. None of those is a special case, and none of
 * them needs a second renderer.
 *
 * A view is **read-only unless it is yours**: {@link seatView} takes `writable`, and a view of
 * somebody else's board silently refuses every mutation rather than trusting a caller to remember
 * not to try. Turn order is a separate gate again, checked by the server.
 */
import type { PlateLocation, Seat, Tableau, TileLocation } from './tableau'

/** Fill in the seat on a location that did not name one. Source locations are shared and untouched. */
function atSeat<L extends PlateLocation | TileLocation>(location: L, seat: Seat): L {
  if (location.kind === 'source' || location.kind === 'onPlate') return location
  return { ...location, seat } as L
}

/**
 * A tableau as one seat sees it.
 *
 * Queries answer about that seat; mutations land there. The shared source is not rewritten — it
 * belongs to everyone, so drafting out of it works through a view exactly as it does without one.
 */
export function seatView(inner: Tableau, seat: Seat, writable = true): Tableau {
  const no = <T>(value: T) => value

  return {
    ...inner,

    // ── looking ──────────────────────────────────────────────────────────────
    tilesOnBoard: () => inner.tilesOnBoard(seat),
    platesOnBoard: () => inner.platesOnBoard(seat),
    freeDrawerSlots: () => inner.freeDrawerSlots(seat),
    stems: () => inner.stems(seat),
    anchors: () => inner.anchors(seat),
    coverageAt: cell => inner.coverageAt(cell, seat),
    petalAt: cell => inner.petalAt(cell, seat),

    // ── touching ─────────────────────────────────────────────────────────────
    addTile: (spec, location, options) =>
      writable ? inner.addTile(spec, atSeat(location, seat), options) : no(undefined),
    addPlate: (location, options) =>
      writable ? inner.addPlate(atSeat(location, seat), options) : no(undefined),
    addStem: slot => (writable ? inner.addStem(slot, seat) : no(undefined)),
    moveTile: (id, location) =>
      writable ? inner.moveTile(id, atSeat(location, seat)) : no(false),
    movePlate: (id, location) =>
      writable ? inner.movePlate(id, atSeat(location, seat)) : no(false),
    moveStem: (id, slot) => (writable ? inner.moveStem(id, slot) : no(false)),
    rotatePlate: (id, steps) => (writable ? inner.rotatePlate(id, steps) : no(false)),
    discard: id => (writable ? inner.discard(id) : null),
    swapDrawerItems: (a, b) => (writable ? inner.swapDrawerItems(a, b) : no(false)),
  }
}
