import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { applyEntry, recordingTableau, replayTableau, type LogEntry } from '@hexnome/rules/gameLog'
import { defaultGameSettings } from '@hexnome/rules/gameSettings'
import { BOARD_CENTRE, tableauOptionsFor } from '@hexnome/rules/setup'
import type { Tableau } from '@hexnome/rules/tableau'
import { PrismaService } from '../prisma.service'
import { replayOf, SOLO_SEAT } from './dto'
import { GamesService } from './games.service'

/**
 * The games service, against the real database.
 *
 * Not mocked, deliberately. The thing that can genuinely go wrong here is the chain — two commands
 * claiming one parent — and that is a property of a MySQL unique index. A fake would only prove that
 * the fake rejects duplicates. Everything else is cheap enough to come along.
 *
 * Every game made here is deleted afterwards; commands go with it by cascade.
 */

const prisma = new PrismaService()
const games = new GamesService(prisma)
const made: string[] = []
const SETTINGS = defaultGameSettings(1700000000000)

async function newGame(seed?: string) {
  const game = await games.create({ settings: SETTINGS, seed })
  made.push(game.id)
  return game
}

/*
 * Effects are verified now, so a test's move has to be one the opening board actually allows.
 *
 * Ids come from a single counter, so the opening position — plate, its fixed tile, three stems — is
 * always `p1`, `t2`, `s3`..`s5`. That makes the centre plate nameable, and its rotation the one move
 * that is legal however many times it is made.
 */
const OPENING_PLATE = 'p1'

/** Drawer slots 0..2 hold the opening stems; a new one has to go somewhere else. */
const FIRST_FREE_SLOT = 3

/** A legal move with no side effects worth tracking, repeatable without limit. */
const nudge = (): LogEntry => ({ op: 'rotatePlate', id: OPENING_PLATE, steps: 1 })

/** A distinguishable effect: `slot` carries who wrote it, so a torn command would be visible. */
const stem = (n: number): LogEntry => ({ op: 'addStem', slot: FIRST_FREE_SLOT + n })

/** A submission with everything but the parts a test cares about filled in. */
const turn = (prevSeq: number, effects: LogEntry[] = [nudge()], cmdId = randomUUID()) =>
  ({ cmdId, prevSeq, author: SOLO_SEAT, effects })

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
    expect(game.status).toBe('running')
  })

  /* The point of the split: a copied seed replays a deal under a new id. */
  it('takes a seed it is given, while still minting a fresh id', async () => {
    const first = await newGame()
    const replay = await newGame(first.seed)
    expect(replay.seed).toBe(first.seed)
    expect(replay.id).not.toBe(first.id)
  })

  /*
   * A game with an empty log would have no head to build on and no board to replay. The genesis
   * command is written in the same nested insert as the game, so that state cannot be reached.
   */
  it('is never left without a genesis command', async () => {
    const game = await newGame()
    const slice = await games.commands(game.id, 0)
    expect(slice.commands).toHaveLength(1)
    expect(slice.commands[0]!.prevSeq).toBe(0)
    expect(slice.commands[0]!.author).toBe('server')
    // No turn preceded it, so it is all response and no effects.
    expect(slice.commands[0]!.effects).toEqual([])
    expect(game.head.seq).toBe(slice.commands[0]!.seq)
    expect(game.head.awaiting).toBe(SOLO_SEAT)
  })

  /* The head is a real seq, not a count — the numbering is global and sparse. */
  it('numbers the genesis command from the global sequence, not from one', async () => {
    const [a, b] = await Promise.all([newGame(), newGame()])
    expect(a.head.seq).not.toBe(b.head.seq)
  })

  it('deals the opening position the server owns, not an empty board', async () => {
    const game = await newGame()
    const slice = await games.commands(game.id, 0)
    const board = replayTableau(slice.commands[0]!.response, tableauOptionsFor(SETTINGS))

    const centre = board.plates().find(p => p.location.kind === 'board')
    expect(centre?.location).toEqual({ kind: 'board', hole: BOARD_CENTRE })
    // The plate's own fixed tile, plus the starting stems in ordinary drawer slots.
    expect(board.tilesOnBoard()).toHaveLength(1)
    expect(board.tilesOnBoard()[0]!.fixed).toBe(true)
    expect(board.stems()).toHaveLength(SETTINGS.initialStems)
  })

  /* The source has to be stocked before the player is asked to draft from it. */
  it('stocks the source with the first lot, so turn one has something to take', async () => {
    const game = await newGame()
    const slice = await games.commands(game.id, 0)
    const board = replayTableau(slice.commands[0]!.response, tableauOptionsFor(SETTINGS))

    expect(board.plateInSourceLot(0)).toBeDefined()
    expect(board.tilesInSourceLot(0)).toHaveLength(4)
  })

  /* Same seed, same deal — the opening plate included. */
  it('opens identically for two games sharing a seed', async () => {
    const first = await newGame()
    const replay = await newGame(first.seed)
    const [a, b] = await Promise.all([games.commands(first.id, 0), games.commands(replay.id, 0)])
    expect(a.commands[0]!.response).toEqual(b.commands[0]!.response)
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
    await prisma.game.update({ where: { id: game.id }, data: { settings: { mode: 'tampered' } } })
    await expect(games.find(game.id)).rejects.toThrow(ConflictException)
  })

  it('has nothing to say about a game that does not exist', async () => {
    await expect(games.find('no-such-game')).rejects.toThrow(NotFoundException)
    await expect(games.commands('no-such-game', 0)).rejects.toThrow(NotFoundException)
    await expect(games.submit('no-such-game', turn(0))).rejects.toThrow(NotFoundException)
  })
})

