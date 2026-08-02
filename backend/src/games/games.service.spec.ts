import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { createGameLog, recordingTableau, replayTableau, type LogEntry } from '@hexnome/rules/gameLog'
import { defaultGameSettings } from '@hexnome/rules/gameSettings'
import { hexRectangle } from '@hexnome/rules/hex'
import { createTableau, type TableauOptions } from '@hexnome/rules/tableau'
import { PrismaService } from '../prisma.service'
import { GamesService } from './games.service'

/**
 * The games service, against the real database.
 *
 * Not mocked, deliberately. The one thing here that can genuinely go wrong is sequence allocation
 * under concurrency, and that is a property of MySQL's row locks — a fake would prove that the fake
 * serialises. Everything else is cheap enough to come along.
 *
 * Every game made here is deleted afterwards; entries go with it by cascade.
 */

const prisma = new PrismaService()
const games = new GamesService(prisma)
const made: string[] = []

async function newGame(seed?: string) {
  const game = await games.create({ settings: defaultGameSettings(1700000000000), seed })
  made.push(game.id)
  return game
}

/** A distinguishable entry: `slot` carries who wrote it, so interleaving is visible. */
const stem = (slot: number): LogEntry => ({ op: 'addStem', slot })

beforeAll(async () => {
  await prisma.$connect()
})

afterAll(async () => {
  if (made.length) await prisma.game.deleteMany({ where: { id: { in: made } } })
  await prisma.$disconnect()
})

describe('starting a game', () => {
  it('gives it an id and a seed that are not the same string', async () => {
    const game = await newGame()
    expect(game.id).not.toBe(game.seed)
    expect(game.lastSeq).toBe(0)
    expect(game.status).toBe('running')
  })

  /* The point of the split: a copied seed replays a deal under a new id. */
  it('takes a seed it is given, while still minting a fresh id', async () => {
    const first = await newGame()
    const replay = await newGame(first.seed)
    expect(replay.seed).toBe(first.seed)
    expect(replay.id).not.toBe(first.id)
  })

  it('refuses settings it cannot read', async () => {
    await expect(games.create({ settings: { mode: 'nonsense' } })).rejects.toThrow(ConflictException)
  })

  /*
   * A JSON column is editable in MySQL, so a row is no more trustworthy than localStorage was. The
   * settings are parsed on the way out as well as in — this writes past the service to prove it.
   */
  it('refuses to serve a row whose settings have been tampered with', async () => {
    const game = await newGame()
    await prisma.game.update({
      where: { id: game.id },
      data: { settings: { mode: 'tampered' } },
    })
    await expect(games.find(game.id)).rejects.toThrow(ConflictException)
  })

  it('has nothing to say about a game that does not exist', async () => {
    await expect(games.find('no-such-game')).rejects.toThrow(NotFoundException)
    await expect(games.log('no-such-game', 0)).rejects.toThrow(NotFoundException)
  })
})

describe('reading the log', () => {
  it('returns exactly the tail after the cursor', async () => {
    const game = await newGame()
    await games.append(game.id, [stem(0), stem(1), stem(2)])

    const all = await games.log(game.id, 0)
    expect(all.entries.map(e => e.seq)).toEqual([1, 2, 3])
    expect(all.lastSeq).toBe(3)

    const tail = await games.log(game.id, 2)
    expect(tail.entries.map(e => e.seq)).toEqual([3])
    expect(tail.since).toBe(2)
    expect(tail.lastSeq).toBe(3)
  })

  it('says nothing is new when the cursor is already the head', async () => {
    const game = await newGame()
    await games.append(game.id, [stem(0)])
    const slice = await games.log(game.id, 1)
    expect(slice.entries).toEqual([])
    expect(slice.lastSeq).toBe(1)
  })

  /* A cursor past the head is a client that has seen more than exists — empty, not negative. */
  it('survives a cursor beyond the end', async () => {
    const game = await newGame()
    await games.append(game.id, [stem(0)])
    expect((await games.log(game.id, 99)).entries).toEqual([])
  })

  it('ignores a cursor that is not a number', async () => {
    const game = await newGame()
    await games.append(game.id, [stem(4)])
    expect((await games.log(game.id, Number.NaN)).entries).toHaveLength(1)
    expect((await games.log(game.id, -5)).entries).toHaveLength(1)
  })

  /* Entries come back as JSON, so they must arrive as the same values that went in. */
  it('round-trips an entry through the JSON column unchanged', async () => {
    const game = await newGame()
    const entry: LogEntry = {
      op: 'addTile',
      spec: { color: 3, value: 5 },
      location: { kind: 'onPlate', plateId: 'p1', petal: 2 },
      fixed: true,
    }
    await games.append(game.id, [entry])
    expect((await games.log(game.id, 0)).entries[0]!.entry).toEqual(entry)
  })
})

