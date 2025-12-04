import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Socket, Server } from 'socket.io';
import { NotificationGateway } from './notification.gateway';

describe('NotificationGateway', () => {
  let gateway: NotificationGateway;
  let jwtService: JwtService;

  const mockSocket = {
    id: 'socket-123',
    data: {},
    handshake: {
      headers: {},
      auth: {},
      query: {},
    },
    join: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket;

  const mockServer = {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
  } as unknown as Server;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationGateway,
        {
          provide: JwtService,
          useValue: new JwtService({
            secret: 'test-secret',
            signOptions: { expiresIn: '1h' },
          }),
        },
      ],
    }).compile();

    gateway = module.get<NotificationGateway>(NotificationGateway);
    jwtService = module.get<JwtService>(JwtService);

    // Set the mock server
    gateway.server = mockServer;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleConnection', () => {
    it('should authenticate and join user room with valid Bearer token', async () => {
      const token = jwtService.sign({ sub: 'user-123', email: 'test@example.com' });
      const socket = {
        ...mockSocket,
        data: {},
        handshake: {
          headers: { authorization: `Bearer ${token}` },
          auth: {},
          query: {},
        },
        join: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as Socket;

      await gateway.handleConnection(socket);

      expect(socket.data.userId).toBe('user-123');
      expect(socket.join).toHaveBeenCalledWith('user:user-123');
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('should authenticate with token from auth object', async () => {
      const token = jwtService.sign({ sub: 'user-456', email: 'test@example.com' });
      const socket = {
        ...mockSocket,
        data: {},
        handshake: {
          headers: {},
          auth: { token },
          query: {},
        },
        join: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as Socket;

      await gateway.handleConnection(socket);

      expect(socket.data.userId).toBe('user-456');
      expect(socket.join).toHaveBeenCalledWith('user:user-456');
    });

    it('should authenticate with token from query parameter', async () => {
      const token = jwtService.sign({ sub: 'user-789', email: 'test@example.com' });
      const socket = {
        ...mockSocket,
        data: {},
        handshake: {
          headers: {},
          auth: {},
          query: { token },
        },
        join: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as Socket;

      await gateway.handleConnection(socket);

      expect(socket.data.userId).toBe('user-789');
      expect(socket.join).toHaveBeenCalledWith('user:user-789');
    });

    it('should disconnect client with no token', async () => {
      const socket = {
        ...mockSocket,
        data: {},
        handshake: {
          headers: {},
          auth: {},
          query: {},
        },
        join: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as Socket;

      await gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('should disconnect client with invalid token', async () => {
      const socket = {
        ...mockSocket,
        data: {},
        handshake: {
          headers: { authorization: 'Bearer invalid-token' },
          auth: {},
          query: {},
        },
        join: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as Socket;

      await gateway.handleConnection(socket);

      expect(socket.disconnect).toHaveBeenCalled();
      expect(socket.join).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('should handle disconnect for authenticated user', () => {
      const socket = {
        ...mockSocket,
        data: { userId: 'user-123' },
      } as unknown as Socket;

      // Should not throw
      expect(() => gateway.handleDisconnect(socket)).not.toThrow();
    });

    it('should handle disconnect for unauthenticated client', () => {
      const socket = {
        ...mockSocket,
        data: {},
      } as unknown as Socket;

      // Should not throw
      expect(() => gateway.handleDisconnect(socket)).not.toThrow();
    });
  });

  describe('emitToUser', () => {
    it('should emit event to user-specific room', () => {
      const userId = 'user-123';
      const event = 'test:event';
      const data = { message: 'test' };

      gateway.emitToUser(userId, event, data);

      expect(mockServer.to).toHaveBeenCalledWith('user:user-123');
      expect(mockServer.emit).toHaveBeenCalledWith(event, data);
    });
  });

  describe('getServer', () => {
    it('should return the server instance', () => {
      const server = gateway.getServer();
      expect(server).toBe(mockServer);
    });
  });
});
