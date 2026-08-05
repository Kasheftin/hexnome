import { Body, Controller, Get, HttpStatus, Param, Post, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import type { CommandSlice, CreateGameBody, GameView, SubmitBody, SubmitResult } from './dto'
import { GamesService } from './games.service'

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

  @Post()
  create(@Body() body: CreateGameBody): Promise<GameView> {
    return this.games.create(body)
  }

  @Get(':id')
  find(@Param('id') id: string): Promise<GameView> {
    return this.games.find(id)
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
    @Res({ passthrough: true }) res: Response,
  ): Promise<SubmitResult> {
    const result = await this.games.submit(id, body)
    res.status(result.duplicate ? HttpStatus.OK : HttpStatus.CREATED)
    return result
  }
}
