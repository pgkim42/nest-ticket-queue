import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from '../src/app.module';
import { User, UserRole } from '../src/users/entities/user.entity';
import { Event } from '../src/events/entities/event.entity';
import { QueueEntry, QueueEntryStatus } from '../src/queue/entities/queue-entry.entity';
import { Reservation, ReservationStatus } from '../src/reservations/entities/reservation.entity';
import { RedisService } from '../src/redis/redis.service';
import { QueueService, PromotionResult } from '../src/queue/queue.service';

async function cleanupTestData(
  reservationRepository: Repository<Reservation>,
  queueEntryRepository: Repository<QueueEntry>,
  eventRepository: Repository<Event>,
  userRepository: Repository<User>,
) {
  // Delete in correct order to respect foreign key constraints
  await reservationRepository.createQueryBuilder().delete().execute();
  await queueEntryRepository.createQueryBuilder().delete().execute();
  await eventRepository.createQueryBuilder().delete().execute();
  await userRepository.createQueryBuilder().delete().execute();
}

/**
 * Integration Test: Concurrent Promotion Scenario
 * 
 * Tests that when multiple users in queue compete for the last seat:
 * - Exactly one user gets the reservation
 * - Others receive sold out response
 * - No overselling occurs
 * 
 * Requirements: 12.1
 * 
 * Prerequisites:
 * 1. Docker containers must be running: docker-compose up -d
 * 2. Local Windows Redis service must be stopped (if installed)
 *    - BullMQ requires Redis 5.0+, Windows Redis is typically 3.0.x
 *    - Stop with: net stop Redis (as admin) or disable the service
 * 3. Ensure port 6379 is only used by Docker Redis
 * 
 * Run tests: npm run test:e2e
 */
