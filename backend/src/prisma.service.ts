import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from './generated/prisma/client'

/**
 * The database connection, as a Nest provider.
 *
 * Prisma 7 takes a **driver adapter** rather than a connection string: the URL in
 * `prisma.config.ts` is for the CLI, and the running server builds its own pool here. The MariaDB
 * adapter is the supported one for MySQL.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set — copy backend/.env.example to backend/.env')
    super({ adapter: new PrismaMariaDb(url) })
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
