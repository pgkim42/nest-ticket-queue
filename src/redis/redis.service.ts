import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.client = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 3) {
          this.logger.error('Redis connection failed after 3 retries');
          return null;
        }
        return Math.min(times * 100, 3000);
      },
    });
  }

  async onModuleInit() {
    try {
      await this.client.ping();
      this.logger.log('Redis connection established');
    } catch (error) {
      this.logger.error('Failed to connect to Redis', error);
    }
  }

  async onModuleDestroy() {
    await this.client.quit();
    this.logger.log('Redis connection closed');
  }

  getClient(): Redis {
    return this.client;
  }

  // Seat inventory operations
  async initializeSeats(eventId: string, count: number): Promise<void> {
    await this.client.set(`remainingSeats:${eventId}`, count);
  }

  async decrementSeats(eventId: string): Promise<number> {
    return this.client.decr(`remainingSeats:${eventId}`);
  }

  async incrementSeats(eventId: string): Promise<number> {
    return this.client.incr(`remainingSeats:${eventId}`);
  }

  async getRemainingSeats(eventId: string): Promise<number> {
    const seats = await this.client.get(`remainingSeats:${eventId}`);
    return seats ? parseInt(seats, 10) : 0;
  }

  // Queue operations
  async addToQueue(eventId: string, userId: string): Promise<number> {
    const timestamp = Date.now();
    await this.client.zadd(`queue:${eventId}`, timestamp, userId);
    const position = await this.client.zrank(`queue:${eventId}`, userId);
    return position !== null ? position + 1 : 1;
  }

  async getQueuePosition(
    eventId: string,
    userId: string,
  ): Promise<number | null> {
    const rank = await this.client.zrank(`queue:${eventId}`, userId);
    return rank !== null ? rank + 1 : null;
  }

  async getQueueLength(eventId: string): Promise<number> {
    return this.client.zcard(`queue:${eventId}`);
  }

  async removeFromQueue(eventId: string, userId: string): Promise<void> {
    await this.client.zrem(`queue:${eventId}`, userId);
  }

  async getNextInQueue(eventId: string): Promise<string | null> {
    const result = await this.client.zrange(`queue:${eventId}`, 0, 0);
    return result.length > 0 ? result[0] : null;
  }

  // Active user management
  async setActiveUser(
    eventId: string,
    userId: string,
    ttlSeconds: number,
  ): Promise<void> {
    await this.client.setex(`active:${eventId}:${userId}`, ttlSeconds, '1');
    await this.client.incr(`activeCount:${eventId}`);
  }

  async isActiveUser(eventId: string, userId: string): Promise<boolean> {
    const result = await this.client.exists(`active:${eventId}:${userId}`);
    return result === 1;
  }

  async removeActiveUser(eventId: string, userId: string): Promise<void> {
    const existed = await this.client.del(`active:${eventId}:${userId}`);
    if (existed) {
      await this.client.decr(`activeCount:${eventId}`);
    }
  }

  async getActiveCount(eventId: string): Promise<number> {
    const count = await this.client.get(`activeCount:${eventId}`);
    return count ? parseInt(count, 10) : 0;
  }

  // Reservation expiration idempotency
  async setReservationExpired(reservationId: string): Promise<boolean> {
    const result = await this.client.setnx(
      `reservationExpired:${reservationId}`,
      '1',
    );
    if (result === 1) {
      await this.client.expire(`reservationExpired:${reservationId}`, 3600);
      return true;
    }
    return false;
  }

  // Utility methods
  async ping(): Promise<string> {
    return this.client.ping();
  }

  async flushAll(): Promise<void> {
    await this.client.flushall();
  }
}
