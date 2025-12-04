import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Event } from './entities/event.entity';
import { Reservation, ReservationStatus } from '../reservations/entities/reservation.entity';
import { RedisService } from '../redis/redis.service';
import { CreateEventDto } from './dto/create-event.dto';
import { EventStatsDto, ReservationCountsByStatusDto } from './dto/event-stats.dto';

// Type alias for backward compatibility
type ReservationCountsByStatus = ReservationCountsByStatusDto;

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
    @InjectRepository(Reservation)
    private readonly reservationRepository: Repository<Reservation>,
    private readonly redisService: RedisService,
  ) {}

  async create(createEventDto: CreateEventDto): Promise<Event> {
    const event = this.eventRepository.create(createEventDto);
    const savedEvent = await this.eventRepository.save(event);

    // Initialize Redis seat counter (Requirement 1.4)
    await this.redisService.initializeSeats(savedEvent.id, savedEvent.totalSeats);

    return savedEvent;
  }

  async findAll(): Promise<(Event & { remainingSeats: number })[]> {
    const events = await this.eventRepository.find();
    
    const eventsWithSeats = await Promise.all(
      events.map(async (event) => {
        const remainingSeats = await this.redisService.getRemainingSeats(event.id);
        return { ...event, remainingSeats };
      }),
    );

    return eventsWithSeats;
  }

  async findById(id: string): Promise<Event & { remainingSeats: number }> {
    const event = await this.eventRepository.findOne({ where: { id } });
    
    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }

    const remainingSeats = await this.redisService.getRemainingSeats(id);
    return { ...event, remainingSeats };
  }

  /**
   * Get statistics for an event (admin only)
   * 
   * Requirements: 10.1, 10.2, 10.3
   * - Return remaining seats count from Redis
   * - Return current queue length
   * - Return reservation counts grouped by status (PENDING_PAYMENT, PAID, EXPIRED)
   */
  async getStats(eventId: string): Promise<EventStatsDto> {
    // Verify event exists
    const event = await this.eventRepository.findOne({ where: { id: eventId } });
    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    // Get remaining seats from Redis (Requirement 10.1)
    const remainingSeats = await this.redisService.getRemainingSeats(eventId);

    // Get queue length from Redis (Requirement 10.2)
    const queueLength = await this.redisService.getQueueLength(eventId);

    // Get reservation counts by status (Requirement 10.3)
    const reservationCounts = await this.getReservationCountsByStatus(eventId);

    return {
      eventId,
      remainingSeats,
      queueLength,
      reservationCounts,
    };
  }

  private async getReservationCountsByStatus(
    eventId: string,
  ): Promise<ReservationCountsByStatus> {
    const counts = await this.reservationRepository
      .createQueryBuilder('reservation')
      .select('reservation.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('reservation.eventId = :eventId', { eventId })
      .groupBy('reservation.status')
      .getRawMany<{ status: ReservationStatus; count: string }>();

    const result: ReservationCountsByStatus = {
      PENDING_PAYMENT: 0,
      PAID: 0,
      EXPIRED: 0,
    };

    for (const row of counts) {
      if (row.status === ReservationStatus.PENDING_PAYMENT) {
        result.PENDING_PAYMENT = parseInt(row.count, 10);
      } else if (row.status === ReservationStatus.PAID) {
        result.PAID = parseInt(row.count, 10);
      } else if (row.status === ReservationStatus.EXPIRED) {
        result.EXPIRED = parseInt(row.count, 10);
      }
    }

    return result;
  }
}
