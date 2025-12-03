import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  let service: RedisService;
  let mockRedisClient: {
    ping: jest.Mock;
    quit: jest.Mock;
    set: jest.Mock;
    get: jest.Mock;
    incr: jest.Mock;
    decr: jest.Mock;
    zadd: jest.Mock;
    zrank: jest.Mock;
    zcard: jest.Mock;
    zrem: jest.Mock;
    zrange: jest.Mock;
    setex: jest.Mock;
    exists: jest.Mock;
    del: jest.Mock;
    setnx: jest.Mock;
    expire: jest.Mock;
    flushall: jest.Mock;
  };

  beforeEach(async () => {
    mockRedisClient = {
      ping: jest.fn().mockResolvedValue('PONG'),
      quit: jest.fn().mockResolvedValue('OK'),
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      incr: jest.fn().mockResolvedValue(1),
      decr: jest.fn().mockResolvedValue(0),
      zadd: jest.fn().mockResolvedValue(1),
      zrank: jest.fn().mockResolvedValue(0),
      zcard: jest.fn().mockResolvedValue(0),
      zrem: jest.fn().mockResolvedValue(1),
      zrange: jest.fn().mockResolvedValue([]),
      setex: jest.fn().mockResolvedValue('OK'),
      exists: jest.fn().mockResolvedValue(0),
      del: jest.fn().mockResolvedValue(1),
      setnx: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      flushall: jest.fn().mockResolvedValue('OK'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue: unknown) => defaultValue),
          },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    // Replace the internal client with mock
    (service as unknown as { client: typeof mockRedisClient }).client =
      mockRedisClient;
  });

  describe('connection handling', () => {
    it('should ping successfully', async () => {
      const result = await service.ping();
      expect(result).toBe('PONG');
      expect(mockRedisClient.ping).toHaveBeenCalled();
    });
  });

  describe('seat inventory operations', () => {
    const eventId = 'event-123';

    it('should initialize seats', async () => {
      await service.initializeSeats(eventId, 100);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        `remainingSeats:${eventId}`,
        100,
      );
    });

    it('should decrement seats', async () => {
      mockRedisClient.decr.mockResolvedValue(99);
      const result = await service.decrementSeats(eventId);
      expect(result).toBe(99);
      expect(mockRedisClient.decr).toHaveBeenCalledWith(
        `remainingSeats:${eventId}`,
      );
    });

    it('should increment seats', async () => {
      mockRedisClient.incr.mockResolvedValue(101);
      const result = await service.incrementSeats(eventId);
      expect(result).toBe(101);
      expect(mockRedisClient.incr).toHaveBeenCalledWith(
        `remainingSeats:${eventId}`,
      );
    });

    it('should get remaining seats', async () => {
      mockRedisClient.get.mockResolvedValue('50');
      const result = await service.getRemainingSeats(eventId);
      expect(result).toBe(50);
    });

    it('should return 0 when no seats key exists', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      const result = await service.getRemainingSeats(eventId);
      expect(result).toBe(0);
    });
  });

  describe('queue operations', () => {
    const eventId = 'event-123';
    const userId = 'user-456';

    it('should add user to queue and return position', async () => {
      mockRedisClient.zrank.mockResolvedValue(0);
      const position = await service.addToQueue(eventId, userId);
      expect(position).toBe(1);
      expect(mockRedisClient.zadd).toHaveBeenCalled();
    });

    it('should get queue position', async () => {
      mockRedisClient.zrank.mockResolvedValue(2);
      const position = await service.getQueuePosition(eventId, userId);
      expect(position).toBe(3);
    });

    it('should return null for non-existent user position', async () => {
      mockRedisClient.zrank.mockResolvedValue(null);
      const position = await service.getQueuePosition(eventId, userId);
      expect(position).toBeNull();
    });

    it('should get queue length', async () => {
      mockRedisClient.zcard.mockResolvedValue(10);
      const length = await service.getQueueLength(eventId);
      expect(length).toBe(10);
    });

    it('should remove user from queue', async () => {
      await service.removeFromQueue(eventId, userId);
      expect(mockRedisClient.zrem).toHaveBeenCalledWith(
        `queue:${eventId}`,
        userId,
      );
    });

    it('should get next user in queue', async () => {
      mockRedisClient.zrange.mockResolvedValue(['user-first']);
      const next = await service.getNextInQueue(eventId);
      expect(next).toBe('user-first');
    });

    it('should return null when queue is empty', async () => {
      mockRedisClient.zrange.mockResolvedValue([]);
      const next = await service.getNextInQueue(eventId);
      expect(next).toBeNull();
    });
  });

  describe('active user management', () => {
    const eventId = 'event-123';
    const userId = 'user-456';

    it('should set active user with TTL', async () => {
      await service.setActiveUser(eventId, userId, 300);
      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        `active:${eventId}:${userId}`,
        300,
        '1',
      );
      expect(mockRedisClient.incr).toHaveBeenCalledWith(
        `activeCount:${eventId}`,
      );
    });

    it('should check if user is active', async () => {
      mockRedisClient.exists.mockResolvedValue(1);
      const isActive = await service.isActiveUser(eventId, userId);
      expect(isActive).toBe(true);
    });

    it('should return false for non-active user', async () => {
      mockRedisClient.exists.mockResolvedValue(0);
      const isActive = await service.isActiveUser(eventId, userId);
      expect(isActive).toBe(false);
    });

    it('should remove active user and decrement count', async () => {
      mockRedisClient.del.mockResolvedValue(1);
      await service.removeActiveUser(eventId, userId);
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        `active:${eventId}:${userId}`,
      );
      expect(mockRedisClient.decr).toHaveBeenCalledWith(
        `activeCount:${eventId}`,
      );
    });

    it('should get active count', async () => {
      mockRedisClient.get.mockResolvedValue('5');
      const count = await service.getActiveCount(eventId);
      expect(count).toBe(5);
    });
  });

  describe('reservation expiration idempotency', () => {
    const reservationId = 'res-123';

    it('should set reservation expired and return true on first call', async () => {
      mockRedisClient.setnx.mockResolvedValue(1);
      const result = await service.setReservationExpired(reservationId);
      expect(result).toBe(true);
      expect(mockRedisClient.expire).toHaveBeenCalledWith(
        `reservationExpired:${reservationId}`,
        3600,
      );
    });

    it('should return false on subsequent calls', async () => {
      mockRedisClient.setnx.mockResolvedValue(0);
      const result = await service.setReservationExpired(reservationId);
      expect(result).toBe(false);
      expect(mockRedisClient.expire).not.toHaveBeenCalled();
    });
  });
});
