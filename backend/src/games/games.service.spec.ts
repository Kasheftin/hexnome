import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { defaultGameSettings, SOLO, type GameSettings } from '../rules/gameSettings'
import { DeskService } from '../desk/desk.service'
import { PrismaService } from '../prisma.service'
import { createGameBody } from './dto'
import { GamesService } from './games.service'
import { HeadsGateway } from './heads.gateway'
import { PresenceService } from './presence.service'
import { TurnsService } from './turns.service'

/**
 * The games service, against the real database.
 *
 * Not mocked, deliberately, and for the same reason the desk's spec is not: what can genuinely go
 * wrong here is storage. A seat claimed twice, a JSON column that comes back as something other than
 * what went in, a `seq` that does not move. A fake would only prove the fake behaves.
 *
 * The one thing worth a real database above all is the **claim**, which is a conditional update and
 * therefore only correct if the database says so. There is a test below that runs several joins at
 * once and insists they land in different chairs.
 *
 * Every game made here is deleted afterwards; its seats go with it, by cascade.
 */

const prisma = new PrismaService()
/*
 * A real gateway with nothing attached. `moved` finds no room and returns, so the service is
 * exercised exactly as it runs — no stub to fall out of step with it, and no socket server to tidy
 * up. What the gateway itself does is `heads.gateway.spec.ts`.
 */
const heads = new HeadsGateway()
/**
 * The clock presence is measured against, in the spec's hand.
 *
 * Held here rather than slept through: the only interesting question about presence is what happens
 * ninety seconds after somebody stops reading.
 */
let now = Date.now()
const presence = new PresenceService()
presence.clock = () => now
const after = (seconds: number): void => { now += seconds * 1000 }
const desks = new DeskService(prisma)
const turns = new TurnsService(prisma, desks, heads)
const games = new GamesService(prisma, desks, turns, heads, presence)
const made: string[] = []

function settingsFor(players: number): GameSettings {
  return { ...defaultGameSettings(0), kind: players > SOLO ? 'multiplayer' : 'singleplayer', players }
}

async function newGame(players = 3, name = 'Ember') {
  const claim = await games.create({ settings: settingsFor(players), name })
  made.push(claim.game.id)
  return claim
}

afterAll(async () => {
  if (made.length) await prisma.game.deleteMany({ where: { id: { in: made } } })
  await prisma.$disconnect()
})

describe('opening a table', () => {
  it('seats everyone the settings asked for, and claims the creator´s', async () => {
    const { seat, token, game } = await newGame(3, 'Ember')

    expect(seat).toBe(0)
    expect(token).toMatch(/^[0-9a-f-]{36}$/)
    expect(game.status).toBe('waiting')
    expect(game.seats).toHaveLength(3)
    expect(game.seats.map(s => s.joined)).toEqual([true, false, false])
    expect(game.seats[0]?.name).toBe('Ember')
    expect(game.you).toBe(0)
  })

  /* The whole reason this endpoint exists: the client no longer knows what the game deals from. */
  it('mints a seed and never lets it out', async () => {
    const { game } = await newGame()

    expect(game).not.toHaveProperty('seed')
    const row = await prisma.game.findUnique({ where: { id: game.id } })
    expect(row?.seed).toMatch(/^[0-9a-f-]{36}$/)
    expect(row?.seed).not.toBe(game.id)
  })

  /**
   * One game, one secret seed, and the client cannot smuggle in a second.
   *
   * A seed used to be a setting, back when the client dealt the game. `parseGameSettings` drops it
   * now, so a blob from an older build — or a hand-edited one — cannot leave a stale copy in the row
   * for the next reader to have to choose between.
   */
  it('keeps no seed in the settings, whatever the client sent', async () => {
    // Through the body parser, because that is where an untrusted blob becomes settings — the
    // service takes a `GameSettings` and is entitled to believe it.
    const body = createGameBody({ settings: { ...settingsFor(2), seed: 'from-the-client' }, name: '' })
    const { game } = await games.create(body)
    made.push(game.id)

    expect(game.settings).not.toHaveProperty('seed')
    const row = await prisma.game.findUnique({ where: { id: game.id } })
    expect(row?.settings).not.toHaveProperty('seed')
    expect(row?.seed).not.toBe('from-the-client')
  })

  it('keeps the settings it was given', async () => {
    const wanted = { ...settingsFor(2), platesPerRound: 6, tileSlots: 16, firstPassFine: 2 }
    const { game } = await games.create({ settings: wanted, name: '' })
    made.push(game.id)

    expect(game.settings.platesPerRound).toBe(6)
    expect(game.settings.tileSlots).toBe(16)
    expect(game.settings.firstPassFine).toBe(2)
  })

  /* A solo game is a table of one, so it fills the moment it is made. No branch says so. */
  it('starts a solo game immediately', async () => {
    const { game } = await newGame(SOLO)

    expect(game.status).toBe('running')
    expect(game.seats).toHaveLength(1)
    expect(game.you).toBe(0)
  })

  it('refuses a table nobody could sit at', async () => {
    await expect(games.create({ settings: settingsFor(0), name: '' })).rejects.toThrow(ConflictException)
    await expect(games.create({ settings: settingsFor(9), name: '' })).rejects.toThrow(ConflictException)
  })
})

