import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DataSource } from 'typeorm';
import { User, UserRole } from '../users/entities/user.entity';
import { Event } from '../events/entities/event.entity';
import { RedisService } from '../redis/redis.service';
import * as bcrypt from 'bcrypt';

/**
 * Seed script for development/testing
 * 
 * Creates:
 * - 1 admin user (admin@test.com / admin123)
 * - 2 regular users (user1@test.com, user2@test.com / password123)
 * - 2 events (one active, one upcoming)
 * 
 * Run: npx ts-node src/database/seed.ts
 */
async function seed() {
  console.log('🌱 Starting seed...');

  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);
  const redisService = app.get(RedisService);

  const userRepository = dataSource.getRepository(User);
  const eventRepository = dataSource.getRepository(Event);

  // Clean existing data
  console.log('🧹 Cleaning existing data...');
  await dataSource.query('TRUNCATE TABLE reservations, queue_entries, events, users CASCADE');

  // Create users
  console.log('👤 Creating users...');
  const passwordHash = await bcrypt.hash('password123', 10);
  const adminHash = await bcrypt.hash('admin123', 10);

  const admin = await userRepository.save({
    email: 'admin@test.com',
    passwordHash: adminHash,
    name: 'Admin User',
    role: UserRole.ADMIN,
  });

  const user1 = await userRepository.save({
    email: 'user1@test.com',
    passwordHash,
    name: 'Test User 1',
    role: UserRole.USER,
  });

  const user2 = await userRepository.save({
    email: 'user2@test.com',
    passwordHash,
    name: 'Test User 2',
    role: UserRole.USER,
  });

  console.log(`  ✅ Admin: admin@test.com / admin123`);
  console.log(`  ✅ User1: user1@test.com / password123`);
  console.log(`  ✅ User2: user2@test.com / password123`);

  // Create events
  console.log('🎫 Creating events...');
  const now = new Date();

  // Active event (sales open now)
  const activeEvent = await eventRepository.save({
    name: '2024 Winter Concert',
    totalSeats: 100,
    salesStartAt: new Date(now.getTime() - 60 * 60 * 1000), // 1 hour ago
    salesEndAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24 hours later
  });
  await redisService.initializeSeats(activeEvent.id, activeEvent.totalSeats);

  // Upcoming event (sales start tomorrow)
  const upcomingEvent = await eventRepository.save({
    name: '2025 New Year Festival',
    totalSeats: 50,
    salesStartAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), // Tomorrow
    salesEndAt: new Date(now.getTime() + 48 * 60 * 60 * 1000), // Day after
  });
  await redisService.initializeSeats(upcomingEvent.id, upcomingEvent.totalSeats);

  // Limited seats event (for testing competition)
  const limitedEvent = await eventRepository.save({
    name: 'VIP Private Show (5 seats only)',
    totalSeats: 5,
    salesStartAt: new Date(now.getTime() - 60 * 60 * 1000),
    salesEndAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
  });
  await redisService.initializeSeats(limitedEvent.id, limitedEvent.totalSeats);

  console.log(`  ✅ ${activeEvent.name} (${activeEvent.totalSeats} seats) - OPEN NOW`);
  console.log(`  ✅ ${upcomingEvent.name} (${upcomingEvent.totalSeats} seats) - Opens tomorrow`);
  console.log(`  ✅ ${limitedEvent.name} - OPEN NOW`);

  console.log('\n✨ Seed completed!');
  console.log('\n📋 Quick start:');
  console.log('  1. npm run start:dev');
  console.log('  2. Open http://localhost:3000/index.html');
  console.log('  3. Login with user1@test.com / password123');

  await app.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
