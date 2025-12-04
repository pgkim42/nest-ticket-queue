import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import { QueueEntry, QueueEntryStatus } from '../queue/entities/queue-entry.entity';
import { RedisService } from '../redis/redis.service';
import { NotificationService } from '../notification/notification.service';
import { RESERVATION_EXPIRATION_QUEUE } from '../queue/queue.module';

const RESERVATION_TTL_SECONDS = 300; // 5 minutes

export interface ExpirationResult {
  processed: boolean;
  reason: 'expired' | 'already_processed' | 'not_pending' | 'not_found';
}

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepository: Repository<Reservation>,
    @InjectRepository(QueueEntry)
    private readonly queueEntryRepository: Repository<QueueEntry>,
    @InjectQueue(RESERVATION_EXPIRATION_QUEUE)
    private readonly expirationQueue: Queue,
    private readonly redisService: RedisService,
    private readonly notificationService: NotificationService,
  ) {}

  async createReservation(
    eventId: string,
    userId: string,
  ): Promise<Reservation> {
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_SECONDS * 1000);

    const reservation = this.reservationRepository.create({
      eventId,
      userId,
      status: ReservationStatus.PENDING_PAYMENT,
      expiresAt,
    });

    const savedReservation = await this.reservationRepository.save(reservation);

    // Schedule expiration job (delayed by 5 minutes)
    await this.expirationQueue.add(
      'expire-reservation',
      {
        reservationId: savedReservation.id,
        eventId,
        userId,
      },
      {
        delay: RESERVATION_TTL_SECONDS * 1000,
        jobId: `expire-${savedReservation.id}`,
      },
    );

    this.logger.log(
      `Created reservation ${savedReservation.id} for user ${userId}, expires at ${expiresAt.toISOString()}`,
    );

    return savedReservation;
  }

  async findById(id: string): Promise<Reservation | null> {
    return this.reservationRepository.findOne({ where: { id } });
  }

  async findByEventAndUser(
    eventId: string,
    userId: string,
  ): Promise<Reservation | null> {
    return this.reservationRepository.findOne({
      where: { eventId, userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Process payment for a reservation
   * 
   * Requirements: 6.1, 6.2, 6.3, 5.5
   * - Verify ownership and PENDING_PAYMENT status
   * - Verify not expired (expiresAt > now)
   * - Update status to PAID, set paidAt
   * - Update QueueEntry status to DONE
   */
  async processPayment(
    reservationId: string,
    userId: string,
  ): Promise<Reservation> {
    // Find the reservation
    const reservation = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });

    if (!reservation) {
      throw new NotFoundException('Reservation not found');
    }

    // Verify ownership (Requirement 6.3)
    if (reservation.userId !== userId) {
      throw new ForbiddenException('You are not authorized to pay for this reservation');
    }

    // Verify PENDING_PAYMENT status
    if (reservation.status !== ReservationStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        `Cannot process payment for reservation with status: ${reservation.status}`,
      );
    }

    // Verify not expired (Requirement 6.2)
    const now = new Date();
    if (now > reservation.expiresAt) {
      throw new BadRequestException('Reservation has expired');
    }

    // Update reservation status to PAID (Requirement 6.1)
    reservation.status = ReservationStatus.PAID;
    reservation.paidAt = now;
    const updatedReservation = await this.reservationRepository.save(reservation);

    // Update QueueEntry status to DONE (Requirement 5.5)
    await this.queueEntryRepository.update(
      { eventId: reservation.eventId, userId: reservation.userId },
      { status: QueueEntryStatus.DONE },
    );

    this.logger.log(
      `Payment processed for reservation ${reservationId}, user ${userId}`,
    );

    // Send WebSocket notification for payment success (Requirement 6.4)
    this.notificationService.notifyPaymentSuccess(userId, {
      reservationId,
      eventId: reservation.eventId,
      paidAt: updatedReservation.paidAt!,
    });

    return updatedReservation;
  }

  /**
   * Expire a reservation with idempotency
   * 
   * Requirements: 7.1, 7.2, 7.3, 4.4
   * - Check if still PENDING_PAYMENT
   * - Use Redis SETNX for idempotency lock (reservationExpired:{id})
   * - If first to expire: INCR seat, update status to EXPIRED, update QueueEntry to EXPIRED
   * - Returns whether the expiration was processed
   */
  async expireReservation(reservationId: string): Promise<ExpirationResult> {
    // Find the reservation
    const reservation = await this.reservationRepository.findOne({
      where: { id: reservationId },
    });

    if (!reservation) {
      this.logger.warn(`Reservation ${reservationId} not found for expiration`);
      return { processed: false, reason: 'not_found' };
    }

    // Check if still PENDING_PAYMENT (idempotent - skip if already processed)
    if (reservation.status !== ReservationStatus.PENDING_PAYMENT) {
      this.logger.debug(
        `Reservation ${reservationId} already processed (status: ${reservation.status})`,
      );
      return { processed: false, reason: 'not_pending' };
    }

    // Use Redis SETNX for idempotency lock (Requirement 7.3)
    // This ensures seat count is restored exactly once even with concurrent executions
    const isFirstToExpire = await this.redisService.setReservationExpired(reservationId);

    if (!isFirstToExpire) {
      this.logger.debug(
        `Reservation ${reservationId} already being expired by another process`,
      );
      return { processed: false, reason: 'already_processed' };
    }

    // First to expire - process the expiration
    try {
      // Restore seat count (Requirement 7.2)
      await this.redisService.incrementSeats(reservation.eventId);

      // Update reservation status to EXPIRED (Requirement 7.1)
      await this.reservationRepository.update(
        { id: reservationId },
        { status: ReservationStatus.EXPIRED },
      );

      // Update QueueEntry status to EXPIRED
      await this.queueEntryRepository.update(
        { eventId: reservation.eventId, userId: reservation.userId },
        { status: QueueEntryStatus.EXPIRED },
      );

      // Remove active user from Redis
      await this.redisService.removeActiveUser(
        reservation.eventId,
        reservation.userId,
      );

      this.logger.log(
        `Reservation ${reservationId} expired, seat restored for event ${reservation.eventId}`,
      );

      // Send WebSocket notification for reservation expiration (Requirement 7.4)
      this.notificationService.notifyReservationExpired(reservation.userId, {
        reservationId,
        eventId: reservation.eventId,
      });

      return { processed: true, reason: 'expired' };
    } catch (error) {
      this.logger.error(
        `Error expiring reservation ${reservationId}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Get the event ID for a reservation (used by processor for promotion trigger)
   */
  async getReservationEventId(reservationId: string): Promise<string | null> {
    const reservation = await this.reservationRepository.findOne({
      where: { id: reservationId },
      select: ['eventId'],
    });
    return reservation?.eventId ?? null;
  }
}
