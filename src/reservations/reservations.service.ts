import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import { RESERVATION_EXPIRATION_QUEUE } from '../queue/queue.module';

const RESERVATION_TTL_SECONDS = 300; // 5 minutes

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepository: Repository<Reservation>,
    @InjectQueue(RESERVATION_EXPIRATION_QUEUE)
    private readonly expirationQueue: Queue,
  ) {}

  async createReservation(
    eventId: string,
    userId: string,
  ): Promise<Reservation> {
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_SECONDS * 1000);

    const reservation = this.reservationRepository.create({
      eventId,
      userId,
      status: ReservationStatus.PENDING_PAYMENT,
      expiresAt,
    });

    const savedReservation = await this.reservationRepository.save(reservation);

    // Schedule expiration job (delayed by 5 minutes)
    await this.expirationQueue.add(
      'expire-reservation',
      {
        reservationId: savedReservation.id,
        eventId,
        userId,
      },
      {
        delay: RESERVATION_TTL_SECONDS * 1000,
        jobId: `expire-${savedReservation.id}`,
      },
    );

    this.logger.log(
      `Created reservation ${savedReservation.id} for user ${userId}, expires at ${expiresAt.toISOString()}`,
    );

    return savedReservation;
  }

  async findById(id: string): Promise<Reservation | null> {
    return this.reservationRepository.findOne({ where: { id } });
  }

  async findByEventAndUser(
    eventId: string,
    userId: string,
  ): Promise<Reservation | null> {
    return this.reservationRepository.findOne({
      where: { eventId, userId },
      order: { createdAt: 'DESC' },
    });
  }
}