describe('reading the log', () => {
  it('returns exactly the tail after the cursor', async () => {
    const game = await newGame()
    const first = await games.submit(game.id, turn(game.head.seq))
    const second = await games.submit(game.id, turn(first.command.seq))

    const all = await games.commands(game.id, 0)
    expect(all.commands).toHaveLength(3)
    expect(all.head.seq).toBe(second.command.seq)

    const tail = await games.commands(game.id, first.command.seq)
    expect(tail.commands.map(c => c.seq)).toEqual([second.command.seq])
    expect(tail.since).toBe(first.command.seq)
  })

  it('says nothing is new when the cursor is already the head', async () => {
    const game = await newGame()
    const slice = await games.commands(game.id, game.head.seq)
    expect(slice.commands).toEqual([])
    expect(slice.head.seq).toBe(game.head.seq)
  })

  /* A cursor past the head is a client that has seen more than exists — empty, not negative. */
  it('survives a cursor beyond the end', async () => {
    const game = await newGame()
    expect((await games.commands(game.id, game.head.seq + 999)).commands).toEqual([])
  })

  it('ignores a cursor that is not a number', async () => {
    const game = await newGame()
    expect((await games.commands(game.id, Number.NaN)).commands).toHaveLength(1)
    expect((await games.commands(game.id, -5)).commands).toHaveLength(1)
  })

  /* Effects come back as JSON, so they must arrive as the values that went in. */
  it('round-trips effects through the JSON column unchanged', async () => {
    const game = await newGame()
    const effects: LogEntry[] = [
      { op: 'addTile', spec: { color: 3, value: 5 }, location: { kind: 'drawer', slot: 9 }, fixed: true },
      { op: 'addStem', slot: 4 },
    ]
    const written = await games.submit(game.id, turn(game.head.seq, effects))
    const read = await games.commands(game.id, game.head.seq)
    expect(written.command.effects).toEqual(effects)
    expect(read.commands[0]!.effects).toEqual(effects)
  })
})

