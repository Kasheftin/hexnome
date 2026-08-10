/**
 * Three routes, and nothing else.
 *
 * ```
 * POST /games                { settings, name? }        → { seat, token, game }
 * GET  /games/:id            Authorization: Seat …      → GameView
 * POST /games/:id/join       { name? }                  → { seat, token, game }
 * GET  /games/:id/commands   ?since=N                   → CommandSlice
 * POST /games/:id/commands   { cmdId, prevSeq, command } → SubmitResult
 * ```
 *
 * The two that hand out a seat are the only responses a **token** ever appears in. Everything else
 * about a game is public to whoever holds its id — reading a table is not a privilege, and the id is
 * already the capability to do it — so both `GET`s need no authentication. The token a read may carry
 * only decides which seat comes back as `you`.
 *
 * Submitting is the exception, and the only one: the seat is derived from the token and nothing in
 * the body may name it. A client that could say which seat it was could take somebody else's turn.
 *
 * A submit answers three ways and a client should tell them apart: the rows it just wrote; the rows
 * it wrote *last time*, when a retry is recognised (`duplicate: true`); or a 409 carrying the real
 * head, meaning catch up and reconsider before trying again.
 */
import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common'
import type { CommandSlice, GameView, SeatClaim, SubmitResult } from '../rules/wire'
import { createGameBody, joinBody, seatToken, submitBody } from './dto'
import { GamesService } from './games.service'
import { TurnsService } from './turns.service'

@Controller('games')
export class GamesController {
  constructor(
    private readonly games: GamesService,
    private readonly turns: TurnsService,
  ) {}

  @Post()
  create(@Body() raw: unknown): Promise<SeatClaim> {
    return this.games.create(createGameBody(raw))
  }

  @Get(':id')
  find(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<GameView> {
    return this.games.find(id, seatToken(authorization))
  }

  @Post(':id/join')
  join(@Param('id') id: string, @Body() raw: unknown): Promise<SeatClaim> {
    return this.games.join(id, joinBody(raw).name)
  }

  /** Everything after a cursor. `since=0`, or a missing one, means the whole log. */
  @Get(':id/commands')
  commands(@Param('id') id: string, @Query('since') since?: string): Promise<CommandSlice> {
    return this.turns.since(id, Number(since ?? 0))
  }

  @Post(':id/commands')
  submit(
    @Param('id') id: string,
    @Body() raw: unknown,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<SubmitResult> {
    const { cmdId, prevSeq, command } = submitBody(raw)
    return this.turns.submit(id, cmdId, prevSeq, command, seatToken(authorization))
  }
}
