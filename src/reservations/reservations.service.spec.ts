import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import {
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import { QueueEntry, QueueEntryStatus } from '../queue/entities/queue-entry.entity';
import { RedisService } from '../redis/redis.service';
import { NotificationService } from '../notification/notification.service';
import { RESERVATION_EXPIRATION_QUEUE } from '../queue/queue.module';

describe('ReservationsService', () => {
  let service: ReservationsService;
  let mockReservationRepository: any;
  let mockQueueEntryRepository: any;
  let mockRedisService: any;
  let mockExpirationQueue: any;

  beforeEach(async () => {
    mockReservationRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };

    mockQueueEntryRepository = {
      update: jest.fn(),
    };

    mockRedisService = {
      incrementSeats: jest.fn(),
      setReservationExpired: jest.fn(),
      removeActiveUser: jest.fn(),
    };

    mockExpirationQueue = {
      add: jest.fn(),
    };

    const mockNotificationService = {
      notifyQueuePosition: jest.fn(),
      notifyActiveStatus: jest.fn(),
      notifySoldOut: jest.fn(),
      notifyReservationExpired: jest.fn(),
      notifyPaymentSuccess: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationsService,
        {
          provide: getRepositoryToken(Reservation),
          useValue: mockReservationRepository,
        },
        {
          provide: getRepositoryToken(QueueEntry),
          useValue: mockQueueEntryRepository,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: getQueueToken(RESERVATION_EXPIRATION_QUEUE),
          useValue: mockExpirationQueue,
        },
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    service = module.get<ReservationsService>(ReservationsService);
  });

  describe('processPayment', () => {
    const reservationId = 'res-123';
    const userId = 'user-123';
    const eventId = 'event-123';

    it('should successfully process payment for valid reservation', async () => {
      // Arrange
      const reservation: Partial<Reservation> = {
        id: reservationId,
        eventId,
        userId,
        status: ReservationStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() + 60000), // 1 minute in future
        paidAt: null,
      };

      mockReservationRepository.findOne.mockResolvedValue(reservation);
      mockReservationRepository.save.mockImplementation((r: Reservation) =>
        Promise.resolve({ ...r }),
      );
      mockQueueEntryRepository.update.mockResolvedValue({ affected: 1 });

      // Act
      const result = await service.processPayment(reservationId, userId);

      // Assert
      expect(result.status).toBe(ReservationStatus.PAID);
      expect(result.paidAt).toBeDefined();
      expect(mockQueueEntryRepository.update).toHaveBeenCalledWith(
        { eventId, userId },
        { status: QueueEntryStatus.DONE },
      );
    });

    it('should throw NotFoundException for non-existent reservation', async () => {
      // Arrange
      mockReservationRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.processPayment(reservationId, userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ForbiddenException when user does not own reservation', async () => {
      // Arrange
      const reservation: Partial<Reservation> = {
        id: reservationId,
        eventId,
        userId: 'other-user',
        status: ReservationStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() + 60000),
      };

      mockReservationRepository.findOne.mockResolvedValue(reservation);

      // Act & Assert
      await expect(service.processPayment(reservationId, userId)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw BadRequestException for expired reservation', async () => {
      // Arrange
      const reservation: Partial<Reservation> = {
        id: reservationId,
        eventId,
        userId,
        status: ReservationStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() - 1000), // Already expired
      };

      mockReservationRepository.findOne.mockResolvedValue(reservation);

      // Act & Assert
      await expect(service.processPayment(reservationId, userId)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.processPayment(reservationId, userId)).rejects.toThrow(
        'Reservation has expired',
      );
    });

    it('should throw BadRequestException for non-PENDING_PAYMENT status', async () => {
      // Arrange
      const reservation: Partial<Reservation> = {
        id: reservationId,
        eventId,
        userId,
        status: ReservationStatus.PAID,
        expiresAt: new Date(Date.now() + 60000),
      };

      mockReservationRepository.findOne.mockResolvedValue(reservation);

      // Act & Assert
      await expect(service.processPayment(reservationId, userId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });


  describe('expireReservation', () => {
    const reservationId = 'res-123';
    const userId = 'user-123';
    const eventId = 'event-123';

    it('should successfully expire PENDING_PAYMENT reservation', async () => {
      // Arrange
      const reservation: Partial<Reservation> = {
        id: reservationId,
        eventId,
        userId,
        status: ReservationStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() - 1000),
      };

      mockReservationRepository.findOne.mockResolvedValue(reservation);
      mockRedisService.setReservationExpired.mockResolvedValue(true);
      mockRedisService.incrementSeats.mockResolvedValue(1);
      mockReservationRepository.update.mockResolvedValue({ affected: 1 });
      mockQueueEntryRepository.update.mockResolvedValue({ affected: 1 });
      mockRedisService.removeActiveUser.mockResolvedValue(undefined);

      // Act
      const result = await service.expireReservation(reservationId);

      // Assert
      expect(result.processed).toBe(true);
      expect(result.reason).toBe('expired');
      expect(mockRedisService.incrementSeats).toHaveBeenCalledWith(eventId);
      expect(mockReservationRepository.update).toHaveBeenCalledWith(
        { id: reservationId },
        { status: ReservationStatus.EXPIRED },
      );
      expect(mockQueueEntryRepository.update).toHaveBeenCalledWith(
        { eventId, userId },
        { status: QueueEntryStatus.EXPIRED },
      );
    });

    it('should return not_found for non-existent reservation', async () => {
      // Arrange
      mockReservationRepository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.expireReservation(reservationId);

      // Assert
      expect(result.processed).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('should return not_pending for already processed reservation', async () => {
      // Arrange
      const reservation: Partial<Reservation> = {
        id: reservationId,
        eventId,
        userId,
        status: ReservationStatus.PAID,
        expiresAt: new Date(Date.now() - 1000),
      };

      mockReservationRepository.findOne.mockResolvedValue(reservation);

      // Act
      const result = await service.expireReservation(reservationId);

      // Assert
      expect(result.processed).toBe(false);
      expect(result.reason).toBe('not_pending');
      expect(mockRedisService.incrementSeats).not.toHaveBeenCalled();
    });

    it('should return already_processed when idempotency lock exists', async () => {
      // Arrange
      const reservation: Partial<Reservation> = {
        id: reservationId,
        eventId,
        userId,
        status: ReservationStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() - 1000),
      };

      mockReservationRepository.findOne.mockResolvedValue(reservation);
      mockRedisService.setReservationExpired.mockResolvedValue(false); // Lock already exists

      // Act
      const result = await service.expireReservation(reservationId);

      // Assert
      expect(result.processed).toBe(false);
      expect(result.reason).toBe('already_processed');
      expect(mockRedisService.incrementSeats).not.toHaveBeenCalled();
    });

    it('should handle EXPIRED status reservation', async () => {
      // Arrange
      const reservation: Partial<Reservation> = {
        id: reservationId,
        eventId,
        userId,
        status: ReservationStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 1000),
      };

      mockReservationRepository.findOne.mockResolvedValue(reservation);

      // Act
      const result = await service.expireReservation(reservationId);

      // Assert
      expect(result.processed).toBe(false);
      expect(result.reason).toBe('not_pending');
    });
  });

  describe('createReservation', () => {
    const eventId = 'event-123';
    const userId = 'user-123';

    it('should create reservation with correct expiration time', async () => {
      // Arrange
      const createdReservation = {
        id: 'res-new',
        eventId,
        userId,
        status: ReservationStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() + 300000),
      };

      mockReservationRepository.create.mockReturnValue(createdReservation);
      mockReservationRepository.save.mockResolvedValue(createdReservation);
      mockExpirationQueue.add.mockResolvedValue({});

      // Act
      const result = await service.createReservation(eventId, userId);

      // Assert
      expect(result.status).toBe(ReservationStatus.PENDING_PAYMENT);
      expect(mockExpirationQueue.add).toHaveBeenCalledWith(
        'expire-reservation',
        expect.objectContaining({
          reservationId: createdReservation.id,
          eventId,
          userId,
        }),
        expect.objectContaining({
          delay: 300000, // 5 minutes
        }),
      );
    });

    it('should schedule expiration job with correct job ID', async () => {
      // Arrange
      const createdReservation = {
        id: 'res-unique-id',
        eventId,
        userId,
        status: ReservationStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() + 300000),
      };

      mockReservationRepository.create.mockReturnValue(createdReservation);
      mockReservationRepository.save.mockResolvedValue(createdReservation);
      mockExpirationQueue.add.mockResolvedValue({});

      // Act
      await service.createReservation(eventId, userId);

      // Assert
      expect(mockExpirationQueue.add).toHaveBeenCalledWith(
        'expire-reservation',
        expect.any(Object),
        expect.objectContaining({
          jobId: `expire-${createdReservation.id}`,
        }),
      );
    });
  });
});
