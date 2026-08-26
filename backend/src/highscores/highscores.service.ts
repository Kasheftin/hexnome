/**
 * A board: the finished games of one preset at one seat count, best first.
 *
 * The first thing in this server that returns a *list* rather than one record found by its id, which
 * is why the ordering below is spelled out rather than assumed.
 */
import { Injectable } from '@nestjs/common'
import type { HighscorePage, HighscoreRow } from '../rules/wire'
import { PrismaService } from '../prisma.service'
import type { HighscoreQuery } from './dto'

@Injectable()
export class HighscoresService {
  constructor(private readonly prisma: PrismaService) {}

  async find({ presetId, players, limit, offset }: HighscoreQuery): Promise<HighscorePage> {
    /*
     * `score: { not: null }` is the whole test for "this game finished and was scored".
     *
     * Not `status: 'finished'` as well. The two are written in the same statement, so they cannot
     * disagree — and a query naming both would imply they might, which would be a worse thing to
     * believe than to check.
     */
    const where = { presetId, players, score: { not: null } }

    /*
     * **A total order, and it has to be.** `score DESC` alone is not one: MySQL may return equal
     * scores in any order it likes, and it need not be the same order twice — so one row could appear
     * on page 1 and page 2 while another appeared on neither. The tiebreak is the earlier game first,
     * which is the fair way to break a draw, and the id last because two games can finish inside the
     * same millisecond and something has to be final.
     */
    const [rows, total] = await Promise.all([
      this.prisma.game.findMany({
        where,
        orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }, { id: 'asc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.game.count({ where }),
    ])

    return { rows: rows.map(row => rowOf(row)), total, limit, offset }
  }
}

/**
 * One row, field by field.
 *
 * Named out rather than spread, exactly as `viewOf` in games.service.ts is: a `Game` row carries the
 * seed and the whole settings blob, and a spread here would be one careless line away from publishing
 * both. The game id is left off deliberately — see `HighscoreRow` in the wire module for why.
 */
function rowOf(row: {
  presetId: string | null
  players: number | null
  score: number | null
  winnerSeat: number | null
  winnerName: string | null
  updatedAt: Date
}): HighscoreRow {
  return {
    presetId: row.presetId ?? '',
    players: row.players ?? 0,
    score: row.score ?? 0,
    winnerSeat: row.winnerSeat ?? 0,
    winnerName: row.winnerName ?? '',
    finishedAt: row.updatedAt.toISOString(),
  }
}
