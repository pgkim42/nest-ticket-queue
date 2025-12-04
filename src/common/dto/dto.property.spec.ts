import 'reflect-metadata';
import * as fc from 'fast-check';
import { plainToInstance, instanceToPlain } from 'class-transformer';
import { EventResponseDto } from '../../events/dto/event-response.dto';
import { QueueStatusDto, JoinQueueResponseDto } from '../../queue/dto/queue-status.dto';
import { ReservationResponseDto } from '../../reservations/dto/reservation-response.dto';
import { AuthResponseDto, UserInfoDto } from '../../auth/dto/auth-response.dto';
import { EventStatsDto, ReservationCountsByStatusDto } from '../../events/dto/event-stats.dto';
import { QueueEntryStatus } from '../../queue/entities/queue-entry.entity';
import { ReservationStatus } from '../../reservations/entities/reservation.entity';

/**
 * **Feature: nest-ticket-queue, Property 10: Domain Object Serialization Round-Trip**
 * **Validates: Requirements 11.3**
 *
 * For any domain object (Event, QueueEntry, Reservation),
 * serializing to JSON and deserializing back SHALL produce an equivalent object.
 */
describe('Property 10: Domain Object Serialization Round-Trip', () => {
  // Helper to generate valid UUID
  const uuidArb = fc.uuid();

  // Helper to generate valid dates using timestamp to avoid NaN dates
  const dateArb = fc
    .integer({ min: 1577836800000, max: 1924991999000 }) // 2020-01-01 to 2030-12-31 in ms
    .map((ts) => new Date(ts));

  describe('EventResponseDto round-trip', () => {
    it('should produce equivalent object after serialize/deserialize', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
          fc.integer({ min: 0, max: 100000 }),
          fc.integer({ min: 0, max: 100000 }),
          dateArb,
          dateArb,
          dateArb,
          dateArb,
          async (id, name, totalSeats, remainingSeats, salesStartAt, salesEndAt, createdAt, updatedAt) => {
            // Create original DTO instance
            const original = new EventResponseDto();
            original.id = id;
            original.name = name.trim();
            original.totalSeats = totalSeats;
            original.remainingSeats = remainingSeats;
            original.salesStartAt = salesStartAt;
            original.salesEndAt = salesEndAt;
            original.createdAt = createdAt;
            original.updatedAt = updatedAt;

            // Serialize to plain object (JSON-like)
            const plain = instanceToPlain(original);

            // Deserialize back to DTO instance
            const restored = plainToInstance(EventResponseDto, plain);

            // Property: restored object should be equivalent to original
            expect(restored.id).toBe(original.id);
            expect(restored.name).toBe(original.name);
            expect(restored.totalSeats).toBe(original.totalSeats);
            expect(restored.remainingSeats).toBe(original.remainingSeats);
            // Dates are serialized to ISO strings, so compare as strings
            expect(new Date(restored.salesStartAt).toISOString()).toBe(original.salesStartAt.toISOString());
            expect(new Date(restored.salesEndAt).toISOString()).toBe(original.salesEndAt.toISOString());
            expect(new Date(restored.createdAt).toISOString()).toBe(original.createdAt.toISOString());
            expect(new Date(restored.updatedAt).toISOString()).toBe(original.updatedAt.toISOString());
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('QueueStatusDto round-trip', () => {
    it('should produce equivalent object after serialize/deserialize', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 100000 }),
          fc.constantFrom(...Object.values(QueueEntryStatus)),
          uuidArb,
          fc.option(dateArb, { nil: undefined }),
          fc.option(uuidArb, { nil: undefined }),
          async (position, status, eventId, expiresAt, reservationId) => {
            const original = new QueueStatusDto();
            original.position = position;
            original.status = status;
            original.eventId = eventId;
            original.expiresAt = expiresAt;
            original.reservationId = reservationId;

            const plain = instanceToPlain(original);
            const restored = plainToInstance(QueueStatusDto, plain);

            expect(restored.position).toBe(original.position);
            expect(restored.status).toBe(original.status);
            expect(restored.eventId).toBe(original.eventId);
            if (original.expiresAt) {
              expect(new Date(restored.expiresAt!).toISOString()).toBe(original.expiresAt.toISOString());
            } else {
              expect(restored.expiresAt).toBeUndefined();
            }
            expect(restored.reservationId).toBe(original.reservationId);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('JoinQueueResponseDto round-trip', () => {
    it('should produce equivalent object after serialize/deserialize', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 100000 }),
          fc.constantFrom(...Object.values(QueueEntryStatus)),
          uuidArb,
          fc.string({ minLength: 1, maxLength: 200 }),
          async (position, status, eventId, message) => {
            const original = new JoinQueueResponseDto();
            original.position = position;
            original.status = status;
            original.eventId = eventId;
            original.message = message;

            const plain = instanceToPlain(original);
            const restored = plainToInstance(JoinQueueResponseDto, plain);

            expect(restored.position).toBe(original.position);
            expect(restored.status).toBe(original.status);
            expect(restored.eventId).toBe(original.eventId);
            expect(restored.message).toBe(original.message);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('ReservationResponseDto round-trip', () => {
    it('should produce equivalent object after serialize/deserialize', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          uuidArb,
          uuidArb,
          fc.constantFrom(...Object.values(ReservationStatus)),
          dateArb,
          // Use boolean to decide if paidAt is set, then use a valid date
          fc.boolean(),
          dateArb,
          dateArb,
          dateArb,
          async (id, eventId, userId, status, expiresAt, hasPaidAt, paidAtDate, createdAt, updatedAt) => {
            const original = new ReservationResponseDto();
            original.id = id;
            original.eventId = eventId;
            original.userId = userId;
            original.status = status;
            original.expiresAt = expiresAt;
            original.paidAt = hasPaidAt ? paidAtDate : null;
            original.createdAt = createdAt;
            original.updatedAt = updatedAt;

            const plain = instanceToPlain(original);
            const restored = plainToInstance(ReservationResponseDto, plain);

            expect(restored.id).toBe(original.id);
            expect(restored.eventId).toBe(original.eventId);
            expect(restored.userId).toBe(original.userId);
            expect(restored.status).toBe(original.status);
            expect(new Date(restored.expiresAt).toISOString()).toBe(original.expiresAt.toISOString());
            if (original.paidAt) {
              expect(new Date(restored.paidAt!).toISOString()).toBe(original.paidAt.toISOString());
            } else {
              expect(restored.paidAt).toBeNull();
            }
            expect(new Date(restored.createdAt).toISOString()).toBe(original.createdAt.toISOString());
            expect(new Date(restored.updatedAt).toISOString()).toBe(original.updatedAt.toISOString());
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('AuthResponseDto round-trip', () => {
    it('should produce equivalent object after serialize/deserialize', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 10, maxLength: 500 }), // JWT-like token
          uuidArb,
          fc.emailAddress(),
          fc.string({ minLength: 1, maxLength: 100 }),
          fc.constantFrom('USER', 'ADMIN'),
          async (accessToken, userId, email, name, role) => {
            const userInfo = new UserInfoDto();
            userInfo.id = userId;
            userInfo.email = email;
            userInfo.name = name;
            userInfo.role = role;

            const original = new AuthResponseDto();
            original.accessToken = accessToken;
            original.user = userInfo;

            const plain = instanceToPlain(original);
            const restored = plainToInstance(AuthResponseDto, plain);

            expect(restored.accessToken).toBe(original.accessToken);
            expect(restored.user.id).toBe(original.user.id);
            expect(restored.user.email).toBe(original.user.email);
            expect(restored.user.name).toBe(original.user.name);
            expect(restored.user.role).toBe(original.user.role);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('EventStatsDto round-trip', () => {
    it('should produce equivalent object after serialize/deserialize', async () => {
      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          fc.integer({ min: 0, max: 100000 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.integer({ min: 0, max: 100000 }),
          fc.integer({ min: 0, max: 100000 }),
          async (eventId, remainingSeats, queueLength, pendingPayment, paid, expired) => {
            const reservationCounts = new ReservationCountsByStatusDto();
            reservationCounts.PENDING_PAYMENT = pendingPayment;
            reservationCounts.PAID = paid;
            reservationCounts.EXPIRED = expired;

            const original = new EventStatsDto();
            original.eventId = eventId;
            original.remainingSeats = remainingSeats;
            original.queueLength = queueLength;
            original.reservationCounts = reservationCounts;

            const plain = instanceToPlain(original);
            const restored = plainToInstance(EventStatsDto, plain);

            expect(restored.eventId).toBe(original.eventId);
            expect(restored.remainingSeats).toBe(original.remainingSeats);
            expect(restored.queueLength).toBe(original.queueLength);
            expect(restored.reservationCounts.PENDING_PAYMENT).toBe(original.reservationCounts.PENDING_PAYMENT);
            expect(restored.reservationCounts.PAID).toBe(original.reservationCounts.PAID);
            expect(restored.reservationCounts.EXPIRED).toBe(original.reservationCounts.EXPIRED);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
