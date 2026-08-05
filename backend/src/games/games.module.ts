import { Module } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { GamesController } from './games.controller'
import { GamesService } from './games.service'
import { HeadsGateway } from './heads.gateway'

@Module({
  controllers: [GamesController],
  providers: [GamesService, PrismaService, HeadsGateway],
  exports: [GamesService, HeadsGateway],
})
export class GamesModule {}
