import { Controller, Get } from '@nestjs/common'
import { TILE_COLOR_COUNT, createDeck } from '@hexnome/rules/deck'

/**
 * Proof of life, and proof the rules package is genuinely usable here.
 *
 * The deck figures are not decoration: they are computed by the same `createDeck` the browser calls,
 * from the same source, so a mismatch between client and server would show up as a wrong number
 * rather than as a subtle disagreement about what a game is.
 */
@Controller()
export class HealthController {
  @Get('health')
  health(): { status: string, rules: { colors: number, plates: number, tiles: number } } {
    const deck = createDeck('health-check')
    return {
      status: 'ok',
      rules: {
        colors: TILE_COLOR_COUNT,
        plates: deck.plates.length,
        tiles: deck.tiles.length,
      },
    }
  }
}
