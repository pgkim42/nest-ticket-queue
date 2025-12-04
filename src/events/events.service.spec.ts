import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { EventsService } from './events.service';
import { Event } from './entities/event.entity';
import { Reservation, ReservationStatus } from '../reservations/entities/reservation.entity';
import { RedisService } from '../redis/redis.service';
import { CreateEventDto } from './dto/create-event.dto';

describe('EventsService', () => {
  let service: EventsService;
  let eventRepository: jest.Mocked<Repository<Event>>;
  let reservationRepository: jest.Mocked<Repository<Reservation>>;
  let redisService: jest.Mocked<RedisService>;

  const mockEvent: Event = {
    id: 'event-123',
    name: 'Test Concert',
    totalSeats: 100,
    salesStartAt: new Date('2025-01-01'),
    salesEndAt: new Date('2025-01-31'),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Mock query builder for reservation counts
  const createMockQueryBuilder = (rawResults: { status: ReservationStatus; count: string }[]) => {
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rawResults),
    } as unknown as SelectQueryBuilder<Reservation>;
    return mockQueryBuilder;
  };

  beforeEach(async () => {
    const mockEventRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
    };

    const mockReservationRepository = {
      createQueryBuilder: jest.fn(),
    };

    const mockRedisService = {
      initializeSeats: jest.fn(),
      getRemainingSeats: jest.fn(),
      getQueueLength: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        {
          provide: getRepositoryToken(Event),
          useValue: mockEventRepository,
        },
        {
          provide: getRepositoryToken(Reservation),
          useValue: mockReservationRepository,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    eventRepository = module.get(getRepositoryToken(Event));
    reservationRepository = module.get(getRepositoryToken(Reservation));
    redisService = module.get(RedisService);
  });

  describe('create', () => {
    it('should create an event and initialize Redis seat counter', async () => {
      // Arrange
      const createEventDto: CreateEventDto = {
        name: 'Test Concert',
        totalSeats: 100,
        salesStartAt: '2025-01-01T00:00:00.000Z',
        salesEndAt: '2025-01-31T00:00:00.000Z',
      };

      eventRepository.create.mockReturnValue(mockEvent);
      eventRepository.save.mockResolvedValue(mockEvent);
      redisService.initializeSeats.mockResolvedValue(undefined);

      // Act
      const result = await service.create(createEventDto);

      // Assert
      expect(eventRepository.create).toHaveBeenCalledWith(createEventDto);
      expect(eventRepository.save).toHaveBeenCalledWith(mockEvent);
      expect(redisService.initializeSeats).toHaveBeenCalledWith(
        mockEvent.id,
        mockEvent.totalSeats,
      );
      expect(result).toEqual(mockEvent);
    });
  });

  describe('findAll', () => {
    it('should return all events with remaining seats from Redis', async () => {
      // Arrange
      const events = [mockEvent, { ...mockEvent, id: 'event-456', totalSeats: 50 }];
      eventRepository.find.mockResolvedValue(events);
      redisService.getRemainingSeats
        .mockResolvedValueOnce(80)
        .mockResolvedValueOnce(30);

      // Act
      const result = await service.findAll();

      // Assert
      expect(eventRepository.find).toHaveBeenCalled();
      expect(redisService.getRemainingSeats).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
      expect(result[0].remainingSeats).toBe(80);
      expect(result[1].remainingSeats).toBe(30);
    });

    it('should return empty array when no events exist', async () => {
      // Arrange
      eventRepository.find.mockResolvedValue([]);

      // Act
      const result = await service.findAll();

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should return event with remaining seats from Redis', async () => {
      // Arrange
      eventRepository.findOne.mockResolvedValue(mockEvent);
      redisService.getRemainingSeats.mockResolvedValue(75);

      // Act
      const result = await service.findById('event-123');

      // Assert
      expect(eventRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'event-123' },
      });
      expect(redisService.getRemainingSeats).toHaveBeenCalledWith('event-123');
      expect(result.remainingSeats).toBe(75);
      expect(result.id).toBe(mockEvent.id);
    });

    it('should throw NotFoundException when event does not exist', async () => {
      // Arrange
      eventRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findById('non-existent')).rejects.toThrow(
        'Event with ID non-existent not found',
      );
    });
  });

  describe('getStats', () => {
    // Requirements: 10.1, 10.2, 10.3
    it('should return event statistics with remaining seats, queue length, and reservation counts', async () => {
      // Arrange
      eventRepository.findOne.mockResolvedValue(mockEvent);
      redisService.getRemainingSeats.mockResolvedValue(75);
      redisService.getQueueLength.mockResolvedValue(50);
      
      const mockQueryBuilder = createMockQueryBuilder([
        { status: ReservationStatus.PENDING_PAYMENT, count: '5' },
        { status: ReservationStatus.PAID, count: '20' },
        { status: ReservationStatus.EXPIRED, count: '3' },
      ]);
      reservationRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getStats('event-123');

      // Assert
      expect(eventRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'event-123' },
      });
      expect(redisService.getRemainingSeats).toHaveBeenCalledWith('event-123');
      expect(redisService.getQueueLength).toHaveBeenCalledWith('event-123');
      expect(reservationRepository.createQueryBuilder).toHaveBeenCalledWith('reservation');
      
      expect(result).toEqual({
        eventId: 'event-123',
        remainingSeats: 75,
        queueLength: 50,
        reservationCounts: {
          PENDING_PAYMENT: 5,
          PAID: 20,
          EXPIRED: 3,
        },
      });
    });

    it('should return zero counts when no reservations exist', async () => {
      // Arrange
      eventRepository.findOne.mockResolvedValue(mockEvent);
      redisService.getRemainingSeats.mockResolvedValue(100);
      redisService.getQueueLength.mockResolvedValue(0);
      
      const mockQueryBuilder = createMockQueryBuilder([]);
      reservationRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Act
      const result = await service.getStats('event-123');

      // Assert
      expect(result.reservationCounts).toEqual({
        PENDING_PAYMENT: 0,
        PAID: 0,
        EXPIRED: 0,
      });
    });

    it('should throw NotFoundException when event does not exist', async () => {
      // Arrange
      eventRepository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getStats('non-existent')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.getStats('non-existent')).rejects.toThrow(
        'Event with ID non-existent not found',
      );
    });
  });
});
