import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common'
import { draftItems, type PlayerCommand } from '../rules/game'
import { defaultGameSettings, SOLO, type GameSettings } from '../rules/gameSettings'
import { DeskService } from '../desk/desk.service'
import { PrismaService } from '../prisma.service'
import { GamesService } from './games.service'
import { HeadsGateway } from './heads.gateway'
import { PresenceService } from './presence.service'
import { TurnsService } from './turns.service'

/**
 * The log, against the real database.
 *
 * The one thing here that a fake could not prove is the **chain**: `@@unique([gameId, prevSeq])` is
 * the entire concurrency design, and whether it holds is a question about an index. There is a test
 * below that fires a dozen turns at one parent and insists eleven of them lose — remove the
 * constraint and it goes green with a forked log, which is exactly the failure it exists to catch.
 *
 * Everything the rules decide is covered without a database in `packages/rules`. What is here is
 * storage, ordering, identity and the deal.
 */

const prisma = new PrismaService()
const heads = new HeadsGateway()
const presence = new PresenceService()
const desks = new DeskService(prisma)
const turns = new TurnsService(prisma, desks, heads)
const games = new GamesService(prisma, desks, turns, heads, presence)

const made: string[] = []

function settingsFor(players: number): GameSettings {
  return {
    ...defaultGameSettings(0),
    kind: players > SOLO ? 'multiplayer' : 'singleplayer',
    players,
  }
}

/** A game that has started, with the token for each seat in seating order. */
async function table(players = 2): Promise<{ id: string, tokens: string[] }> {
  const first = await games.create({ settings: settingsFor(players), name: 'Ember' })
  made.push(first.game.id)
  const tokens = [first.token]
  for (let seat = 1; seat < players; seat++) {
    tokens.push((await games.join(first.game.id, `Seat ${seat}`)).token)
  }
  return { id: first.game.id, tokens }
}

/** The seq a fresh turn must name. */
async function head(gameId: string): Promise<number> {
  return (await turns.since(gameId, 0)).head.seq
}

function pass(seat: number): PlayerCommand {
  return { kind: 'pass', seat }
}

/**
 * A complete draft off the source, whatever happens to be showing.
 *
 * Taking "every value-1 item" reads well and is a coin flip: four random tiles out of thirty-six
 * kinds hold no 1 about half the time, and the test then drafts nothing and fails for a reason that
 * has nothing to do with what it is about. Sweeping the value of a tile that is *there* is a complete
 * draft by construction, whatever was dealt.
 *
 * **One id per kind**, though. A sweep is over kinds, not over items — the bag holds three copies of
 * each tile, so four dealt at random carry a matching pair about one time in nine, and selecting both
 * is the one thing `completedStrategies` refuses outright. That is a flake with a period of days: it
 * turns up in whichever test drew the pair, never in a rerun of that test alone.
 */
async function sweepTheSource(gameId: string): Promise<string[]> {
  const showing = draftItems(await turns.stateOf(gameId))
  const value = showing[0]?.value
  if (value === undefined) throw new Error('nothing in the source to draft')

  const oneEach = new Map<string, string>()
  for (const item of showing) {
    if (item.value === value) oneEach.set(`${item.color}:${item.value}`, item.id)
  }
  return [...oneEach.values()]
}

afterAll(async () => {
  if (made.length) await prisma.game.deleteMany({ where: { id: { in: made } } })
  await prisma.$disconnect()
})

describe('a game that has started', () => {
  /**
   * The opening lot is dealt before anybody plays.
   *
   * It has to be: the first turn is a draft, and there would be nothing to draft from. The client
   * used to deal it on mount — which is exactly the arrangement that dealt two lots when two clients
   * mounted.
   */
  it('has an opening lot in its log, dealt by nobody', async () => {
    const { id } = await table(2)
    const slice = await turns.since(id, 0)

    expect(slice.commands).toHaveLength(1)
    expect(slice.commands[0]?.author).toBeNull()
    expect(slice.commands[0]?.command.kind).toBe('deal')
    expect(slice.head.seq).toBe(slice.commands[0]?.seq)
  })

  it('has two desks of its own, and does not show them', async () => {
    const { id } = await table(2)
    const row = await prisma.game.findUnique({ where: { id } })

    expect(row?.tileDeskId).toMatch(/^[0-9a-f-]{36}$/)
    expect(row?.plateDeskId).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.stringify(await games.find(id))).not.toContain(row?.tileDeskId)
  })
})

