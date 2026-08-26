import { join } from 'node:path'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { DeskModule } from './desk/desk.module'
import { GamesModule } from './games/games.module'
import { HighscoresModule } from './highscores/highscores.module'
import { HealthController } from './health.controller'
import { PrismaService } from './prisma.service'

/**
 * The env file, found relative to the code rather than to whoever launched it.
 *
 * A bare `.env` is resolved against the working directory, so the server starts from `backend/` and
 * fails from the workspace root — with "DATABASE_URL is not set", which points at the wrong thing
 * entirely. `dist/app.module.js` is one level under `backend/`, and so is `src/app.module.ts`, so the
 * same hop up works compiled or not.
 */
const ENV_FILE = join(__dirname, '..', '.env')

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ENV_FILE }), DeskModule, GamesModule, HighscoresModule],
  controllers: [HealthController],
  providers: [PrismaService],
})
export class AppModule {}
