import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Event } from '../../events/entities/event.entity';
import { User } from '../../users/entities/user.entity';

export enum ReservationStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAID = 'PAID',
  CANCELED = 'CANCELED', // Defined for future use, not created in this implementation
  EXPIRED = 'EXPIRED',
}

@Entity('reservations')
@Index(['eventId', 'userId'])
export class Reservation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  eventId!: string;

  @Column('uuid')
  userId!: string;

  @Column({
    type: 'enum',
    enum: ReservationStatus,
    default: ReservationStatus.PENDING_PAYMENT,
  })
  status!: ReservationStatus;

  @Column({ type: 'timestamp' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  paidAt!: Date | null;

  @ManyToOne(() => Event)
  @JoinColumn({ name: 'eventId' })
  event!: Event;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