describe('taking a turn', () => {
  it('stores it, and folds it into the game', async () => {
    const { id, tokens } = await table(2)
    const at = await head(id)

    const result = await turns.submit(id, randomUUID(), at, pass(0), tokens[0]!)

    expect(result.duplicate).toBe(false)
    expect(result.commands[0]?.author).toBe(0)
    expect((await turns.stateOf(id)).seats[0]?.passed).toBe(true)
    // The turn moved on to the seat that has not passed.
    expect((await turns.stateOf(id)).activeSeat).toBe(1)
  })

  it('refuses a turn from a seat whose turn it is not', async () => {
    const { id, tokens } = await table(2)

    await expect(turns.submit(id, randomUUID(), await head(id), pass(1), tokens[1]!))
      .rejects.toBeInstanceOf(UnprocessableEntityException)
  })

  /** The seat comes from the token. Naming another one in the body is not a way round that. */
  it('refuses a command that claims a seat the token does not hold', async () => {
    const { id, tokens } = await table(2)

    await expect(turns.submit(id, randomUUID(), await head(id), pass(0), tokens[1]!))
      .rejects.toBeInstanceOf(ForbiddenException)
  })

  it('refuses a stranger with no seat at all', async () => {
    const { id } = await table(2)

    await expect(turns.submit(id, randomUUID(), await head(id), pass(0), 'not-a-token'))
      .rejects.toBeInstanceOf(ForbiddenException)
  })

  /* Shape before legality: `applyCommand` casts rather than checks, so nothing unread may reach it. */
  it('refuses something that is not a command, and stores nothing', async () => {
    const { id, tokens } = await table(2)
    const before = (await turns.since(id, 0)).commands.length

    for (const nonsense of [null, 42, { kind: 'shove', seat: 0 }, { kind: 'pass' }]) {
      await expect(turns.submit(id, randomUUID(), await head(id), nonsense, tokens[0]!))
        .rejects.toBeInstanceOf(UnprocessableEntityException)
    }
    expect((await turns.since(id, 0)).commands).toHaveLength(before)
  })

  /** A deal is the server's. A client able to submit one would be choosing its own tiles. */
  it('refuses a deal, however well formed', async () => {
    const { id, tokens } = await table(2)
    const deal = { kind: 'deal', seat: 0, plate: { color: 1, value: 1 }, tiles: [{ color: 2, value: 2 }] }

    await expect(turns.submit(id, randomUUID(), await head(id), deal, tokens[0]!))
      .rejects.toBeInstanceOf(UnprocessableEntityException)
  })

  it('refuses a move the rules refuse, and stores nothing', async () => {
    const { id, tokens } = await table(2)
    const before = (await turns.since(id, 0)).commands.length
    const nothing = { kind: 'draft', seat: 0, ids: [] }

    await expect(turns.submit(id, randomUUID(), await head(id), nothing, tokens[0]!))
      .rejects.toBeInstanceOf(UnprocessableEntityException)
    expect((await turns.since(id, 0)).commands).toHaveLength(before)
  })
})

describe('the deal', () => {
  /**
   * A draft that touches the top lot leaves the source wanting another, and the server fills it in
   * the same request — so a reader can never see the turn without the deal it caused.
   */
  it('follows a turn that emptied the top lot, in the same breath', async () => {
    const { id, tokens } = await table(2)
    const taking = await sweepTheSource(id)

    const result = await turns.submit(
      id,
      randomUUID(),
      await head(id),
      { kind: 'draft', seat: 0, ids: taking },
      tokens[0]!,
    )

    expect(result.commands.map(row => row.command.kind)).toEqual(['draft', 'deal'])
    expect(result.commands[1]?.author).toBeNull()
    // And the chain runs through both: the deal names the draft as its parent.
    expect(result.commands[1]?.prevSeq).toBe(result.commands[0]?.seq)
  })

  it('does not deal when the source has not been touched', async () => {
    const { id, tokens } = await table(2)

    const result = await turns.submit(id, randomUUID(), await head(id), pass(0), tokens[0]!)

    expect(result.commands.map(row => row.command.kind)).toEqual(['pass'])
  })

  /** The bag is the game's, and the client never learns its handle or its order. */
  it('takes the lot out of the game´s own desk', async () => {
    const { id, tokens } = await table(2)
    const row = await prisma.game.findUnique({ where: { id } })
    const before = await prisma.desk.findUnique({ where: { id: row!.tileDeskId! } })

    const taking = await sweepTheSource(id)
    await turns.submit(id, randomUUID(), await head(id), { kind: 'draft', seat: 0, ids: taking }, tokens[0]!)

    const after = await prisma.desk.findUnique({ where: { id: row!.tileDeskId! } })
    expect((after?.config as { desk: number[] }).desk.length)
      .toBeLessThan((before?.config as { desk: number[] }).desk.length)
  })
})

