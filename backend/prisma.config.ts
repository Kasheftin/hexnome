// Prisma 7 no longer loads .env by itself; the CLI needs it read before the config is evaluated.
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

type Env = { DATABASE_URL: string }

/**
 * Connection settings for the Prisma CLI — migrations, `db push`, Studio.
 *
 * Prisma 7 moved these out of `schema.prisma`, which now describes shape only. The running server
 * does not read this file: it passes a driver adapter to `PrismaClient` instead (see PrismaService).
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env<Env>('DATABASE_URL') },
})
