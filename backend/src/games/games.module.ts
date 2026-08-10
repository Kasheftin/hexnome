import { Module } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { GamesController } from './games.controller'
import { GamesService } from './games.service'
import { HeadsGateway } from './heads.gateway'

@Module({
  controllers: [GamesController],
  providers: [GamesService, HeadsGateway, PrismaService],
  // Exported so `main.ts` can hand it the HTTP server once that is listening.
  exports: [HeadsGateway],
})
export class GamesModule {}
