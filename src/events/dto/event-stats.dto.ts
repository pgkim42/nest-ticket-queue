import { Expose, Type } from 'class-transformer';
import { IsUUID, IsInt, Min, ValidateNested } from 'class-validator';

export class ReservationCountsByStatusDto {
  @Expose()
  @IsInt()
  @Min(0)
  PENDING_PAYMENT!: number;

  @Expose()
  @IsInt()
  @Min(0)
  PAID!: number;

  @Expose()
  @IsInt()
  @Min(0)
  EXPIRED!: number;
}

export class EventStatsDto {
  @Expose()
  @IsUUID()
  eventId!: string;

  @Expose()
  @IsInt()
  @Min(0)
  remainingSeats!: number;

  @Expose()
  @IsInt()
  @Min(0)
  queueLength!: number;

  @Expose()
  @ValidateNested()
  @Type(() => ReservationCountsByStatusDto)
  reservationCounts!: ReservationCountsByStatusDto;
}
