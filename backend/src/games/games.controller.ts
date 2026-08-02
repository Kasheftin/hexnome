import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import type { AppendBody, AppendResult, CreateGameBody, GameView, LogSlice } from './dto'
import { GamesService } from './games.service'

/**
 * A game is its journal, so the API is small: make one, read it, read what has happened, add to it.
 *
 * There is no endpoint for the board — it is derived by replaying the log, on whichever side needs
 * it. Adding one would mean two descriptions of the same thing, free to disagree.
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

  @Get(':id/log')
  log(@Param('id') id: string, @Query('since') since?: string): Promise<LogSlice> {
    return this.games.log(id, Number(since ?? 0))
  }

  @Post(':id/log')
  append(@Param('id') id: string, @Body() body: AppendBody): Promise<AppendResult> {
    return this.games.append(id, body.entries ?? [], body.expectedSeq)
  }
}