describe('reading a game', () => {
  it('does not know a game that does not exist', async () => {
    await expect(games.find('nobody-here')).rejects.toThrow(NotFoundException)
  })

  /**
   * Reading is public; the token only decides which seat is *yours*.
   *
   * A spectator gets the same seat list as a player, because a share link is exactly the right to
   * look at a table. What they do not get is a `you`.
   */
  it('tells a spectator everything except which seat is theirs', async () => {
    const { game } = await newGame(2, 'Ember')
    const seen = await games.find(game.id)

    expect(seen.seats).toHaveLength(2)
    expect(seen.seats[0]?.name).toBe('Ember')
    expect(seen.you).toBeNull()
  })

  it('never shows anybody´s token', async () => {
    const { game, token } = await newGame(2)
    const seen = JSON.stringify(await games.find(game.id, token))

    expect(seen).not.toContain(token)
  })

  /* An empty token must not match a free seat, whose token is null in the row and '' on the way out. */
  it('does not seat an empty token at a free chair', async () => {
    const { game } = await newGame(3)

    expect((await games.find(game.id, '')).you).toBeNull()
  })
})

/**
 * Who is still at the table, answered from the traffic already flowing.
 *
 * There is no heartbeat to test, because reading a game *is* the heartbeat: every client refetches
 * its game on every watch tick, with its token. So these are about that read having the side effect,
 * and about it being the reader's own seat and nobody else's.
 */
describe('who is present', () => {
  it('counts the caller as present, in the answer to their own read', async () => {
    const { game, token } = await newGame(2, 'Ember')

    const seen = await games.find(game.id, token)

    expect(seen.seats[0]?.online).toBe(true)
  })

  /**
   * Creating and joining count too, and should: both are somebody doing a thing at the table, which
   * is better evidence than a poll. This is about what happens once they stop.
   */
  it('forgets a seat that has stopped reading, and keeps the one that has not', async () => {
    const { game, token } = await newGame(2, 'Ember')
    await games.join(game.id, 'Flux')
    expect((await games.find(game.id, token)).seats.map(seat => seat.online)).toEqual([true, true])

    // Ember keeps polling for two minutes; Flux closed the tab.
    for (let poll = 0; poll < 8; poll++) {
      after(15)
      await games.find(game.id, token)
    }

    const seen = await games.find(game.id, token)
    expect(seen.seats.map(seat => seat.online)).toEqual([true, false])
  })

  it('is told by whoever reads, so two players are both present', async () => {
    const { game, token } = await newGame(2, 'Ember')
    const second = await games.join(game.id, 'Flux')

    await games.find(game.id, token)
    const seen = await games.find(game.id, second.token)

    expect(seen.seats.map(seat => seat.online)).toEqual([true, true])
  })

  /** A watcher is not a player. Reading with no token puts nobody at the table, including them. */
  it('is not moved by a spectator, who has no seat to be present in', async () => {
    const { game } = await newGame(2, 'Ember')
    after(120)

    const seen = await games.find(game.id)

    expect(seen.seats.every(seat => !seat.online)).toBe(true)
  })

  /**
   * A chair nobody has claimed cannot be anywhere, whatever the presence service happens to hold.
   *
   * Marked present directly, because that disagreement is the whole point of the guard: presence is
   * keyed by seat *number* and knows nothing about who holds one, so the two can only be reconciled
   * where they meet. No path in the app produces this today — which is precisely why it has to be
   * produced here rather than waited for.
   */
  it('never calls an empty chair present', async () => {
    const { game, token } = await newGame(3, 'Ember')
    presence.seen(game.id, 1)

    const seen = await games.find(game.id, token)

    expect(seen.seats[1]?.joined).toBe(false)
    expect(seen.seats[1]?.online).toBe(false)
  })
})

