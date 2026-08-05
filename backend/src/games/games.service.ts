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
  passedThisRound,
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
import { HeadsGateway } from './heads.gateway'
import {
  GENESIS,
  SERVER_SEAT,
  type CommandSlice,
  type CommandView,
  type CreateGameBody,
  type GameStatus,
  type JoinBody,
  type SeatClaim,
  type GameView,
  type Head,
  type SubmitBody,
  type SubmitResult,
} from './dto'

/** Whoever makes the game sits down first, in the seat the tableau calls zero. */
const CREATOR_SEAT = 0

/** And plays first. Turn order is seat order. */
const FIRST_SEAT = 0

/** How many rounds the log has already closed. The next one is this plus one. */
function roundsSoFar(history: readonly (readonly LogEntry[])[]): number {
  return history.flat().filter(entry => entry.op === 'endRound').length
}

/** Names are shown to strangers, so they are trimmed and bounded. Empty means "did not say". */
function cleanName(name: string | undefined): string {
  return (name ?? '').trim().slice(0, 40)
}

/** A row as Prisma hands it back, before the JSON column is trusted. */
interface CommandRow {
  seq: number
  prevSeq: number
  author: number | null
  awaiting: number | null
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly heads: HeadsGateway,
  ) {}

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
  async create(body: CreateGameBody): Promise<SeatClaim> {
    const settings = parseGameSettings(body.settings)
    if (!settings) throw new ConflictException('settings are not a game this server understands')

    const seed = body.seed?.slice(0, 64) || randomUUID()
    const id = randomUUID()
    const token = randomUUID()

    /*
     * Made as a lobby with every seat laid out and the creator sitting in the first one. No genesis
     * command yet: what the opening deals depends on who is playing, and nobody else has arrived.
     *
     * A solo game takes this same path and simply fills up at once — one route rather than two, so
     * there is no singleplayer special case to fall out of step with the rest.
     */
    await this.prisma.game.create({
      data: {
        id,
        seed,
        // Prisma's JSON input wants an index signature; GameSettings is a closed shape, and being
        // closed is the point of it.
        settings: settings as unknown as object,
        status: 'lobby',
        seats: {
          create: Array.from({ length: settings.players }, (_, seat) => ({
            seat,
            // Seat zero is the creator's, claimed in the same write so it cannot be taken from them.
            name: seat === CREATOR_SEAT ? cleanName(body.name) : null,
            token: seat === CREATOR_SEAT ? token : null,
            joined: seat === CREATOR_SEAT ? new Date() : null,
          })),
        },
      },
    })

    return { seat: CREATOR_SEAT, token, game: await this.startIfFull(id, token) }
  }

  /**
   * Take the lowest free seat.
   *
   * **The claim is a conditional update, and that is the whole concurrency design** — the same shape
   * as the command chain. `WHERE token IS NULL` either takes the seat or affects nothing, so two
   * people opening the link together cannot both get in; the loser simply tries the next one. A read
   * to find a free seat would be a race however carefully it were written.
   */
  async join(id: string, body: JoinBody): Promise<SeatClaim> {
    const game = await this.prisma.game.findUnique({
      where: { id },
      include: { seats: { orderBy: { seat: 'asc' } } },
    })
    if (!game) throw new NotFoundException(`no game ${id}`)
    if (game.status !== 'lobby') throw new ConflictException('this game has already started')

    const token = randomUUID()

    for (const seat of game.seats) {
      if (seat.token !== null) continue
      const taken = await this.prisma.seat.updateMany({
        where: { gameId: id, seat: seat.seat, token: null },
        data: { token, name: cleanName(body?.name), joined: new Date() },
      })
      // Zero rows means somebody else took it between the read and the write. Try the next.
      if (taken.count === 1) return { seat: seat.seat, token, game: await this.startIfFull(id, token) }
    }

    throw new ConflictException('every seat at this table is taken')
  }

  /**
   * Start the game if the last seat has just been claimed; otherwise leave it waiting.
   *
   * The genesis command is written here rather than at creation because the opening deals one board
   * per player, and until the table is full there is no knowing how many that is.
   *
   * Racing joins may both arrive here. The chain settles it: the genesis names `prevSeq: 0`, and
   * `@@unique([gameId, prevSeq])` lets exactly one of them write it.
   */
  private async startIfFull(id: string, token = ''): Promise<GameView> {
    const game = await this.prisma.game.findUnique({
      where: { id },
      include: { seats: true, commands: { orderBy: { seq: 'desc' }, take: 1 } },
    })
    if (!game) throw new NotFoundException(`no game ${id}`)
    if (game.status !== 'lobby' || game.seats.some(seat => seat.token === null)) {
      return this.toView(game, token)
    }

    const settings = parseGameSettings(game.settings)
    if (!settings) throw new ConflictException(`game ${id} has settings this server cannot read`)

    try {
      await this.prisma.game.update({
        where: { id },
        data: {
          status: 'running',
          commands: {
            create: {
              prevSeq: GENESIS,
              author: SERVER_SEAT,
              awaiting: FIRST_SEAT,
              cmdId: randomUUID(),
              // Entirely the server's doing — no turn preceded it — so it is all response.
              effects: [] as unknown as object,
              response: this.openingEffects(game.seed, settings) as unknown as object,
            },
          },
        },
      })
    }
    catch (error) {
      // Another join got there first. Its genesis is the one that counts.
      if (!isUniqueViolation(error)) throw error
    }

    // A table that just filled has a genesis command, and everyone waiting wants to know.
    const started = await this.find(id, token)
    this.heads.moved(id, started.head.seq)
    return started
  }

  /**
   * The opening position, as the entries that produce it.
   *
   * Played onto a throwaway recording tableau rather than hand-written: the ids the entries name are
   * assigned by the model, so composing them by hand would mean reimplementing its counter and
   * getting it wrong the first time a rule changed.
   *
   * **One board and one drawer per seat, from one deck.** The starting plates are dealt together so
   * that no player's opening depends on the order the seats happened to fill.
   */
  private openingEffects(seed: string, settings: GameSettings): LogEntry[] {
    const entries: LogEntry[] = []
    const tableau = recordingTableau(
      createTableau(tableauOptionsFor(settings)),
      entry => entries.push(entry),
    )

    const deck = createDeck(seed)
    const starting = dealStartingPlates(deck.plates, settings.players).starting
    for (let seat = 0; seat < settings.players; seat++) {
      openingPosition(tableau, settings, starting[seat], seat)
    }

    /*
     * And the first lot, so a started game is playable on arrival. It is dealt here rather than in
     * answer to the first turn because there would be nothing to draft from on that turn — the
     * source has to be stocked before the player is asked to take from it.
     */
    createDealer(seed).deal(tableau)

    return entries
  }

  async find(id: string, token = ''): Promise<GameView> {
    const game = await this.prisma.game.findUnique({
      where: { id },
      include: { seats: true, commands: { orderBy: { seq: 'desc' }, take: 1 } },
    })
    if (!game) throw new NotFoundException(`no game ${id}`)
    return this.toView(game, token)
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
      include: { seats: true, commands: { orderBy: { seq: 'desc' }, take: 1 } },
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
  async submit(id: string, body: SubmitBody, token: string): Promise<SubmitResult> {
    if (!body?.cmdId) throw new ConflictException('a command needs a cmdId')

    const game = await this.prisma.game.findUnique({
      where: { id },
      include: { seats: true, commands: { orderBy: { seq: 'desc' }, take: 1 } },
    })
    if (!game) throw new NotFoundException(`no game ${id}`)

    const head = headOf(game.commands)

    /*
     * **Who this is comes from the token, never from the request body.** A client that could name its
     * own seat could take somebody else's turn, so `author` is not a field a caller may set — it is
     * looked up.
     */
    const author = await this.seatOfToken(id, token)

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
        message: head.awaiting === null
          ? 'this game is over'
          : `it is seat ${head.awaiting}'s turn, not seat ${author}'s`,
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
    const { tableau, dealer, history } = await this.replay(id, settings)
    const effects = body.effects ?? []

    // `author` is passed, so an effect reaching another seat's board is refused here and not merely
    // in a function somebody has to remember to call.
    const outcome = applyCommand(tableau, dealer, effects, author)
    if (!outcome.ok) {
      const refused = effects[outcome.refusedAt]
      throw new UnprocessableEntityException({
        message: `effect ${outcome.refusedAt} (${refused?.op}) is not a move this board allows`,
        index: outcome.refusedAt,
        op: refused?.op,
      })
    }

    /*
     * A round closes when every seat has passed, and the server is what decides it — the rule needs
     * to know about all the players, and only this side does. A client that passed and closed the
     * round itself would be right in a solo game and wrong in every other.
     */
    const passed = passedThisRound([...history, effects])
    const closing = passed.size >= settings.players

    const response = this.dealerResponse(tableau, dealer, settings, closing, roundsSoFar(history) + 1)

    try {
      const row = await this.prisma.command.create({
        data: {
          gameId: id,
          prevSeq: body.prevSeq,
          author,
          // Round the table. Seat order is join order, and seat zero plays first.
          awaiting: (author + 1) % settings.players,
          cmdId: body.cmdId,
          // Both halves in one row, and therefore one INSERT: a client must never be able to observe
          // a move landing without the deal it triggered.
          effects: effects as unknown as object,
          response: response as unknown as object,
        },
      })
      /*
       * Announced only once the row is safely stored. Watchers are told the head moved and fetch it
       * themselves — the socket carries a number, so a client that misses it is merely slower.
       */
      this.heads.moved(id, row.seq)
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
  private dealerResponse(
    tableau: Tableau,
    dealer: Dealer,
    settings: GameSettings,
    closing: boolean,
    round: number,
  ): LogEntry[] {
    const response: LogEntry[] = []
    const recorder = recordingTableau(tableau, entry => response.push(entry))

    /*
     * The bookmark goes in before anything else the server owes, and that ordering is the point: the
     * scoring panel cuts the log at `endRound` and shows the board as it stood then, so a lot dealt
     * for the next round must fall on the far side of the cut.
     */
    if (closing) return [{ op: 'endRound', round }]

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
  private async replay(
    gameId: string,
    settings: GameSettings,
  ): Promise<ReplayedGame & { history: LogEntry[][] }> {
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
    return { ...replayDealer(game?.seed ?? '', settings, commands), history: commands }
  }

  /**
   * Which seat a token belongs to.
   *
   * The only place a request's identity is decided. An unknown token is not a seat at this table and
   * gets nothing — including, deliberately, no hint about whether the game or the token was wrong.
   */
  private async seatOfToken(gameId: string, token: string): Promise<number> {
    const seat = token
      ? await this.prisma.seat.findUnique({
        where: { gameId_token: { gameId, token } },
        select: { seat: true },
      })
      : null
    if (!seat) throw new ForbiddenException('that is not a seat at this table')
    return seat.seat
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
    seats?: { seat: number, name: string | null, token: string | null, joined: Date | null }[]
    commands?: CommandRow[]
  }, token = ''): GameView {
    const settings = parseGameSettings(game.settings)
    if (!settings) throw new ConflictException(`game ${game.id} has settings this server cannot read`)
    return {
      id: game.id,
      seed: game.seed,
      settings,
      status: game.status as GameStatus,
      /*
       * Names and who has arrived, and nothing else. The token is read here and deliberately not
       * carried across — handing every player the others' tokens would give each of them the others'
       * turns, and it would happen through a `select` nobody looked at twice.
       */
      seats: [...(game.seats ?? [])]
        .sort((a, b) => a.seat - b.seat)
        .map(seat => ({ seat: seat.seat, name: seat.name ?? '', joined: seat.token !== null })),
      you: token ? game.seats?.find(seat => seat.token === token)?.seat ?? null : null,
      head: headOf(game.commands ?? []),
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
function headOf(commands: readonly { seq: number, awaiting: number | null }[]): Head {
  const last = commands[0]
  return last
    ? { seq: last.seq, awaiting: last.awaiting }
    : { seq: GENESIS, awaiting: FIRST_SEAT }
}
