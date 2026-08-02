import { describe, expect, it } from 'vitest'
import { createDeck } from '@hexnome/rules/deck'
import {
  applyEntry,
  createGameLog,
  recordingTableau,
  replayTableau,
  type LogEntry,
} from '@hexnome/rules/gameLog'
import { hexRectangle } from '@hexnome/rules/hex'
import { createTableau, type TableauOptions } from '@hexnome/rules/tableau'

/**
 * The rules package, exercised from the server.
 *
 * Not a re-run of the package's own suite — that already passes. These are the three things the
 * backend specifically depends on, and each would be an expensive thing to discover later.
 */

const OPTIONS: TableauOptions = {
  cells: hexRectangle(6, 6),
  drawerSlots: 16,
  plateSlots: 2,
  sourceLots: 4,
  sourceTilesPerLot: 4,
}

describe('the deck, server-side', () => {
  it('deals the same 36 plates and 108 tiles the browser does', () => {
    const deck = createDeck('shared-seed')
    expect(deck.plates).toHaveLength(36)
    expect(deck.tiles).toHaveLength(108)
  })

  /*
   * The property the whole arrangement rests on: one seed, one deal, wherever it is computed. If the
   * two sides ever ran different code this is what would break, and it would break silently.
   */
  it('is a pure function of the seed, so client and server cannot disagree', () => {
    expect(createDeck('same')).toEqual(createDeck('same'))
    expect(createDeck('same')).not.toEqual(createDeck('different'))
  })

  /* Two ids may share a seed — that is how a deal gets replayed — so the deck must follow the seed. */
  it('follows the seed rather than anything else', () => {
    const replayed = createDeck('carried-over')
    expect(replayed).toEqual(createDeck('carried-over'))
  })
})

describe('replaying a journal', () => {
  it('rebuilds a board from entries alone', () => {
    const log = createGameLog()
    const live = recordingTableau(createTableau(OPTIONS), log.append)

    const plate = live.addPlate({ kind: 'board', hole: { q: 0, r: 0 } })!
    live.addTile({ color: 2, value: 3 }, { kind: 'onPlate', plateId: plate.id, petal: 1 })
    live.addStem(0)

    const rebuilt = replayTableau(log.entries, OPTIONS)
    expect(rebuilt.tiles().map(t => t.id)).toEqual(live.tiles().map(t => t.id))
    expect(rebuilt.plates().map(p => p.id)).toEqual(live.plates().map(p => p.id))
    expect(rebuilt.stems()).toHaveLength(1)
  })

  /*
   * Entries will be stored one per row in a JSON column and read back as plain objects. Anything
   * that survived only as a live JS value — a Map, a Date, an undefined — would vanish in transit.
   */
  it('survives the round trip a JSON column will put it through', () => {
    const log = createGameLog()
    const live = recordingTableau(createTableau(OPTIONS), log.append)
    const plate = live.addPlate({ kind: 'source', lot: 0 }, { faceDown: true })!
    live.addTile({ color: 1, value: 5 }, { kind: 'source', lot: 0, index: 0 })
    live.revealPlate(plate.id, { color: 4, value: 2 }, 3)

    const throughDb = log.entries.map(e => JSON.parse(JSON.stringify(e)) as LogEntry)
    const rebuilt = replayTableau(throughDb, OPTIONS)

    expect(rebuilt.plateToken(plate.id)?.value).toBe(2)
    expect(rebuilt.tiles()).toHaveLength(2)
  })

  /* The server applies entries one at a time as they arrive, not only in bulk. */
  it('can be applied entry by entry, as an append stream would', () => {
    const log = createGameLog()
    const live = recordingTableau(createTableau(OPTIONS), log.append)
    live.addPlate({ kind: 'board', hole: { q: 0, r: 0 } })
    live.addStem(2)

    const follower = createTableau(OPTIONS)
    for (const entry of log.entries) applyEntry(follower, entry)

    expect(follower.plates()).toHaveLength(1)
    expect(follower.stems().map(s => s.slot)).toEqual([2])
  })
})

/*
 * A face-down plate carries no token in the model, which is what will make the deck genuinely secret
 * once the server owns it: there is nothing in the entry for a client to read.
 */
describe('what a face-down plate gives away', () => {
  it('is nothing, until it is revealed', () => {
    const log = createGameLog()
    const live = recordingTableau(createTableau(OPTIONS), log.append)
    const plate = live.addPlate({ kind: 'source', lot: 0 }, { faceDown: true })!

    const serialised = JSON.stringify(log.entries)
    expect(serialised).not.toContain('color')
    expect(live.plateToken(plate.id)).toBeUndefined()

    live.revealPlate(plate.id, { color: 5, value: 6 }, 0)
    expect(JSON.stringify(log.entries)).toContain('"revealPlate"')
  })
})
