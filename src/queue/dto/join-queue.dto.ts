import { IsUUID } from 'class-validator';

// Note: Currently the join queue endpoint uses path params (eventId) and JWT (userId)
// This DTO is provided for potential future use if body params are needed
export class JoinQueueDto {
  @IsUUID()
  eventId!: string;
}
