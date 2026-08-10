/**
 * Three routes, and nothing else.
 *
 * ```
 * POST /desk              { gameId, kind }             → { id, remaining }
 * POST /desk/:id/draw     { n }                       → { id, remaining, codes }
 * POST /desk/:id/discard  { codes } | [ … ]           → { id, remaining }
 * ```
 *
 * A code is 11–66: colour then value. That is the whole vocabulary once a desk exists — the row has
 * no idea whether it holds a game's tiles or its plates. `kind` is only how the *builder* is told
 * which of a game's two bags to make.
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
    const { gameId, kind } = createDeskBody(raw)
    return this.desks.create(gameId, kind)
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
