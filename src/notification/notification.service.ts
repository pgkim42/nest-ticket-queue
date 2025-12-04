import { Injectable } from '@nestjs/common';
import { NotificationGateway } from './notification.gateway';

export interface QueuePositionPayload {
  eventId: string;
  position: number;
  status: string;
}

export interface ActiveStatusPayload {
  eventId: string;
  reservationId: string;
  expiresAt: Date;
}

export interface SoldOutPayload {
  eventId: string;
}

export interface ReservationExpiredPayload {
  reservationId: string;
  eventId: string;
}

export interface PaymentSuccessPayload {
  reservationId: string;
  eventId: string;
  paidAt: Date;
}

@Injectable()
export class NotificationService {
  constructor(private readonly gateway: NotificationGateway) {}

  /**
   * Notify user about their queue position change
   * Emits: queue:position
   * Requirements: 8.2
   */
  notifyQueuePosition(userId: string, payload: QueuePositionPayload): void {
    this.gateway.emitToUser(userId, 'queue:position', payload);
  }

  /**
   * Notify user when promoted to ACTIVE status with reservation details
   * Emits: queue:active
   * Requirements: 8.3, 4.3
   */
  notifyActiveStatus(userId: string, payload: ActiveStatusPayload): void {
    this.gateway.emitToUser(userId, 'queue:active', payload);
  }

  /**
   * Notify user when event is sold out
   * Emits: queue:soldout
   * Requirements: 8.4
   */
  notifySoldOut(userId: string, payload: SoldOutPayload): void {
    this.gateway.emitToUser(userId, 'queue:soldout', payload);
  }

  /**
   * Notify user when their reservation has expired
   * Emits: reservation:expired
   * Requirements: 7.4
   */
  notifyReservationExpired(
    userId: string,
    payload: ReservationExpiredPayload,
  ): void {
    this.gateway.emitToUser(userId, 'reservation:expired', payload);
  }

  /**
   * Notify user when payment is successful
   * Emits: reservation:paid
   * Requirements: 6.4
   */
  notifyPaymentSuccess(userId: string, payload: PaymentSuccessPayload): void {
    this.gateway.emitToUser(userId, 'reservation:paid', payload);
  }
}