describe('joining', () => {
  it('takes the lowest free seat and says which', async () => {
    const { game } = await newGame(3, 'Ember')
    const second = await games.join(game.id, 'Flux')

    expect(second.seat).toBe(1)
    expect(second.game.you).toBe(1)
    expect(second.game.seats.map(s => s.joined)).toEqual([true, true, false])
    expect(second.game.seats[1]?.name).toBe('Flux')
  })

  it('moves the game on, so a watching room knows to look', async () => {
    const { game } = await newGame(3)
    const before = game.seq
    const after = await games.join(game.id, 'Flux')

    expect(after.game.seq).toBeGreaterThan(before)
  })

  it('starts the game when the last seat is taken, and not before', async () => {
    const { game } = await newGame(3)

    expect((await games.join(game.id, 'Flux')).game.status).toBe('waiting')
    expect((await games.join(game.id, 'Gimbal')).game.status).toBe('running')
  })

  it('refuses a fourth player at a table of three', async () => {
    const { game } = await newGame(3)
    await games.join(game.id, 'Flux')
    await games.join(game.id, 'Gimbal')

    await expect(games.join(game.id, 'Late')).rejects.toThrow(ConflictException)
  })

  it('refuses a game that has already started', async () => {
    const { game } = await newGame(SOLO)

    await expect(games.join(game.id, 'Late')).rejects.toThrow(ConflictException)
  })

  it('takes a player who did not say who they are', async () => {
    const { game } = await newGame(2)
    const joined = await games.join(game.id, '')

    expect(joined.game.seats[1]?.name).toBe('')
    expect(joined.game.seats[1]?.joined).toBe(true)
  })

  /**
   * The reason the claim is a conditional write rather than a read and a write.
   *
   * Four people open one link at the same moment. Whatever order the database serialises them in,
   * each must end up in a chair of their own — and the fourth, at a table of three, must be told the
   * table is full rather than sharing somebody's drawer.
   */
  it('gives four simultaneous joins four different answers', async () => {
    const { game } = await newGame(3)
    const attempts = await Promise.allSettled([
      games.join(game.id, 'A'),
      games.join(game.id, 'B'),
      games.join(game.id, 'C'),
      games.join(game.id, 'D'),
    ])

    const seated = attempts
      .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof games.join>>> =>
        result.status === 'fulfilled')
      .map(result => result.value.seat)

    // Two of the three seats were free, so exactly two of the four can have been given one.
    expect(seated).toHaveLength(2)
    expect(new Set(seated).size).toBe(2)
    expect(seated).not.toContain(0)

    const row = await prisma.seat.findMany({ where: { gameId: game.id }, orderBy: { seat: 'asc' } })
    expect(row.every(seat => seat.token !== null)).toBe(true)
    expect(new Set(row.map(seat => seat.token)).size).toBe(3)
  })
})

/**
 * Dealing the same game to somebody who wants to beat it.
 *
 * A game is dealt from two seeds and both have to be inherited, which is the whole reason this was
 * more than copying a column. The secret one orders the bags. The public one — normally the game's
 * own id, which is why `dealKey` exists at all — decides the opening plates, the round targets and
 * the petal stream. Copy one and you get a different game with a familiar bag.
 *
 * So the test is not "did the columns copy" but "is it the same game", and the way to ask that is to
 * look at what was dealt.
 */