/**
 * The command that is not a turn.
 *
 * Everything else here is somebody's move, taken in order, announced to the table. Tidying a drawer
 * is none of those things, and each of them is a way it could quietly become one.
 */
type Arrange = Extract<PlayerCommand, { kind: 'arrange' }>

describe('arranging a drawer', () => {
  /** The plan that puts seat `seat`'s drawer back exactly as it is — a legal no-op, and enough. */
  async function asItStands(gameId: string, seat: number): Promise<Arrange> {
    const state = await turns.stateOf(gameId)
    const tableau = state.seats[seat]!.tableau
    const settings = state.options.settings
    return {
      kind: 'arrange',
      seat,
      drawer: Array.from({ length: settings.tileSlots }, (_, slot) =>
        tableau.drawerSlotOccupant(slot) ?? null),
      bays: Array.from({ length: settings.plateSlots }, (_, slot) =>
        tableau.plateSlotOccupant(slot) ?? null),
    }
  }

  const seqOf = async (gameId: string): Promise<number> =>
    (await prisma.game.findUnique({ where: { id: gameId } }))!.seq

  /* The point of the whole change: seat 1 may tidy while seat 0 is still thinking. */
  it('is stored from a seat whose turn it is not, and does not move the turn', async () => {
    const { id, tokens } = await table(2)
    const state = await turns.stateOf(id)
    expect(state.activeSeat).toBe(0)

    const result = await turns.submit(
      id, randomUUID(), await head(id), await asItStands(id, 1), tokens[1]!,
    )

    expect(result.commands.map(row => row.command.kind)).toEqual(['arrange'])
    expect((await turns.stateOf(id)).activeSeat).toBe(0)
    expect((await turns.stateOf(id)).turn).toBe(state.turn)
  })

  /**
   * Announced like everything else, and this test is the reason.
   *
   * It used to assert the opposite — that an arrange left `Game.seq` alone, so a player fidgeting
   * with their drawer would not wake the table. But `Game.seq` is how a client learns to advance its
   * cursor, and the chain refuses a turn whose `prevSeq` is not the head. A silent write therefore
   * left every other client stale without telling them, and the next player to act was refused, for
   * as long as it took the backstop poll to notice — fifteen seconds with a live socket.
   *
   * Whatever moves the head has to say so.
   */
  it('announces itself, exactly as a turn does', async () => {
    const { id, tokens } = await table(2)
    const before = await seqOf(id)

    await turns.submit(id, randomUUID(), await head(id), await asItStands(id, 1), tokens[1]!)
    const afterArrange = await seqOf(id)
    expect(afterArrange).toBeGreaterThan(before)

    await turns.submit(id, randomUUID(), await head(id), pass(0), tokens[0]!)
    expect(await seqOf(id)).toBeGreaterThan(afterArrange)
  })

  /** The seat comes from the token, as it does for every other command. */
  it('cannot be sent for somebody else´s drawer', async () => {
    const { id, tokens } = await table(2)

    await expect(turns.submit(id, randomUUID(), await head(id), await asItStands(id, 1), tokens[0]!))
      .rejects.toBeInstanceOf(ForbiddenException)
  })

  it('is refused when it is not an arrangement of that drawer', async () => {
    const { id, tokens } = await table(2)
    const plan = await asItStands(id, 1)
    const before = (await turns.since(id, 0)).commands.length

    await expect(turns.submit(
      id, randomUUID(), await head(id), { ...plan, drawer: [...plan.drawer, 'nope'] }, tokens[1]!,
    )).rejects.toBeInstanceOf(UnprocessableEntityException)
    expect((await turns.since(id, 0)).commands).toHaveLength(before)
  })
})

