import { describe, expect, it } from 'vitest'
import { applyEntry, createGameLog, recordingTableau, replayTableau } from './gameLog'
import { hexRectangle } from './hex'
import {
  createTableau,
  drawerSlot,
  boardHole,
  SOLO_SEAT,
  type TableauOptions,
} from './tableau'

/**
 * More than one player in one tableau.
 *
 * The model holds every seat's board, drawer and bays at once, because it has to: piece ids come from
 * a single counter and the journal names pieces by id, so a replay that skipped another player's
 * entries would number everything differently from that point on and the log would stop meaning one
 * thing to everybody. Splitting the game into one tableau per player is what these tests exist to
 * make unnecessary.
 *
 * Seats are also *optional*. A location that does not say belongs to seat 0, so the whole
 * singleplayer game — and the 444 tests that came before this file — never mention one.
 */

const OPTIONS: TableauOptions = {
  cells: hexRectangle(6, 6),
  drawerSlots: 8,
  plateSlots: 2,
  sourceLots: 3,
  sourceTilesPerLot: 4,
}

const CENTRE = { q: 0, r: 0 }

describe('two boards in one tableau', () => {
  it('lets both players hold the same hole', () => {
    const t = createTableau(OPTIONS)
    const mine = t.addPlate(boardHole(CENTRE, 0))
    const yours = t.addPlate(boardHole(CENTRE, 1))

    expect(mine).toBeDefined()
    expect(yours).toBeDefined()
    expect(mine!.id).not.toBe(yours!.id)
  })

  /* The same hole on one board is still one place. Seats must not make the board permissive. */
  it('still refuses two plates in one hole on the same board', () => {
    const t = createTableau(OPTIONS)
    expect(t.addPlate(boardHole(CENTRE, 1))).toBeDefined()
    expect(t.addPlate(boardHole(CENTRE, 1))).toBeUndefined()
  })

  it('shows each player only their own board', () => {
    const t = createTableau(OPTIONS)
    const mine = t.addPlate(boardHole(CENTRE, 0))!
    const yours = t.addPlate(boardHole(CENTRE, 1))!

    expect(t.platesOnBoard(0).map(p => p.id)).toEqual([mine.id])
    expect(t.platesOnBoard(1).map(p => p.id)).toEqual([yours.id])
    // And the whole-game view still sees both, which is what conservation counts.
    expect(t.plates()).toHaveLength(2)
  })

  it('keeps coverage apart, so one board is not covered by the other', () => {
    const t = createTableau(OPTIONS)
    t.addPlate(boardHole(CENTRE, 1))

    expect(t.coverageAt(CENTRE, 1)).toBeDefined()
    expect(t.coverageAt(CENTRE, 0)).toBeUndefined()
  })

  /*
   * The rule that would silently ruin a game: a plate has to touch one of *your* plates, not anyone's.
   * Seat 1 having a full board must not make seat 0's second plate legal in mid-air.
   */
  it('does not let one player connect to another player\'s plates', () => {
    const t = createTableau(OPTIONS)
    t.addPlate(boardHole(CENTRE, 1))

    // Seat 0's board is empty, so its first plate may go anywhere. Far enough that the two plates
    // genuinely do not touch: a plate spans a radius of one, so holes must be more than three apart.
    const far = { q: 5, r: 0 }
    expect(t.addPlate(boardHole(far, 0))).toBeDefined()
    // But its second must touch its own first, not seat 1's.
    expect(t.addPlate(boardHole(CENTRE, 0))).toBeUndefined()
  })

  it('gives each player their own anchors', () => {
    const t = createTableau(OPTIONS)
    t.addPlate(boardHole(CENTRE, 0))
    expect(t.anchors(0)).toHaveLength(1)
    expect(t.anchors(1)).toHaveLength(0)
  })
})

describe('two drawers in one tableau', () => {
  it('lets both players use the same slot number', () => {
    const t = createTableau(OPTIONS)
    const mine = t.addTile({ color: 1, value: 1 }, drawerSlot(3, 0))
    const yours = t.addTile({ color: 2, value: 2 }, drawerSlot(3, 1))

    expect(mine).toBeDefined()
    expect(yours).toBeDefined()
    expect(t.freeDrawerSlots(0)).not.toContain(3)
    expect(t.freeDrawerSlots(1)).not.toContain(3)
    expect(t.freeDrawerSlots(0)).toContain(4)
  })

  it('still refuses two tiles in one slot of one drawer', () => {
    const t = createTableau(OPTIONS)
    expect(t.addTile({ color: 1, value: 1 }, drawerSlot(3, 1))).toBeDefined()
    expect(t.addTile({ color: 2, value: 2 }, drawerSlot(3, 1))).toBeUndefined()
  })

  it('keeps stems in the drawer they were put in', () => {
    const t = createTableau(OPTIONS)
    const mine = t.addStem(0, 0)!
    const yours = t.addStem(0, 1)!

    expect(t.stems(0).map(s => s.id)).toEqual([mine.id])
    expect(t.stems(1).map(s => s.id)).toEqual([yours.id])
  })

  /* A stem and a tile still share a slot, per seat. */
  it('will not put a stem where that player already has a tile', () => {
    const t = createTableau(OPTIONS)
    t.addTile({ color: 1, value: 1 }, drawerSlot(2, 1))
    expect(t.addStem(2, 1)).toBeUndefined()
    // …but seat 0's slot 2 is untouched.
    expect(t.addStem(2, 0)).toBeDefined()
  })
})