describe('Concurrent Promotion (Integration)', () => {
  let app: INestApplication;
  let userRepository: Repository<User>;
  let eventRepository: Repository<Event>;
  let queueEntryRepository: Repository<QueueEntry>;
  let reservationRepository: Repository<Reservation>;
  let redisService: RedisService;
  let queueService: QueueService;

  const NUM_USERS = 10;
  let testUsers: User[] = [];
  let testEvent: Event;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    userRepository = moduleFixture.get<Repository<User>>(getRepositoryToken(User));
    eventRepository = moduleFixture.get<Repository<Event>>(getRepositoryToken(Event));
    queueEntryRepository = moduleFixture.get<Repository<QueueEntry>>(getRepositoryToken(QueueEntry));
    reservationRepository = moduleFixture.get<Repository<Reservation>>(getRepositoryToken(Reservation));
    redisService = moduleFixture.get<RedisService>(RedisService);
    queueService = moduleFixture.get<QueueService>(QueueService);
  }, 30000);

  beforeEach(async () => {
    // Clean up test data using query builder to avoid empty criteria error
    await cleanupTestData(
      reservationRepository,
      queueEntryRepository,
      eventRepository,
      userRepository,
    );
    testUsers = [];

    // Create multiple test users
    const passwordHash = await bcrypt.hash('password123', 10);
    for (let i = 0; i < NUM_USERS; i++) {
      const user = await userRepository.save({
        email: `user${i}@example.com`,
        passwordHash,
        name: `User ${i}`,
        role: UserRole.USER,
      });
      testUsers.push(user);
    }

    // Create test event with only 1 seat (last seat scenario)
    const now = new Date();
    const salesStartAt = new Date(now.getTime() - 60 * 60 * 1000);
    const salesEndAt = new Date(now.getTime() + 60 * 60 * 1000);

    testEvent = await eventRepository.save({
      name: 'Last Seat Concert',
      totalSeats: 1,
      salesStartAt,
      salesEndAt,
    });

    // Initialize Redis seat counter with 1 seat
    await redisService.initializeSeats(testEvent.id, 1);
  });

  afterAll(async () => {
    if (app) {
      try {
        await cleanupTestData(
          reservationRepository,
          queueEntryRepository,
          eventRepository,
          userRepository,
        );
      } catch (e) {
        // Ignore cleanup errors
      }
      await app.close();
    }
  }, 10000);

  describe('Last Seat Competition (Requirement 12.1)', () => {
    it('should allow exactly one user to get reservation when multiple compete for last seat', async () => {
      // Add all users to queue
      for (const user of testUsers) {
        await queueService.joinQueue(testEvent.id, user.id);
      }

      // Verify all users are in queue
      const queueLength = await redisService.getQueueLength(testEvent.id);
      expect(queueLength).toBe(NUM_USERS);

      // Attempt to promote all users concurrently
      const promotionPromises: Promise<PromotionResult>[] = [];
      for (let i = 0; i < NUM_USERS; i++) {
        promotionPromises.push(queueService.promoteNextUser(testEvent.id));
      }

      const results = await Promise.all(promotionPromises);

      // Count successful promotions and sold out results
      const successfulPromotions = results.filter(
        (r) => r.success && r.reason === 'promoted',
      );

      // Exactly 1 should succeed (Requirement 12.1)
      expect(successfulPromotions.length).toBe(1);

      // Verify remaining seats is 0 (not negative - no oversell)
      const remainingSeats = await redisService.getRemainingSeats(testEvent.id);
      expect(remainingSeats).toBe(0);

      // Verify exactly 1 reservation was created
      const reservations = await reservationRepository.find({
        where: { eventId: testEvent.id },
      });
      expect(reservations.length).toBe(1);
      expect(reservations[0].status).toBe(ReservationStatus.PENDING_PAYMENT);

      // Verify queue entries have correct statuses
      const activeEntries = await queueEntryRepository.find({
        where: { eventId: testEvent.id, status: QueueEntryStatus.ACTIVE },
      });
      expect(activeEntries.length).toBe(1);
    });

    it('should handle concurrent promotions with multiple seats correctly', async () => {
      // Create event with 3 seats
      const multiSeatEvent = await eventRepository.save({
        name: 'Multi Seat Concert',
        totalSeats: 3,
        salesStartAt: new Date(Date.now() - 60 * 60 * 1000),
        salesEndAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      await redisService.initializeSeats(multiSeatEvent.id, 3);

      try {
        // Add all users to queue
        for (const user of testUsers) {
          await queueService.joinQueue(multiSeatEvent.id, user.id);
        }

        // Attempt to promote all users concurrently
        const promotionPromises: Promise<PromotionResult>[] = [];
        for (let i = 0; i < NUM_USERS; i++) {
          promotionPromises.push(queueService.promoteNextUser(multiSeatEvent.id));
        }

        const results = await Promise.all(promotionPromises);

        // Count successful promotions
        const successfulPromotions = results.filter(
          (r) => r.success && r.reason === 'promoted',
        );

        // Exactly 3 should succeed (matching totalSeats)
        expect(successfulPromotions.length).toBe(3);

        // Verify remaining seats is 0
        const remainingSeats = await redisService.getRemainingSeats(multiSeatEvent.id);
        expect(remainingSeats).toBe(0);

        // Verify exactly 3 reservations were created
        const reservations = await reservationRepository.find({
          where: { eventId: multiSeatEvent.id },
        });
        expect(reservations.length).toBe(3);
      } finally {
        // Clean up multiSeatEvent related data
        await reservationRepository
          .createQueryBuilder()
          .delete()
          .where('eventId = :eventId', { eventId: multiSeatEvent.id })
          .execute();
        await queueEntryRepository
          .createQueryBuilder()
          .delete()
          .where('eventId = :eventId', { eventId: multiSeatEvent.id })
          .execute();
        await eventRepository.delete({ id: multiSeatEvent.id });
      }
    });

    it('should maintain FIFO order during sequential promotions', async () => {
      // Create event with 5 seats
      const fifoEvent = await eventRepository.save({
        name: 'FIFO Test Concert',
        totalSeats: 5,
        salesStartAt: new Date(Date.now() - 60 * 60 * 1000),
        salesEndAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      await redisService.initializeSeats(fifoEvent.id, 5);

      try {
        // Add users to queue in order (with small delays to ensure order)
        for (const user of testUsers.slice(0, 5)) {
          await queueService.joinQueue(fifoEvent.id, user.id);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        // Promote users sequentially
        const promotedUserIds: string[] = [];
        for (let i = 0; i < 5; i++) {
          const result = await queueService.promoteNextUser(fifoEvent.id);
          if (result.success) {
            promotedUserIds.push(result.userId);
          }
        }

        // Verify FIFO order (first 5 users should be promoted in order)
        expect(promotedUserIds.length).toBe(5);
        for (let i = 0; i < 5; i++) {
          expect(promotedUserIds[i]).toBe(testUsers[i].id);
        }
      } finally {
        // Clean up fifoEvent related data
        await reservationRepository
          .createQueryBuilder()
          .delete()
          .where('eventId = :eventId', { eventId: fifoEvent.id })
          .execute();
        await queueEntryRepository
          .createQueryBuilder()
          .delete()
          .where('eventId = :eventId', { eventId: fifoEvent.id })
          .execute();
        await eventRepository.delete({ id: fifoEvent.id });
      }
    });
  });
});
