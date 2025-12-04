import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { QueueService } from './queue.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('events/:eventId/queue')
@UseGuards(JwtAuthGuard)
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  // POST /events/:id/queue/join - Join queue (Requirement 2.1)
  @Post('join')
  async joinQueue(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.queueService.joinQueue(eventId, userId);
  }

  // GET /events/:id/queue/me - Get queue position (Requirement 3.1)
  @Get('me')
  async getQueueStatus(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.queueService.getQueueStatus(eventId, userId);
  }
}