/*
 * Why all of this lives in one tableau rather than one per player. Ids come from a single counter, so
 * a replay only reproduces them if it applies every entry — including the other players'.
 */
describe('ids across seats', () => {
  it('mints every piece a distinct id whoever it belongs to', () => {
    const t = createTableau(OPTIONS)
    const ids = [
      t.addPlate(boardHole(CENTRE, 0))!.id,
      t.addPlate(boardHole(CENTRE, 1))!.id,
      t.addTile({ color: 1, value: 1 }, drawerSlot(0, 0))!.id,
      t.addTile({ color: 1, value: 1 }, drawerSlot(0, 1))!.id,
      t.addStem(1, 0)!.id,
      t.addStem(1, 1)!.id,
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('replays a two-player log into the same two boards', () => {
    const log = createGameLog()
    const live = recordingTableau(createTableau(OPTIONS), log.append)

    const mine = live.addPlate(boardHole(CENTRE, 0))!
    const yours = live.addPlate(boardHole(CENTRE, 1))!
    live.addTile({ color: 3, value: 3 }, { kind: 'onPlate', plateId: mine.id, petal: 0 })
    live.addTile({ color: 4, value: 4 }, { kind: 'onPlate', plateId: yours.id, petal: 2 })
    live.addStem(5, 0)
    live.addStem(5, 1)

    const rebuilt = replayTableau(log.entries, OPTIONS)
    for (const seat of [0, 1]) {
      expect(rebuilt.platesOnBoard(seat).map(p => p.id)).toEqual(live.platesOnBoard(seat).map(p => p.id))
      expect(rebuilt.tilesOnBoard(seat).map(t => t.id)).toEqual(live.tilesOnBoard(seat).map(t => t.id))
      expect(rebuilt.stems(seat).map(s => s.id)).toEqual(live.stems(seat).map(s => s.id))
    }
  })

  /*
   * The failure mode the single tableau exists to prevent, demonstrated: replaying only one player's
   * entries shifts every id that follows, so the log stops naming the same pieces.
   */
  it('numbers pieces differently if another player\'s entries are skipped', () => {
    const log = createGameLog()
    const live = recordingTableau(createTableau(OPTIONS), log.append)
    live.addPlate(boardHole(CENTRE, 0))
    live.addStem(0, 0)
    const yours = live.addPlate(boardHole(CENTRE, 1))!

    const partial = createTableau(OPTIONS)
    for (const entry of log.entries) {
      // Pretend seat 0's entries belong to somebody else and skip them.
      if (entry.op === 'addStem' && entry.seat === 0) continue
      if (entry.op === 'addPlate' && entry.location.kind === 'board' && entry.location.seat !== 1) continue
      applyEntry(partial, entry)
    }
    expect(partial.platesOnBoard(1)[0]!.id).not.toBe(yours.id)
  })
})

/* Seats are optional, and a game with one never mentions them. */
describe('the unstated seat', () => {
  it('is seat zero', () => {
    const t = createTableau(OPTIONS)
    const plate = t.addPlate({ kind: 'board', hole: CENTRE })!
    expect(t.platesOnBoard(SOLO_SEAT).map(p => p.id)).toEqual([plate.id])
  })

  /*
   * And it stays unstated on the way out. Locations are journalled and stored as JSON, so emitting
   * `seat: 0` would change every entry a singleplayer game writes and would not match the entries
   * already in the database.
   */
  it('is not written back into the location', () => {
    const t = createTableau(OPTIONS)
    const tile = t.addTile({ color: 1, value: 1 }, drawerSlot(2))!
    expect(tile.location).toEqual({ kind: 'drawer', slot: 2 })
    expect(drawerSlot(2)).not.toHaveProperty('seat')
    expect(boardHole(CENTRE)).not.toHaveProperty('seat')
  })
})
