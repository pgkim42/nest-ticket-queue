import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from '../src/app.module';
import { User, UserRole } from '../src/users/entities/user.entity';
import { Event } from '../src/events/entities/event.entity';
import { QueueEntry, QueueEntryStatus } from '../src/queue/entities/queue-entry.entity';
import { Reservation, ReservationStatus } from '../src/reservations/entities/reservation.entity';
import { RedisService } from '../src/redis/redis.service';
import { QueueService } from '../src/queue/queue.service';

async function cleanupTestData(
  reservationRepository: Repository<Reservation>,
  queueEntryRepository: Repository<QueueEntry>,
  eventRepository: Repository<Event>,
  userRepository: Repository<User>,
) {
  // Delete in correct order to respect foreign key constraints
  // First delete reservations (references events and users)
  await reservationRepository.createQueryBuilder().delete().execute();
  // Then delete queue entries (references events and users)
  await queueEntryRepository.createQueryBuilder().delete().execute();
  // Then delete events
  await eventRepository.createQueryBuilder().delete().execute();
  // Finally delete users
  await userRepository.createQueryBuilder().delete().execute();
}

/**
 * E2E Test: Complete Ticketing Flow
 * 
 * Tests the full user journey:
 * User login → Queue join → Wait for ACTIVE promotion → Receive reservation → Pay
 * 
 * Requirements: All
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
describe('Ticketing Flow (E2E)', () => {
  let app: INestApplication;
  let userRepository: Repository<User>;
  let eventRepository: Repository<Event>;
  let queueEntryRepository: Repository<QueueEntry>;
  let reservationRepository: Repository<Reservation>;
  let redisService: RedisService;
  let queueService: QueueService;

  let testUser: User;
  let testEvent: Event;
  let authToken: string;

  beforeAll(async () => {
    // Skip if Redis version is incompatible (Windows local Redis)
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

    // Create test user
    const passwordHash = await bcrypt.hash('password123', 10);
    testUser = await userRepository.save({
      email: 'test@example.com',
      passwordHash,
      name: 'Test User',
      role: UserRole.USER,
    });

    // Create test event with sales period that includes now
    const now = new Date();
    const salesStartAt = new Date(now.getTime() - 60 * 60 * 1000); // 1 hour ago
    const salesEndAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now

    testEvent = await eventRepository.save({
      name: 'Test Concert',
      totalSeats: 10,
      salesStartAt,
      salesEndAt,
    });

    // Initialize Redis seat counter
    await redisService.initializeSeats(testEvent.id, testEvent.totalSeats);
  });

  afterAll(async () => {
    if (app) {
      // Clean up
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

  describe('Complete Ticketing Flow', () => {
    it('should complete full ticketing flow: login → queue join → promotion → payment', async () => {
      // Step 1: Login (Requirement 9.1)
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(201);

      expect(loginResponse.body.accessToken).toBeDefined();
      authToken = loginResponse.body.accessToken;

      // Step 2: Join Queue (Requirement 2.1)
      const joinResponse = await request(app.getHttpServer())
        .post(`/events/${testEvent.id}/queue/join`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      expect(joinResponse.body.position).toBe(1);
      expect(joinResponse.body.status).toBe(QueueEntryStatus.WAITING);

      // Step 3: Promote user to ACTIVE (Requirement 4.1, 4.2)
      const promotionResult = await queueService.promoteNextUser(testEvent.id);
      expect(promotionResult.success).toBe(true);
      expect(promotionResult.reason).toBe('promoted');
      expect(promotionResult.reservation).toBeDefined();

      const reservationId = promotionResult.reservation!.id;

      // Verify queue status is now ACTIVE (Requirement 3.1)
      const statusResponse = await request(app.getHttpServer())
        .get(`/events/${testEvent.id}/queue/me`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(statusResponse.body.status).toBe(QueueEntryStatus.ACTIVE);

      // Step 4: Process Payment (Requirement 6.1)
      const paymentResponse = await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/pay`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      expect(paymentResponse.body.status).toBe(ReservationStatus.PAID);
      expect(paymentResponse.body.paidAt).toBeDefined();

      // Verify final state
      const finalQueueEntry = await queueEntryRepository.findOne({
        where: { eventId: testEvent.id, userId: testUser.id },
      });
      expect(finalQueueEntry?.status).toBe(QueueEntryStatus.DONE);

      const finalReservation = await reservationRepository.findOne({
        where: { id: reservationId },
      });
      expect(finalReservation?.status).toBe(ReservationStatus.PAID);
    });

    it('should reject queue join before sales start (Requirement 2.3)', async () => {
      // Create event with future sales start
      const futureEvent = await eventRepository.save({
        name: 'Future Event',
        totalSeats: 10,
        salesStartAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
        salesEndAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // Day after
      });

      try {
        // Login first
        const loginResponse = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: 'test@example.com', password: 'password123' })
          .expect(201);

        // Try to join queue
        const joinResponse = await request(app.getHttpServer())
          .post(`/events/${futureEvent.id}/queue/join`)
          .set('Authorization', `Bearer ${loginResponse.body.accessToken}`)
          .expect(400);

        expect(joinResponse.body.message).toContain('Sales have not started');
      } finally {
        // Clean up the futureEvent to avoid FK constraint issues
        await eventRepository.delete({ id: futureEvent.id });
      }
    });

    it('should reject queue join after sales end (Requirement 2.4)', async () => {
      // Create event with past sales period
      const pastEvent = await eventRepository.save({
        name: 'Past Event',
        totalSeats: 10,
        salesStartAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 2 days ago
        salesEndAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
      });

      try {
        // Login first
        const loginResponse = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: 'test@example.com', password: 'password123' })
          .expect(201);

        // Try to join queue
        const joinResponse = await request(app.getHttpServer())
          .post(`/events/${pastEvent.id}/queue/join`)
          .set('Authorization', `Bearer ${loginResponse.body.accessToken}`)
          .expect(400);

        expect(joinResponse.body.message).toContain('Sales have ended');
      } finally {
        // Clean up the pastEvent to avoid FK constraint issues
        await eventRepository.delete({ id: pastEvent.id });
      }
    });

    it('should return existing position on duplicate queue join (Requirement 2.2)', async () => {
      // Login
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(201);

      authToken = loginResponse.body.accessToken;

      // First join
      const firstJoin = await request(app.getHttpServer())
        .post(`/events/${testEvent.id}/queue/join`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      expect(firstJoin.body.position).toBe(1);

      // Second join (should be idempotent)
      const secondJoin = await request(app.getHttpServer())
        .post(`/events/${testEvent.id}/queue/join`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      expect(secondJoin.body.position).toBe(1);
      expect(secondJoin.body.message).toContain('Already in queue');

      // Verify only one queue entry exists
      const entries = await queueEntryRepository.find({
        where: { eventId: testEvent.id, userId: testUser.id },
      });
      expect(entries.length).toBe(1);
    });

    it('should reject payment for expired reservation (Requirement 6.2)', async () => {
      // Login and join queue
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(201);

      authToken = loginResponse.body.accessToken;

      await request(app.getHttpServer())
        .post(`/events/${testEvent.id}/queue/join`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      // Promote user
      const promotionResult = await queueService.promoteNextUser(testEvent.id);
      const reservationId = promotionResult.reservation!.id;

      // Manually expire the reservation
      await reservationRepository.update(
        { id: reservationId },
        { expiresAt: new Date(Date.now() - 1000) }, // Set to past
      );

      // Try to pay
      const paymentResponse = await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/pay`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);

      expect(paymentResponse.body.message).toContain('expired');
    });

    it('should reject payment for another user\'s reservation (Requirement 6.3)', async () => {
      // Create another user
      const passwordHash = await bcrypt.hash('password123', 10);
      const otherUser = await userRepository.save({
        email: 'other@example.com',
        passwordHash,
        name: 'Other User',
        role: UserRole.USER,
      });

      // Login as test user and join queue
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password123' })
        .expect(201);

      authToken = loginResponse.body.accessToken;

      await request(app.getHttpServer())
        .post(`/events/${testEvent.id}/queue/join`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      // Promote test user
      const promotionResult = await queueService.promoteNextUser(testEvent.id);
      const reservationId = promotionResult.reservation!.id;

      // Login as other user
      const otherLoginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'other@example.com', password: 'password123' })
        .expect(201);

      // Try to pay for test user's reservation
      const paymentResponse = await request(app.getHttpServer())
        .post(`/reservations/${reservationId}/pay`)
        .set('Authorization', `Bearer ${otherLoginResponse.body.accessToken}`)
        .expect(403);

      expect(paymentResponse.body.message).toContain('not authorized');
    });
  });
});
