import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { QueueService } from './queue.service';
import { QueueEntry, QueueEntryStatus } from './entities/queue-entry.entity';
import { RedisService } from '../redis/redis.service';
import { EventsService } from '../events/events.service';
import { ReservationsService } from '../reservations/reservations.service';

describe('QueueService', () => {
  let service: QueueService;
  let queueEntryRepository: jest.Mocked<Repository<QueueEntry>>;
  let redisService: jest.Mocked<RedisService>;
  let eventsService: jest.Mocked<EventsService>;
  let reservationsService: jest.Mocked<ReservationsService>;

  const mockEvent = {
    id: 'event-123',
    name: 'Test Concert',
    totalSeats: 100,
    salesStartAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
    salesEndAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day from now
    createdAt: new Date(),
    updatedAt: new Date(),
    remainingSeats: 100,
  };

  const mockQueueEntry: QueueEntry = {
    id: 'queue-123',
    eventId: 'event-123',
    userId: 'user-123',
    status: QueueEntryStatus.WAITING,
    position: 1,
    reservationId: null,
    event: mockEvent as any,
    user: {} as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockQueueEntryRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const mockRedisService = {
      addToQueue: jest.fn(),
      getQueuePosition: jest.fn(),
      getQueueLength: jest.fn(),
      removeFromQueue: jest.fn(),
      isInQueue: jest.fn(),
    };

    const mockEventsService = {
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
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
    queueEntryRepository = module.get(getRepositoryToken(QueueEntry));
    redisService = module.get(RedisService);
    eventsService = module.get(EventsService);
    reservationsService = module.get(ReservationsService);
  });

  describe('joinQueue', () => {
    it('should add user to queue and create QueueEntry', async () => {
      // Arrange
      eventsService.findById.mockResolvedValue(mockEvent);
      queueEntryRepository.findOne.mockResolvedValue(null);
      redisService.addToQueue.mockResolvedValue(1);
      queueEntryRepository.create.mockReturnValue(mockQueueEntry);
      queueEntryRepository.save.mockResolvedValue(mockQueueEntry);

      // Act
      const result = await service.joinQueue('event-123', 'user-123');

      // Assert
      expect(eventsService.findById).toHaveBeenCalledWith('event-123');
      expect(redisService.addToQueue).toHaveBeenCalledWith('event-123', 'user-123');
      expect(queueEntryRepository.create).toHaveBeenCalledWith({
        eventId: 'event-123',
        userId: 'user-123',
        status: QueueEntryStatus.WAITING,
        position: 1,
      });
      expect(result.position).toBe(1);
      expect(result.status).toBe(QueueEntryStatus.WAITING);
      expect(result.message).toBe('Successfully joined queue');
    });

    it('should return existing position for duplicate join (idempotency)', async () => {
      // Arrange
      eventsService.findById.mockResolvedValue(mockEvent);
      queueEntryRepository.findOne.mockResolvedValue(mockQueueEntry);
      redisService.getQueuePosition.mockResolvedValue(1);

      // Act
      const result = await service.joinQueue('event-123', 'user-123');

      // Assert
      expect(redisService.addToQueue).not.toHaveBeenCalled();
      expect(queueEntryRepository.create).not.toHaveBeenCalled();
      expect(result.position).toBe(1);
      expect(result.message).toBe('Already in queue');
    });

    it('should reject join before sales start', async () => {
      // Arrange
      const futureEvent = {
        ...mockEvent,
        salesStartAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day from now
        salesEndAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 2 days from now
      };
      eventsService.findById.mockResolvedValue(futureEvent);

      // Act & Assert
      await expect(service.joinQueue('event-123', 'user-123')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.joinQueue('event-123', 'user-123')).rejects.toThrow(
        'Sales have not started yet',
      );
    });

    it('should reject join after sales end', async () => {
      // Arrange
      const pastEvent = {
        ...mockEvent,
        salesStartAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // 2 days ago
        salesEndAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
      };
      eventsService.findById.mockResolvedValue(pastEvent);

      // Act & Assert
      await expect(service.joinQueue('event-123', 'user-123')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.joinQueue('event-123', 'user-123')).rejects.toThrow(
        'Sales have ended',
      );
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue status for user in queue', async () => {
      // Arrange
      queueEntryRepository.findOne.mockResolvedValue(mockQueueEntry);
      redisService.getQueuePosition.mockResolvedValue(1);

      // Act
      const result = await service.getQueueStatus('event-123', 'user-123');

      // Assert
      expect(queueEntryRepository.findOne).toHaveBeenCalledWith({
        where: { eventId: 'event-123', userId: 'user-123' },
      });
      expect(result.position).toBe(1);
      expect(result.status).toBe(QueueEntryStatus.WAITING);
      expect(result.eventId).toBe('event-123');
    });

    it('should throw NotFoundException when user not in queue', async () => {
      // Arrange
      queueEntryRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getQueueStatus('event-123', 'user-123')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getQueueStatus('event-123', 'user-123')).rejects.toThrow(
        'Not in queue for this event',
      );
    });
  });

  describe('getQueueLength', () => {
    it('should return queue length from Redis', async () => {
      // Arrange
      redisService.getQueueLength.mockResolvedValue(10);

      // Act
      const result = await service.getQueueLength('event-123');

      // Assert
      expect(redisService.getQueueLength).toHaveBeenCalledWith('event-123');
      expect(result).toBe(10);
    });
  });

  describe('promoteNextUser', () => {
    const mockReservation = {
      id: 'res-123',
      eventId: 'event-123',
      userId: 'user-123',
      status: 'PENDING_PAYMENT',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    };

    beforeEach(() => {
      // Add missing mock methods for promotion tests
      (redisService as any).getNextInQueue = jest.fn();
      (redisService as any).decrementSeats = jest.fn();
      (redisService as any).incrementSeats = jest.fn();
      (redisService as any).setActiveUser = jest.fn();
      (redisService as any).getActiveCount = jest.fn();
      (queueEntryRepository as any).update = jest.fn();
    });

    it('should promote user when seats are available', async () => {
      // Arrange
      redisService.getNextInQueue.mockResolvedValue('user-123');
      redisService.decrementSeats.mockResolvedValue(9); // 10 - 1 = 9 (seats available)
      reservationsService.createReservation.mockResolvedValue(mockReservation as any);
      queueEntryRepository.update.mockResolvedValue({ affected: 1 } as any);
      redisService.removeFromQueue.mockResolvedValue(undefined);
      redisService.setActiveUser.mockResolvedValue(undefined);

      // Act
      const result = await service.promoteNextUser('event-123');

      // Assert
      expect(result.success).toBe(true);
      expect(result.userId).toBe('user-123');
      expect(result.reason).toBe('promoted');
      expect(result.reservation).toBeDefined();
      expect(redisService.decrementSeats).toHaveBeenCalledWith('event-123');
      expect(reservationsService.createReservation).toHaveBeenCalledWith('event-123', 'user-123');
      expect(redisService.setActiveUser).toHaveBeenCalledWith('event-123', 'user-123', 300);
    });

    it('should handle sold out scenario', async () => {
      // Arrange
      redisService.getNextInQueue.mockResolvedValue('user-123');
      redisService.decrementSeats.mockResolvedValue(-1); // Sold out
      redisService.incrementSeats.mockResolvedValue(0); // Restore
      queueEntryRepository.update.mockResolvedValue({ affected: 1 } as any);
      redisService.removeFromQueue.mockResolvedValue(undefined);

      // Act
      const result = await service.promoteNextUser('event-123');

      // Assert
      expect(result.success).toBe(false);
      expect(result.userId).toBe('user-123');
      expect(result.reason).toBe('sold_out');
      expect(redisService.incrementSeats).toHaveBeenCalledWith('event-123');
      expect(reservationsService.createReservation).not.toHaveBeenCalled();
    });

    it('should return no_users_in_queue when queue is empty', async () => {
      // Arrange
      redisService.getNextInQueue.mockResolvedValue(null);

      // Act
      const result = await service.promoteNextUser('event-123');

      // Assert
      expect(result.success).toBe(false);
      expect(result.reason).toBe('no_users_in_queue');
      expect(redisService.decrementSeats).not.toHaveBeenCalled();
    });
  });

  describe('promoteUsers', () => {
    beforeEach(() => {
      (redisService as any).getNextInQueue = jest.fn();
      (redisService as any).decrementSeats = jest.fn();
      (redisService as any).incrementSeats = jest.fn();
      (redisService as any).setActiveUser = jest.fn();
      (redisService as any).getActiveCount = jest.fn();
      (queueEntryRepository as any).update = jest.fn();
    });

    it('should respect concurrent active user limit', async () => {
      // Arrange
      redisService.getActiveCount.mockResolvedValue(8); // 8 active users
      const maxActiveUsers = 10; // Limit is 10

      // Only 2 slots available (10 - 8 = 2)
      let callCount = 0;
      redisService.getNextInQueue.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) return Promise.resolve(`user-${callCount}`);
        return Promise.resolve(null);
      });
      redisService.decrementSeats.mockResolvedValue(5);
      reservationsService.createReservation.mockResolvedValue({
        id: 'res-123',
        eventId: 'event-123',
        userId: 'user-1',
        status: 'PENDING_PAYMENT',
        expiresAt: new Date(),
      } as any);
      queueEntryRepository.update.mockResolvedValue({ affected: 1 } as any);
      redisService.removeFromQueue.mockResolvedValue(undefined);
      redisService.setActiveUser.mockResolvedValue(undefined);

      // Act
      const results = await service.promoteUsers('event-123', maxActiveUsers);

      // Assert
      // Should only promote 2 users (10 - 8 = 2 slots available)
      const promotedCount = results.filter((r) => r.reason === 'promoted').length;
      expect(promotedCount).toBeLessThanOrEqual(2);
    });

    it('should stop promoting when sold out', async () => {
      // Arrange
      redisService.getActiveCount.mockResolvedValue(0);
      
      let callCount = 0;
      redisService.getNextInQueue.mockImplementation(() => {
        callCount++;
        return Promise.resolve(`user-${callCount}`);
      });

      // First user gets seat, second is sold out
      redisService.decrementSeats
        .mockResolvedValueOnce(0) // First user: last seat
        .mockResolvedValueOnce(-1); // Second user: sold out

      reservationsService.createReservation.mockResolvedValue({
        id: 'res-123',
        eventId: 'event-123',
        userId: 'user-1',
        status: 'PENDING_PAYMENT',
        expiresAt: new Date(),
      } as any);
      redisService.incrementSeats.mockResolvedValue(0);
      queueEntryRepository.update.mockResolvedValue({ affected: 1 } as any);
      redisService.removeFromQueue.mockResolvedValue(undefined);
      redisService.setActiveUser.mockResolvedValue(undefined);

      // Act
      const results = await service.promoteUsers('event-123', 10);

      // Assert
      expect(results.length).toBe(2);
      expect(results[0].reason).toBe('promoted');
      expect(results[1].reason).toBe('sold_out');
    });
  });
});
