import { describe, expect, it } from 'vitest'
import { seatView } from './seatView'
import { hexRectangle } from './hex'
import { boardHole, createTableau, drawerSlot, type TableauOptions } from './tableau'

/**
 * One state, many views. The tableau holds every player's board and drawer at once; a view decides
 * which of them the question is about.
 */

const OPTIONS: TableauOptions = {
  cells: hexRectangle(6, 6),
  drawerSlots: 8,
  plateSlots: 2,
  sourceLots: 3,
  sourceTilesPerLot: 4,
}
const CENTRE = { q: 0, r: 0 }

describe('looking through a seat', () => {
  it('answers about that seat without being asked twice', () => {
    const game = createTableau(OPTIONS)
    game.addPlate(boardHole(CENTRE, 0))
    game.addPlate(boardHole(CENTRE, 1))

    // The unseated calls a renderer already makes, now scoped by the view rather than by the caller.
    expect(seatView(game, 0).platesOnBoard()).toHaveLength(1)
    expect(seatView(game, 1).platesOnBoard()).toHaveLength(1)
    expect(seatView(game, 0).platesOnBoard()[0]!.id)
      .not.toBe(seatView(game, 1).platesOnBoard()[0]!.id)
    expect(seatView(game, 2).platesOnBoard()).toHaveLength(0)
  })

  it('puts a piece in the drawer the view is pointed at', () => {
    const game = createTableau(OPTIONS)
    seatView(game, 1).addTile({ color: 1, value: 1 }, { kind: 'drawer', slot: 3 })

    expect(game.freeDrawerSlots(1)).not.toContain(3)
    expect(game.freeDrawerSlots(0)).toContain(3)
  })

  it('leaves the shared source shared', () => {
    const game = createTableau(OPTIONS)
    const loose = seatView(game, 1).addTile({ color: 2, value: 2 }, { kind: 'source', lot: 0, index: 0 })!

    // Not rewritten to seat 1: there is one source and everybody drafts from it.
    expect(loose.location).toEqual({ kind: 'source', lot: 0, index: 0 })
    expect(game.tilesInSourceLot(0)).toHaveLength(1)
  })

  it('drafts out of the source and into the viewer\'s own drawer', () => {
    const game = createTableau(OPTIONS)
    const loose = game.addTile({ color: 2, value: 2 }, { kind: 'source', lot: 0, index: 0 })!

    seatView(game, 1).moveTile(loose.id, { kind: 'drawer', slot: 0 })
    expect(game.tile(loose.id)!.location).toEqual({ kind: 'drawer', slot: 0, seat: 1 })
  })

  it('keeps a stem in the drawer it was viewed into', () => {
    const game = createTableau(OPTIONS)
    seatView(game, 2).addStem(0)
    expect(game.stems(2)).toHaveLength(1)
    expect(game.stems(0)).toHaveLength(0)
  })
})

/*
 * Watching someone else. The renderer is the same one — this is not a picture of their board, it is
 * their board — so the only thing that must differ is that nothing can be done to it.
 */
/*
 * The bug this file did not catch the first time. The view scoped the queries it overrode and left
 * `plates()` and `tiles()` whole — and those are what the renderer reads. Both players' boards grow
 * from hole (0,0), so every plate drawn at its own hole put two boards in the same place, and every
 * tile drawn put two drawers in one.
 */
describe('the accessors a renderer actually reads', () => {
  function twoPlayers() {
    const game = createTableau(OPTIONS)
    const mine = game.addPlate(boardHole(CENTRE, 0))!
    const yours = game.addPlate(boardHole(CENTRE, 1))!
    game.addTile({ color: 1, value: 1 }, { kind: 'onPlate', plateId: mine.id, petal: 0 }, { fixed: true })
    game.addTile({ color: 2, value: 2 }, { kind: 'onPlate', plateId: yours.id, petal: 0 }, { fixed: true })
    game.addTile({ color: 3, value: 3 }, drawerSlot(0, 0))
    game.addTile({ color: 4, value: 4 }, drawerSlot(0, 1))
    return { game, mine, yours }
  }

  it('shows one plate per board, not both at the same hole', () => {
    const { game, mine, yours } = twoPlayers()
    expect(seatView(game, 0).plates().map(p => p.id)).toEqual([mine.id])
    expect(seatView(game, 1).plates().map(p => p.id)).toEqual([yours.id])
    // The tableau itself still has both, which is what conservation counts.
    expect(game.plates()).toHaveLength(2)
  })

  it('shows one drawer, not both merged', () => {
    const { game } = twoPlayers()
    const drawerOf = (s: number) => seatView(game, s).tiles()
      .filter(t => t.location.kind === 'drawer')
      .map(t => t.value)

    expect(drawerOf(0)).toEqual([3])
    expect(drawerOf(1)).toEqual([4])
  })

  /* A plate's own tile follows its plate — which is why `onPlate` carries no seat of its own. */
  it('carries a plate\'s fixed tile along with the plate', () => {
    const { game } = twoPlayers()
    expect(seatView(game, 0).tiles().filter(t => t.fixed).map(t => t.value)).toEqual([1])
    expect(seatView(game, 1).tiles().filter(t => t.fixed).map(t => t.value)).toEqual([2])
  })

  /* The source is everyone's, so it is in every view. */
  it('keeps the shared source in both views', () => {
    const { game } = twoPlayers()
    game.addPlate({ kind: 'source', lot: 0 }, { faceDown: true })
    game.addTile({ color: 5, value: 5 }, { kind: 'source', lot: 0, index: 0 })

    for (const s of [0, 1]) {
      const view = seatView(game, s)
      expect(view.plates().filter(p => p.location.kind === 'source')).toHaveLength(1)
      expect(view.tiles().filter(t => t.location.kind === 'source')).toHaveLength(1)
    }
  })
})

describe('a view of somebody else', () => {
  it('shows everything and changes nothing', () => {
    const game = createTableau(OPTIONS)
    game.addPlate(boardHole(CENTRE, 1))
    game.addTile({ color: 3, value: 3 }, drawerSlot(2, 1))

    const watching = seatView(game, 1, false)
    expect(watching.platesOnBoard()).toHaveLength(1)
    expect(watching.freeDrawerSlots()).not.toContain(2)

    expect(watching.addStem(0)).toBeUndefined()
    expect(watching.addPlate({ kind: 'board', hole: { q: 2, r: 0 } })).toBeUndefined()
    expect(watching.rotatePlate(game.platesOnBoard(1)[0]!.id, 1)).toBe(false)
    expect(watching.discard(game.platesOnBoard(1)[0]!.id)).toBeNull()

    // And the game is exactly as it was.
    expect(game.stems(1)).toHaveLength(0)
    expect(game.platesOnBoard(1)).toHaveLength(1)
    expect(game.platesOnBoard(1)[0]!.rotation).toBe(0)
  })

  /* A spectator is not a special case — it is a read-only view of whichever seat they picked. */
  it('is what a spectator gets, with no seat of their own', () => {
    const game = createTableau(OPTIONS)
    game.addPlate(boardHole(CENTRE, 0))
    const spectating = seatView(game, 0, false)
    expect(spectating.platesOnBoard()).toHaveLength(1)
    expect(spectating.addStem(0)).toBeUndefined()
  })
})