describe('playing the same deal again', () => {
  /** A finished solo game, played out by passing until it is over. */
  async function finished(players = SOLO) {
    const claim = await games.create({ settings: settingsFor(players), name: 'Ember' })
    made.push(claim.game.id)
    const id = claim.game.id
    const tokens = [claim.token]
    for (let seat = 1; seat < players; seat++) {
      tokens.push((await games.join(id, `Seat ${seat}`)).token)
    }
    let guard = 0
    while (!(await turns.stateOf(id)).finished && guard++ < 60) {
      const state = await turns.stateOf(id)
      const head = (await turns.since(id, 0)).head.seq
      await turns.submit(id, randomUUID(), head, { kind: 'pass', seat: state.activeSeat },
        tokens[state.activeSeat]!)
    }
    return id
  }

  const openingOf = async (id: string) =>
    (await turns.since(id, 0)).commands.find(row => row.command.kind === 'deal')?.command

  /**
   * Both seeds, on the row.
   *
   * Stated directly because everything else about a repeat is downstream of these two values, and the
   * tests that try to observe the deal are each blind to one half: the source's first lot comes out of
   * the desks, so it is the *secret* seed that decides it, and the agenda comes out of the public key.
   * Neither notices the other going wrong.
   *
   * An earlier version of this suite compared the seats' opening plates and looked like a third
   * check. It was not: it read the original's *finished* tableau against the copy's fresh one, and
   * passed with the public key deliberately randomised. Deleted rather than kept as reassurance.
   */
  it('inherits both seeds, which is what everything else follows from', async () => {
    const original = await finished()
    const copy = await games.clone(original, 'Rival')
    made.push(copy.game.id)

    const rows = await prisma.game.findMany({
      where: { id: { in: [original, copy.game.id] } },
      select: { id: true, seed: true, dealKey: true },
    })
    const before = rows.find(row => row.id === original)!
    const after2 = rows.find(row => row.id === copy.game.id)!

    expect(after2.seed).toBe(before.seed)
    // The original was dealt from its own id, and the copy is dealt from the original's.
    expect(before.dealKey).toBeNull()
    expect(after2.dealKey).toBe(original)
  })

  it('deals the identical opening lot', async () => {
    const original = await finished()
    const copy = await games.clone(original, 'Rival')
    made.push(copy.game.id)

    expect(await openingOf(copy.game.id)).toEqual(await openingOf(original))
  })

  /* The other half of the same game: what each round is scored for. */
  it('scores against the identical agenda', async () => {
    const original = await finished()
    const copy = await games.clone(original, 'Rival')
    made.push(copy.game.id)

    const before = await turns.stateOf(original)
    const after2 = await turns.stateOf(copy.game.id)
    expect(after2.options.agenda).toEqual(before.options.agenda)
    expect(after2.options.dealKey).toBe(before.options.dealKey)
  })

  it('is a new game, not the old one wearing a hat', async () => {
    const original = await finished()
    const copy = await games.clone(original, 'Rival')
    made.push(copy.game.id)

    expect(copy.game.id).not.toBe(original)
    expect(copy.game.seats[0]!.name).toBe('Rival')
    expect((await turns.stateOf(copy.game.id)).finished).toBe(false)
  })

  /*
   * The secret seed is copied and still never shown. That is what lets a player replay a deal without
   * being able to see what is coming in a game they have not played yet.
   */
  it('inherits the secret seed without publishing it', async () => {
    const original = await finished()
    const copy = await games.clone(original, 'Rival')
    made.push(copy.game.id)

    const rows = await prisma.game.findMany({
      where: { id: { in: [original, copy.game.id] } },
      select: { seed: true },
    })
    expect(rows[0]!.seed).toBe(rows[1]!.seed)
    expect(JSON.stringify(copy)).not.toContain(rows[0]!.seed)
  })

  it('starts a solo repeat straight away, and sits a table down to wait', async () => {
    const solo = await games.clone(await finished(SOLO), 'Rival')
    made.push(solo.game.id)
    expect(solo.game.status).toBe('running')

    const table = await games.clone(await finished(2), 'Rival')
    made.push(table.game.id)
    expect(table.game.status).toBe('waiting')
  })

  /* Repeating a game still being played would hand out its opening to somebody sitting at it. */
  it('will not repeat a game that is not over', async () => {
    const running = await newGame(SOLO)
    await expect(games.clone(running.game.id, 'Rival')).rejects.toThrow(ConflictException)
  })

  it('has nothing to repeat for a game that does not exist', async () => {
    await expect(games.clone(randomUUID(), 'Rival')).rejects.toThrow(NotFoundException)
  })
})
