/**
 * One route.
 *
 * ```
 * GET /highscores  ?preset=&players=&limit=&offset=  → HighscorePage
 * ```
 *
 * No authentication, because a board is public by definition — it is the one place in this server
 * whose whole purpose is to be read by people who hold nothing at all. What that costs is stated in
 * the wire type: no game id goes out, so a board is not a way into the games behind it.
 *
 * `@Query()` whole rather than parameter by parameter, so the four arrive together and are read by
 * one function. The alternative — four `@Query('name')` strings — spreads the validation across a
 * signature, which is the thing `dto.ts` exists to stop.
 */
import { Controller, Get, Query } from '@nestjs/common'
import type { HighscorePage } from '../rules/wire'
import { highscoreQuery } from './dto'
import { HighscoresService } from './highscores.service'

@Controller('highscores')
export class HighscoresController {
  constructor(private readonly highscores: HighscoresService) {}

  @Get()
  find(@Query() raw: Record<string, unknown>): Promise<HighscorePage> {
    return this.highscores.find(highscoreQuery(raw))
  }
}
