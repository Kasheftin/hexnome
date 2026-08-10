import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { DISTINCT_TILES, openingPlateCodes } from '../rules/deck'
import { createDesk } from '../rules/desk'
import { DEFAULT_TILE_COPIES, defaultGameSettings } from '../rules/gameSettings'
import type { DeskKind } from '../rules/wire'
import { PrismaService } from '../prisma.service'
import { DeskService } from './desk.service'

/**
 * The desk service, against the real database.
 *
 * Not mocked, deliberately. What can genuinely go wrong here is storage: a JSON column that comes back
 * as something other than what went in, a version check that does not check, an id that collides. A
 * fake would only prove the fake behaves. The bag's own arithmetic is covered without a database in
 * `packages/rules/src/desk.spec.ts`; this is about the parts a database is required to be honest about.
 *
 * Every desk made here is deleted afterwards.
 */

/** The smallest tile bag a game can be set up with: `TILE_COPIES_CHOICES` starts at two. */
const BAG = DISTINCT_TILES * 2

const prisma = new PrismaService()
const desks = new DeskService(prisma)
const made: string[] = []
const games: string[] = []

/**
 * A game to build desks from.
 *
 * Written straight to the row rather than through `GamesService`, because what this file is about is
 * the bag: it needs a seed, a copy count and a seat count, and a service that also hands out chairs
 * would put its concerns in the way.
 */
async function newGame(
  { seed = 'spec-seed', tileCopies = 2, plateCopies = 1, players = 1, settings = {} } = {},
): Promise<string> {
  const id = randomUUID()
  await prisma.game.create({
    data: {
      id,
      seed,
      status: 'running',
      /*
       * A whole settings object, not a fragment. The service reads these back through
       * `parseGameSettings`, which is the same gate a client's blob goes through — so a copy count
       * that is not one of the offered choices is silently replaced by the default rather than
       * honoured, and a test asking for one would be testing the default under another name.
       */
      settings: {
        ...defaultGameSettings(0),
        players,
        tileCopies,
        plateCopies,
        ...settings,
      } as unknown as object,
    },
  })
  games.push(id)
  return id
}

async function newDesk(
  options: Parameters<typeof newGame>[0] = {},
  kind: DeskKind = 'tiles',
): Promise<string> {
  const { id } = await desks.create(await newGame(options), kind)
  made.push(id)
  return id
}

afterAll(async () => {
  if (made.length) await prisma.desk.deleteMany({ where: { id: { in: made } } })
  if (games.length) await prisma.game.deleteMany({ where: { id: { in: games } } })
  await prisma.$disconnect()
})

describe('creating a desk', () => {
  it('stores the whole bag and reports what is drawable', async () => {
    const created = await desks.create(await newGame({ tileCopies: 2 }), 'tiles')
    made.push(created.id)

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.remaining).toBe(DISTINCT_TILES * 2)

    const row = await prisma.desk.findUnique({ where: { id: created.id } })
    expect(row?.version).toBe(0)
    expect((row?.config as { desk: number[] }).desk).toHaveLength(DISTINCT_TILES * 2)
  })

  /** The order comes from the game's seed, which is the server's own and never leaves it. */
  it('deals the order the game´s seed says', async () => {
    const id = await newDesk({ seed: 'a-known-seed' })
    const drawn = await desks.draw(id, 8)

    const built = createDesk('a-known-seed:tiles', { copies: 2 })
    expect(built.ok && built.value.desk.slice(0, 8)).toEqual(drawn.codes)
  })

  /* The whole point of a seed: two games sharing one deal the same, from fresh rows every time. */
  it('deals the same order to two games with the same seed', async () => {
    const a = await newDesk({ seed: 'twins' })
    const b = await newDesk({ seed: 'twins' })

    expect((await desks.draw(a, 8)).codes).toEqual((await desks.draw(b, 8)).codes)
  })

  it('gives the two desks of one game different orders', async () => {
    const gameId = await newGame()
    const tiles = await desks.create(gameId, 'tiles')
    const plates = await desks.create(gameId, 'plates')
    made.push(tiles.id, plates.id)

    const fromTiles = await desks.draw(tiles.id, DISTINCT_TILES - 1)
    const fromPlates = await desks.draw(plates.id, DISTINCT_TILES - 1)
    expect(fromTiles.codes).not.toEqual(fromPlates.codes)
  })

  /** Copies come from the game's settings, so a client cannot ask for a bag it was not dealt. */
  it('builds the bag the settings asked for, of each kind', async () => {
    const gameId = await newGame({ tileCopies: 4, plateCopies: 2 })
    const tiles = await desks.create(gameId, 'tiles')
    const plates = await desks.create(gameId, 'plates')
    made.push(tiles.id, plates.id)

    expect(tiles.remaining).toBe(DISTINCT_TILES * 4)
    // Every player's opening plate is held back, and this game seats one.
    expect(plates.remaining).toBe(DISTINCT_TILES * 2 - 1)
  })

  /**
   * The plates already on the boards are not in the bag, and both sides must agree which they are.
   *
   * The client works the same set out for itself when it lays the boards out, and it can only do
   * that from something it knows — so the exclusion is keyed on the **game id**, not on the secret
   * seed beside it. Disagree here and the bag deals a plate that is already on somebody's board.
   */
  it('holds back the opening plates, chosen from the id the client can also see', async () => {
    const gameId = await newGame({ players: 4, plateCopies: 1 })
    const created = await desks.create(gameId, 'plates')
    made.push(created.id)

    const opening = openingPlateCodes(gameId, 4)
    expect(opening).toHaveLength(4)
    expect(created.remaining).toBe(DISTINCT_TILES - 4)

    const { codes } = await desks.draw(created.id, DISTINCT_TILES - 4)
    for (const held of opening) expect(codes).not.toContain(held)
  })

  it('does not know a game that does not exist', async () => {
    await expect(desks.create('nobody-here', 'tiles')).rejects.toBeInstanceOf(NotFoundException)
  })

  /**
   * There is no unbuildable bag any more, and that is the point.
   *
   * The copy counts used to arrive from a client and could be anything; now they come from settings
   * that have been through `parseGameSettings`, which replaces a count nobody was offered with the
   * default. A nonsense *blob* is the failure that is left — a JSON column is editable in the
   * database — and it is refused rather than guessed at.
   */
  it('refuses a game whose settings it cannot read', async () => {
    const id = randomUUID()
    await prisma.game.create({
      data: { id, seed: 'spec-seed', status: 'running', settings: { kind: 'nonsense' } as unknown as object },
    })
    games.push(id)

    await expect(desks.create(id, 'tiles')).rejects.toBeInstanceOf(ConflictException)
  })

  it('ignores a copy count nobody was offered, rather than honouring it', async () => {
    const gameId = await newGame({ settings: { tileCopies: 99 } })
    const created = await desks.create(gameId, 'tiles')
    made.push(created.id)

    expect(created.remaining).toBe(DISTINCT_TILES * DEFAULT_TILE_COPIES)
  })
})

