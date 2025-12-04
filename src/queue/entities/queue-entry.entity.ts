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

export enum QueueEntryStatus {
  WAITING = 'WAITING',
  ACTIVE = 'ACTIVE',
  DONE = 'DONE',
  EXPIRED = 'EXPIRED',
}

@Entity('queue_entries')
@Index(['eventId', 'userId'], { unique: true })
export class QueueEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  eventId!: string;

  @Column('uuid')
  userId!: string;

  @Column({
    type: 'enum',
    enum: QueueEntryStatus,
    default: QueueEntryStatus.WAITING,
  })
  status!: QueueEntryStatus;

  @Column({ type: 'int' })
  position!: number;

  @Column({ type: 'uuid', nullable: true })
  reservationId!: string | null;

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
