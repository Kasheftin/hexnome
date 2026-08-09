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
import {
  createDesk,
  deskRemaining,
  discardToDesk,
  drawFromDesk,
  type DeskState,
} from '../rules/desk'
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

  async create(seed: string, copies: number, exclude: readonly number[]): Promise<DeskSummary> {
    const built = createDesk(seed, { copies, exclude })
    // A refusal here is the caller's fault — an unbuildable bag, not a missing row.
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

    await this.save(id, version, result.value)
    return { id, remaining: deskRemaining(result.value) }
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
