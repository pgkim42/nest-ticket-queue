import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Reservation } from './entities/reservation.entity';
import { QueueEntry } from '../queue/entities/queue-entry.entity';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';
import { QueueModule, RESERVATION_EXPIRATION_QUEUE } from '../queue/queue.module';
import { RedisModule } from '../redis/redis.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reservation, QueueEntry]),
    forwardRef(() => QueueModule),
    RedisModule,
    NotificationModule,
    BullModule.registerQueue({
      name: RESERVATION_EXPIRATION_QUEUE,
    }),
  ],
  controllers: [ReservationsController],
  providers: [ReservationsService],
  exports: [TypeOrmModule, ReservationsService],
})
export class ReservationsModule {}
