import { Module } from '@nestjs/common'
import { PrismaService } from '../prisma.service'
import { DeskController } from './desk.controller'
import { DeskService } from './desk.service'

@Module({
  controllers: [DeskController],
  providers: [DeskService, PrismaService],
})
export class DeskModule {}
