import { Expose, Transform, Type } from 'class-transformer';
import { IsUUID, IsEnum, IsDate, IsOptional } from 'class-validator';
import { ReservationStatus } from '../entities/reservation.entity';

// Helper function to safely convert Date to ISO string
const dateToIsoString = (value: unknown): string | unknown => {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString();
  }
  return value;
};

export class ReservationResponseDto {
  @Expose()
  @IsUUID()
  id!: string;

  @Expose()
  @IsUUID()
  eventId!: string;

  @Expose()
  @IsUUID()
  userId!: string;

  @Expose()
  @IsEnum(ReservationStatus)
  status!: ReservationStatus;

  @Expose()
  @IsDate()
  @Type(() => Date)
  @Transform(({ value }) => dateToIsoString(value), { toPlainOnly: true })
  expiresAt!: Date;

  @Expose()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  @Transform(({ value }) => dateToIsoString(value), { toPlainOnly: true })
  paidAt?: Date | null;

  @Expose()
  @IsDate()
  @Type(() => Date)
  @Transform(({ value }) => dateToIsoString(value), { toPlainOnly: true })
  createdAt!: Date;

  @Expose()
  @IsDate()
  @Type(() => Date)
  @Transform(({ value }) => dateToIsoString(value), { toPlainOnly: true })
  updatedAt!: Date;
}
