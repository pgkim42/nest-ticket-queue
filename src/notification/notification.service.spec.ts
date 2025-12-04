import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { NotificationGateway } from './notification.gateway';

describe('NotificationService', () => {
  let service: NotificationService;
  let gateway: jest.Mocked<NotificationGateway>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: NotificationGateway,
          useValue: {
            emitToUser: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    gateway = module.get(NotificationGateway);
  });

  describe('notifyQueuePosition', () => {
    it('should emit queue:position event to user', () => {
      const userId = 'user-123';
      const payload = {
        eventId: 'event-456',
        position: 5,
        status: 'WAITING',
      };

      service.notifyQueuePosition(userId, payload);

      expect(gateway.emitToUser).toHaveBeenCalledWith(
        userId,
        'queue:position',
        payload,
      );
    });
  });

  describe('notifyActiveStatus', () => {
    it('should emit queue:active event to user with reservation details', () => {
      const userId = 'user-123';
      const payload = {
        eventId: 'event-456',
        reservationId: 'res-789',
        expiresAt: new Date('2025-12-04T12:00:00Z'),
      };

      service.notifyActiveStatus(userId, payload);

      expect(gateway.emitToUser).toHaveBeenCalledWith(
        userId,
        'queue:active',
        payload,
      );
    });
  });

  describe('notifySoldOut', () => {
    it('should emit queue:soldout event to user', () => {
      const userId = 'user-123';
      const payload = {
        eventId: 'event-456',
      };

      service.notifySoldOut(userId, payload);

      expect(gateway.emitToUser).toHaveBeenCalledWith(
        userId,
        'queue:soldout',
        payload,
      );
    });
  });

  describe('notifyReservationExpired', () => {
    it('should emit reservation:expired event to user', () => {
      const userId = 'user-123';
      const payload = {
        reservationId: 'res-789',
        eventId: 'event-456',
      };

      service.notifyReservationExpired(userId, payload);

      expect(gateway.emitToUser).toHaveBeenCalledWith(
        userId,
        'reservation:expired',
        payload,
      );
    });
  });

  describe('notifyPaymentSuccess', () => {
    it('should emit reservation:paid event to user', () => {
      const userId = 'user-123';
      const payload = {
        reservationId: 'res-789',
        eventId: 'event-456',
        paidAt: new Date('2025-12-04T12:00:00Z'),
      };

      service.notifyPaymentSuccess(userId, payload);

      expect(gateway.emitToUser).toHaveBeenCalledWith(
        userId,
        'reservation:paid',
        payload,
      );
    });
  });
});
