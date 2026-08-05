import { randomUUID } from 'node:crypto'
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { createDeck, dealStartingPlates } from '@hexnome/rules/deck'
import {
  applyCommand,
  createDealer,
  replayDealer,
  type Dealer,
  type ReplayedGame,
} from '@hexnome/rules/dealer'
import { recordingTableau, type LogEntry } from '@hexnome/rules/gameLog'
import {
  DEFAULT_PLATES_PER_ROUND,
  parseGameSettings,
  type GameSettings,
} from '@hexnome/rules/gameSettings'
import { openingPosition, tableauOptionsFor } from '@hexnome/rules/setup'
import { shouldRefill } from '@hexnome/rules/source'
import { createTableau, type Tableau } from '@hexnome/rules/tableau'
import { PrismaService } from '../prisma.service'
import {
  GENESIS,
  SERVER_SEAT,
  SOLO_SEAT,
  type CommandSlice,
  type CommandView,
  type CreateGameBody,
  type GameView,
  type Head,
  type SubmitBody,
  type SubmitResult,
} from './dto'

/** One seat for now. Seats arrive with multiplayer; the column and the check are already real. */
const SEATS = 1

/** A row as Prisma hands it back, before the JSON column is trusted. */
interface CommandRow {
  seq: number
  prevSeq: number
  author: string
  awaiting: string
  cmdId: string
  effects: unknown
  response: unknown
}

function toCommandView(row: CommandRow): CommandView {
  return {
    seq: row.seq,
    prevSeq: row.prevSeq,
    author: row.author,
    awaiting: row.awaiting,
    cmdId: row.cmdId,
    effects: row.effects as LogEntry[],
    response: row.response as LogEntry[],
  }
}

/**
 * A unique index refused the write — either the chain's or the command id's.
 *
 * Deliberately *not* split by which index fired, though the two mean opposite things: one is a race
 * the caller lost, the other is the caller's own retry. Two callers sending the same command at once
 * violate **both** indexes, and MySQL reports whichever it checked first — which turned out to be the
 * chain, so keying off the constraint name answered a retry with a conflict.
 *
 * Looking the command id up settles it properly: a row bearing this caller's id exists or it does
 * not, whoever wrote it and whichever index complained.
 */
function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === 'P2002'
}

