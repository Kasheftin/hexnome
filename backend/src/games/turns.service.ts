import { randomUUID } from 'node:crypto'
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { createAgenda } from '../rules/agenda'
import { boardCells } from '../rules/board'
import { tileCode, tileFromCode } from '../rules/desk'
import {
  applyCommand,
  canUndo,
  needsDeal,
  planUndo,
  replayGame,
  type Command,
  type GameOptions,
  type GameState,
} from '../rules/game'
import { parseGameSettings } from '../rules/gameSettings'
import { parseCommand } from '../rules/parseCommand'
import { SOURCE_TILES_PER_LOT } from '../rules/source'
import type { TileSpec } from '../rules/tableau'
import type { CommandRow, CommandSlice, SubmitResult } from '../rules/wire'
import { DeskService } from '../desk/desk.service'
import { PrismaService } from '../prisma.service'
import { HeadsGateway } from './heads.gateway'

/** The predecessor of the first command. Zero rather than null — see the schema. */
const GENESIS = 0

/** The server's own commands have no seat. Null rather than a reserved number. */
const SERVER_SEAT = null

/**
 * Turns: the log, and the only thing allowed to add to it.
 *
 * A game's board, drawers, source and score are all folded from these rows. Nothing else is stored,
 * so nothing else can disagree with them.
 *
 * ## The server is the authority, and this is where that becomes true
 *
 * A client says what it *wants* — draft these, place that, pass — and this decides. It folds the log,
 * runs the same `applyCommand` the client validated with, and refuses what the rules refuse. There is
 * one copy of that function and both ends compile it from the same file, so a move one accepts the
 * other accepts too; when they disagree it is because the client is out of date, and the answer is a
 * refusal rather than a divergence nobody notices.
 *
 * ## The deal is the server's, and cannot be asked for
 *
 * `deal` carries what the desk dealt. A client able to submit one would be choosing its own tiles, so
 * `parseCommand` refuses the word outright and the restock happens here: after every accepted turn,
 * while the source wants a lot, this draws from the game's own desk and appends the deal as its own
 * command. It is also the only arrangement that works — with one shared desk, two clients each
 * deciding the source needs filling would draw two lots.
 *
 * ## Folding costs nothing worth avoiding
 *
 * A four-round game is a few hundred commands, and folding them is a few hundred function calls
 * against arrays of tens. Re-folded on every submit, deliberately: a cached state is a second copy of
 * the truth, and this whole design exists to have one. Measure before caching.
 */