describe('appending', () => {
  it('reports where it started and where it left the head', async () => {
    const game = await newGame()
    const first = await games.append(game.id, [stem(0), stem(1)])
    expect(first).toMatchObject({ from: 0, lastSeq: 2 })

    const second = await games.append(game.id, [stem(2)])
    expect(second).toMatchObject({ from: 2, lastSeq: 3 })
    expect(second.entries[0]!.seq).toBe(3)
  })

  it('records who wrote each entry', async () => {
    const game = await newGame()
    await games.append(game.id, [stem(0)], undefined, 'player')
    await games.append(game.id, [stem(1)], undefined, 'server')
    expect((await games.log(game.id, 0)).entries.map(e => e.origin)).toEqual(['player', 'server'])
  })

  it('leaves the head alone when given nothing to write', async () => {
    const game = await newGame()
    await games.append(game.id, [stem(0)])
    expect(await games.append(game.id, [])).toEqual({ from: 1, lastSeq: 1, entries: [] })
  })

  it('refuses a game that does not exist rather than creating one', async () => {
    await expect(games.append('no-such-game', [stem(0)])).rejects.toThrow(NotFoundException)
  })

  describe('the guard against appending to a stale head', () => {
    it('lets an append through when the caller is up to date', async () => {
      const game = await newGame()
      await games.append(game.id, [stem(0)])
      await expect(games.append(game.id, [stem(1)], 1)).resolves.toMatchObject({ lastSeq: 2 })
    })

    /*
     * A client reasoning from a board that has moved on would append moves that no longer make
     * sense. It is told the real head so it can catch up and retry.
     */
    it('refuses one from behind, and says how far behind', async () => {
      const game = await newGame()
      await games.append(game.id, [stem(0), stem(1)])
      await expect(games.append(game.id, [stem(2)], 0)).rejects.toThrow(ConflictException)
      expect((await games.find(game.id)).lastSeq).toBe(2)
    })

    /* Refusing must roll back cleanly: a rejected append leaves no half-written rows. */
    it('writes nothing at all when it refuses', async () => {
      const game = await newGame()
      await games.append(game.id, [stem(0)])
      await games.append(game.id, [stem(1), stem(2)], 0).catch(() => {})
      expect((await games.log(game.id, 0)).entries).toHaveLength(1)
    })
  })
})

/*
 * The whole point of the endpoints, end to end: a board played on one side is rebuilt on the other
 * from nothing but what the database gave back. Every other test here checks a piece of the pipe;
 * this one checks that something goes through it.
 */
describe('a game played through the API', () => {
  const OPTIONS: TableauOptions = {
    cells: hexRectangle(6, 6),
    drawerSlots: 16,
    plateSlots: 2,
    sourceLots: 4,
    sourceTilesPerLot: 4,
  }

  it('replays from the stored log into the same board it was played on', async () => {
    const game = await newGame()
    const log = createGameLog()
    const played = recordingTableau(createTableau(OPTIONS), log.append)

    // A few turns' worth of the moves a real game makes.
    const plate = played.addPlate({ kind: 'board', hole: { q: 0, r: 0 } })!
    played.rotatePlate(plate.id, 2)
    const tile = played.addTile({ color: 2, value: 3 }, { kind: 'drawer', slot: 0 })!
    played.moveTile(tile.id, { kind: 'onPlate', plateId: plate.id, petal: 1 })
    played.addStem(0)
    const spare = played.addTile({ color: 5, value: 1 }, { kind: 'drawer', slot: 1 })!
    played.discard(spare.id)

    // Sent in the batches a client would send, not in one lump.
    let head = 0
    for (const entry of log.entries) {
      const result = await games.append(game.id, [entry], head)
      head = result.lastSeq
    }
    expect(head).toBe(log.entries.length)

    const rebuilt = replayTableau((await games.log(game.id, 0)).entries.map(e => e.entry), OPTIONS)

    expect(rebuilt.tiles().map(t => t.id)).toEqual(played.tiles().map(t => t.id))
    expect(rebuilt.plates().map(p => p.id)).toEqual(played.plates().map(p => p.id))
    expect(rebuilt.stems().map(s => s.slot)).toEqual(played.stems().map(s => s.slot))
    // The rotation is the one that would replay wrong if entries arrived out of order.
    expect(rebuilt.cellOfTile(tile.id)).toEqual(played.cellOfTile(tile.id))
    expect(rebuilt.tilesOnBoard()).toHaveLength(played.tilesOnBoard().length)
  })
})

