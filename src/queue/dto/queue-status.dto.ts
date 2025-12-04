import { Expose, Transform, Type } from 'class-transformer';
import { IsInt, IsEnum, IsUUID, IsOptional, IsDate, IsString, Min } from 'class-validator';
import { QueueEntryStatus } from '../entities/queue-entry.entity';

// Helper function to safely convert Date to ISO string
const dateToIsoString = (value: unknown): string | unknown => {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString();
  }
  return value;
};

export class QueueStatusDto {
  @Expose()
  @IsInt()
  @Min(0)
  position!: number;

  @Expose()
  @IsEnum(QueueEntryStatus)
  status!: QueueEntryStatus;

  @Expose()
  @IsUUID()
  eventId!: string;

  @Expose()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  @Transform(({ value }) => dateToIsoString(value), { toPlainOnly: true })
  expiresAt?: Date;

  @Expose()
  @IsOptional()
  @IsUUID()
  reservationId?: string;
}

export class JoinQueueResponseDto {
  @Expose()
  @IsInt()
  @Min(0)
  position!: number;

  @Expose()
  @IsEnum(QueueEntryStatus)
  status!: QueueEntryStatus;

  @Expose()
  @IsUUID()
  eventId!: string;

  @Expose()
  @IsString()
  message!: string;
}