describe('submitting a command', () => {
  it('links each command to the one before it', async () => {
    const game = await newGame()
    const first = await games.submit(game.id, turn(game.head.seq))
    const second = await games.submit(game.id, turn(first.command.seq))

    expect(first.command.prevSeq).toBe(game.head.seq)
    expect(second.command.prevSeq).toBe(first.command.seq)
    expect(second.command.seq).toBeGreaterThan(first.command.seq)
    expect(first.duplicate).toBe(false)
  })

  /* The invariant everything else rests on: an unbroken chain from 0 to the head. */
  it('leaves a chain with no fork and no break', async () => {
    const game = await newGame()
    let head = game.head.seq
    for (let i = 0; i < 8; i++) head = (await games.submit(game.id, turn(head, [stem(i)]))).command.seq

    const { commands } = await games.commands(game.id, 0)
    expect(commands[0]!.prevSeq).toBe(0)
    for (let i = 1; i < commands.length; i++) {
      expect(commands[i]!.prevSeq).toBe(commands[i - 1]!.seq)
    }
    expect(commands.at(-1)!.seq).toBe(head)
  })

  it('records who submitted it and who may act next', async () => {
    const game = await newGame()
    const { command } = await games.submit(game.id, turn(game.head.seq))
    expect(command.author).toBe(SOLO_SEAT)
    expect(command.awaiting).toBe(SOLO_SEAT)
  })

  it('insists on a cmdId', async () => {
    const game = await newGame()
    await expect(games.submit(game.id, { cmdId: '', prevSeq: game.head.seq, effects: [] }))
      .rejects.toThrow(ConflictException)
  })

  describe('building on a head that has moved', () => {
    it('is refused, and told where the head really is', async () => {
      const game = await newGame()
      const first = await games.submit(game.id, turn(game.head.seq))

      const stale = games.submit(game.id, turn(game.head.seq))
      await expect(stale).rejects.toThrow(ConflictException)
      await expect(stale).rejects.toMatchObject({
        response: { head: { seq: first.command.seq, awaiting: SOLO_SEAT } },
      })
    })

    it('writes nothing when it refuses', async () => {
      const game = await newGame()
      await games.submit(game.id, turn(game.head.seq))
      await games.submit(game.id, turn(game.head.seq)).catch(() => {})
      expect((await games.commands(game.id, 0)).commands).toHaveLength(2)
    })
  })

  /*
   * The retry path, and the reason `cmdId` has a column. The server commits, the response is lost,
   * the client resends the same command — which now names a prevSeq the head has moved past. Without
   * the id that is indistinguishable from a stale client, and the client cannot tell "refused" from
   * "already applied".
   */
  describe('a resend of a command that already landed', () => {
    it('returns the original row rather than refusing it', async () => {
      const game = await newGame()
      const submission = turn(game.head.seq, [stem(3)])

      const first = await games.submit(game.id, submission)
      const again = await games.submit(game.id, submission)

      expect(again.duplicate).toBe(true)
      expect(again.command).toEqual(first.command)
      expect((await games.commands(game.id, 0)).commands).toHaveLength(2)
    })

    /* The distinction that makes it useful: a *different* command from the same stale point is not. */
    it('does not excuse a different command from the same stale point', async () => {
      const game = await newGame()
      await games.submit(game.id, turn(game.head.seq, [stem(1)]))
      await expect(games.submit(game.id, turn(game.head.seq, [stem(2)])))
        .rejects.toThrow(ConflictException)
    })

    /* Two callers racing with the *same* id: one writes, the other is handed that write. */
    it('collapses a concurrent double-submit into one row', async () => {
      const game = await newGame()
      const submission = turn(game.head.seq)
      const both = await Promise.all([
        games.submit(game.id, submission),
        games.submit(game.id, submission),
      ])
      expect(both[0].command.seq).toBe(both[1].command.seq)
      expect(both.filter(r => r.duplicate)).toHaveLength(1)
      expect((await games.commands(game.id, 0)).commands).toHaveLength(2)
    })
  })

  /*
   * Authorization, which is a different job from the guard above and must not be confused with it: it
   * reads the state it is protecting, so two commands from the *same* seat both pass. One seat exists
   * in play, so `awaiting` is set directly here — the mechanism is real even though nothing exercises
   * it yet.
   */
  describe('acting out of turn', () => {
    it('is refused before the database is touched', async () => {
      const game = await newGame()
      await prisma.command.update({
        where: { seq: game.head.seq },
        data: { awaiting: 'p2' },
      })

      const wrongSeat = games.submit(game.id, { ...turn(game.head.seq), author: 'p1' })
      await expect(wrongSeat).rejects.toThrow(ForbiddenException)
      await expect(wrongSeat).rejects.toMatchObject({ response: { awaiting: 'p2' } })
      expect((await games.commands(game.id, 0)).commands).toHaveLength(1)
    })

    it('lets the awaited seat through', async () => {
      const game = await newGame()
      await prisma.command.update({ where: { seq: game.head.seq }, data: { awaiting: 'p2' } })
      await expect(games.submit(game.id, { ...turn(game.head.seq), author: 'p2' }))
        .resolves.toMatchObject({ duplicate: false })
    })
  })
})

