import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Event } from './entities/event.entity';
import { RedisService } from '../redis/redis.service';
import { CreateEventDto } from './dto/create-event.dto';

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>,
    private readonly redisService: RedisService,
  ) {}

  async create(createEventDto: CreateEventDto): Promise<Event> {
    const event = this.eventRepository.create(createEventDto);
    const savedEvent = await this.eventRepository.save(event);

    // Initialize Redis seat counter (Requirement 1.4)
    await this.redisService.initializeSeats(savedEvent.id, savedEvent.totalSeats);

    return savedEvent;
  }

  async findAll(): Promise<(Event & { remainingSeats: number })[]> {
    const events = await this.eventRepository.find();
    
    const eventsWithSeats = await Promise.all(
      events.map(async (event) => {
        const remainingSeats = await this.redisService.getRemainingSeats(event.id);
        return { ...event, remainingSeats };
      }),
    );

    return eventsWithSeats;
  }

  async findById(id: string): Promise<Event & { remainingSeats: number }> {
    const event = await this.eventRepository.findOne({ where: { id } });
    
    if (!event) {
      throw new NotFoundException(`Event with ID ${id} not found`);
    }

    const remainingSeats = await this.redisService.getRemainingSeats(id);
    return { ...event, remainingSeats };
  }
}
