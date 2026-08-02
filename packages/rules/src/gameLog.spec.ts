import { describe, expect, it } from 'vitest'
import {
  createGameLog,
  entriesThroughRound,
  recordingTableau,
  replayTableau,
  type LogEntry,
} from './gameLog'
import { hexRectangle } from './hex'
import {
  createTableau,
  type PlateLocation,
  type TableauOptions,
  type Tile,
  type TileSpec,
} from './tableau'

const RED: TileSpec = { color: 0, value: 1 }
const BLUE: TileSpec = { color: 3, value: 2 }

const OPTIONS: TableauOptions = {
  cells: hexRectangle(6, 6),
  drawerSlots: 16,
  plateSlots: 2,
  sourceLots: 2,
  sourceTilesPerLot: 4,
}

const onBoard = (q: number, r: number): PlateLocation => ({ kind: 'board', hole: { q, r } })
const inDrawer = (slot: number) => ({ kind: 'drawer', slot }) as const

/** A recording tableau and the log behind it. */
function recorded() {
  const log = createGameLog()
  return { log, tableau: recordingTableau(createTableau(OPTIONS), log.append) }
}

/** Everything that identifies a board, for comparing an original against its replay. */
function fingerprint(tableau: ReturnType<typeof createTableau>) {
  return {
    tiles: tableau.tiles().map(t => ({ id: t.id, ...t.location, c: t.color, v: t.value, f: t.fixed })),
    plates: tableau.plates().map(p => ({ id: p.id, ...p.location, rot: p.rotation, down: p.faceDown })),
    stems: tableau.stems().map(s => ({ id: s.id, slot: s.slot })),
  }
}

describe('recording', () => {
  it('writes down a mutation that happened', () => {
    const { log, tableau } = recorded()
    tableau.addPlate(onBoard(0, 0))
    expect(log.entries).toEqual([
      { op: 'addPlate', location: onBoard(0, 0), rotation: 0, faceDown: false },
    ])
  })

  /*
   * A refused call is not something that happened. Leaving it out is also what keeps replay's id
   * counter in step — see the invariant below.
   */
  it('writes down nothing for a mutation that was refused', () => {
    const { log, tableau } = recorded()
    tableau.addPlate(onBoard(0, 0))
    tableau.addPlate(onBoard(0, 0)) // the cell is taken
    expect(log.entries).toHaveLength(1)
  })

  it('records nothing at all for a query', () => {
    const { log, tableau } = recorded()
    tableau.plates()
    tableau.freeDrawerSlots()
    tableau.canPlacePlate(onBoard(0, 0))
    expect(log.entries).toEqual([])
  })

  it('passes the real result back to the caller', () => {
    const { tableau } = recorded()
    const plate = tableau.addPlate(onBoard(0, 0))
    expect(plate?.id).toBeTruthy()
    expect(tableau.plates()).toHaveLength(1)
    expect(tableau.addPlate(onBoard(0, 0))).toBeUndefined()
  })

  it('covers every mutator on the model', () => {
    const { log, tableau } = recorded()
    const plate = tableau.addPlate({ kind: 'plateSlot', slot: 0 })!
    const tile = tableau.addTile(RED, inDrawer(0))!
    const stem = tableau.addStem(1)!
    const source = tableau.addPlate({ kind: 'source', lot: 0 }, { faceDown: true })!

    tableau.moveTile(tile.id, inDrawer(3))
    tableau.moveStem(stem.id, 4)
    tableau.movePlate(plate.id, { kind: 'plateSlot', slot: 1 })
    tableau.rotatePlate(plate.id, 1)
    tableau.revealPlate(source.id, BLUE, 2)
    tableau.addTile(BLUE, inDrawer(0))
    tableau.swapDrawerItems(tile.id, stem.id)
    tableau.discard(tile.id)

    expect(log.entries.map(entry => entry.op)).toEqual([
      'addPlate', 'addTile', 'addStem', 'addPlate',
      'moveTile', 'moveStem', 'movePlate', 'rotatePlate', 'revealPlate',
      'addTile', 'swapDrawerItems', 'discard',
    ])
  })
})

/*
 * The property the whole design rests on. `addTile`, `addPlate` and `addStem` each check legality
 * *before* taking the next id, so a refused add never burns one — which is why recording only the
 * successful calls lets a replay hand out exactly the same ids. If this ever stops being true, replay
 * silently reconstructs a board whose ids do not match its journal.
 */
describe('the id invariant', () => {
  it('does not consume an id for a refused add', () => {
    const t = createTableau(OPTIONS)
    t.addTile(RED, inDrawer(0))
    t.addTile(BLUE, inDrawer(0)) // refused: the slot is taken
    const second = t.addTile(BLUE, inDrawer(1))
    // Ids run t1, t2 — not t1, t3.
    expect(second?.id).toBe('t2')
  })

  it('gives a replay the same ids as the original', () => {
    const { log, tableau } = recorded()
    tableau.addTile(RED, inDrawer(0))
    tableau.addTile(BLUE, inDrawer(0)) // refused
    tableau.addTile(BLUE, inDrawer(1))
    const replayed = replayTableau(log.entries, OPTIONS)
    expect(replayed.tiles().map(t => t.id)).toEqual(tableau.tiles().map(t => t.id))
  })
})

