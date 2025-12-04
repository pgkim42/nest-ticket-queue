import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { User, UserRole } from '../users/entities/user.entity';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: JwtService;

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    passwordHash: '',
    name: 'Test User',
    role: UserRole.USER,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockUser.passwordHash = await bcrypt.hash('password123', 10);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            findById: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: new JwtService({
            secret: 'test-secret',
            signOptions: { expiresIn: '1h' },
          }),
        },
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('login', () => {
    it('should return access token for valid credentials', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);

      const result = await authService.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.accessToken).toBeDefined();
      expect(result.user.id).toBe(mockUser.id);
      expect(result.user.email).toBe(mockUser.email);
      expect(result.user.name).toBe(mockUser.name);
      expect(result.user.role).toBe(mockUser.role);
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        authService.login({
          email: 'nonexistent@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for invalid password', async () => {
      usersService.findByEmail.mockResolvedValue(mockUser);

      await expect(
        authService.login({
          email: 'test@example.com',
          password: 'wrongpassword',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('validateToken', () => {
    it('should return payload for valid token', async () => {
      const payload = { sub: 'user-123', email: 'test@example.com' };
      const token = jwtService.sign(payload);

      const result = await authService.validateToken(token);

      expect(result).not.toBeNull();
      expect(result?.sub).toBe(payload.sub);
      expect(result?.email).toBe(payload.email);
    });

    it('should return null for invalid token', async () => {
      const result = await authService.validateToken('invalid-token');

      expect(result).toBeNull();
    });

    it('should return null for expired token', async () => {
      const expiredJwtService = new JwtService({
        secret: 'test-secret',
        signOptions: { expiresIn: '-1s' },
      });
      const payload = { sub: 'user-123', email: 'test@example.com' };
      const expiredToken = expiredJwtService.sign(payload);

      const result = await authService.validateToken(expiredToken);

      expect(result).toBeNull();
    });
  });
});
