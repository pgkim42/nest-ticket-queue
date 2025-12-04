import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateEventDto } from '../../events/dto/create-event.dto';
import { LoginDto } from '../../auth/dto/login.dto';
import { EventResponseDto } from '../../events/dto/event-response.dto';
import { QueueStatusDto } from '../../queue/dto/queue-status.dto';
import { ReservationResponseDto } from '../../reservations/dto/reservation-response.dto';
import { QueueEntryStatus } from '../../queue/entities/queue-entry.entity';
import { ReservationStatus } from '../../reservations/entities/reservation.entity';

/**
 * Unit tests for DTO validation
 * **Validates: Requirements 11.2**
 */
describe('DTO Validation', () => {
  describe('CreateEventDto', () => {
    it('should pass validation with valid data', async () => {
      const dto = plainToInstance(CreateEventDto, {
        name: 'Test Event',
        totalSeats: 100,
        salesStartAt: '2025-01-01T00:00:00.000Z',
        salesEndAt: '2025-01-31T23:59:59.000Z',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation when name is empty', async () => {
      const dto = plainToInstance(CreateEventDto, {
        name: '',
        totalSeats: 100,
        salesStartAt: '2025-01-01T00:00:00.000Z',
        salesEndAt: '2025-01-31T23:59:59.000Z',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'name')).toBe(true);
    });

    it('should fail validation when name is missing', async () => {
      const dto = plainToInstance(CreateEventDto, {
        totalSeats: 100,
        salesStartAt: '2025-01-01T00:00:00.000Z',
        salesEndAt: '2025-01-31T23:59:59.000Z',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'name')).toBe(true);
    });

    it('should fail validation when totalSeats is less than 1', async () => {
      const dto = plainToInstance(CreateEventDto, {
        name: 'Test Event',
        totalSeats: 0,
        salesStartAt: '2025-01-01T00:00:00.000Z',
        salesEndAt: '2025-01-31T23:59:59.000Z',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'totalSeats')).toBe(true);
    });

    it('should fail validation when totalSeats is not an integer', async () => {
      const dto = plainToInstance(CreateEventDto, {
        name: 'Test Event',
        totalSeats: 'not-a-number',
        salesStartAt: '2025-01-01T00:00:00.000Z',
        salesEndAt: '2025-01-31T23:59:59.000Z',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'totalSeats')).toBe(true);
    });

    it('should fail validation when salesStartAt is not a valid date string', async () => {
      const dto = plainToInstance(CreateEventDto, {
        name: 'Test Event',
        totalSeats: 100,
        salesStartAt: 'invalid-date',
        salesEndAt: '2025-01-31T23:59:59.000Z',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'salesStartAt')).toBe(true);
    });

    it('should fail validation when salesEndAt is missing', async () => {
      const dto = plainToInstance(CreateEventDto, {
        name: 'Test Event',
        totalSeats: 100,
        salesStartAt: '2025-01-01T00:00:00.000Z',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'salesEndAt')).toBe(true);
    });
  });

  describe('LoginDto', () => {
    it('should pass validation with valid data', async () => {
      const dto = plainToInstance(LoginDto, {
        email: 'test@example.com',
        password: 'password123',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation when email is invalid', async () => {
      const dto = plainToInstance(LoginDto, {
        email: 'not-an-email',
        password: 'password123',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'email')).toBe(true);
    });

    it('should fail validation when email is missing', async () => {
      const dto = plainToInstance(LoginDto, {
        password: 'password123',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'email')).toBe(true);
    });

    it('should fail validation when password is too short', async () => {
      const dto = plainToInstance(LoginDto, {
        email: 'test@example.com',
        password: '12345',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'password')).toBe(true);
    });

    it('should fail validation when password is missing', async () => {
      const dto = plainToInstance(LoginDto, {
        email: 'test@example.com',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'password')).toBe(true);
    });
  });

  describe('EventResponseDto', () => {
    it('should pass validation with valid data', async () => {
      const dto = plainToInstance(EventResponseDto, {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Event',
        totalSeats: 100,
        remainingSeats: 50,
        salesStartAt: new Date('2025-01-01'),
        salesEndAt: new Date('2025-01-31'),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation when id is not a valid UUID', async () => {
      const dto = plainToInstance(EventResponseDto, {
        id: 'not-a-uuid',
        name: 'Test Event',
        totalSeats: 100,
        remainingSeats: 50,
        salesStartAt: new Date('2025-01-01'),
        salesEndAt: new Date('2025-01-31'),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'id')).toBe(true);
    });

    it('should fail validation when remainingSeats is negative', async () => {
      const dto = plainToInstance(EventResponseDto, {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Event',
        totalSeats: 100,
        remainingSeats: -1,
        salesStartAt: new Date('2025-01-01'),
        salesEndAt: new Date('2025-01-31'),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'remainingSeats')).toBe(true);
    });
  });

  describe('QueueStatusDto', () => {
    it('should pass validation with valid data', async () => {
      const dto = plainToInstance(QueueStatusDto, {
        position: 5,
        status: QueueEntryStatus.WAITING,
        eventId: '550e8400-e29b-41d4-a716-446655440000',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should pass validation with optional fields', async () => {
      const dto = plainToInstance(QueueStatusDto, {
        position: 1,
        status: QueueEntryStatus.ACTIVE,
        eventId: '550e8400-e29b-41d4-a716-446655440000',
        expiresAt: new Date('2025-01-01T00:05:00.000Z'),
        reservationId: '550e8400-e29b-41d4-a716-446655440001',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation when position is negative', async () => {
      const dto = plainToInstance(QueueStatusDto, {
        position: -1,
        status: QueueEntryStatus.WAITING,
        eventId: '550e8400-e29b-41d4-a716-446655440000',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'position')).toBe(true);
    });

    it('should fail validation when status is invalid', async () => {
      const dto = plainToInstance(QueueStatusDto, {
        position: 5,
        status: 'INVALID_STATUS',
        eventId: '550e8400-e29b-41d4-a716-446655440000',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'status')).toBe(true);
    });

    it('should fail validation when eventId is not a valid UUID', async () => {
      const dto = plainToInstance(QueueStatusDto, {
        position: 5,
        status: QueueEntryStatus.WAITING,
        eventId: 'not-a-uuid',
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'eventId')).toBe(true);
    });
  });

  describe('ReservationResponseDto', () => {
    it('should pass validation with valid data', async () => {
      const dto = plainToInstance(ReservationResponseDto, {
        id: '550e8400-e29b-41d4-a716-446655440000',
        eventId: '550e8400-e29b-41d4-a716-446655440001',
        userId: '550e8400-e29b-41d4-a716-446655440002',
        status: ReservationStatus.PENDING_PAYMENT,
        expiresAt: new Date('2025-01-01T00:05:00.000Z'),
        paidAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should pass validation with paidAt set', async () => {
      const dto = plainToInstance(ReservationResponseDto, {
        id: '550e8400-e29b-41d4-a716-446655440000',
        eventId: '550e8400-e29b-41d4-a716-446655440001',
        userId: '550e8400-e29b-41d4-a716-446655440002',
        status: ReservationStatus.PAID,
        expiresAt: new Date('2025-01-01T00:05:00.000Z'),
        paidAt: new Date('2025-01-01T00:03:00.000Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail validation when status is invalid', async () => {
      const dto = plainToInstance(ReservationResponseDto, {
        id: '550e8400-e29b-41d4-a716-446655440000',
        eventId: '550e8400-e29b-41d4-a716-446655440001',
        userId: '550e8400-e29b-41d4-a716-446655440002',
        status: 'INVALID_STATUS',
        expiresAt: new Date('2025-01-01T00:05:00.000Z'),
        paidAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'status')).toBe(true);
    });

    it('should fail validation when userId is not a valid UUID', async () => {
      const dto = plainToInstance(ReservationResponseDto, {
        id: '550e8400-e29b-41d4-a716-446655440000',
        eventId: '550e8400-e29b-41d4-a716-446655440001',
        userId: 'not-a-uuid',
        status: ReservationStatus.PENDING_PAYMENT,
        expiresAt: new Date('2025-01-01T00:05:00.000Z'),
        paidAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'userId')).toBe(true);
    });
  });
});
