/**
 * Three routes, and nothing else.
 *
 * ```
 * POST /desk              { seed, copies, exclude? }  → { id, remaining }
 * POST /desk/:id/draw     { n }                       → { id, remaining, codes }
 * POST /desk/:id/discard  { codes } | [ … ]           → { id, remaining }
 * ```
 *
 * A code is 11–66: colour then value. That is the whole vocabulary — the service has no idea whether
 * the row it is serving holds a game's tiles or its plates, and does not need one.
 *
 * All three are POSTs, including the two that read like reads: drawing changes the desk, and so does
 * discarding. Nothing here is safe to repeat.
 */
import { Body, Controller, Param, Post } from '@nestjs/common'
import { createDeskBody, discardBody, drawBody } from './dto'
import { DeskService, type DeskSummary } from './desk.service'

@Controller('desk')
export class DeskController {
  constructor(private readonly desks: DeskService) {}

  @Post()
  create(@Body() raw: unknown): Promise<DeskSummary> {
    const { seed, copies, exclude } = createDeskBody(raw)
    return this.desks.create(seed, copies, exclude)
  }

  @Post(':id/draw')
  draw(@Param('id') id: string, @Body() raw: unknown): Promise<DeskSummary & { codes: readonly number[] }> {
    return this.desks.draw(id, drawBody(raw))
  }

  @Post(':id/discard')
  discard(@Param('id') id: string, @Body() raw: unknown): Promise<DeskSummary> {
    return this.desks.discard(id, discardBody(raw))
  }
}
