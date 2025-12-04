import { IsString, IsInt, IsDateString, Min, IsNotEmpty } from 'class-validator';

export class CreateEventDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsInt()
  @Min(1)
  totalSeats!: number;

  @IsDateString()
  salesStartAt!: string;

  @IsDateString()
  salesEndAt!: string;
}
