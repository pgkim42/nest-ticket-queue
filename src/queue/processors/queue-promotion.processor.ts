import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { QueueService } from '../queue.service';
import { EventsService } from '../../events/events.service';

/**
 * Queue Promotion Processor
 * 
 * Implements scheduler-based periodic promotion check (Option A from design).
 * Respects concurrent ACTIVE user limit to prevent system overload.
 * 
 * Requirements: 4.4, 4.5
 */
@Injectable()
export class QueuePromotionProcessor {
  private readonly logger = new Logger(QueuePromotionProcessor.name);
  private readonly maxActiveUsers: number;

  constructor(
    private readonly queueService: QueueService,
    private readonly eventsService: EventsService,
    private readonly configService: ConfigService,
  ) {
    this.maxActiveUsers = this.configService.get<number>('MAX_ACTIVE_USERS', 10);
  }

  /**
   * Periodic promotion check - runs every 5 seconds
   * Promotes waiting users to ACTIVE status while respecting limits
   */
  @Cron(CronExpression.EVERY_5_SECONDS)
  async handlePromotionCheck(): Promise<void> {
    this.logger.debug('Running queue promotion check...');

    try {
      // Get all active events (events with ongoing sales)
      const events = await this.eventsService.findAll();
      const now = new Date();

      const activeEvents = events.filter(
        (event) => event.salesStartAt <= now && event.salesEndAt >= now,
      );

      for (const event of activeEvents) {
        await this.promoteUsersForEvent(event.id);
      }
    } catch (error) {
      this.logger.error('Error during promotion check', error);
    }
  }

  /**
   * Promotes users for a specific event
   * Called by scheduler or triggered when a slot becomes available
   */
  async promoteUsersForEvent(eventId: string): Promise<void> {
    try {
      const results = await this.queueService.promoteUsers(
        eventId,
        this.maxActiveUsers,
      );

      const promoted = results.filter((r) => r.reason === 'promoted');
      const soldOut = results.filter((r) => r.reason === 'sold_out');

      if (promoted.length > 0) {
        this.logger.log(
          `Promoted ${promoted.length} users for event ${eventId}`,
        );
      }

      if (soldOut.length > 0) {
        this.logger.log(
          `${soldOut.length} users marked as sold out for event ${eventId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Error promoting users for event ${eventId}`,
        error,
      );
    }
  }

  /**
   * Trigger promotion when a slot becomes available
   * Called when a reservation expires or is completed
   */
  async triggerPromotionOnSlotAvailable(eventId: string): Promise<void> {
    this.logger.debug(`Slot available for event ${eventId}, triggering promotion`);
    await this.promoteUsersForEvent(eventId);
  }
}