@Injectable()
export class TurnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly desks: DeskService,
    private readonly heads: HeadsGateway,
  ) {}

  /**
   * Everything after a cursor.
   *
   * **Rows first, and the head derived from them.** Reading the head separately leaves a window: a
   * command landing between the two queries is returned but not counted, and a client that advanced
   * its cursor to the head would fetch and apply it a second time. Attempt 1 had exactly that bug.
   */
  async since(gameId: string, cursor: number): Promise<CommandSlice> {
    const from = Number.isFinite(cursor) && cursor > 0 ? Math.floor(cursor) : GENESIS
    const rows = await this.prisma.command.findMany({
      where: { gameId, seq: { gt: from } },
      orderBy: { seq: 'asc' },
    })
    if (rows.length > 0) {
      const commands = rows.map(toRow)
      return { since: from, head: { seq: commands[commands.length - 1]!.seq }, commands }
    }
    // Nothing new, so the head has to be asked for — it is behind the cursor, not in front of it.
    return { since: from, head: await this.head(gameId), commands: [] }
  }

  /**
   * Take a turn.
   *
   * The order of what follows is load-bearing and is written out in `docs/tech-spec.md`. In short:
   * recognise a retry before calling anything stale, read the command before trusting it, fold before
   * believing it, and write the turn and its deal together.
   */
  async submit(gameId: string, cmdId: string, prevSeq: number, sent: unknown, token: string): Promise<SubmitResult> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { seats: true, commands: { orderBy: { seq: 'desc' }, take: 1 } },
    })
    if (!game) throw new NotFoundException(`no game ${gameId}`)

    const seat = game.seats.find(row => token !== '' && row.token === token)?.seat
    // Deliberately not saying whether the game or the token was wrong.
    if (seat === undefined) throw new ForbiddenException('that is not a seat at this table')
    if (game.status !== 'running') throw new ConflictException(`this game is ${game.status}`)

    /*
     * **Idempotency before staleness, and the order is the whole point.** A retry of a turn that did
     * land carries a `prevSeq` the head has already moved past, so testing staleness first would
     * answer every successful retry with a conflict — the one case `cmdId` exists to prevent.
     */
    const headSeq = game.commands[0]?.seq ?? GENESIS
    if (prevSeq !== headSeq) {
      const already = await this.written(gameId, cmdId)
      if (already) return { commands: already, duplicate: true }
      throw new ConflictException({ message: 'the log has moved on since you last read it', head: { seq: headSeq } })
    }

    // Shape first. `applyCommand` casts rather than checks, so an unread `to` would reach the model.
    const command = parseCommand(sent)
    if (!command) throw new UnprocessableEntityException('that is not a command this server can read')
    if (command.seat !== seat) throw new ForbiddenException(`that command claims seat ${command.seat}`)

    const options = this.optionsFor(game.id, game.settings)
    const log = await this.log(gameId)

    // An undo cancels commands rather than changing a position, so it does not go through
    // `applyCommand` at all. Its own path, ending in the same append and the same announcement.
    if (command.kind === 'undo') return this.takeBack(game, options, log, prevSeq, cmdId, seat)

    const state = replayGame(options, log)

    const played = applyCommand(state, command)
    if (!played.ok) throw new UnprocessableEntityException(played.error)

    // Whatever the turn left the source wanting.
    const dealt = await this.restock(game, state)

    const written = await this.append(gameId, prevSeq, [
      { author: seat, cmdId, command },
      ...dealt.map(deal => ({ author: SERVER_SEAT, cmdId: randomUUID(), command: deal })),
    ], cmdId)
    if (written.duplicate) return written

    // The pile is the desk's, and the state cannot reach it — see `CommandResult.toDesk`.
    await this.returnToDesk(game, played.toDesk)
    if (state.finished) {
      await this.prisma.game.updateMany({ where: { id: gameId, status: 'running' }, data: { status: 'finished' } })
    }
    /*
     * **Everything is announced, tidying included.**
     *
     * An arrange used to be silent, on the reasoning that a player sorting their drawer should not
     * wake every tab at the table to deliver something only a peeking opponent would see. That was
     * wrong, and it cost a turn several times a game.
     *
     * A command that is not announced still moves the head, and the chain requires a turn to name
     * the current head as its parent. So a silent arrange left every other client holding a cursor
     * it did not know was stale, and the next player to act got a 409 — up to fifteen seconds later,
     * because with a live socket that is how long the backstop poll takes to notice. Reproduced
     * exactly: one player rearranges, the other passes a second later and the pass is refused; wait
     * seventeen seconds first and the same pass lands.
     *
     * The nudge is what keeps everyone's cursor current, which is not decoration on a chain that
     * refuses stale writes. Coalescing on the client (`GameView.ARRANGE_SETTLE_MS`) is what keeps
     * this to one message per rearrangement rather than one per dropped tile.
     */
    await this.announce(gameId)
    return written
  }

  /**
   * Take the last turn back.
   *
   * **The desks are the whole of the work.** Everything else undo touches is derived: append the row
   * and every client's next fold rebuilds the position without being told anything more, because
   * `effectiveLog` resolves the undo away and the state is only ever the log's meaning. The two bags
   * are the exception — mutable rows that no fold can reach — so this hands them back exactly what the
   * cancelled commands took from them and gave them.
   *
   * ## The order, which is load-bearing
   *
   * The desks are rewound **before** the row is written, and that is deliberate. A rewind can be
   * refused — the bag may have reshuffled past the point this turn left it — and a refusal has to
   * leave the game exactly as it was. Writing first would mean a log that says the turn was taken back
   * and bags that still hold it, which is the one state nothing downstream could repair.
   *
   * The cost is the opposite failure: bags rewound and then the append lost to a race. That is the
   * lesser of the two — it costs a lot's worth of supply and no correctness, which is the same trade
   * `open()` already makes and says so.
   */
  private async takeBack(
    game: { id: string, tileDeskId: string | null, plateDeskId: string | null },
    options: GameOptions,
    log: Command[],
    prevSeq: number,
    cmdId: string,
    seat: number,
  ): Promise<SubmitResult> {
    if (!canUndo(options, log)) {
      throw new UnprocessableEntityException('there is no turn to take back')
    }

    const plan = planUndo(options, log)

    /*
     * Both bags, before anything is written. `rewind` refuses rather than forcing, so a bag that has
     * moved past this turn leaves the game untouched and the player is told the turn is gone.
     */
    if (game.tileDeskId) {
      await this.desks.rewind(game.tileDeskId, {
        drew: plan.dealt.tiles.map(tileCode),
        returned: plan.returned.tiles.map(tileCode),
      })
    }
    if (game.plateDeskId) {
      await this.desks.rewind(game.plateDeskId, {
        drew: plan.dealt.plates.map(tileCode),
        returned: plan.returned.plates.map(tileCode),
      })
    }

    const written = await this.append(
      game.id,
      prevSeq,
      [{ author: seat, cmdId, command: { kind: 'undo', seat } }],
      cmdId,
    )
    if (!written.duplicate) await this.announce(game.id)
    return written
  }

  /**
   * The first lot, written the moment a game starts.
   *
   * A started game has to be playable on arrival: the first turn is a draft, and without this there
   * would be nothing to draft from. It used to be dealt by the client on mount — which is precisely
   * the arrangement that dealt two lots when two clients mounted.
   *
   * Called from `GamesService.startIfFull`, once the desks exist. Racing joins can both reach that
   * point; the chain settles it here, because this names `prevSeq: 0` and only one command may.
   */
  async open(gameId: string): Promise<void> {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } })
    if (!game) throw new NotFoundException(`no game ${gameId}`)

    const state = replayGame(this.optionsFor(game.id, game.settings), [])
    const dealt = await this.restock(game, state)
    if (dealt.length === 0) return

    try {
      await this.append(
        gameId,
        GENESIS,
        dealt.map(deal => ({ author: SERVER_SEAT, cmdId: randomUUID(), command: deal })),
        '',
      )
    } catch (error) {
      // Another join opened it first. Its lot is the one that counts, and the tiles this drew are
      // simply gone from the bag — which costs a lot's worth of supply and no correctness.
      if (!(error instanceof ConflictException)) throw error
    }
  }

  /**
   * Fill the source until it stops asking, applying each lot as it lands.
   *
   * One lot at a time and `needsDeal` before each, because a tile is gone from the desk whether or
   * not it lands anywhere and that precondition is the only guard there is.
   */
  private async restock(
    game: { id: string, tileDeskId: string | null, plateDeskId: string | null },
    state: GameState,
  ): Promise<Command[]> {
    const dealt: Command[] = []
    while (needsDeal(state)) {
      const lot = await this.drawLot(game)
      if (!lot) break
      const answer = applyCommand(state, lot)
      // A deal the state will not take is a bug here rather than a client's fault — and the tiles
      // have left the desk either way, so it is better said out loud than swallowed.
      if (!answer.ok) throw new ConflictException(`the deal was refused: ${answer.error}`)
      dealt.push(lot)
    }
    return dealt
  }

  /** Where the chain ends. Zero for a game nobody has played yet, which is what a first turn names. */
  private async head(gameId: string): Promise<{ seq: number }> {
    const last = await this.prisma.command.findFirst({
      where: { gameId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    })
    return { seq: last?.seq ?? GENESIS }
  }

  private async log(gameId: string): Promise<Command[]> {
    const rows = await this.prisma.command.findMany({ where: { gameId }, orderBy: { seq: 'asc' } })
    return rows.map(row => row.command as unknown as Command)
  }

  /** The rows a `cmdId` already wrote, in order — a recognised retry. */
  private async written(gameId: string, cmdId: string): Promise<CommandRow[] | null> {
    const mine = await this.prisma.command.findFirst({ where: { gameId, cmdId } })
    if (!mine) return null
    /*
     * The turn *and* the deals behind it. They were written together and the caller has seen neither,
     * so handing back only the row bearing its id would lose the restock.
     */
    const rows = await this.prisma.command.findMany({
      where: { gameId, prevSeq: { gte: mine.prevSeq }, seq: { gte: mine.seq } },
      orderBy: { seq: 'asc' },
    })
    return rows.map(toRow)
  }

  /**
   * Write the turn and its deals as one chain.
   *
   * In a transaction, so a reader cannot see a turn without the deal it caused. The unique violation
   * is caught rather than pre-empted: the insert is what adjudicates, and looking the command id up
   * afterwards is what tells this caller's own retry from a race it lost. Which index complained does
   * not say — two callers sending one command at once violate both, and MySQL reports whichever it
   * checked first.
   */
  private async append(
    gameId: string,
    prevSeq: number,
    entries: readonly { author: number | null, cmdId: string, command: Command }[],
    cmdId: string,
  ): Promise<SubmitResult> {
    try {
      const written: CommandRow[] = []
      await this.prisma.$transaction(async (tx) => {
        let parent = prevSeq
        for (const entry of entries) {
          const row = await tx.command.create({
            data: {
              gameId,
              prevSeq: parent,
              author: entry.author,
              cmdId: entry.cmdId,
              command: entry.command as unknown as object,
            },
          })
          parent = row.seq
          written.push(toRow(row))
        }
      })
      return { commands: written, duplicate: false }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const already = await this.written(gameId, cmdId)
      if (already) return { commands: already, duplicate: true }
      throw new ConflictException({
        message: 'another command took this place first',
        head: await this.head(gameId),
      })
    }
  }

  /** One lot, drawn from the game's own desks. Null when either bag is too short to fill it. */
  private async drawLot(game: { id: string, tileDeskId: string | null, plateDeskId: string | null }): Promise<Command | null> {
    if (!game.tileDeskId || !game.plateDeskId) return null
    try {
      const plate = await this.desks.draw(game.plateDeskId, 1)
      const tiles = await this.desks.draw(game.tileDeskId, SOURCE_TILES_PER_LOT)
      return { kind: 'deal', plate: specOf(plate.codes[0] as number), tiles: tiles.codes.map(specOf) }
    } catch {
      // A bag too short to fill a lot is the end of the supply, not an error: the round plays on with
      // what is showing. Anything else here would also have to be survivable, for the same reason.
      return null
    }
  }

  private async returnToDesk(
    game: { tileDeskId: string | null, plateDeskId: string | null },
    owed: { tiles: readonly TileSpec[], plates: readonly TileSpec[] },
  ): Promise<void> {
    if (game.tileDeskId && owed.tiles.length) {
      await this.desks.discard(game.tileDeskId, owed.tiles.map(tileCode))
    }
    if (game.plateDeskId && owed.plates.length) {
      await this.desks.discard(game.plateDeskId, owed.plates.map(tileCode))
    }
  }

  /** Move the game on, so every watcher knows to look. Same nudge a join sends. */
  private async announce(gameId: string): Promise<void> {
    const game = await this.prisma.game.update({ where: { id: gameId }, data: { seq: { increment: 1 } } })
    this.heads.moved(gameId, game.seq)
  }

  /**
   * Everything the rules need to fold this game.
   *
   * Every input is the server's own or derived from what it holds. `gameId` is the *public* seed —
   * the opening plates and the petal stream — and is deliberately not `game.seed`, which the desks
   * are built from and which never leaves this process.
   */
  private optionsFor(gameId: string, stored: unknown): GameOptions {
    const settings = parseGameSettings(stored)
    if (!settings) throw new ConflictException(`game ${gameId} has settings this server cannot read`)
    return {
      settings,
      gameId,
      cells: boardCells(),
      sourceTilesPerLot: SOURCE_TILES_PER_LOT,
      agenda: createAgenda(gameId, settings.mode),
    }
  }

  /** The state a game's log means. For the specs, and for anything that wants to look. */
  async stateOf(gameId: string): Promise<GameState> {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } })
    if (!game) throw new NotFoundException(`no game ${gameId}`)
    return replayGame(this.optionsFor(game.id, game.settings), await this.log(gameId))
  }
}

function toRow(row: { seq: number, prevSeq: number, author: number | null, cmdId: string, command: unknown }): CommandRow {
  return {
    seq: row.seq,
    prevSeq: row.prevSeq,
    author: row.author,
    cmdId: row.cmdId,
    command: row.command as Command,
  }
}

function specOf(code: number): TileSpec {
  const spec = tileFromCode(code)
  if (!spec) throw new ConflictException(`${code} is not a tile code`)
  return spec
}

/**
 * A duplicate-key error, whichever index complained.
 *
 * Deliberately not split by index, though the two mean opposite things — one is a race this caller
 * lost, the other is its own retry. Two callers sending one command at once violate both, and MySQL
 * reports whichever it checked first; looking the command id up afterwards settles it properly.
 */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
}