/*
 * The one real race, and the reason the allocation is a transaction holding a row lock. Two appends
 * taking the same sequence number would not raise an error — it would corrupt the log and only show
 * up much later, as a board that replays wrong.
 */
describe('appends arriving together', () => {
  const CALLERS = 60
  const PER_CALL = 3

  it('numbers them 1…N with no gaps, no repeats, and no interleaving', async () => {
    const game = await newGame()

    // Each caller writes a block tagged with its own index, so a block torn apart is visible.
    const results = await Promise.all(
      Array.from({ length: CALLERS }, (_, caller) =>
        games.append(game.id, Array.from({ length: PER_CALL }, () => stem(caller)))),
    )

    const slice = await games.log(game.id, 0)
    const seqs = slice.entries.map(e => e.seq)
    expect(seqs).toEqual(Array.from({ length: CALLERS * PER_CALL }, (_, i) => i + 1))
    expect(new Set(seqs).size).toBe(seqs.length)
    expect(slice.lastSeq).toBe(CALLERS * PER_CALL)

    /*
     * Atomicity, not just uniqueness. Each caller's entries must be consecutive: an append is one
     * transaction, so another caller's block cannot land inside it.
     */
    for (const written of results) {
      const seen = slice.entries.filter(e => written.entries.some(w => w.seq === e.seq))
      expect(seen.map(e => e.seq)).toEqual([written.from + 1, written.from + 2, written.from + 3])
      expect(new Set(seen.map(e => (e.entry as { slot: number }).slot)).size).toBe(1)
    }

    // And every caller was told a distinct starting point.
    expect(new Set(results.map(r => r.from)).size).toBe(CALLERS)
  }, 60_000)

  /* Two games contend for nothing: their locks are different rows. */
  it('does not serialise games against each other', async () => {
    const [a, b] = await Promise.all([newGame(), newGame()])
    await Promise.all([
      ...Array.from({ length: 10 }, () => games.append(a.id, [stem(1)])),
      ...Array.from({ length: 10 }, () => games.append(b.id, [stem(2)])),
    ])
    expect((await games.find(a.id)).lastSeq).toBe(10)
    expect((await games.find(b.id)).lastSeq).toBe(10)
  }, 60_000)
})

/*
 * The property the whole exercise is for: a face-down plate's token must not be in the database at
 * all until it is revealed. Checked against the stored bytes, not the model — the model is already
 * proven, and what leaks is what is written down.
 */
describe('what the stored log gives away', () => {
  it('holds no token for a face-down plate until it is revealed', async () => {
    const game = await newGame()
    await games.append(game.id, [
      { op: 'addPlate', location: { kind: 'source', lot: 0 }, rotation: 0, faceDown: true },
    ], undefined, 'server')

    const hidden = await prisma.logEntry.findMany({ where: { gameId: game.id } })
    expect(JSON.stringify(hidden)).not.toContain('color')

    await games.append(game.id, [
      { op: 'revealPlate', id: 'plate-1', spec: { color: 4, value: 2 }, petal: 0 },
    ], undefined, 'server')

    const revealed = await prisma.logEntry.findMany({ where: { gameId: game.id }, orderBy: { seq: 'asc' } })
    expect(JSON.stringify(revealed[0]!.data)).not.toContain('color')
    expect(JSON.stringify(revealed[1]!.data)).toContain('"color":4')
  })
})
