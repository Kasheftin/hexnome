/**
 * Three routes, and nothing else.
 *
 * ```
 * POST /games            { settings, name? }   → { seat, token, game }
 * GET  /games/:id        Authorization: Seat … → GameView
 * POST /games/:id/join   { name? }             → { seat, token, game }
 * ```
 *
 * The two that hand out a seat are the only responses a **token** ever appears in. Everything else
 * about a game is public to whoever holds its id — reading a table is not a privilege, and the id is
 * already the capability to do it — so `GET` needs no authentication. The token it may carry only
 * decides which seat comes back as `you`.
 */
import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common'
import type { GameView, SeatClaim } from '../rules/wire'
import { createGameBody, joinBody, seatToken } from './dto'
import { GamesService } from './games.service'

@Controller('games')
export class GamesController {
  constructor(private readonly games: GamesService) {}

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
}
