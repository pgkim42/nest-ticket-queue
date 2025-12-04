import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueEntry, QueueEntryStatus } from './entities/queue-entry.entity';
import { RedisService } from '../redis/redis.service';
import { EventsService } from '../events/events.service';
import { ReservationsService } from '../reservations/reservations.service';
import { NotificationService } from '../notification/notification.service';

const mockNotificationService = {
  notifyQueuePosition: jest.fn(),
  notifyActiveStatus: jest.fn(),
  notifySoldOut: jest.fn(),
  notifyReservationExpired: jest.fn(),
  notifyPaymentSuccess: jest.fn(),
};

/**
 * **Feature: nest-ticket-queue, Property 2: Queue Join Idempotency**
 * **Validates: Requirements 2.2**
 *
 * For any user U and event E, if U joins the queue for E multiple times,
 * the queue length SHALL increase by exactly 1 (on first join only),
 * and all subsequent join calls SHALL return the same position.
 */
describe('Property 2: Queue Join Idempotency', () => {
  let queueService: QueueService;
  let redisQueueStore: Map<string, Map<string, number>>; // eventId -> (userId -> timestamp)
  let dbQueueEntries: Map<string, QueueEntry>; // `${eventId}:${userId}` -> QueueEntry

  beforeEach(async () => {
    redisQueueStore = new Map();
    dbQueueEntries = new Map();

    const mockQueueEntryRepository = {
      findOne: jest.fn(({ where }: { where: { eventId: string; userId: string } }) => {
        const key = `${where.eventId}:${where.userId}`;
        return Promise.resolve(dbQueueEntries.get(key) || null);
      }),
      create: jest.fn((data: Partial<QueueEntry>) => ({
        id: `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      save: jest.fn((entry: QueueEntry) => {
        const key = `${entry.eventId}:${entry.userId}`;
        dbQueueEntries.set(key, entry);
        return Promise.resolve(entry);
      }),
    };

    const mockRedisService = {
      addToQueue: jest.fn((eventId: string, userId: string) => {
        if (!redisQueueStore.has(eventId)) {
          redisQueueStore.set(eventId, new Map());
        }
        const queue = redisQueueStore.get(eventId)!;
        // NX behavior: only add if not exists
        if (!queue.has(userId)) {
          queue.set(userId, Date.now());
        }
        // Calculate position (1-indexed)
        const sortedUsers = Array.from(queue.entries())
          .sort((a, b) => a[1] - b[1])
          .map(([uid]) => uid);
        return Promise.resolve(sortedUsers.indexOf(userId) + 1);
      }),
      getQueuePosition: jest.fn((eventId: string, userId: string) => {
        const queue = redisQueueStore.get(eventId);
        if (!queue || !queue.has(userId)) return Promise.resolve(null);
        const sortedUsers = Array.from(queue.entries())
          .sort((a, b) => a[1] - b[1])
          .map(([uid]) => uid);
        return Promise.resolve(sortedUsers.indexOf(userId) + 1);
      }),
      getQueueLength: jest.fn((eventId: string) => {
        const queue = redisQueueStore.get(eventId);
        return Promise.resolve(queue ? queue.size : 0);
      }),
    };


    const mockEventsService = {
      findById: jest.fn((eventId: string) => {
        // Return a valid event with current sales period
        const now = new Date();
        const salesStartAt = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
        const salesEndAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1 day from now
        return Promise.resolve({
          id: eventId,
          name: 'Test Event',
          totalSeats: 100,
          salesStartAt,
          salesEndAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }),
    };

    const mockReservationsService = {
      createReservation: jest.fn(),
      findById: jest.fn(),
      findByEventAndUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: getRepositoryToken(QueueEntry),
          useValue: mockQueueEntryRepository,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: EventsService,
          useValue: mockEventsService,
        },
        {
          provide: ReservationsService,
          useValue: mockReservationsService,
        },
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    queueService = module.get<QueueService>(QueueService);
  });

  it('should return same position for multiple join attempts by same user', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // eventId
        fc.uuid(), // userId
        fc.integer({ min: 2, max: 10 }), // number of join attempts
        async (eventId, userId, joinAttempts) => {
          const positions: number[] = [];
          const queueLengths: number[] = [];

          for (let i = 0; i < joinAttempts; i++) {
            const result = await queueService.joinQueue(eventId, userId);
            positions.push(result.position);
            queueLengths.push(await queueService.getQueueLength(eventId));
          }

          // Property: All positions should be the same
          const firstPosition = positions[0];
          expect(positions.every((p) => p === firstPosition)).toBe(true);

          // Property: Queue length should be exactly 1 (only one entry)
          expect(queueLengths.every((len) => len === 1)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should increase queue length by exactly 1 on first join only', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // eventId
        fc.array(fc.uuid(), { minLength: 1, maxLength: 20 }), // userIds
        async (eventId, userIds) => {
          // Make userIds unique
          const uniqueUserIds = [...new Set(userIds)];
          
          for (const userId of uniqueUserIds) {
            const lengthBefore = await queueService.getQueueLength(eventId);
            
            // First join
            await queueService.joinQueue(eventId, userId);
            const lengthAfterFirst = await queueService.getQueueLength(eventId);
            
            // Second join (should be idempotent)
            await queueService.joinQueue(eventId, userId);
            const lengthAfterSecond = await queueService.getQueueLength(eventId);

            // Property: First join increases length by 1
            expect(lengthAfterFirst).toBe(lengthBefore + 1);
            
            // Property: Second join does not change length
            expect(lengthAfterSecond).toBe(lengthAfterFirst);
          }

          // Property: Final queue length equals number of unique users
          const finalLength = await queueService.getQueueLength(eventId);
          expect(finalLength).toBe(uniqueUserIds.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * **Feature: nest-ticket-queue, Property 3: Sales Period Enforcement**
 * **Validates: Requirements 2.3, 2.4**
 *
 * For any event E with salesStartAt and salesEndAt, and any timestamp T:
 * - If T < salesStartAt, queue join SHALL be rejected
 * - If T > salesEndAt, queue join SHALL be rejected
 * - If salesStartAt <= T <= salesEndAt, queue join SHALL be accepted
 */
describe('Property 3: Sales Period Enforcement', () => {
  let queueService: QueueService;
  let mockEventsService: { findById: jest.Mock };
  let redisQueueStore: Map<string, Map<string, number>>;
  let dbQueueEntries: Map<string, QueueEntry>;

  beforeEach(async () => {
    redisQueueStore = new Map();
    dbQueueEntries = new Map();

    const mockQueueEntryRepository = {
      findOne: jest.fn(({ where }: { where: { eventId: string; userId: string } }) => {
        const key = `${where.eventId}:${where.userId}`;
        return Promise.resolve(dbQueueEntries.get(key) || null);
      }),
      create: jest.fn((data: Partial<QueueEntry>) => ({
        id: `queue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      save: jest.fn((entry: QueueEntry) => {
        const key = `${entry.eventId}:${entry.userId}`;
        dbQueueEntries.set(key, entry);
        return Promise.resolve(entry);
      }),
    };

    const mockRedisService = {
      addToQueue: jest.fn((eventId: string, userId: string) => {
        if (!redisQueueStore.has(eventId)) {
          redisQueueStore.set(eventId, new Map());
        }
        const queue = redisQueueStore.get(eventId)!;
        if (!queue.has(userId)) {
          queue.set(userId, Date.now());
        }
        const sortedUsers = Array.from(queue.entries())
          .sort((a, b) => a[1] - b[1])
          .map(([uid]) => uid);
        return Promise.resolve(sortedUsers.indexOf(userId) + 1);
      }),
      getQueuePosition: jest.fn((eventId: string, userId: string) => {
        const queue = redisQueueStore.get(eventId);
        if (!queue || !queue.has(userId)) return Promise.resolve(null);
        const sortedUsers = Array.from(queue.entries())
          .sort((a, b) => a[1] - b[1])
          .map(([uid]) => uid);
        return Promise.resolve(sortedUsers.indexOf(userId) + 1);
      }),
      getQueueLength: jest.fn((eventId: string) => {
        const queue = redisQueueStore.get(eventId);
        return Promise.resolve(queue ? queue.size : 0);
      }),
    };

    mockEventsService = {
      findById: jest.fn(),
    };

    const mockReservationsService = {
      createReservation: jest.fn(),
      findById: jest.fn(),
      findByEventAndUser: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: getRepositoryToken(QueueEntry),
          useValue: mockQueueEntryRepository,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: EventsService,
          useValue: mockEventsService,
        },
        {
          provide: ReservationsService,
          useValue: mockReservationsService,
        },
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    queueService = module.get<QueueService>(QueueService);
  });

  it('should reject queue join before sales start', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // eventId
        fc.uuid(), // userId
        fc.integer({ min: 1, max: 365 }), // days before sales start
        async (eventId, userId, daysBefore) => {
          const now = new Date();
          const salesStartAt = new Date(now.getTime() + daysBefore * 24 * 60 * 60 * 1000);
          const salesEndAt = new Date(salesStartAt.getTime() + 7 * 24 * 60 * 60 * 1000);

          mockEventsService.findById.mockResolvedValue({
            id: eventId,
            name: 'Future Event',
            totalSeats: 100,
            salesStartAt,
            salesEndAt,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Property: Join should be rejected with "Sales have not started yet"
          await expect(queueService.joinQueue(eventId, userId)).rejects.toThrow(
            BadRequestException,
          );
          await expect(queueService.joinQueue(eventId, userId)).rejects.toThrow(
            'Sales have not started yet',
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should reject queue join after sales end', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // eventId
        fc.uuid(), // userId
        fc.integer({ min: 1, max: 365 }), // days after sales end
        async (eventId, userId, daysAfter) => {
          const now = new Date();
          const salesEndAt = new Date(now.getTime() - daysAfter * 24 * 60 * 60 * 1000);
          const salesStartAt = new Date(salesEndAt.getTime() - 7 * 24 * 60 * 60 * 1000);

          mockEventsService.findById.mockResolvedValue({
            id: eventId,
            name: 'Past Event',
            totalSeats: 100,
            salesStartAt,
            salesEndAt,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Property: Join should be rejected with "Sales have ended"
          await expect(queueService.joinQueue(eventId, userId)).rejects.toThrow(
            BadRequestException,
          );
          await expect(queueService.joinQueue(eventId, userId)).rejects.toThrow(
            'Sales have ended',
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should accept queue join during sales period', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // eventId
        fc.uuid(), // userId
        fc.integer({ min: 1, max: 30 }), // days into sales period
        fc.integer({ min: 31, max: 60 }), // total sales period days
        async (eventId, userId, daysInto, totalDays) => {
          // Clear previous entries for this test
          redisQueueStore.clear();
          dbQueueEntries.clear();

          const now = new Date();
          const salesStartAt = new Date(now.getTime() - daysInto * 24 * 60 * 60 * 1000);
          const salesEndAt = new Date(salesStartAt.getTime() + totalDays * 24 * 60 * 60 * 1000);

          mockEventsService.findById.mockResolvedValue({
            id: eventId,
            name: 'Active Event',
            totalSeats: 100,
            salesStartAt,
            salesEndAt,
            createdAt: new Date(),
            updatedAt: new Date(),
          });

          // Property: Join should succeed during sales period
          const result = await queueService.joinQueue(eventId, userId);
          expect(result.position).toBeGreaterThan(0);
          expect(result.status).toBe(QueueEntryStatus.WAITING);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * **Feature: nest-ticket-queue, Property 4: Queue Promotion FIFO Order**
 * **Validates: Requirements 4.1**
 *
 * For any queue with users [U1, U2, ..., Un] who joined in that order,
 * when K users are promoted to ACTIVE, the promoted users SHALL be
 * exactly [U1, U2, ..., Uk] in that order.
 */
describe('Property 4: Queue Promotion FIFO Order', () => {
  let queueService: QueueService;
  let redisQueueStore: Map<string, { userId: string; order: number }[]>;
  let redisSeatCounters: Map<string, number>;
  let redisActiveUsers: Map<string, Set<string>>;
  let dbQueueEntries: Map<string, QueueEntry>;
  let orderCounter: number;

  beforeEach(async () => {
    redisQueueStore = new Map();
    redisSeatCounters = new Map();
    redisActiveUsers = new Map();
    dbQueueEntries = new Map();
    orderCounter = 0;

    const mockQueueEntryRepository = {
      findOne: jest.fn(({ where }: { where: { eventId: string; userId: string } }) => {
        const key = `${where.eventId}:${where.userId}`;
        return Promise.resolve(dbQueueEntries.get(key) || null);
      }),
      create: jest.fn((data: Partial<QueueEntry>) => ({
        id: `queue-${orderCounter}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      save: jest.fn((entry: QueueEntry) => {
        const key = `${entry.eventId}:${entry.userId}`;
        dbQueueEntries.set(key, entry);
        return Promise.resolve(entry);
      }),
      update: jest.fn(
        (
          criteria: { eventId: string; userId: string },
          data: Partial<QueueEntry>,
        ) => {
          const key = `${criteria.eventId}:${criteria.userId}`;
          const existing = dbQueueEntries.get(key);
          if (existing) {
            dbQueueEntries.set(key, { ...existing, ...data });
          }
          return Promise.resolve({ affected: existing ? 1 : 0 });
        },
      ),
    };

    const mockRedisService = {
      addToQueue: jest.fn((eventId: string, userId: string) => {
        if (!redisQueueStore.has(eventId)) {
          redisQueueStore.set(eventId, []);
        }
        const queue = redisQueueStore.get(eventId)!;
        // NX behavior: only add if not exists
        const existing = queue.find((u) => u.userId === userId);
        if (!existing) {
          queue.push({ userId, order: orderCounter++ });
        }
        // Sort by order and return position (1-indexed)
        queue.sort((a, b) => a.order - b.order);
        return Promise.resolve(queue.findIndex((u) => u.userId === userId) + 1);
      }),
      getQueuePosition: jest.fn((eventId: string, userId: string) => {
        const queue = redisQueueStore.get(eventId);
        if (!queue) return Promise.resolve(null);
        const idx = queue.findIndex((u) => u.userId === userId);
        return Promise.resolve(idx >= 0 ? idx + 1 : null);
      }),
      getQueueLength: jest.fn((eventId: string) => {
        const queue = redisQueueStore.get(eventId);
        return Promise.resolve(queue ? queue.length : 0);
      }),
      getNextInQueue: jest.fn((eventId: string) => {
        const queue = redisQueueStore.get(eventId);
        if (!queue || queue.length === 0) return Promise.resolve(null);
        queue.sort((a, b) => a.order - b.order);
        return Promise.resolve(queue[0].userId);
      }),
      removeFromQueue: jest.fn((eventId: string, userId: string) => {
        const queue = redisQueueStore.get(eventId);
        if (queue) {
          const idx = queue.findIndex((u) => u.userId === userId);
          if (idx >= 0) queue.splice(idx, 1);
        }
        return Promise.resolve();
      }),
      decrementSeats: jest.fn((eventId: string) => {
        const current = redisSeatCounters.get(eventId) ?? 0;
        const newValue = current - 1;
        redisSeatCounters.set(eventId, newValue);
        return Promise.resolve(newValue);
      }),
      incrementSeats: jest.fn((eventId: string) => {
        const current = redisSeatCounters.get(eventId) ?? 0;
        const newValue = current + 1;
        redisSeatCounters.set(eventId, newValue);
        return Promise.resolve(newValue);
      }),
      setActiveUser: jest.fn((eventId: string, userId: string) => {
        if (!redisActiveUsers.has(eventId)) {
          redisActiveUsers.set(eventId, new Set());
        }
        redisActiveUsers.get(eventId)!.add(userId);
        return Promise.resolve();
      }),
      getActiveCount: jest.fn((eventId: string) => {
        const active = redisActiveUsers.get(eventId);
        return Promise.resolve(active ? active.size : 0);
      }),
    };

    const mockEventsService = {
      findById: jest.fn((eventId: string) => {
        const now = new Date();
        return Promise.resolve({
          id: eventId,
          name: 'Test Event',
          totalSeats: 100,
          salesStartAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          salesEndAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }),
    };

    const mockReservationsService = {
      createReservation: jest.fn((eventId: string, userId: string) => {
        const reservation = {
          id: `res-${orderCounter}`,
          eventId,
          userId,
          status: 'PENDING_PAYMENT',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        };
        return Promise.resolve(reservation);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: getRepositoryToken(QueueEntry),
          useValue: mockQueueEntryRepository,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: EventsService,
          useValue: mockEventsService,
        },
        {
          provide: ReservationsService,
          useValue: mockReservationsService,
        },
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    queueService = module.get<QueueService>(QueueService);
  });

  it('should promote users in FIFO order based on join time', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // eventId
        fc.array(fc.uuid(), { minLength: 3, maxLength: 10 }), // userIds
        fc.integer({ min: 1, max: 5 }), // number of users to promote
        async (eventId, userIds, promoteCount) => {
          // Reset state for each test
          redisQueueStore.clear();
          redisSeatCounters.clear();
          redisActiveUsers.clear();
          dbQueueEntries.clear();
          orderCounter = 0;

          // Make userIds unique
          const uniqueUserIds = [...new Set(userIds)];
          if (uniqueUserIds.length < 2) return; // Need at least 2 users

          // Initialize seats
          redisSeatCounters.set(eventId, uniqueUserIds.length);

          // Add users to queue in order
          const joinOrder: string[] = [];
          for (const userId of uniqueUserIds) {
            await queueService.joinQueue(eventId, userId);
            joinOrder.push(userId);
          }

          // Promote K users (limited by queue size)
          const actualPromoteCount = Math.min(promoteCount, uniqueUserIds.length);
          const promotedUsers: string[] = [];

          for (let i = 0; i < actualPromoteCount; i++) {
            const result = await queueService.promoteNextUser(eventId);
            if (result.success && result.userId) {
              promotedUsers.push(result.userId);
            }
          }

          // Property: Promoted users should be the first K users in join order
          const expectedPromoted = joinOrder.slice(0, actualPromoteCount);
          expect(promotedUsers).toEqual(expectedPromoted);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should maintain FIFO order even with interleaved operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // eventId
        fc.array(fc.uuid(), { minLength: 5, maxLength: 15 }), // userIds
        async (eventId, userIds) => {
          // Reset state
          redisQueueStore.clear();
          redisSeatCounters.clear();
          redisActiveUsers.clear();
          dbQueueEntries.clear();
          orderCounter = 0;

          const uniqueUserIds = [...new Set(userIds)];
          if (uniqueUserIds.length < 3) return;

          // Initialize with enough seats
          redisSeatCounters.set(eventId, uniqueUserIds.length);

          // Add first half of users
          const firstHalf = uniqueUserIds.slice(0, Math.floor(uniqueUserIds.length / 2));
          for (const userId of firstHalf) {
            await queueService.joinQueue(eventId, userId);
          }

          // Promote one user
          const firstPromotion = await queueService.promoteNextUser(eventId);

          // Add second half of users
          const secondHalf = uniqueUserIds.slice(Math.floor(uniqueUserIds.length / 2));
          for (const userId of secondHalf) {
            await queueService.joinQueue(eventId, userId);
          }

          // Promote another user
          const secondPromotion = await queueService.promoteNextUser(eventId);

          // Property: First promotion should be first user, second should be second user
          if (firstPromotion.success) {
            expect(firstPromotion.userId).toBe(firstHalf[0]);
          }
          if (secondPromotion.success && firstHalf.length > 1) {
            expect(secondPromotion.userId).toBe(firstHalf[1]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * **Feature: nest-ticket-queue, Property 6: Reservation Seat Decrement Atomicity (Oversell Prevention)**
 * **Validates: Requirements 5.1, 5.2, 5.3, 12.1**
 *
 * For any event E with remainingSeats = N and M concurrent reservation attempts where M > N:
 * - Exactly N reservations SHALL succeed
 * - Exactly (M - N) reservations SHALL fail with "sold out"
 * - The final remainingSeats SHALL equal 0 (not negative)
 */
describe('Property 6: Reservation Seat Decrement Atomicity (Oversell Prevention)', () => {
  let queueService: QueueService;
  let redisSeatCounters: Map<string, number>;
  let redisQueueStore: Map<string, { userId: string; order: number }[]>;
  let redisActiveUsers: Map<string, Set<string>>;
  let dbQueueEntries: Map<string, QueueEntry>;
  let orderCounter: number;
  let successfulReservations: number;
  let soldOutCount: number;

  beforeEach(async () => {
    redisSeatCounters = new Map();
    redisQueueStore = new Map();
    redisActiveUsers = new Map();
    dbQueueEntries = new Map();
    orderCounter = 0;
    successfulReservations = 0;
    soldOutCount = 0;

    const mockQueueEntryRepository = {
      findOne: jest.fn(({ where }: { where: { eventId: string; userId: string } }) => {
        const key = `${where.eventId}:${where.userId}`;
        return Promise.resolve(dbQueueEntries.get(key) || null);
      }),
      create: jest.fn((data: Partial<QueueEntry>) => ({
        id: `queue-${orderCounter++}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      save: jest.fn((entry: QueueEntry) => {
        const key = `${entry.eventId}:${entry.userId}`;
        dbQueueEntries.set(key, entry);
        return Promise.resolve(entry);
      }),
      update: jest.fn(
        (
          criteria: { eventId: string; userId: string },
          data: Partial<QueueEntry>,
        ) => {
          const key = `${criteria.eventId}:${criteria.userId}`;
          const existing = dbQueueEntries.get(key);
          if (existing) {
            dbQueueEntries.set(key, { ...existing, ...data });
          }
          return Promise.resolve({ affected: existing ? 1 : 0 });
        },
      ),
    };

    const mockRedisService = {
      addToQueue: jest.fn((eventId: string, userId: string) => {
        if (!redisQueueStore.has(eventId)) {
          redisQueueStore.set(eventId, []);
        }
        const queue = redisQueueStore.get(eventId)!;
        const existing = queue.find((u) => u.userId === userId);
        if (!existing) {
          queue.push({ userId, order: orderCounter++ });
        }
        queue.sort((a, b) => a.order - b.order);
        return Promise.resolve(queue.findIndex((u) => u.userId === userId) + 1);
      }),
      getQueuePosition: jest.fn((eventId: string, userId: string) => {
        const queue = redisQueueStore.get(eventId);
        if (!queue) return Promise.resolve(null);
        const idx = queue.findIndex((u) => u.userId === userId);
        return Promise.resolve(idx >= 0 ? idx + 1 : null);
      }),
      getQueueLength: jest.fn((eventId: string) => {
        const queue = redisQueueStore.get(eventId);
        return Promise.resolve(queue ? queue.length : 0);
      }),
      getNextInQueue: jest.fn((eventId: string) => {
        const queue = redisQueueStore.get(eventId);
        if (!queue || queue.length === 0) return Promise.resolve(null);
        queue.sort((a, b) => a.order - b.order);
        return Promise.resolve(queue[0].userId);
      }),
      removeFromQueue: jest.fn((eventId: string, userId: string) => {
        const queue = redisQueueStore.get(eventId);
        if (queue) {
          const idx = queue.findIndex((u) => u.userId === userId);
          if (idx >= 0) queue.splice(idx, 1);
        }
        return Promise.resolve();
      }),
      decrementSeats: jest.fn((eventId: string) => {
        const current = redisSeatCounters.get(eventId) ?? 0;
        const newValue = current - 1;
        redisSeatCounters.set(eventId, newValue);
        return Promise.resolve(newValue);
      }),
      incrementSeats: jest.fn((eventId: string) => {
        const current = redisSeatCounters.get(eventId) ?? 0;
        const newValue = current + 1;
        redisSeatCounters.set(eventId, newValue);
        return Promise.resolve(newValue);
      }),
      setActiveUser: jest.fn((eventId: string, userId: string) => {
        if (!redisActiveUsers.has(eventId)) {
          redisActiveUsers.set(eventId, new Set());
        }
        redisActiveUsers.get(eventId)!.add(userId);
        return Promise.resolve();
      }),
      getActiveCount: jest.fn((eventId: string) => {
        const active = redisActiveUsers.get(eventId);
        return Promise.resolve(active ? active.size : 0);
      }),
    };

    const mockEventsService = {
      findById: jest.fn((eventId: string) => {
        const now = new Date();
        return Promise.resolve({
          id: eventId,
          name: 'Test Event',
          totalSeats: 100,
          salesStartAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          salesEndAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }),
    };

    const mockReservationsService = {
      createReservation: jest.fn((eventId: string, userId: string) => {
        successfulReservations++;
        return Promise.resolve({
          id: `res-${orderCounter++}`,
          eventId,
          userId,
          status: 'PENDING_PAYMENT',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        });
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: getRepositoryToken(QueueEntry),
          useValue: mockQueueEntryRepository,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: EventsService,
          useValue: mockEventsService,
        },
        {
          provide: ReservationsService,
          useValue: mockReservationsService,
        },
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    queueService = module.get<QueueService>(QueueService);
  });

  it('should never oversell seats - exactly N reservations for N seats', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // eventId
        fc.integer({ min: 1, max: 20 }), // totalSeats (N)
        fc.integer({ min: 1, max: 30 }), // totalUsers (M, may be > N)
        async (eventId, totalSeats, totalUsers) => {
          // Reset state
          redisSeatCounters.clear();
          redisQueueStore.clear();
          redisActiveUsers.clear();
          dbQueueEntries.clear();
          orderCounter = 0;
          successfulReservations = 0;
          soldOutCount = 0;

          // Initialize seats
          redisSeatCounters.set(eventId, totalSeats);

          // Generate unique user IDs
          const userIds = Array.from({ length: totalUsers }, (_, i) => `user-${i}`);

          // Add all users to queue
          for (const userId of userIds) {
            await queueService.joinQueue(eventId, userId);
          }

          // Attempt to promote all users
          const results = [];
          for (let i = 0; i < totalUsers; i++) {
            const result = await queueService.promoteNextUser(eventId);
            results.push(result);
            if (result.reason === 'sold_out') {
              soldOutCount++;
            }
            if (result.reason === 'no_users_in_queue') {
              break;
            }
          }

          // Property 1: Exactly min(N, M) reservations should succeed
          const expectedSuccessful = Math.min(totalSeats, totalUsers);
          expect(successfulReservations).toBe(expectedSuccessful);

          // Property 2: Final seat count should be 0 or positive (never negative)
          const finalSeats = redisSeatCounters.get(eventId) ?? 0;
          expect(finalSeats).toBeGreaterThanOrEqual(0);

          // Property 3: If M > N, exactly (M - N) should get sold out
          if (totalUsers > totalSeats) {
            expect(soldOutCount).toBe(totalUsers - totalSeats);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should restore seat count when promotion fails due to sold out', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // eventId
        fc.integer({ min: 1, max: 10 }), // totalSeats
        async (eventId, totalSeats) => {
          // Reset state
          redisSeatCounters.clear();
          redisQueueStore.clear();
          redisActiveUsers.clear();
          dbQueueEntries.clear();
          orderCounter = 0;
          successfulReservations = 0;

          // Initialize with exactly totalSeats
          redisSeatCounters.set(eventId, totalSeats);

          // Add more users than seats
          const extraUsers = 5;
          const totalUsers = totalSeats + extraUsers;
          const userIds = Array.from({ length: totalUsers }, (_, i) => `user-${i}`);

          for (const userId of userIds) {
            await queueService.joinQueue(eventId, userId);
          }

          // Promote all users
          for (let i = 0; i < totalUsers; i++) {
            await queueService.promoteNextUser(eventId);
          }

          // Property: Final seat count should be exactly 0 (not negative)
          // This verifies that INCR is called to restore seats when DECR goes negative
          const finalSeats = redisSeatCounters.get(eventId) ?? 0;
          expect(finalSeats).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * **Feature: nest-ticket-queue, Property 9: Concurrent Last-Seat Reservation**
 * **Validates: Requirements 12.1**
 *
 * For any event E with remainingSeats = 1 and N concurrent ACTIVE users
 * attempting reservation simultaneously:
 * - Exactly 1 reservation SHALL succeed
 * - Exactly (N - 1) reservations SHALL fail
 * - remainingSeats SHALL equal 0 after all attempts complete
 */
describe('Property 9: Concurrent Last-Seat Reservation', () => {
  let queueService: QueueService;
  let redisSeatCounters: Map<string, number>;
  let redisQueueStore: Map<string, { userId: string; order: number }[]>;
  let redisActiveUsers: Map<string, Set<string>>;
  let dbQueueEntries: Map<string, QueueEntry>;
  let orderCounter: number;
  let successfulReservations: number;

  beforeEach(async () => {
    redisSeatCounters = new Map();
    redisQueueStore = new Map();
    redisActiveUsers = new Map();
    dbQueueEntries = new Map();
    orderCounter = 0;
    successfulReservations = 0;

    const mockQueueEntryRepository = {
      findOne: jest.fn(({ where }: { where: { eventId: string; userId: string } }) => {
        const key = `${where.eventId}:${where.userId}`;
        return Promise.resolve(dbQueueEntries.get(key) || null);
      }),
      create: jest.fn((data: Partial<QueueEntry>) => ({
        id: `queue-${orderCounter++}`,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      save: jest.fn((entry: QueueEntry) => {
        const key = `${entry.eventId}:${entry.userId}`;
        dbQueueEntries.set(key, entry);
        return Promise.resolve(entry);
      }),
      update: jest.fn(
        (
          criteria: { eventId: string; userId: string },
          data: Partial<QueueEntry>,
        ) => {
          const key = `${criteria.eventId}:${criteria.userId}`;
          const existing = dbQueueEntries.get(key);
          if (existing) {
            dbQueueEntries.set(key, { ...existing, ...data });
          }
          return Promise.resolve({ affected: existing ? 1 : 0 });
        },
      ),
    };

    const mockRedisService = {
      addToQueue: jest.fn((eventId: string, userId: string) => {
        if (!redisQueueStore.has(eventId)) {
          redisQueueStore.set(eventId, []);
        }
        const queue = redisQueueStore.get(eventId)!;
        const existing = queue.find((u) => u.userId === userId);
        if (!existing) {
          queue.push({ userId, order: orderCounter++ });
        }
        queue.sort((a, b) => a.order - b.order);
        return Promise.resolve(queue.findIndex((u) => u.userId === userId) + 1);
      }),
      getQueuePosition: jest.fn((eventId: string, userId: string) => {
        const queue = redisQueueStore.get(eventId);
        if (!queue) return Promise.resolve(null);
        const idx = queue.findIndex((u) => u.userId === userId);
        return Promise.resolve(idx >= 0 ? idx + 1 : null);
      }),
      getQueueLength: jest.fn((eventId: string) => {
        const queue = redisQueueStore.get(eventId);
        return Promise.resolve(queue ? queue.length : 0);
      }),
      getNextInQueue: jest.fn((eventId: string) => {
        const queue = redisQueueStore.get(eventId);
        if (!queue || queue.length === 0) return Promise.resolve(null);
        queue.sort((a, b) => a.order - b.order);
        return Promise.resolve(queue[0].userId);
      }),
      removeFromQueue: jest.fn((eventId: string, userId: string) => {
        const queue = redisQueueStore.get(eventId);
        if (queue) {
          const idx = queue.findIndex((u) => u.userId === userId);
          if (idx >= 0) queue.splice(idx, 1);
        }
        return Promise.resolve();
      }),
      decrementSeats: jest.fn((eventId: string) => {
        const current = redisSeatCounters.get(eventId) ?? 0;
        const newValue = current - 1;
        redisSeatCounters.set(eventId, newValue);
        return Promise.resolve(newValue);
      }),
      incrementSeats: jest.fn((eventId: string) => {
        const current = redisSeatCounters.get(eventId) ?? 0;
        const newValue = current + 1;
        redisSeatCounters.set(eventId, newValue);
        return Promise.resolve(newValue);
      }),
      setActiveUser: jest.fn((eventId: string, userId: string) => {
        if (!redisActiveUsers.has(eventId)) {
          redisActiveUsers.set(eventId, new Set());
        }
        redisActiveUsers.get(eventId)!.add(userId);
        return Promise.resolve();
      }),
      getActiveCount: jest.fn((eventId: string) => {
        const active = redisActiveUsers.get(eventId);
        return Promise.resolve(active ? active.size : 0);
      }),
    };

    const mockEventsService = {
      findById: jest.fn((eventId: string) => {
        const now = new Date();
        return Promise.resolve({
          id: eventId,
          name: 'Test Event',
          totalSeats: 100,
          salesStartAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          salesEndAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }),
    };

    const mockReservationsService = {
      createReservation: jest.fn((eventId: string, userId: string) => {
        successfulReservations++;
        return Promise.resolve({
          id: `res-${orderCounter++}`,
          eventId,
          userId,
          status: 'PENDING_PAYMENT',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        });
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: getRepositoryToken(QueueEntry),
          useValue: mockQueueEntryRepository,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: EventsService,
          useValue: mockEventsService,
        },
        {
          provide: ReservationsService,
          useValue: mockReservationsService,
        },
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    queueService = module.get<QueueService>(QueueService);
  });

  it('should allow exactly one reservation for last seat with multiple users', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // eventId
        fc.integer({ min: 2, max: 20 }), // number of users competing for last seat
        async (eventId, numUsers) => {
          // Reset state
          redisSeatCounters.clear();
          redisQueueStore.clear();
          redisActiveUsers.clear();
          dbQueueEntries.clear();
          orderCounter = 0;
          successfulReservations = 0;

          // Initialize with exactly 1 seat (last seat scenario)
          redisSeatCounters.set(eventId, 1);

          // Generate unique user IDs
          const userIds = Array.from({ length: numUsers }, (_, i) => `user-${i}`);

          // Add all users to queue
          for (const userId of userIds) {
            await queueService.joinQueue(eventId, userId);
          }

          // Attempt to promote all users (simulating concurrent attempts)
          const results = [];
          for (let i = 0; i < numUsers; i++) {
            const result = await queueService.promoteNextUser(eventId);
            results.push(result);
            if (result.reason === 'no_users_in_queue') {
              break;
            }
          }

          // Property 1: Exactly 1 reservation should succeed
          expect(successfulReservations).toBe(1);

          // Property 2: Exactly (N - 1) should fail with sold_out
          const soldOutResults = results.filter((r) => r.reason === 'sold_out');
          expect(soldOutResults.length).toBe(numUsers - 1);

          // Property 3: Final seat count should be exactly 0
          const finalSeats = redisSeatCounters.get(eventId) ?? 0;
          expect(finalSeats).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should handle edge case of single user for last seat', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(), // eventId
        async (eventId) => {
          // Reset state
          redisSeatCounters.clear();
          redisQueueStore.clear();
          redisActiveUsers.clear();
          dbQueueEntries.clear();
          orderCounter = 0;
          successfulReservations = 0;

          // Initialize with exactly 1 seat
          redisSeatCounters.set(eventId, 1);

          // Add single user
          const userId = 'single-user';
          await queueService.joinQueue(eventId, userId);

          // Promote the user
          const result = await queueService.promoteNextUser(eventId);

          // Property: Single user should get the last seat
          expect(result.success).toBe(true);
          expect(result.reason).toBe('promoted');
          expect(successfulReservations).toBe(1);

          // Property: Final seat count should be 0
          const finalSeats = redisSeatCounters.get(eventId) ?? 0;
          expect(finalSeats).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
