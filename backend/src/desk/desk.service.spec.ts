import { afterAll, describe, expect, it } from 'vitest'
import { ConflictException, NotFoundException } from '@nestjs/common'
import { DISTINCT_TILES } from '../rules/deck'
import { createDesk } from '../rules/desk'
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

const prisma = new PrismaService()
const desks = new DeskService(prisma)
const made: string[] = []

const SEED = 'spec:tiles'

async function newDesk(copies = 1, exclude?: number[]): Promise<string> {
  const { id } = await desks.create(SEED, copies, exclude ?? [])
  made.push(id)
  return id
}

afterAll(async () => {
  if (made.length) await prisma.desk.deleteMany({ where: { id: { in: made } } })
  await prisma.$disconnect()
})

describe('creating a desk', () => {
  it('stores the whole bag and reports what is drawable', async () => {
    const created = await desks.create(SEED, 2, [])
    made.push(created.id)

    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.remaining).toBe(DISTINCT_TILES * 2)

    const row = await prisma.desk.findUnique({ where: { id: created.id } })
    expect(row?.version).toBe(0)
    expect((row?.config as { desk: number[] }).desk).toHaveLength(DISTINCT_TILES * 2)
  })

  /* The whole point of a seed: the same one deals the same order, from a fresh row every time. */
  it('deals the order the seed says, not the order the row was written in', async () => {
    const a = await newDesk()
    const b = await newDesk()
    const drawnA = await desks.draw(a, 8)
    const drawnB = await desks.draw(b, 8)
    expect(drawnA.codes).toEqual(drawnB.codes)

    const built = createDesk(SEED, { copies: 1 })
    expect(built.ok && built.value.desk.slice(0, 8)).toEqual(drawnA.codes)
  })

  it('gives the two desks of one game different orders', async () => {
    const tiles = await desks.create('game:tiles', 1, [])
    const plates = await desks.create('game:plates', 1, [])
    made.push(tiles.id, plates.id)
    const fromTiles = await desks.draw(tiles.id, 36)
    const fromPlates = await desks.draw(plates.id, 36)
    expect(fromTiles.codes).not.toEqual(fromPlates.codes)
  })

  it('holds back the codes it is told to', async () => {
    const id = await newDesk(1, [11, 66])
    const { codes } = await desks.draw(id, DISTINCT_TILES - 2)
    expect(codes).not.toContain(11)
    expect(codes).not.toContain(66)
  })

  it('refuses a bag it cannot build', async () => {
    await expect(desks.create(SEED, 0, [])).rejects.toBeInstanceOf(ConflictException)
    await expect(desks.create(SEED, 1, [11, 11])).rejects.toBeInstanceOf(ConflictException)
    await expect(desks.create(SEED, 1, [99])).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('drawing', () => {
  it('does not deal the same tile twice across requests', async () => {
    const id = await newDesk()
    const first = await desks.draw(id, 20)
    const second = await desks.draw(id, 16)
    const all = [...first.codes, ...second.codes]

    expect(all).toHaveLength(DISTINCT_TILES)
    expect(new Set(all).size).toBe(DISTINCT_TILES)
    expect(second.remaining).toBe(0)
  })

  it('refuses a draw the desk cannot cover, and moves nothing', async () => {
    const id = await newDesk()
    await expect(desks.draw(id, 1000)).rejects.toBeInstanceOf(ConflictException)
    // Still whole: a refused draw is not a partial one.
    expect((await desks.draw(id, DISTINCT_TILES)).remaining).toBe(0)
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
    const { codes } = await desks.draw(id, DISTINCT_TILES)
    expect((await desks.discard(id, codes.slice(0, 5))).remaining).toBe(5)

    const again = await desks.draw(id, 5)
    expect([...again.codes].sort()).toEqual([...codes.slice(0, 5)].sort())
  })

  it('refuses a code that was never drawn', async () => {
    const id = await newDesk()
    await desks.draw(id, 4)
    // A code still sitting in the bag: the game's one copy of it is already accounted for.
    const row = await prisma.desk.findUnique({ where: { id } })
    const undrawn = (row?.config as { desk: number[] }).desk[0] as number
    await expect(desks.discard(id, [undrawn])).rejects.toBeInstanceOf(ConflictException)
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
    let held = [...(await desks.draw(id, DISTINCT_TILES)).codes]

    for (let round = 0; round < 3; round++) {
      await desks.discard(id, held)
      held = [...(await desks.draw(id, DISTINCT_TILES)).codes]
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
    expect((row?.config as { desk: number[] }).desk).toHaveLength(DISTINCT_TILES - 4)
    expect(row?.version).toBe(1)
  })
})
