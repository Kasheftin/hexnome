import { Module } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { DeskController } from './desk.controller'
import { DeskService } from './desk.service'

@Module({
  controllers: [DeskController],
  providers: [DeskService, PrismaService],
  // The games module deals from these on the server's own account — see `TurnsService`.
  exports: [DeskService],
})
export class DeskModule {}
