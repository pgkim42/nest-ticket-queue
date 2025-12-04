import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@Controller()
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  // POST /admin/events - Create event (admin only)
  @Post('admin/events')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async create(@Body() createEventDto: CreateEventDto) {
    return this.eventsService.create(createEventDto);
  }

  // GET /events - List all events
  @Get('events')
  async findAll() {
    return this.eventsService.findAll();
  }

  // GET /events/:id - Get event details with remaining seats
  @Get('events/:id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventsService.findById(id);
  }

  // GET /admin/events/:id/stats - Get event statistics (admin only)
  // Requirements: 10.1, 10.2, 10.3
  @Get('admin/events/:id/stats')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getStats(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventsService.getStats(id);
  }
}