/*
 * What stops a client writing whatever it likes into the log.
 *
 * The server replays the chain and applies the submitted effects to a real tableau, using the same
 * rules the client validated with — so this is not a second opinion about legality, it is the same
 * one, checked again where the client cannot reach.
 */
describe('verifying a turn against the board', () => {
  it('accepts a move the board allows', async () => {
    const game = await newGame()
    await expect(games.submit(game.id, turn(game.head.seq, [stem(0)])))
      .resolves.toMatchObject({ duplicate: false })
  })

  it('refuses a piece that does not exist', async () => {
    const game = await newGame()
    const ghost: LogEntry = { op: 'moveTile', id: 't999', location: { kind: 'drawer', slot: 6 } }
    await expect(games.submit(game.id, turn(game.head.seq, [ghost])))
      .rejects.toThrow(UnprocessableEntityException)
  })

  it('refuses a drawer slot that is already taken', async () => {
    const game = await newGame()
    // Slots 0..2 hold the opening stems, so this one is occupied.
    await expect(games.submit(game.id, turn(game.head.seq, [{ op: 'addStem', slot: 0 }])))
      .rejects.toThrow(UnprocessableEntityException)
  })

  it('refuses a plate placed off the board', async () => {
    const game = await newGame()
    const offBoard: LogEntry = {
      op: 'addPlate',
      location: { kind: 'board', hole: { q: 9999, r: 9999 } },
      rotation: 0,
      faceDown: false,
    }
    await expect(games.submit(game.id, turn(game.head.seq, [offBoard])))
      .rejects.toThrow(UnprocessableEntityException)
  })

  /* Refused whole: a later entry assumes a board the refused one never produced. */
  it('writes nothing at all when one effect in a turn is illegal', async () => {
    const game = await newGame()
    const mixed = [stem(0), { op: 'addStem', slot: 0 } as LogEntry, stem(1)]

    const refused = games.submit(game.id, turn(game.head.seq, mixed))
    await expect(refused).rejects.toThrow(UnprocessableEntityException)
    await expect(refused).rejects.toMatchObject({ response: { index: 1, op: 'addStem' } })

    const { commands } = await games.commands(game.id, 0)
    expect(commands).toHaveLength(1)
    // And the good first effect did not leak into the board either.
    expect(replayTableau(commands.flatMap(replayOf), tableauOptionsFor(SETTINGS)).stems())
      .toHaveLength(SETTINGS.initialStems)
  })

  /*
   * Legality is checked per mutation, not per turn. This is the gap the next stage closes, and it is
   * recorded as a test so that closing it shows up here as a failure rather than as a surprise.
   */
  it('does not yet catch effects that are each legal but add up to two turns', async () => {
    const game = await newGame()
    const twoTurnsWorth = [stem(0), stem(1), stem(2), stem(3), stem(4)]
    await expect(games.submit(game.id, turn(game.head.seq, twoTurnsWorth)))
      .resolves.toMatchObject({ duplicate: false })
  })
})

