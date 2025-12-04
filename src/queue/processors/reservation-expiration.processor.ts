import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job } from 'bullmq';
import { ReservationsService } from '../../reservations/reservations.service';
import { QueuePromotionProcessor } from './queue-promotion.processor';

export interface ReservationExpirationJobData {
  reservationId: string;
  eventId: string;
  userId: string;
}

/**
 * Reservation Expiration Processor
 * 
 * Processes BullMQ delayed jobs for reservation expiration.
 * Implements idempotent expiration with seat restoration.
 * Triggers next user promotion after expiration (Requirement 4.4).
 * 
 * Requirements: 7.1, 7.2, 7.3, 4.4
 */
@Processor('reservation-expiration')
export class ReservationExpirationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReservationExpirationProcessor.name);

  constructor(
    @Inject(forwardRef(() => ReservationsService))
    private readonly reservationsService: ReservationsService,
    private readonly queuePromotionProcessor: QueuePromotionProcessor,
  ) {
    super();
  }

  async process(job: Job<ReservationExpirationJobData>): Promise<void> {
    const { reservationId, eventId } = job.data;

    this.logger.log(
      `Processing reservation expiration job: ${reservationId}`,
    );

    try {
      // Call the idempotent expiration method
      const result = await this.reservationsService.expireReservation(reservationId);

      if (result.processed) {
        this.logger.log(
          `Reservation ${reservationId} expired successfully, triggering promotion`,
        );

        // Trigger next user promotion after expiration (Requirement 4.4)
        await this.queuePromotionProcessor.triggerPromotionOnSlotAvailable(eventId);
      } else {
        this.logger.debug(
          `Reservation ${reservationId} expiration skipped: ${result.reason}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error processing expiration for reservation ${reservationId}`,
        error,
      );
      throw error; // Re-throw to trigger BullMQ retry
    }
  }
}
