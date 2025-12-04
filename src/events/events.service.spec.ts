import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { EventsService } from './events.service';
import { Event } from './entities/event.entity';
import { RedisService } from '../redis/redis.service';
import { CreateEventDto } from './dto/create-event.dto';

describe('EventsService', () => {
  let service: EventsService;
  let eventRepository: jest.Mocked<Repository<Event>>;
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

  beforeEach(async () => {
    const mockEventRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
    };

    const mockRedisService = {
      initializeSeats: jest.fn(),
      getRemainingSeats: jest.fn(),
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

    service = module.get<EventsService>(EventsService);
    eventRepository = module.get(getRepositoryToken(Event));
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
});