describe('the chain', () => {
  it('reads everything after a cursor, and nothing before it', async () => {
    const { id, tokens } = await table(2)
    const opening = await head(id)
    await turns.submit(id, randomUUID(), opening, pass(0), tokens[0]!)

    const slice = await turns.since(id, opening)
    expect(slice.since).toBe(opening)
    expect(slice.commands.every(row => row.seq > opening)).toBe(true)
    expect(slice.head.seq).toBe(slice.commands.at(-1)?.seq)
  })

  /**
   * The head comes from the rows, not from a query of its own.
   *
   * Read separately it leaves a window: a command landing between the two queries is returned but not
   * counted, and a client that advanced its cursor to the head would fetch and apply it twice.
   */
  it('never reports a head behind the rows it just handed over', async () => {
    const { id, tokens } = await table(2)
    await turns.submit(id, randomUUID(), await head(id), pass(0), tokens[0]!)

    const slice = await turns.since(id, 0)
    for (const row of slice.commands) expect(row.seq).toBeLessThanOrEqual(slice.head.seq)
  })

  it('refuses a turn built on a parent the log has moved past', async () => {
    const { id, tokens } = await table(2)
    const stale = await head(id)
    await turns.submit(id, randomUUID(), stale, pass(0), tokens[0]!)

    await expect(turns.submit(id, randomUUID(), stale, pass(1), tokens[1]!))
      .rejects.toBeInstanceOf(ConflictException)
  })

  /**
   * Idempotency is checked **before** staleness, and the order is the point.
   *
   * A retry of a turn that did land carries a `prevSeq` the head has moved past. Testing staleness
   * first would answer every successful retry with a conflict — the one case `cmdId` exists to stop.
   */
  it('hands back the original rows when a turn is sent twice', async () => {
    const { id, tokens } = await table(2)
    const at = await head(id)
    const cmdId = randomUUID()

    const first = await turns.submit(id, cmdId, at, pass(0), tokens[0]!)
    const again = await turns.submit(id, cmdId, at, pass(0), tokens[0]!)

    expect(first.duplicate).toBe(false)
    expect(again.duplicate).toBe(true)
    expect(again.commands.map(row => row.seq)).toEqual(first.commands.map(row => row.seq))
    // And exactly one turn was written, whatever the client believed.
    expect((await turns.since(id, at)).commands).toHaveLength(first.commands.length)
  })

  /**
   * The constraint that is the concurrency design, tested the only way it can be.
   *
   * A dozen turns claiming one parent: exactly one wins and the rest are refused. They are *not*
   * queued behind the winner — each was reasoning from a board that no longer exists by the time it
   * lost. Remove `@@unique([gameId, prevSeq])` and this goes green with a forked log.
   */
  it('lets exactly one of many simultaneous turns through', async () => {
    const { id, tokens } = await table(2)
    const at = await head(id)

    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () => turns.submit(id, randomUUID(), at, pass(0), tokens[0]!)),
    )
    const won = attempts.filter(result => result.status === 'fulfilled')

    expect(won).toHaveLength(1)
    const after = await turns.since(id, at)
    expect(after.commands.filter(row => row.author === 0)).toHaveLength(1)
  })
})

describe('the end of a game', () => {
  /* Attempt 1 typed a finished game and never wrote one. */
  it('marks the game finished when the last round closes', async () => {
    const { id, tokens } = await table(SOLO)
    const rounds = (await turns.stateOf(id)).options.agenda.length

    for (let round = 0; round < rounds; round++) {
      await turns.submit(id, randomUUID(), await head(id), pass(0), tokens[0]!)
    }

    expect((await turns.stateOf(id)).finished).toBe(true)
    expect((await prisma.game.findUnique({ where: { id } }))?.status).toBe('finished')
  })

  it('refuses a turn once the game is over', async () => {
    const { id, tokens } = await table(SOLO)
    const rounds = (await turns.stateOf(id)).options.agenda.length
    for (let round = 0; round < rounds; round++) {
      await turns.submit(id, randomUUID(), await head(id), pass(0), tokens[0]!)
    }

    await expect(turns.submit(id, randomUUID(), await head(id), pass(0), tokens[0]!))
      .rejects.toBeInstanceOf(ConflictException)
  })
})

