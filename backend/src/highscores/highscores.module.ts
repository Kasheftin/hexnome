import { Module } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { HighscoresController } from './highscores.controller'
import { HighscoresService } from './highscores.service'

@Module({
  controllers: [HighscoresController],
  providers: [HighscoresService, PrismaService],
})
export class HighscoresModule {}
