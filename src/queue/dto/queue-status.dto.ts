import { QueueEntryStatus } from '../entities/queue-entry.entity';

export class QueueStatusDto {
  position!: number;
  status!: QueueEntryStatus;
  eventId!: string;
  expiresAt?: Date;
  reservationId?: string;
}

export class JoinQueueResponseDto {
  position!: number;
  status!: QueueEntryStatus;
  eventId!: string;
  message!: string;
}
