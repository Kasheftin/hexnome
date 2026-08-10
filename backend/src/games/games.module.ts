import { Module } from '@nestjs/common'
import { DeskModule } from '../desk/desk.module'
import { PrismaService } from '../prisma.service'
import { GamesController } from './games.controller'
import { GamesService } from './games.service'
import { HeadsGateway } from './heads.gateway'
import { TurnsService } from './turns.service'

@Module({
  // The desks, because a game builds two when it starts and deals from them for the rest of its life.
  imports: [DeskModule],
  controllers: [GamesController],
  providers: [GamesService, TurnsService, HeadsGateway, PrismaService],
  // Exported so `main.ts` can hand the gateway the HTTP server once that is listening.
  exports: [HeadsGateway],
})
export class GamesModule {}
