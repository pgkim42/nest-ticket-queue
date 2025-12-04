import {
  Controller,
  Post,
  Param,
  UseGuards,
  ParseUUIDPipe,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('reservations')
@UseGuards(JwtAuthGuard)
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  /**
   * POST /reservations/:id/pay - Process payment for a reservation
   * 
   * Requirements: 6.1, 6.2, 6.3, 5.5
   * - Verify ownership and PENDING_PAYMENT status
   * - Verify not expired (expiresAt > now)
   * - Update status to PAID, set paidAt
   * - Update QueueEntry status to DONE
   */
  @Post(':id/pay')
  async processPayment(
    @Param('id', ParseUUIDPipe) reservationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.reservationsService.processPayment(reservationId, userId);
  }
}
