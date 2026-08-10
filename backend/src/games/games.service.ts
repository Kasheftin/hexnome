/**
 * A game, as a stored thing: what was chosen, who is at the table, and how far along it is.
 *
 * It knows nothing about the desks. A desk is found by its own id and a game holds no reference to
 * one; what ties them together is the **seed**, minted here and never sent anywhere. That is the
 * point of moving it: the client picks the settings and the server picks what they are dealt from,
 * so nobody holding a share link can rebuild the order.
 *
 * ## Claiming a seat is a conditional write
 *
 * `UPDATE … WHERE gameId = ? AND seat = ? AND token IS NULL` either takes the seat or affects no
 * rows, so two people opening one link together cannot both get in — the loser simply tries the next
 * seat. Reading for a free seat and then writing it would be a race however carefully it were
 * written, and the failure is two players sharing a drawer.
 *
 * Same discipline as the desk's version check, three lines long, for the same reason: the write
 * adjudicates, not a read.
 *
 * ## Every game is a table
 *
 * A solo game is one whose only seat is claimed by its creator, so it starts in the same breath and
 * takes exactly the same path. There is no singleplayer branch here to keep in step with the other
 * one — attempt 1's worst bug was a guard that existed on one path and not the other
 * (docs/backend-attempt1.md).
 */
import { randomUUID } from 'node:crypto'
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { MAX_PLAYERS } from '../rules/deck'
import { parseGameSettings, type GameSettings } from '../rules/gameSettings'
import type { GameStatus, GameView, SeatClaim } from '../rules/wire'
import { PrismaService } from '../prisma.service'
import type { CreateGame } from './dto'
import { HeadsGateway } from './heads.gateway'

/** Whoever creates the game sits here, and turn order starts from it. */
const CREATOR_SEAT = 0

/** A row as this service reads it, with its seats in seating order. */
interface GameRow {
  id: string
  settings: unknown
  status: string
  seq: number
  seats: { seat: number, name: string | null, token: string | null }[]
}

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly heads: HeadsGateway,
  ) {}

  /**
   * Open a table and sit down at it.
   *
   * The seats are all created here, empty but for the creator's, because how many there are is a
   * setting rather than something discovered as people arrive. A game that cannot be seated is
   * refused rather than trimmed — a table of nine is a request nobody meant to make.
   */
  async create({ settings, name }: CreateGame): Promise<SeatClaim> {
    const players = settings.players
    if (players < 1 || players > MAX_PLAYERS) {
      throw new ConflictException(`a game seats 1 to ${MAX_PLAYERS}, not ${players}`)
    }

    const id = randomUUID()
    const token = randomUUID()

    await this.prisma.game.create({
      data: {
        id,
        // Minted here, and the reason this endpoint exists. Never leaves the server.
        seed: randomUUID(),
        /*
         * As parsed, and `parseGameSettings` no longer admits a seed at all. A game has two — this
         * column, which is secret, and the id, which is public and is what the opening plates come
         * from. A third in the settings is the copy that would go stale.
         */
        settings: settings as unknown as object,
        seats: {
          create: Array.from({ length: players }, (_, seat) => ({
            seat,
            name: seat === CREATOR_SEAT ? name : null,
            token: seat === CREATOR_SEAT ? token : null,
            joined: seat === CREATOR_SEAT ? new Date() : null,
          })),
        },
      },
    })

    // A solo game is already full, so this is where it starts. Nothing about that is special-cased.
    const game = await this.startIfFull(id, token)
    return { seat: CREATOR_SEAT, token, game }
  }

  /** The game as the holder of that token sees it. An empty token is a spectator, not an error. */
  async find(id: string, token = ''): Promise<GameView> {
    return this.viewOf(await this.rowOf(id), token)
  }

  /**
   * Take the lowest free seat.
   *
   * Walks them in order and lets the write decide. Zero rows affected means somebody took that seat
   * between the read and the write, so it moves on to the next rather than failing — which is what
   * makes two simultaneous joins land in two different chairs instead of one erroring.
   */
  async join(id: string, name: string): Promise<SeatClaim> {
    const game = await this.rowOf(id)
    if (game.status !== 'waiting') throw new ConflictException('this game has already started')

    const token = randomUUID()

    for (const seat of game.seats) {
      if (seat.token !== null) continue
      const taken = await this.prisma.seat.updateMany({
        where: { gameId: id, seat: seat.seat, token: null },
        data: { token, name, joined: new Date() },
      })
      if (taken.count !== 1) continue

      /*
       * A join is a change to the game even when it does not start it — the waiting room is showing
       * a seat list, and a new name in it is the whole event. So the seq moves for the join itself,
       * and `startIfFull` moves it again if the table just filled.
       */
      await this.touch(id)
      return { seat: seat.seat, token, game: await this.startIfFull(id, token) }
    }

    throw new ConflictException('every seat at this table is taken')
  }

  /**
   * Start the game if the last seat has just been claimed; otherwise leave it waiting.
   *
   * Written as a conditional update for the same reason the claim is: two joins can arrive here
   * together, both see a full table, and both try to start it. `WHERE status = 'waiting'` lets
   * exactly one of them through, and the other's answer is simply the game as the winner left it.
   */
  private async startIfFull(id: string, token: string): Promise<GameView> {
    const game = await this.rowOf(id)
    if (game.status !== 'waiting' || game.seats.some(seat => seat.token === null)) {
      return this.viewOf(game, token)
    }

    await this.prisma.game.updateMany({
      where: { id, status: 'waiting' },
      data: { status: 'running', seq: { increment: 1 } },
    })

    // A table that just filled is what everyone waiting is waiting for.
    const started = await this.rowOf(id)
    this.heads.moved(id, started.seq)
    return this.viewOf(started, token)
  }

  /**
   * Say that something about this game changed, without saying what.
   *
   * The broadcast goes out *after* the write, never before: a watcher told to look before the row
   * has moved fetches the old game, sees nothing new, and stops. Being late is a delay; being early
   * is a miss.
   */
  private async touch(id: string): Promise<void> {
    const game = await this.prisma.game.update({
      where: { id },
      data: { seq: { increment: 1 } },
    })
    this.heads.moved(id, game.seq)
  }

  private async rowOf(id: string): Promise<GameRow> {
    const game = await this.prisma.game.findUnique({
      where: { id },
      include: { seats: { orderBy: { seat: 'asc' } } },
    })
    if (!game) throw new NotFoundException(`no game ${id}`)
    return game
  }

  /**
   * A row as it is allowed to leave the server.
   *
   * Built by naming every field rather than by spreading and deleting: the seed and the tokens are
   * one careless spread away from the wire, and a deletion is a thing somebody can forget to add.
   *
   * The settings are re-parsed on the way out. A JSON column is editable in the database, so it goes
   * through the same gate the client puts localStorage through, for exactly the same reason.
   */
  private viewOf(game: GameRow, token: string): GameView {
    const settings: GameSettings | null = parseGameSettings(game.settings)
    if (!settings) throw new ConflictException(`game ${game.id} has settings this server cannot read`)

    return {
      id: game.id,
      status: game.status as GameStatus,
      seq: game.seq,
      settings,
      seats: game.seats.map(seat => ({
        seat: seat.seat,
        name: seat.name ?? '',
        joined: seat.token !== null,
      })),
      // An empty token must not match a free seat, whose token is null in the row and '' here.
      you: token ? game.seats.find(seat => seat.token === token)?.seat ?? null : null,
    }
  }
}
