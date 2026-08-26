/**
 * A board, against a real database.
 *
 * The same reasoning as the other service specs: what can go wrong here is storage. Ordering,
 * paging and the shape of a filter are questions about what MySQL does with an index, and a fake
 * would only prove the fake agrees with itself. The one that could not be tested any other way is
 * the tie: whether two equal scores hold still across a page boundary is not a property of this
 * code at all, it is a property of the `ORDER BY` it asks for.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { defaultGameSettings } from '../rules/gameSettings'
import { PrismaService } from '../prisma.service'
import { DEFAULT_LIMIT, highscoreQuery, MAX_LIMIT, MAX_OFFSET } from './dto'
import { HighscoresService } from './highscores.service'

const prisma = new PrismaService()
const highscores = new HighscoresService(prisma)

const made: string[] = []

/** A board of this suite's own, so it cannot be disturbed by whatever else is in the database. */
const PRESET = 'spec-board'

interface Seeded {
  readonly score: number | null
  readonly players?: number
  readonly presetId?: string | null
  readonly finishedAt?: Date
  readonly name?: string
}

async function seed({ score, players = 1, presetId = PRESET, finishedAt, name = 'Ember' }: Seeded) {
  const id = randomUUID()
  made.push(id)
  await prisma.game.create({
    data: {
      id,
      seed: randomUUID(),
      settings: defaultGameSettings(0) as unknown as object,
      status: score === null ? 'running' : 'finished',
      presetId,
      players,
      score,
      winnerSeat: 0,
      winnerName: name,
      ...(finishedAt ? { updatedAt: finishedAt } : {}),
    },
  })
  return id
}

const board = (over: Partial<Parameters<typeof highscores.find>[0]> = {}) =>
  highscores.find({ presetId: PRESET, players: 1, limit: 20, offset: 0, ...over })

afterAll(async () => {
  if (made.length) await prisma.game.deleteMany({ where: { id: { in: made } } })
  await prisma.$disconnect()
})

describe('reading a board', () => {
  beforeAll(async () => {
    await seed({ score: 30 })
    await seed({ score: 10 })
    await seed({ score: 20 })
    // Not on this board: unfinished, another seat count, and a game that is nobody's.
    await seed({ score: null })
    await seed({ score: 99, players: 3 })
    await seed({ score: 99, presetId: null })
  })

  it('gives the best first', async () => {
    expect((await board()).rows.map(row => row.score)).toEqual([30, 20, 10])
  })

  it('counts the whole board, not the page', async () => {
    expect((await board({ limit: 1 })).total).toBe(3)
    expect((await board({ limit: 1 })).rows).toHaveLength(1)
  })

  /* A game still being played has no score, and that alone is what keeps it off. */
  it('leaves out a game that has not finished', async () => {
    expect((await board()).rows).toHaveLength(3)
  })

  it('is a different board for a different table size', async () => {
    expect((await board({ players: 3 })).rows.map(row => row.score)).toEqual([99])
  })

  it('has no board at all for a game that is nobody\'s', async () => {
    const orphans = await prisma.game.count({ where: { presetId: null, id: { in: made } } })
    expect(orphans).toBe(1)
    expect((await board()).rows.every(row => row.presetId === PRESET)).toBe(true)
  })

  it('echoes the slice it was asked for', async () => {
    const page = await board({ limit: 2, offset: 1 })
    expect(page).toMatchObject({ limit: 2, offset: 1, total: 3 })
    expect(page.rows.map(row => row.score)).toEqual([20, 10])
  })

  /*
   * The reason the ordering is three keys long, and why this test seeds ten rows rather than two.
   *
   * With `score DESC` alone MySQL may hand equal scores back in any order, and need not pick the same
   * one twice — so a row could arrive on both pages or on neither, and a player would watch their game
   * vanish by turning to page two. But *whether* it reorders them is up to it: a two-row version of
   * this test passed with the tiebreak removed, because with two rows it happened not to. Ten rows
   * inserted in an order unlike the one expected makes an accidental pass a one-in-ten-factorial
   * coincidence rather than a coin flip.
   */
  it('orders a wall of equal scores by the earlier game, and keeps it that way across pages', async () => {
    const tied = randomUUID().slice(0, 8)
    const days = [7, 2, 9, 4, 1, 10, 3, 8, 5, 6]
    for (const day of days) {
      await seed({
        score: 500,
        presetId: tied,
        name: `day-${day}`,
        finishedAt: new Date(`2026-03-${String(day).padStart(2, '0')}T00:00:00Z`),
      })
    }

    const query = { presetId: tied, players: 1, limit: 4, offset: 0 }
    const pages = [
      await highscores.find(query),
      await highscores.find({ ...query, offset: 4 }),
      await highscores.find({ ...query, offset: 8 }),
    ]
    const walked = pages.flatMap(page => page.rows.map(row => row.winnerName))

    // Every game exactly once, and in finishing order — which only the tiebreak can guarantee.
    expect(walked).toEqual(days.map(day => day).sort((a, b) => a - b).map(day => `day-${day}`))
  })

  /* A board is public, so what it does *not* carry is part of the contract. */
  it('publishes no seed, no settings and no game id', async () => {
    const row = (await board()).rows[0]!
    expect(Object.keys(row).sort()).toEqual(
      ['finishedAt', 'players', 'presetId', 'score', 'winnerName', 'winnerSeat'],
    )
  })
})

describe('what a board will be asked for', () => {
  it('refuses a preset nobody offers', () => {
    expect(() => highscoreQuery({ preset: 'nonsense', players: '1' })).toThrow(BadRequestException)
    expect(() => highscoreQuery({ players: '1' })).toThrow(BadRequestException)
  })

  it('refuses a table nobody sits at', () => {
    expect(() => highscoreQuery({ preset: 'standard', players: '9' })).toThrow(BadRequestException)
    expect(() => highscoreQuery({ preset: 'standard' })).toThrow(BadRequestException)
  })

  it('takes the usual slice when none is asked for', () => {
    expect(highscoreQuery({ preset: 'standard', players: '1' }))
      .toEqual({ presetId: 'standard', players: 1, limit: DEFAULT_LIMIT, offset: 0 })
  })

  /* A page size is a request for work, so it is bounded rather than believed. */
  it('will not be talked into an enormous page', () => {
    expect(highscoreQuery({ preset: 'standard', players: '1', limit: '5000' }).limit).toBe(MAX_LIMIT)
    expect(highscoreQuery({ preset: 'standard', players: '1', limit: '0' }).limit).toBe(1)
  })

  it('will not be sent counting into the millions', () => {
    expect(highscoreQuery({ preset: 'standard', players: '1', offset: '5000000' }).offset)
      .toBe(MAX_OFFSET)
  })

  /*
   * Missing is not the same as wrong. No `limit` means "the usual"; `limit=banana` is a caller that
   * believes it asked for something, and is told otherwise.
   */
  it('refuses a slice that is not a number, rather than guessing', () => {
    for (const bad of ['banana', '-1', '1.5']) {
      expect(() => highscoreQuery({ preset: 'standard', players: '1', limit: bad }))
        .toThrow(BadRequestException)
    }
  })
})
