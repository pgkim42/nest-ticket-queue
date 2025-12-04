import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventsService } from './events.service';
import { Event } from './entities/event.entity';
import { RedisService } from '../redis/redis.service';
import { CreateEventDto } from './dto/create-event.dto';

/**
 * **Feature: nest-ticket-queue, Property 1: Event Creation Initializes Redis Counter**
 * **Validates: Requirements 1.4**
 *
 * For any valid event creation request with totalSeats = N,
 * after the event is created, the Redis counter `remainingSeats:{eventId}`
 * SHALL equal N.
 */
describe('Property 1: Event Creation Initializes Redis Counter', () => {
  let eventsService: EventsService;
  let redisSeatsStore: Map<string, number>;

  beforeEach(async () => {
    redisSeatsStore = new Map<string, number>();

    const mockEventRepository = {
      create: jest.fn((dto: CreateEventDto) => ({
        id: `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        ...dto,
        salesStartAt: new Date(dto.salesStartAt),
        salesEndAt: new Date(dto.salesEndAt),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      save: jest.fn((event: Event) => Promise.resolve(event)),
    };

    const mockRedisService = {
      initializeSeats: jest.fn((eventId: string, count: number) => {
        redisSeatsStore.set(eventId, count);
        return Promise.resolve();
      }),
      getRemainingSeats: jest.fn((eventId: string) => {
        return Promise.resolve(redisSeatsStore.get(eventId) ?? 0);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        {
          provide: getRepositoryToken(Event),
          useValue: mockEventRepository,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    eventsService = module.get<EventsService>(EventsService);
  });

  it('should initialize Redis counter with totalSeats for any valid event', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate valid event name
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        // Generate valid totalSeats (positive integer)
        fc.integer({ min: 1, max: 100000 }),
        // Generate valid sales period using timestamp range
        fc.integer({ min: 1704067200000, max: 1893456000000 }), // 2024-01-01 to 2030-01-01 in ms
        fc.integer({ min: 1, max: 365 }), // days after start
        async (name, totalSeats, salesStartTimestamp, daysAfterStart) => {
          const salesStartAt = new Date(salesStartTimestamp);
          const salesEndAt = new Date(salesStartTimestamp + daysAfterStart * 24 * 60 * 60 * 1000);

          const createEventDto: CreateEventDto = {
            name: name.trim(),
            totalSeats,
            salesStartAt: salesStartAt.toISOString(),
            salesEndAt: salesEndAt.toISOString(),
          };

          const createdEvent = await eventsService.create(createEventDto);

          // Property: Redis counter should equal totalSeats
          const redisSeats = redisSeatsStore.get(createdEvent.id);
          expect(redisSeats).toBe(totalSeats);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should maintain correct Redis counter for multiple event creations', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate array of events with different totalSeats
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
            totalSeats: fc.integer({ min: 1, max: 10000 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (eventConfigs) => {
          const createdEvents: Event[] = [];
          const baseDate = new Date('2025-01-01');

          for (const config of eventConfigs) {
            const salesEndAt = new Date(baseDate);
            salesEndAt.setDate(salesEndAt.getDate() + 30);

            const createEventDto: CreateEventDto = {
              name: config.name.trim(),
              totalSeats: config.totalSeats,
              salesStartAt: baseDate.toISOString(),
              salesEndAt: salesEndAt.toISOString(),
            };

            const event = await eventsService.create(createEventDto);
            createdEvents.push(event);
          }

          // Property: Each event's Redis counter should match its totalSeats
          for (let i = 0; i < createdEvents.length; i++) {
            const event = createdEvents[i];
            const expectedSeats = eventConfigs[i].totalSeats;
            const actualSeats = redisSeatsStore.get(event.id);
            expect(actualSeats).toBe(expectedSeats);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
