import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { RESERVATION_EXPIRATION_QUEUE } from '../queue.module';

export interface ReservationExpirationJobData {
  reservationId: string;
  eventId: string;
  userId: string;
}

@Processor(RESERVATION_EXPIRATION_QUEUE)
export class ReservationExpirationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReservationExpirationProcessor.name);

  async process(job: Job<ReservationExpirationJobData>): Promise<void> {
    this.logger.log(
      `Processing reservation expiration job: ${job.data.reservationId}`,
    );

    // Actual expiration logic will be implemented in ReservationService
    // This processor will call the service method
    // For now, just log the job data
    this.logger.log(`Reservation ${job.data.reservationId} expiration check`);
  }
}