describe('taking a turn back', () => {
  /** A solo table, since that is the only shape undo is offered at. */
  async function soloTable(allowUndo = true): Promise<{ id: string, token: string }> {
    const made0 = await games.create({
      settings: { ...settingsFor(SOLO), allowUndo },
      name: 'Ember',
    })
    made.push(made0.game.id)
    return { id: made0.game.id, token: made0.token }
  }

  const undo = (seat = 0): PlayerCommand => ({ kind: 'undo', seat })

  /** Both bags as they stand, straight out of the row — there is no read-only route through the service. */
  async function bags(gameId: string): Promise<{ tiles: unknown, plates: unknown }> {
    const row = await prisma.game.findUnique({ where: { id: gameId } })
    const tiles = await prisma.desk.findUnique({ where: { id: row!.tileDeskId! } })
    const plates = await prisma.desk.findUnique({ where: { id: row!.plateDeskId! } })
    return { tiles: tiles!.config, plates: plates!.config }
  }

  it('puts the position back exactly as it was', async () => {
    const { id, token } = await soloTable()
    const before = await turns.stateOf(id)
    const beforeDrawer = before.seats[0]!.tableau.tiles().length

    await turns.submit(id, randomUUID(), await head(id), {
      kind: 'draft', seat: 0, ids: await sweepTheSource(id),
    }, token)
    expect((await turns.stateOf(id)).seats[0]!.tableau.tiles().length).toBeGreaterThan(beforeDrawer)

    await turns.submit(id, randomUUID(), await head(id), undo(), token)

    const after = await turns.stateOf(id)
    expect(after.seats[0]!.tableau.tiles().length).toBe(beforeDrawer)
    expect(after.turn).toBe(before.turn)
    expect(after.round).toBe(before.round)
  })

  /*
   * The half a re-fold cannot do. Everything above is derived from the log and would come back on its
   * own; the bags are mutable rows, and if undo failed to hand them back what the turn took, the
   * tiles would simply be gone from the game with nothing anywhere to notice.
   */
  it('hands both bags back exactly what the turn took from them', async () => {
    const { id, token } = await soloTable()
    const before = await bags(id)

    await turns.submit(id, randomUUID(), await head(id), {
      kind: 'draft', seat: 0, ids: await sweepTheSource(id),
    }, token)
    expect(await bags(id)).not.toEqual(before)

    await turns.submit(id, randomUUID(), await head(id), undo(), token)
    expect(await bags(id)).toEqual(before)
  })

  /**
   * The proof that the bag was *rewound* rather than merely emptied.
   *
   * A bag that had been drained and refilled from the wrong end would still conserve every tile and
   * still look right in a census — and would then deal a different lot for the same move. Replaying
   * the same turn and getting the same restock is what says the order survived.
   */
  it('deals the same lot when the same turn is played again', async () => {
    const { id, token } = await soloTable()
    const ids = await sweepTheSource(id)

    /*
     * The *last* deal each time, not every deal in the log. Undo appends rather than deletes, so the
     * cancelled restock is still a row — which is the point of the design, and would make a count of
     * every deal grow by one each time round.
     */
    const lastDeal = async (): Promise<string | undefined> => {
      const deals = (await turns.since(id, 0)).commands.filter(row => row.command.kind === 'deal')
      return deals.length > 0 ? JSON.stringify(deals.at(-1)!.command) : undefined
    }

    await turns.submit(id, randomUUID(), await head(id), { kind: 'draft', seat: 0, ids }, token)
    const first = await lastDeal()

    await turns.submit(id, randomUUID(), await head(id), undo(), token)
    await turns.submit(id, randomUUID(), await head(id), { kind: 'draft', seat: 0, ids }, token)

    expect(await lastDeal()).toEqual(first)
  })

  it('is appended rather than deleting anything, so a cursor still works', async () => {
    const { id, token } = await soloTable()
    await turns.submit(id, randomUUID(), await head(id), {
      kind: 'draft', seat: 0, ids: await sweepTheSource(id),
    }, token)
    const beforeUndo = await turns.since(id, 0)

    await turns.submit(id, randomUUID(), await head(id), undo(), token)
    const afterUndo = await turns.since(id, 0)

    // Every row that was there is still there, and the undo is one more on the end.
    expect(afterUndo.commands.length).toBe(beforeUndo.commands.length + 1)
    expect(afterUndo.commands.slice(0, beforeUndo.commands.length)).toEqual(beforeUndo.commands)
    expect(afterUndo.commands.at(-1)?.command.kind).toBe('undo')
  })

  it('refuses when the game was set up without undo', async () => {
    const { id, token } = await soloTable(false)
    await turns.submit(id, randomUUID(), await head(id), {
      kind: 'draft', seat: 0, ids: await sweepTheSource(id),
    }, token)

    await expect(turns.submit(id, randomUUID(), await head(id), undo(), token))
      .rejects.toBeInstanceOf(UnprocessableEntityException)
  })

  it('refuses at a shared table, whatever the settings say', async () => {
    const shared = await games.create({
      settings: { ...settingsFor(2), allowUndo: true },
      name: 'Ember',
    })
    made.push(shared.game.id)
    await games.join(shared.game.id, 'Flux')
    const id = shared.game.id

    await turns.submit(id, randomUUID(), await head(id), pass(0), shared.token)
    await expect(turns.submit(id, randomUUID(), await head(id), undo(), shared.token))
      .rejects.toBeInstanceOf(UnprocessableEntityException)
  })

  it('refuses before anybody has taken a turn', async () => {
    const { id, token } = await soloTable()
    await expect(turns.submit(id, randomUUID(), await head(id), undo(), token))
      .rejects.toBeInstanceOf(UnprocessableEntityException)
  })
})
