import { afterAll, describe, expect, it } from 'vitest'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { defaultGameSettings, SOLO, type GameSettings } from '../rules/gameSettings'
import { DeskService } from '../desk/desk.service'
import { PrismaService } from '../prisma.service'
import { createGameBody } from './dto'
import { GamesService } from './games.service'
import { HeadsGateway } from './heads.gateway'
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
const desks = new DeskService(prisma)
const turns = new TurnsService(prisma, desks, heads)
const games = new GamesService(prisma, desks, turns, heads)
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