describe('drawing', () => {
  it('does not deal the same tile twice across requests', async () => {
    const id = await newDesk()
    const first = await desks.draw(id, 20)
    const second = await desks.draw(id, BAG - 20)
    const all = [...first.codes, ...second.codes]

    expect(all).toHaveLength(BAG)
    // Two copies of each, and no third of anything.
    expect(new Set(all).size).toBe(DISTINCT_TILES)
    expect(second.remaining).toBe(0)
  })

  it('refuses a draw the desk cannot cover, and moves nothing', async () => {
    const id = await newDesk()
    await expect(desks.draw(id, 1000)).rejects.toBeInstanceOf(ConflictException)
    // Still whole: a refused draw is not a partial one.
    expect((await desks.draw(id, BAG)).remaining).toBe(0)
  })

  it('refuses a nonsense count', async () => {
    const id = await newDesk()
    for (const n of [0, -1, 2.5]) {
      await expect(desks.draw(id, n)).rejects.toBeInstanceOf(ConflictException)
    }
  })

  it('does not know a desk that does not exist', async () => {
    await expect(desks.draw('00000000-0000-4000-8000-000000000000', 1))
      .rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('discarding', () => {
  it('makes what came back drawable again, through the pile', async () => {
    const id = await newDesk()
    const { codes } = await desks.draw(id, BAG)
    expect((await desks.discard(id, codes.slice(0, 5))).remaining).toBe(5)

    const again = await desks.draw(id, 5)
    expect([...again.codes].sort()).toEqual([...codes.slice(0, 5)].sort())
  })

  it('refuses a code that was never drawn', async () => {
    const id = await newDesk()
    const { codes } = await desks.draw(id, 4)
    /*
     * A code with *both* copies still in the bag. One copy would not do: with two of everything, a
     * code can be in the bag and also legitimately in somebody's hand, and discarding it would be
     * perfectly honest.
     */
    const row = await prisma.desk.findUnique({ where: { id } })
    const bag = (row?.config as { desk: number[] }).desk
    const untouched = bag.find(code => !codes.includes(code)) as number
    await expect(desks.discard(id, [untouched])).rejects.toBeInstanceOf(ConflictException)
  })

  it('refuses something that is not a tile code', async () => {
    const id = await newDesk()
    await desks.draw(id, 4)
    await expect(desks.discard(id, [99])).rejects.toBeInstanceOf(ConflictException)
  })

  it('takes an empty batch without touching anything', async () => {
    const id = await newDesk()
    const before = await prisma.desk.findUnique({ where: { id } })
    await desks.discard(id, [])
    const after = await prisma.desk.findUnique({ where: { id } })
    expect(after?.version).toBe(before?.version)
  })
})

/**
 * The reshuffle, over storage.
 *
 * The mechanism is pinned in the rules package. What matters here is that the generation and the pile
 * survive the round trip through JSON — a counter that reset on every load would reseed every
 * reshuffle to the same order and nothing would look wrong.
 */
describe('coming back round the pile', () => {
  it('keeps dealing, and remembers how many times it has', async () => {
    const id = await newDesk()
    let held = [...(await desks.draw(id, BAG)).codes]

    for (let round = 0; round < 3; round++) {
      await desks.discard(id, held)
      held = [...(await desks.draw(id, BAG)).codes]
      expect(held).toHaveLength(BAG)
      expect(new Set(held).size).toBe(DISTINCT_TILES)
    }

    const row = await prisma.desk.findUnique({ where: { id } })
    expect((row?.config as { generation: number }).generation).toBe(3)
  })
})

/**
 * The lost update the version column exists to prevent.
 *
 * Two draws that both read the same state would both write it back, and the second would quietly undo
 * the first — the same tile dealt to two callers, with nothing anywhere to notice. The client
 * serialises its own calls, so this should never fire in play; it is here because "should never" is
 * not a guarantee and the failure is invisible.
 */
describe('two writers on one desk', () => {
  it('lets one through and refuses the other', async () => {
    const id = await newDesk()
    const results = await Promise.allSettled([desks.draw(id, 4), desks.draw(id, 4)])
    const won = results.filter(r => r.status === 'fulfilled')
    const lost = results.filter(r => r.status === 'rejected')

    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(1)
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException)

    // And the desk moved exactly once: four gone, not eight and not zero.
    const row = await prisma.desk.findUnique({ where: { id } })
    expect((row?.config as { desk: number[] }).desk).toHaveLength(BAG - 4)
    expect(row?.version).toBe(1)
  })
})
