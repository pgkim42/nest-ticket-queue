import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueueEntry, QueueEntryStatus } from './entities/queue-entry.entity';
import { RedisService } from '../redis/redis.service';
import { EventsService } from '../events/events.service';
import { ReservationsService } from '../reservations/reservations.service';
import { QueueStatusDto, JoinQueueResponseDto } from './dto/queue-status.dto';
import { Reservation } from '../reservations/entities/reservation.entity';

const ACTIVE_USER_TTL_SECONDS = 300; // 5 minutes

export interface PromotionResult {
  success: boolean;
  userId: string;
  reservation?: Reservation;
  reason?: 'promoted' | 'sold_out' | 'no_users_in_queue';
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectRepository(QueueEntry)
    private readonly queueEntryRepository: Repository<QueueEntry>,
    private readonly redisService: RedisService,
    private readonly eventsService: EventsService,
    @Inject(forwardRef(() => ReservationsService))
    private readonly reservationsService: ReservationsService,
  ) {}

  async joinQueue(eventId: string, userId: string): Promise<JoinQueueResponseDto> {
    // Validate event exists and get sales period
    const event = await this.eventsService.findById(eventId);
    const now = new Date();

    // Validate sales period (Requirements 2.3, 2.4)
    if (now < event.salesStartAt) {
      throw new BadRequestException('Sales have not started yet');
    }
    if (now > event.salesEndAt) {
      throw new BadRequestException('Sales have ended');
    }

    // Check for existing queue entry (idempotency - Requirement 2.2)
    const existingEntry = await this.queueEntryRepository.findOne({
      where: { eventId, userId },
    });

    if (existingEntry) {
      // Return existing position without creating duplicate
      const position = await this.redisService.getQueuePosition(eventId, userId);
      return {
        position: position ?? existingEntry.position,
        status: existingEntry.status,
        eventId,
        message: 'Already in queue',
      };
    }

    // Add to Redis queue (Requirement 2.1)
    const position = await this.redisService.addToQueue(eventId, userId);

    // Create QueueEntry in DB (Requirement 2.5)
    const queueEntry = this.queueEntryRepository.create({
      eventId,
      userId,
      status: QueueEntryStatus.WAITING,
      position,
    });
    await this.queueEntryRepository.save(queueEntry);

    return {
      position,
      status: QueueEntryStatus.WAITING,
      eventId,
      message: 'Successfully joined queue',
    };
  }


  async getQueueStatus(eventId: string, userId: string): Promise<QueueStatusDto> {
    // Find queue entry in DB
    const queueEntry = await this.queueEntryRepository.findOne({
      where: { eventId, userId },
    });

    if (!queueEntry) {
      throw new NotFoundException('Not in queue for this event');
    }

    // Get current position from Redis (Requirement 3.1)
    const position = await this.redisService.getQueuePosition(eventId, userId);

    const response: QueueStatusDto = {
      position: position ?? queueEntry.position,
      status: queueEntry.status,
      eventId,
    };

    // Include remaining time if ACTIVE (Requirement 3.3)
    if (queueEntry.status === QueueEntryStatus.ACTIVE && queueEntry.reservationId) {
      // The expiresAt will be fetched from the reservation in a later task
      // For now, we'll return the basic status
    }

    return response;
  }

  async findQueueEntry(eventId: string, userId: string): Promise<QueueEntry | null> {
    return this.queueEntryRepository.findOne({
      where: { eventId, userId },
    });
  }

  async getQueueLength(eventId: string): Promise<number> {
    return this.redisService.getQueueLength(eventId);
  }

  /**
   * Promotes the next user in queue to ACTIVE status with reservation creation.
   * 
   * This method implements the critical path for queue promotion:
   * 1. Get next user from queue (FIFO order)
   * 2. Atomically decrement seats using Redis DECR
   * 3. If seats available (result >= 0): Create reservation, set ACTIVE
   * 4. If sold out (result < 0): Restore seat count with INCR, mark as EXPIRED
   * 
   * Requirements: 4.1, 4.2, 4.4, 5.1, 5.2, 5.3
   */
  async promoteNextUser(eventId: string): Promise<PromotionResult> {
    // Get next user from queue (FIFO - Requirement 4.1)
    const nextUserId = await this.redisService.getNextInQueue(eventId);

    if (!nextUserId) {
      return {
        success: false,
        userId: '',
        reason: 'no_users_in_queue',
      };
    }

    // Atomically decrement seats (Requirement 5.1)
    const remainingSeats = await this.redisService.decrementSeats(eventId);

    if (remainingSeats >= 0) {
      // Seats available - create reservation and promote user
      return this.handleSuccessfulPromotion(eventId, nextUserId);
    } else {
      // Sold out - restore seat count and mark user as expired (Requirement 5.3)
      return this.handleSoldOut(eventId, nextUserId);
    }
  }

  /**
   * Handles successful promotion when seats are available.
   * Creates reservation and updates user status to ACTIVE.
   */
  private async handleSuccessfulPromotion(
    eventId: string,
    userId: string,
  ): Promise<PromotionResult> {
    try {
      // Create reservation with 5-minute expiration (Requirement 4.2)
      const reservation = await this.reservationsService.createReservation(
        eventId,
        userId,
      );

      // Update QueueEntry status to ACTIVE
      await this.queueEntryRepository.update(
        { eventId, userId },
        {
          status: QueueEntryStatus.ACTIVE,
          reservationId: reservation.id,
        },
      );

      // Remove from Redis queue
      await this.redisService.removeFromQueue(eventId, userId);

      // Set active user in Redis with TTL (Requirement 4.2)
      await this.redisService.setActiveUser(
        eventId,
        userId,
        ACTIVE_USER_TTL_SECONDS,
      );

      this.logger.log(
        `User ${userId} promoted to ACTIVE for event ${eventId}, reservation ${reservation.id}`,
      );

      return {
        success: true,
        userId,
        reservation,
        reason: 'promoted',
      };
    } catch (error) {
      // If reservation creation fails, restore the seat
      await this.redisService.incrementSeats(eventId);
      this.logger.error(
        `Failed to create reservation for user ${userId}: ${error}`,
      );
      throw error;
    }
  }

  /**
   * Handles sold out scenario by restoring seat count and marking user as expired.
   */
  private async handleSoldOut(
    eventId: string,
    userId: string,
  ): Promise<PromotionResult> {
    // Restore seat count (Requirement 5.3)
    await this.redisService.incrementSeats(eventId);

    // Update QueueEntry status to EXPIRED (sold out)
    await this.queueEntryRepository.update(
      { eventId, userId },
      { status: QueueEntryStatus.EXPIRED },
    );

    // Remove from Redis queue
    await this.redisService.removeFromQueue(eventId, userId);

    this.logger.log(
      `User ${userId} marked as EXPIRED (sold out) for event ${eventId}`,
    );

    return {
      success: false,
      userId,
      reason: 'sold_out',
    };
  }

  /**
   * Promotes multiple users up to the specified count.
   * Respects the concurrent ACTIVE user limit.
   */
  async promoteUsers(
    eventId: string,
    maxActiveUsers: number,
  ): Promise<PromotionResult[]> {
    const results: PromotionResult[] = [];
    const currentActiveCount = await this.redisService.getActiveCount(eventId);
    const slotsAvailable = Math.max(0, maxActiveUsers - currentActiveCount);

    for (let i = 0; i < slotsAvailable; i++) {
      const result = await this.promoteNextUser(eventId);
      results.push(result);

      // Stop if no more users in queue or sold out
      if (
        result.reason === 'no_users_in_queue' ||
        result.reason === 'sold_out'
      ) {
        break;
      }
    }

    return results;
  }
}
