import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reservation } from './entities/reservation.entity';
import { ReservationsService } from './reservations.service';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reservation]),
    forwardRef(() => QueueModule),
  ],
  providers: [ReservationsService],
  exports: [TypeOrmModule, ReservationsService],
})
export class ReservationsModule {}
