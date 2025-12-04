import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueEntry } from './entities/queue-entry.entity';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { QueuePromotionProcessor } from './processors/queue-promotion.processor';
import { ReservationExpirationProcessor } from './processors/reservation-expiration.processor';
import { RedisModule } from '../redis/redis.module';
import { EventsModule } from '../events/events.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { NotificationModule } from '../notification/notification.module';

export const RESERVATION_EXPIRATION_QUEUE = 'reservation-expiration';

@Module({
  imports: [
    TypeOrmModule.forFeature([QueueEntry]),
    RedisModule,
    EventsModule,
    ScheduleModule.forRoot(),
    forwardRef(() => ReservationsModule),
    NotificationModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    BullModule.registerQueue({
      name: RESERVATION_EXPIRATION_QUEUE,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    }),
  ],
  controllers: [QueueController],
  providers: [QueueService, QueuePromotionProcessor, ReservationExpirationProcessor],
  exports: [BullModule, QueueService, QueuePromotionProcessor, ReservationExpirationProcessor],
})
export class QueueModule {}