/*
 * The reason there is a server at all.
 *
 * A face-down plate's token used to be a fiction: the model held none, but every client derived the
 * whole deck from the game's seed, so anyone who wanted to know could work it out. Now the deck is
 * dealt here and the seed alone is not enough — what a plate is carrying exists only in this
 * process, until the lot above it is picked clean.
 *
 * Checked against the stored bytes rather than the model. What leaks is what is written down.
 */
describe('what a face-down plate gives away', () => {
  /** Take every tile off the top lot, which is what makes the plate beneath eligible to turn over. */
  async function clearTopLot(gameId: string, head: number, board: Tableau) {
    const entries: LogEntry[] = []
    const live = recordingTableau(board, e => entries.push(e))
    for (const tile of board.tilesInSourceLot(0)) {
      const slot = live.freeDrawerSlots()[0]
      if (slot !== undefined) live.moveTile(tile.id, { kind: 'drawer', slot })
    }
    return games.submit(gameId, turn(head, entries))
  }

  it('is nothing, until the lot above it is taken', async () => {
    const game = await newGame()
    const opening = await games.commands(game.id, 0)
    const board = replayTableau(replayOf(opening.commands[0]!), tableauOptionsFor(SETTINGS))

    const hidden = board.plateInSourceLot(0)!
    // The model itself holds no token for it — the property the deal is built on.
    expect(board.plateToken(hidden.id)).toBeUndefined()

    // And neither does anything stored. `revealPlate` is the only entry that ever carries one.
    const rows = await prisma.command.findMany({ where: { gameId: game.id } })
    expect(JSON.stringify(rows)).not.toContain('revealPlate')

    const cleared = await clearTopLot(game.id, game.head.seq, board)

    // Now, and only now, the token arrives — in the server's answer, not the player's move.
    const reveals = cleared.command.response.filter(e => e.op === 'revealPlate')
    expect(reveals).toHaveLength(1)
    expect(reveals[0]).toMatchObject({ id: hidden.id })
  })

  /*
   * The strong form. Two games on the same seed deal the same board, so a token is *derivable* from
   * a seed — which is exactly why the seed must never travel with the plate it hides. It does not:
   * `GameView` carries the seed openly, and the deal it produces is the server's alone until it
   * chooses to reveal it.
   */
  it('does not put the deck anywhere a client can read it', async () => {
    const game = await newGame()
    const slice = await games.commands(game.id, 0)

    const stored = JSON.stringify(slice)
    // The four heaped tiles are visible and belong in the log; the plate under them is not.
    const faceDown = slice.commands[0]!.response.filter(
      e => e.op === 'addPlate' && e.faceDown,
    )
    expect(faceDown).toHaveLength(1)
    expect(faceDown[0]).not.toHaveProperty('spec')
    // Nothing anywhere in the slice says how many plates are left, which would narrow the deal.
    expect(stored).not.toContain('remaining')
    expect(stored).not.toContain('plateBag')
  })
})

/*
 * The one real race. Two commands must never share a parent — and the failure would not be an error,
 * it would be a forked log that replays into two different boards.
 *
 * Note what this asserts, because it is the opposite of what a queue would: exactly **one** command
 * wins and the rest are refused. The loser is not queued behind the winner, because it was reasoning
 * from a board that no longer exists by the time it lost.
 */
