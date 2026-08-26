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
     * Both conditions, though one implies the other.
     *
     * `score`, `winnerSeat`, `winnerName` and `status` are set by a single `UPDATE` guarded by
     * `status: 'running'`, so a scored game is a finished game by construction and `score IS NOT NULL`
     * would do on its own. It is stated anyway because this is the query somebody will read when they
     * want to know what a board contains, and "finished games, best first" is the answer — leaving the
     * status out made a reader check the write path to find out whether an abandoned game could show
     * up. A condition that costs nothing and answers that question in place is worth the line.
     *
     * It also holds the line against a row edited by hand in the database, which is the one way the
     * two could ever come apart.
     */
    const where = { presetId, players, status: 'finished', score: { not: null } }

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
