import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(@ConnectedSocket() client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) {
        this.logger.warn(`Client ${client.id} connection rejected: No token`);
        client.disconnect();
        return;
      }

      const payload = await this.validateToken(token);
      if (!payload) {
        this.logger.warn(
          `Client ${client.id} connection rejected: Invalid token`,
        );
        client.disconnect();
        return;
      }

      // Store user ID in socket data for later use
      client.data.userId = payload.sub;

      // Join user-specific room for targeted notifications
      const userRoom = `user:${payload.sub}`;
      await client.join(userRoom);

      this.logger.log(
        `Client ${client.id} connected as user ${payload.sub}, joined room ${userRoom}`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Client ${client.id} connection error: ${errorMessage}`,
      );
      client.disconnect();
    }
  }

  handleDisconnect(@ConnectedSocket() client: Socket): void {
    const userId = client.data.userId;
    if (userId) {
      this.logger.log(`Client ${client.id} (user ${userId}) disconnected`);
    } else {
      this.logger.log(`Client ${client.id} disconnected`);
    }
  }

  private extractToken(client: Socket): string | null {
    // Try to get token from auth header or query parameter
    const authHeader = client.handshake.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    const token = client.handshake.auth?.token;
    if (token) {
      return token;
    }

    const queryToken = client.handshake.query?.token;
    if (typeof queryToken === 'string') {
      return queryToken;
    }

    return null;
  }

  private async validateToken(token: string): Promise<JwtPayload | null> {
    try {
      return this.jwtService.verify<JwtPayload>(token);
    } catch {
      return null;
    }
  }

  /**
   * Get the Socket.IO server instance for emitting events
   */
  getServer(): Server {
    return this.server;
  }

  /**
   * Emit event to a specific user's room
   */
  emitToUser(userId: string, event: string, data: unknown): void {
    const userRoom = `user:${userId}`;
    this.server.to(userRoom).emit(event, data);
  }
}