describe('commands arriving together', () => {
  const RACERS = 40

  it('lets exactly one of them take the place, and refuses the rest', async () => {
    const game = await newGame()

    const results = await Promise.allSettled(
      Array.from({ length: RACERS }, () =>
        games.submit(game.id, turn(game.head.seq, [nudge()]))),
    )

    const won = results.filter(r => r.status === 'fulfilled')
    const lost = results.filter(r => r.status === 'rejected')
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(RACERS - 1)

    // Every loser must be told it lost, not merely fail. A 500 here would be the constraint firing
    // through a path that does not recognise it.
    for (const l of lost) {
      expect((l as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException)
    }

    const { commands } = await games.commands(game.id, 0)
    expect(commands).toHaveLength(2)
    expect(commands[1]!.prevSeq).toBe(commands[0]!.seq)
  }, 60_000)

  /* Run the race repeatedly: the chain must stay linear the whole way up. */
  it('builds an unbroken chain out of rounds of contention', async () => {
    const game = await newGame()
    let head = game.head.seq

    for (let round = 0; round < 5; round++) {
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => games.submit(game.id, turn(head, [nudge()]))),
      )
      const won = results.filter(r => r.status === 'fulfilled')
      expect(won).toHaveLength(1)
      head = (won[0] as PromiseFulfilledResult<{ command: { seq: number } }>).value.command.seq
    }

    const { commands } = await games.commands(game.id, 0)
    expect(commands).toHaveLength(6)
    for (let i = 1; i < commands.length; i++) {
      expect(commands[i]!.prevSeq).toBe(commands[i - 1]!.seq)
    }
  }, 60_000)

  /* Two games contend for nothing: their chains are different rows. */
  it('does not make games wait for each other', async () => {
    const [a, b] = await Promise.all([newGame(), newGame()])
    const [ra, rb] = await Promise.all([
      games.submit(a.id, turn(a.head.seq)),
      games.submit(b.id, turn(b.head.seq)),
    ])
    expect(ra.duplicate).toBe(false)
    expect(rb.duplicate).toBe(false)
  }, 60_000)
})

/*
 * The whole point of the endpoints, end to end: a board played on one side is rebuilt on the other
 * from nothing but what the database gave back. Every other test here checks a piece of the pipe;
 * this one checks that something goes through it.
 */
describe('a game played through the API', () => {
  it('replays from the stored commands into the same board it was played on', async () => {
    const game = await newGame()
    const options = tableauOptionsFor(SETTINGS)

    // Start from the server's opening position, exactly as a client would.
    const opening = await games.commands(game.id, 0)
    const played = replayTableau(replayOf(opening.commands[0]!), options)

    let head = game.head.seq
    const ids: string[] = []

    // Three turns, each accumulated locally then submitted as one command.
    for (let i = 0; i < 3; i++) {
      const entries: LogEntry[] = []
      const live = recordingTableau(played, e => entries.push(e))
      const tile = live.addTile({ color: i, value: i + 1 }, { kind: 'drawer', slot: 12 + i })!
      live.moveTile(tile.id, { kind: 'drawer', slot: 8 + i })
      ids.push(tile.id)

      const result = await games.submit(game.id, turn(head, entries))
      head = result.command.seq
      /*
       * What a real client does with the acknowledgement: its own effects are already on its board,
       * so only the server's answer is applied. Skipping this is not a small inaccuracy — the deal
       * consumes model ids, so the next turn's tile would be named differently on the two sides.
       */
      for (const entry of result.command.response) applyEntry(played, entry)
    }

    const stored = await games.commands(game.id, 0)
    const rebuilt = replayTableau(stored.commands.flatMap(replayOf), options)

    expect(rebuilt.tiles().map(t => t.id)).toEqual(played.tiles().map(t => t.id))
    expect(rebuilt.plates().map(p => p.id)).toEqual(played.plates().map(p => p.id))
    expect(rebuilt.stems().map(s => s.slot)).toEqual(played.stems().map(s => s.slot))
    // The ids must come out the same, or entries naming them would resolve to different pieces.
    for (const id of ids) expect(rebuilt.tile(id)).toBeDefined()
  })
})