@Injectable()
export class GamesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Start a game, and write its opening position as the first command.
   *
   * The id is always fresh; the seed is only fresh when none was given. Supplying one replays a deal
   * already played — the same deck, agenda and scatter under a new id, which is how a board gets
   * played twice.
   *
   * The genesis command is nested inside the same write, so a game cannot exist without one. A game
   * with an empty log would have no head to build on and no board to replay, which is not a state
   * worth being able to represent.
   */
  async create(body: CreateGameBody): Promise<GameView> {
    const settings = parseGameSettings(body.settings)
    if (!settings) throw new ConflictException('settings are not a game this server understands')

    const seed = body.seed?.slice(0, 64) || randomUUID()

    const game = await this.prisma.game.create({
      data: {
        id: randomUUID(),
        seed,
        // Prisma's JSON input wants an index signature; GameSettings is a closed shape, and being
        // closed is the point of it.
        settings: settings as unknown as object,
        status: 'running',
        commands: {
          create: {
            prevSeq: GENESIS,
            author: SERVER_SEAT,
            awaiting: SOLO_SEAT,
            cmdId: randomUUID(),
            // The opening is entirely the server's doing — there was no turn for it to answer — so
            // it goes in `response` and `effects` is empty. A client replaying the log treats the
            // two the same; only an author reconciling its own optimistic state cares.
            effects: [] as unknown as object,
            response: this.openingEffects(seed, settings) as unknown as object,
          },
        },
      },
      include: { commands: { orderBy: { seq: 'desc' }, take: 1 } },
    })

    return this.toView(game)
  }

  /**
   * The opening position, as the entries that produce it.
   *
   * Played onto a throwaway recording tableau rather than hand-written: the ids the entries name are
   * assigned by the model, so composing them by hand would mean reimplementing its counter and
   * getting it wrong the first time a rule changed.
   */
  private openingEffects(seed: string, settings: GameSettings): LogEntry[] {
    const entries: LogEntry[] = []
    const tableau = recordingTableau(
      createTableau(tableauOptionsFor(settings)),
      entry => entries.push(entry),
    )

    const deck = createDeck(seed)
    openingPosition(tableau, settings, dealStartingPlates(deck.plates, SEATS).starting[0])

    /*
     * And the first lot, so a created game is playable on arrival. It is dealt here rather than in
     * answer to the first turn because there would be nothing to draft from on that turn — the
     * source has to be stocked before the player is asked to take from it.
     */
    createDealer(seed).deal(tableau)

    return entries
  }

  async find(id: string): Promise<GameView> {
    const game = await this.prisma.game.findUnique({
      where: { id },
      include: { commands: { orderBy: { seq: 'desc' }, take: 1 } },
    })
    if (!game) throw new NotFoundException(`no game ${id}`)
    return this.toView(game)
  }

  /**
   * Everything after `since`.
   *
   * A cursor rather than a timestamp: two rows can share a millisecond and clocks step backwards, so
   * `?since=<time>` would silently skip commands. The numbers are sparse — allocated globally, so a
   * game's may jump — but only their order ever matters.
   */
  async commands(id: string, since: number): Promise<CommandSlice> {
    const game = await this.prisma.game.findUnique({
      where: { id },
      include: { commands: { orderBy: { seq: 'desc' }, take: 1 } },
    })
    if (!game) throw new NotFoundException(`no game ${id}`)

    const from = Number.isFinite(since) && since > 0 ? Math.floor(since) : 0
    const rows = await this.prisma.command.findMany({
      where: { gameId: id, seq: { gt: from } },
      orderBy: { seq: 'asc' },
    })
    return { since: from, head: headOf(game.commands), commands: rows.map(toCommandView) }
  }

  /**
   * Add a command to the end of the chain.
   *
   * **There is no transaction, and that is the design.** A command names the command it was built on,
   * and `@@unique([gameId, prevSeq])` makes the database refuse two children of the same parent — so
   * the insert itself decides the race. The head is read to *reason* about the move, and that read is
   * allowed to be stale: nothing downstream trusts it.
   *
   * The ordering checks below therefore produce better *errors* rather than correctness. The
   * legality check is different: nothing else performs it, and without it a client writes whatever
   * it likes into the log.
   */
  async submit(id: string, body: SubmitBody): Promise<SubmitResult> {
    if (!body?.cmdId) throw new ConflictException('a command needs a cmdId')

    const game = await this.prisma.game.findUnique({
      where: { id },
      include: { commands: { orderBy: { seq: 'desc' }, take: 1 } },
    })
    if (!game) throw new NotFoundException(`no game ${id}`)

    const head = headOf(game.commands)
    const author = body.author ?? SOLO_SEAT

    /*
     * Idempotency is checked before staleness, and the order is the whole point. A retry of a command
     * that *did* land carries a prevSeq the head has already moved past, so testing staleness first
     * would answer every successful retry with a conflict — the one case this column exists to stop.
     */
    if (body.prevSeq !== head.seq) {
      const already = await this.stored(id, body.cmdId)
      if (already) return { command: already, duplicate: true }
      throw new ConflictException({
        message: 'the log has moved on since you last read it',
        prevSeq: body.prevSeq,
        head,
      })
    }

    if (author !== head.awaiting) {
      throw new ForbiddenException({
        message: `it is not ${author}'s turn`,
        awaiting: head.awaiting,
      })
    }

    const settings = parseGameSettings(game.settings)
    if (!settings) throw new ConflictException(`game ${id} has settings this server cannot read`)

    /*
     * One pass answers both questions. `applyCommand` walks the turn through a real board, keeping
     * the deck in step as it goes, and refuses the first entry the board will not take — so "is this
     * legal" and "what does it do to the deck" cannot drift apart into two opinions.
     */
    const { tableau, dealer } = await this.replay(id, settings)
    const effects = body.effects ?? []

    const outcome = applyCommand(tableau, dealer, effects)
    if (!outcome.ok) {
      const refused = effects[outcome.refusedAt]
      throw new UnprocessableEntityException({
        message: `effect ${outcome.refusedAt} (${refused?.op}) is not a move this board allows`,
        index: outcome.refusedAt,
        op: refused?.op,
      })
    }

    const response = this.dealerResponse(tableau, dealer, settings)

    try {
      const row = await this.prisma.command.create({
        data: {
          gameId: id,
          prevSeq: body.prevSeq,
          author,
          // Whose turn it is next. Trivial with one seat; Stage C computes it from the round state,
          // and multiplayer from the seat order.
          awaiting: SOLO_SEAT,
          cmdId: body.cmdId,
          // Both halves in one row, and therefore one INSERT: a client must never be able to observe
          // a move landing without the deal it triggered.
          effects: effects as unknown as object,
          response: response as unknown as object,
        },
      })
      return { command: toCommandView(row), duplicate: false }
    }
    catch (error) {
      if (!isUniqueViolation(error)) throw error

      /*
       * The same two outcomes as above, now decided by the database rather than by the stale read.
       * Which of them it is depends on whether this caller's command is in the log — not on which
       * index complained, since a concurrent resend of one command violates both.
       */
      const already = await this.stored(id, body.cmdId)
      if (already) return { command: already, duplicate: true }

      throw new ConflictException({
        message: 'another command took this place first',
        prevSeq: body.prevSeq,
        head: headOf(await this.headRow(id)),
      })
    }
  }

  /**
   * What the server owes in answer to a turn: a plate turned over, a fresh lot on the source.
   *
   * **This is where the deck stops being the client's.** The tiles heaped on a new lot are visible
   * and go into the log as themselves; the plate beneath goes in face down and carries no token,
   * because at that moment the model holds none — only the dealer here knows what it is. The token
   * reaches a client exactly once, in the `revealPlate` entry, and only after the lot is picked
   * clean. Nothing else in any response narrows it.
   *
   * Recorded off a wrapper so the dealer's own mutations are journalled as ordinary entries. A client
   * applies them without needing to know or care that the server made them.
   */
  private dealerResponse(tableau: Tableau, dealer: Dealer, settings: GameSettings): LogEntry[] {
    const response: LogEntry[] = []
    const recorder = recordingTableau(tableau, entry => response.push(entry))

    // Turn over anything the turn just picked clean, before restocking on top of it.
    dealer.reveal(recorder)

    const supply = {
      platesDealt: dealer.platesDealt(),
      platesPerRound: settings.platesPerRound ?? DEFAULT_PLATES_PER_ROUND,
    }
    if (shouldRefill(recorder, supply)) dealer.deal(recorder)

    return response
  }

  /**
   * The game as its log leaves it: the board, and the deck behind the board.
   *
   * O(n) in the length of the game, on every command. Fine at the few hundred a game runs to, and
   * worth measuring before it is worth caching — a snapshot every N commands is the obvious fix, and
   * an unnecessary one until the numbers say so.
   */
  private async replay(gameId: string, settings: GameSettings): Promise<ReplayedGame> {
    const game = await this.prisma.game.findUnique({ where: { id: gameId }, select: { seed: true } })
    const rows = await this.prisma.command.findMany({
      where: { gameId },
      orderBy: { seq: 'asc' },
      select: { effects: true, response: true },
    })
    /*
     * Grouped by command, never flattened. The deck's piles are batched per event and a turn holds
     * at most one payment, so the command boundary is the batch boundary — flattening loses it and
     * produces a deck that is subtly, permanently wrong from the first reshuffle.
     */
    const commands = rows.map(r => [...(r.effects as LogEntry[]), ...(r.response as LogEntry[])])
    return replayDealer(game?.seed ?? '', settings, commands)
  }

  private async stored(gameId: string, cmdId: string): Promise<CommandView | null> {
    const row = await this.prisma.command.findUnique({ where: { gameId_cmdId: { gameId, cmdId } } })
    return row ? toCommandView(row) : null
  }

  private headRow(gameId: string) {
    return this.prisma.command.findMany({ where: { gameId }, orderBy: { seq: 'desc' }, take: 1 })
  }

  /**
   * Settings are re-validated on the way *out*, not only in.
   *
   * The column is JSON in MySQL and editable there, so a row is no more trustworthy than localStorage
   * was — and the client already refuses to trust that.
   */
  private toView(game: {
    id: string
    seed: string
    settings: unknown
    status: string
    commands: CommandRow[]
  }): GameView {
    const settings = parseGameSettings(game.settings)
    if (!settings) throw new ConflictException(`game ${game.id} has settings this server cannot read`)
    return {
      id: game.id,
      seed: game.seed,
      settings,
      status: game.status,
      head: headOf(game.commands),
    }
  }
}

/**
 * Where the chain currently ends.
 *
 * An empty log reads as `{ seq: 0, awaiting: the only seat }`, which is exactly what a first command
 * must name. `create` never leaves a game in that state, but a head that has to be special-cased by
 * every caller is worse than one that answers sensibly.
 */
function headOf(commands: readonly { seq: number, awaiting: string }[]): Head {
  const last = commands[0]
  return last
    ? { seq: last.seq, awaiting: last.awaiting }
    : { seq: GENESIS, awaiting: SOLO_SEAT }
}
