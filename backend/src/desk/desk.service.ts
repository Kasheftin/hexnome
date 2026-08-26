/**
 * The desk, as a stored thing.
 *
 * Deliberately thin: load the row, call the pure function from `../rules/desk`, write it back.
 * Everything about *how a bag behaves* — the build order, the reshuffle seed, what may be discarded —
 * lives in the rules package where it can be tested without a database, and is the same code the
 * conservation spec drives. What this file adds is storage, identity and the one piece of real
 * engineering below.
 *
 * ## The conditional write
 *
 * Two requests against one desk would otherwise both read the same state and both write it back, and
 * the second would silently undo the first: a tile dealt twice, with nothing anywhere to notice. So
 * every write is `UPDATE … WHERE id = ? AND version = ?`, and a write that matches no row means
 * somebody else moved first — a 409, not a corrupted bag.
 *
 * The client serialises its own calls (frontend/src/composables/useDesk.ts), so this should never
 * fire in normal play. It is here because "should never" is not a guarantee, and the failure it
 * prevents is invisible.
 */
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { openingPlateCodes } from '../rules/deck'
import {
  createDesk,
  deskRemaining,
  discardToDesk,
  drawFromDesk,
  undiscardFromDesk,
  undrawFromDesk,
  type DeskState,
} from '../rules/desk'
import { parseGameSettings } from '../rules/gameSettings'
import { dealKeyOf } from '../games/dealKey'
import type { DeskKind } from '../rules/wire'
import { PrismaService } from '../prisma.service'

/** What every route answers with, on top of whatever it drew. */
export interface DeskSummary {
  readonly id: string
  /** Still drawable: the bag plus the pile. */
  readonly remaining: number
}

@Injectable()
export class DeskService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build one of a game's two desks, from the game.
   *
   * Everything the bag needs is a fact about the game, and the client states none of it: the order
   * comes from the game's own seed, which never leaves the server, and how many copies from its
   * settings. A client that cannot say what it is dealt from cannot predict it either, which is the
   * whole point of the bag living here.
   *
   * ## Two seeds, and they are not interchangeable
   *
   * The **order** comes from `game.seed`, the secret. The plates to hold back come from `game.id`,
   * the *public* one — because the client works out the same opening plates for itself when it lays
   * out the boards, and it can only do that from something it knows. They must agree exactly or the
   * bag would deal a plate that is already on somebody's board. Hence the id here, deliberately, and
   * not the seed a line above it.
   */
  async create(gameId: string, kind: DeskKind): Promise<DeskSummary> {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } })
    if (!game) throw new NotFoundException(`no game ${gameId}`)

    const settings = parseGameSettings(game.settings)
    if (!settings) throw new ConflictException(`game ${gameId} has settings this server cannot read`)

    const copies = kind === 'tiles' ? settings.tileCopies : settings.plateCopies
    const exclude = kind === 'plates'
      ? openingPlateCodes(dealKeyOf(game), settings.players)
      : []

    // Distinct per kind, so one game's two desks deal different orders from one secret.
    const seed = `${game.seed}:${kind}`
    const built = createDesk(seed, { copies, exclude })
    // A refusal here is the game's fault — an unbuildable bag, not a missing row.
    if (!built.ok) throw new ConflictException(built.error)

    const id = crypto.randomUUID()
    await this.prisma.desk.create({
      data: { id, seed, config: built.value as unknown as object },
    })
    return { id, remaining: deskRemaining(built.value) }
  }

  async draw(id: string, n: number): Promise<DeskSummary & { codes: readonly number[] }> {
    const { state, version } = await this.load(id)
    const result = drawFromDesk(state, n)
    if (!result.ok) throw new ConflictException(result.error)

    await this.save(id, version, result.value.state)
    return { id, remaining: deskRemaining(result.value.state), codes: result.value.codes }
  }

  async discard(id: string, codes: readonly number[]): Promise<DeskSummary> {
    const { state, version } = await this.load(id)
    const result = discardToDesk(state, codes)
    if (!result.ok) throw new ConflictException(result.error)

    /*
     * An empty batch changes nothing, so it must not be written.
     *
     * Not merely a wasted round trip: the write bumps the version, and a request already in flight
     * against this desk would then lose the conditional update and get a 409 — refused because of a
     * call that did nothing. The desk is still loaded first, so an unknown id is still a 404.
     */
    if (codes.length > 0) await this.save(id, version, result.value)
    return { id, remaining: deskRemaining(result.value) }
  }

  /**
   * Hand a turn's dealings back: the pile batch off the top, then the draw onto the front.
   *
   * **Both desks, both directions, one call** — because a half-reversed desk is worse than a refused
   * undo. The two happen in the reverse of the order a turn played them: `submit` draws its restock
   * and *then* discards what the turn spent, so taking it back lifts the batch off the pile first.
   * They commute unless a reshuffle sits between them, and that is exactly the case that must not
   * quietly half-succeed.
   *
   * Refuses rather than forcing. `undrawFromDesk` will not cross a reshuffle it cannot rule out, and
   * `undiscardFromDesk` will not lift a batch that is no longer on top — see `../rules/desk`. Either
   * refusal means the bag has moved beyond where this turn left it, and the honest answer is that the
   * turn cannot be taken back.
   */
  async rewind(
    id: string,
    { drew, returned }: { drew: readonly number[], returned: readonly number[] },
  ): Promise<DeskSummary> {
    const { state, version } = await this.load(id)

    const unpiled = undiscardFromDesk(state, returned)
    if (!unpiled.ok) throw new ConflictException(unpiled.error)

    const undrawn = undrawFromDesk(unpiled.value, drew)
    if (!undrawn.ok) throw new ConflictException(undrawn.error)

    // One write for both halves, so the version check adjudicates the whole rewind or none of it.
    if (drew.length > 0 || returned.length > 0) await this.save(id, version, undrawn.value)
    return { id, remaining: deskRemaining(undrawn.value) }
  }

  private async load(id: string): Promise<{ state: DeskState, version: number }> {
    const row = await this.prisma.desk.findUnique({ where: { id } })
    if (!row) throw new NotFoundException(`no desk ${id}`)
    return { state: row.config as unknown as DeskState, version: row.version }
  }

  private async save(id: string, version: number, state: DeskState): Promise<void> {
    const { count } = await this.prisma.desk.updateMany({
      where: { id, version },
      data: { version: version + 1, config: state as unknown as object },
    })
    // `updateMany` rather than `update` on purpose: it reports how many rows matched instead of
    // throwing on none, which is what makes the version check readable as a check.
    if (count === 0) throw new ConflictException('the desk moved on; retry with a fresh read')
  }
}
