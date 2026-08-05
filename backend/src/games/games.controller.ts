import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common'
import type { Response } from 'express'
import type {
  CommandSlice,
  CreateGameBody,
  GameView,
  JoinBody,
  SeatClaim,
  SubmitBody,
  SubmitResult,
} from './dto'
import { GamesService } from './games.service'

/**
 * The seat token, out of the `Authorization` header.
 *
 * A header rather than the body, because it is credentials and not content: it does not belong in a
 * log of what was posted, and it should be as awkward to copy into a command by accident as possible.
 */
function seatToken(header: string | undefined): string {
  const [scheme, value] = (header ?? '').split(' ')
  return scheme?.toLowerCase() === 'seat' ? (value ?? '') : ''
}


/**
 * A game is its journal, so the API is small: make one, read it, read what has happened, add to it.
 *
 * There is no endpoint for the board — it is derived by replaying the commands, on whichever side
 * needs it. Adding one would mean two descriptions of the same thing, free to disagree.
 *
 * `POST /games/:id/commands` answers three ways, and a client should tell them apart: the row it just
 * wrote; the row it wrote *last time*, when a retry is recognised (`duplicate: true`); or a `409`
 * carrying the real head, meaning catch up and reconsider before trying again.
 */
@Controller('games')
export class GamesController {
  constructor(private readonly games: GamesService) {}

  /** Makes the game, seats the creator, and hands back the one token they will ever be given. */
  @Post()
  create(@Body() body: CreateGameBody): Promise<SeatClaim> {
    return this.games.create(body)
  }

  /** Takes the lowest free seat. The claim that fills the table starts the game. */
  @Post(':id/join')
  join(@Param('id') id: string, @Body() body: JoinBody): Promise<SeatClaim> {
    return this.games.join(id, body ?? {})
  }

  /** Optionally authenticated: a token names which seat is yours, and its absence means spectator. */
  @Get(':id')
  find(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<GameView> {
    return this.games.find(id, seatToken(authorization))
  }

  @Get(':id/commands')
  commands(@Param('id') id: string, @Query('since') since?: string): Promise<CommandSlice> {
    return this.games.commands(id, Number(since ?? 0))
  }

  /**
   * `201` when a command was written, `200` when a retry was recognised.
   *
   * `duplicate` says the same thing in the body, but a `201` for something that was not created is a
   * lie the transport layer tells — and anything counting writes by status code (a retry policy, a
   * metric, a log) would believe it. `passthrough` sets the status without taking over the response,
   * so the handler still returns its DTO.
   */
  @Post(':id/commands')
  async submit(
    @Param('id') id: string,
    @Body() body: SubmitBody,
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SubmitResult> {
    const result = await this.games.submit(id, body, seatToken(authorization))
    res.status(result.duplicate ? HttpStatus.OK : HttpStatus.CREATED)
    return result
  }
}
