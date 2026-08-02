import { randomUUID } from 'node:crypto'
import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import type { LogEntry } from '@hexnome/rules/gameLog'
import { parseGameSettings } from '@hexnome/rules/gameSettings'
import { PrismaService } from '../prisma.service'
import type { AppendResult, CreateGameBody, GameView, LogSlice, SeqEntry } from './dto'

/** A row as Prisma hands it back, before the JSON columns are trusted. */
interface EntryRow {
  seq: number
  origin: string
  data: unknown
}

/**
 * How long an append may spend waiting for its turn.
 *
 * Appends to one game serialise on that game's row, and a waiter holds a pool connection while it
 * blocks — so a burst queues on two resources at once and the tail waits for both. Prisma's default
 * two-second window is for a transaction that expects to start immediately; this one expects to
 * queue, and a P2028 here is not a broken request but a request that was told to give up early.
 *
 * The ceiling on throughput is the serialised commit rate, so a larger pool would only put more
 * connections behind the same lock. The window is the knob; the pool is not.
 */
const APPEND_MAX_WAIT_MS = 20_000

/** And once started, how long it may hold the lock. Generous: the work under it is three statements. */
const APPEND_TIMEOUT_MS = 10_000

/** Prisma's code for "could not start a transaction in time" — the queue was longer than the window. */
const TRANSACTION_TIMED_OUT = 'P2028'

function toSeqEntry(row: EntryRow): SeqEntry {
  return {
    seq: row.seq,
    origin: row.origin === 'server' ? 'server' : 'player',
    entry: row.data as LogEntry,
  }
}

@Injectable()
export class GamesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Start a game.
   *
   * The id is always fresh; the seed is only fresh when none was given. Supplying one replays a deal
   * already played — the same deck, agenda and scatter under a new id, which is how a board gets
   * played twice.
   */
  async create(body: CreateGameBody): Promise<GameView> {
    const settings = parseGameSettings(body.settings)
    if (!settings) throw new ConflictException('settings are not a game this server understands')

    const game = await this.prisma.game.create({
      data: {
        id: randomUUID(),
        seed: body.seed?.slice(0, 64) || randomUUID(),
        // Prisma's JSON input type wants an index signature; GameSettings is a closed shape, and
        // being closed is the point of it.
        settings: settings as unknown as object,
        status: 'running',
      },
    })
    return this.toView(game)
  }

  async find(id: string): Promise<GameView> {
    const game = await this.prisma.game.findUnique({ where: { id } })
    if (!game) throw new NotFoundException(`no game ${id}`)
    return this.toView(game)
  }

  /**
   * Everything after `since`.
   *
   * A cursor rather than a timestamp: two entries can share a millisecond and clocks step backwards,
   * so `?since=<time>` would silently skip rows. An integer is exact, and it lets a caller notice a
   * gap — "I have 41, you say the head is 45" — instead of diverging quietly.
   */
  async log(id: string, since: number): Promise<LogSlice> {
    const game = await this.prisma.game.findUnique({ where: { id }, select: { lastSeq: true } })
    if (!game) throw new NotFoundException(`no game ${id}`)

    const from = Number.isFinite(since) && since > 0 ? Math.floor(since) : 0
    const rows = await this.prisma.logEntry.findMany({
      where: { gameId: id, seq: { gt: from } },
      orderBy: { seq: 'asc' },
      select: { seq: true, origin: true, data: true },
    })
    return { since: from, lastSeq: game.lastSeq, entries: rows.map(toSeqEntry) }
  }

  /**
   * Add entries to the end of the log.
   *
   * **The sequence is allocated under a row lock.** Two appends arriving together must not take the
   * same number, and the failure would not be an error — it would be a corrupted log discovered much
   * later. `SELECT … FOR UPDATE` on the game row serialises them, so the second waits and continues
   * from where the first finished.
   *
   * `@@id([gameId, seq])` is the backstop, and it is worth keeping for that alone: with the lock
   * removed the race shows up as a duplicate-key error rather than as two entries quietly sharing a
   * number. Loud is the right failure for this — never rely on it, but never drop it either.
   */
  async append(
    id: string,
    entries: readonly LogEntry[],
    expectedSeq?: number,
    origin: 'player' | 'server' = 'player',
  ): Promise<AppendResult> {
    if (entries.length === 0) {
      const { lastSeq } = await this.find(id)
      return { from: lastSeq, lastSeq, entries: [] }
    }

    try {
      return await this.appendLocked(id, entries, expectedSeq, origin)
    }
    catch (error) {
      /*
       * The queue outlasted the window. This is the one failure a caller should simply retry, so it
       * must not look like the malformed-request and lost-race failures beside it.
       */
      if ((error as { code?: string }).code === TRANSACTION_TIMED_OUT) {
        throw new ServiceUnavailableException('the log is busy; retry')
      }
      throw error
    }
  }

  private appendLocked(
    id: string,
    entries: readonly LogEntry[],
    expectedSeq: number | undefined,
    origin: 'player' | 'server',
  ): Promise<AppendResult> {
    return this.prisma.$transaction(async (tx) => {
      // The lock, and the reason this is a transaction at all. Prisma has no `FOR UPDATE`, so it is
      // raw — and it must be the first statement, before anything reads `lastSeq`.
      const locked = await tx.$queryRaw<{ lastSeq: number }[]>`
        SELECT lastSeq FROM Game WHERE id = ${id} FOR UPDATE
      `
      const current = locked[0]
      if (!current) throw new NotFoundException(`no game ${id}`)

      const from = current.lastSeq
      if (expectedSeq !== undefined && expectedSeq !== from) {
        throw new ConflictException({
          message: 'the log has moved on since you last read it',
          expectedSeq,
          lastSeq: from,
        })
      }

      const written: SeqEntry[] = entries.map((entry, index) => ({
        seq: from + index + 1,
        origin,
        entry,
      }))

      await tx.logEntry.createMany({
        data: written.map(w => ({
          gameId: id,
          seq: w.seq,
          origin: w.origin,
          kind: String((w.entry as { op?: unknown }).op ?? 'unknown').slice(0, 24),
          data: w.entry as object,
        })),
      })

      const lastSeq = from + written.length
      await tx.game.update({ where: { id }, data: { lastSeq } })

      return { from, lastSeq, entries: written }
    }, { maxWait: APPEND_MAX_WAIT_MS, timeout: APPEND_TIMEOUT_MS })
  }

  /**
   * Settings are re-validated on the way *out*, not only in.
   *
   * The column is JSON in MySQL and editable there, so a row is no more trustworthy than
   * localStorage was — and the client already refuses to trust that.
   */
  private toView(game: { id: string, seed: string, settings: unknown, status: string, lastSeq: number }): GameView {
    const settings = parseGameSettings(game.settings)
    if (!settings) throw new ConflictException(`game ${game.id} has settings this server cannot read`)
    return { id: game.id, seed: game.seed, settings, status: game.status, lastSeq: game.lastSeq }
  }
}