describe('replaying', () => {
  it('rebuilds an empty board from an empty journal', () => {
    expect(fingerprint(replayTableau([], OPTIONS))).toEqual(fingerprint(createTableau(OPTIONS)))
  })

  it('rebuilds a board indistinguishable from the original', () => {
    const { log, tableau } = recorded()
    const plate = tableau.addPlate(onBoard(0, 0))!
    tableau.addTile(RED, { kind: 'onPlate', plateId: plate.id, petal: 0 }, { fixed: true })
    tableau.addTile(BLUE, { kind: 'onPlate', plateId: plate.id, petal: 2 })
    tableau.addStem(0)
    tableau.rotatePlate(plate.id, 2)

    expect(fingerprint(replayTableau(log.entries, OPTIONS))).toEqual(fingerprint(tableau))
  })

  it('survives the awkward operations: reveal, swap, discard', () => {
    const { log, tableau } = recorded()
    const source = tableau.addPlate({ kind: 'source', lot: 0 }, { faceDown: true })!
    tableau.revealPlate(source.id, BLUE, 3)
    const tile = tableau.addTile(RED, inDrawer(0))!
    const stem = tableau.addStem(1)!
    tableau.swapDrawerItems(tile.id, stem.id)
    tableau.discard(tile.id)

    const replayed = replayTableau(log.entries, OPTIONS)
    expect(fingerprint(replayed)).toEqual(fingerprint(tableau))
    // The revealed token came back with it, rather than being lost as hidden state.
    expect(replayed.plateToken(source.id)?.value).toBe(BLUE.value)
  })

  it('is unaffected by replaying twice', () => {
    const { log, tableau } = recorded()
    tableau.addPlate(onBoard(0, 0))
    tableau.addStem(0)
    expect(fingerprint(replayTableau(log.entries, OPTIONS)))
      .toEqual(fingerprint(replayTableau(log.entries, OPTIONS)))
  })

  it('ignores the round bookmarks, which change nothing', () => {
    const { log, tableau } = recorded()
    tableau.addPlate(onBoard(0, 0))
    log.append({ op: 'endRound', round: 1 })
    expect(fingerprint(replayTableau(log.entries, OPTIONS))).toEqual(fingerprint(tableau))
  })
})

describe('rounds', () => {
  /** Two rounds: a plate in the first, a second plate and a stem in the next. */
  function played() {
    const { log, tableau } = recorded()
    tableau.addPlate(onBoard(0, 0))
    log.append({ op: 'endRound', round: 1 })
    tableau.addPlate(onBoard(3, -1))
    tableau.addStem(0)
    log.append({ op: 'endRound', round: 2 })
    return log
  }

  it('counts the rounds closed so far', () => {
    expect(played().rounds()).toBe(2)
    expect(createGameLog().rounds()).toBe(0)
  })

  /* The accordion's whole trick: round 1's board is the board as it was, not as it ended up. */
  it('cuts a prefix at the end of a round', () => {
    const log = played()
    const first = replayTableau(entriesThroughRound(log.entries, 1), OPTIONS)
    const second = replayTableau(entriesThroughRound(log.entries, 2), OPTIONS)
    expect(first.plates()).toHaveLength(1)
    expect(first.stems()).toHaveLength(0)
    expect(second.plates()).toHaveLength(2)
    expect(second.stems()).toHaveLength(1)
  })

  it('gives everything so far for a round that has not finished', () => {
    const log = played()
    expect(entriesThroughRound(log.entries, 9)).toEqual(log.entries)
  })

  it('gives everything for round 0, there being no bookmark before the first', () => {
    const log = played()
    expect(entriesThroughRound(log.entries, 0)).toEqual(log.entries)
  })
})

describe('a journal as a whole game', () => {
  /*
   * The claim the feature rests on: a game is its journal. Anything that can be derived from a board
   * can be derived from a prefix of the journal, so an earlier round can be scored again exactly as
   * it was scored at the time.
   */
  it('reproduces a mid-game board that no longer exists', () => {
    const { log, tableau } = recorded()
    const plate = tableau.addPlate(onBoard(0, 0))!
    tableau.addTile(RED, { kind: 'onPlate', plateId: plate.id, petal: 0 })
    log.append({ op: 'endRound', round: 1 })

    const asItWas: Tile[] = [...replayTableau(entriesThroughRound(log.entries, 1), OPTIONS).tilesOnBoard()]

    // Play on: the live board moves past that state and cannot be asked about it any more.
    tableau.addTile(BLUE, { kind: 'onPlate', plateId: plate.id, petal: 1 })
    expect(tableau.tilesOnBoard()).toHaveLength(2)
    expect(asItWas).toHaveLength(1)
    expect(asItWas[0]?.color).toBe(RED.color)
  })

  it('is a plain array of data, so it could be stored or sent', () => {
    const { log, tableau } = recorded()
    tableau.addPlate(onBoard(0, 0))
    tableau.addStem(0)
    const throughJson = JSON.parse(JSON.stringify(log.entries)) as LogEntry[]
    expect(fingerprint(replayTableau(throughJson, OPTIONS))).toEqual(fingerprint(tableau))
  })
})
