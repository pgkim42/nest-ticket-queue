import * as fc from 'fast-check';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtPayload } from './strategies/jwt.strategy';

/**
 * **Feature: nest-ticket-queue, Property 11: JWT Authentication Correctness**
 * **Validates: Requirements 9.2, 9.3**
 *
 * For any JWT token:
 * - If the token is valid and not expired, authentication SHALL succeed and return the correct user ID
 * - If the token is invalid or expired, authentication SHALL fail with null
 */
describe('Property 11: JWT Authentication Correctness', () => {
  const JWT_SECRET = 'test-secret-key';
  let jwtService: JwtService;
  let authService: AuthService;

  beforeEach(() => {
    jwtService = new JwtService({
      secret: JWT_SECRET,
      signOptions: { expiresIn: '1h' },
    });

    const mockUsersService = {} as UsersService;
    authService = new AuthService(mockUsersService, jwtService);
  });

  it('should return correct payload for valid tokens', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.emailAddress(),
        async (userId, email) => {
          const payload: JwtPayload = { sub: userId, email };
          const token = jwtService.sign(payload);

          const result = await authService.validateToken(token);

          expect(result).not.toBeNull();
          expect(result?.sub).toBe(userId);
          expect(result?.email).toBe(email);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return null for invalid tokens', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 500 }).filter(
          (s) => !s.includes('.') || s.split('.').length !== 3,
        ),
        async (invalidToken) => {
          const result = await authService.validateToken(invalidToken);
          expect(result).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return null for tokens signed with different secret', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.emailAddress(),
        fc.string({ minLength: 10, maxLength: 50 }).filter(
          (s) => s !== JWT_SECRET,
        ),
        async (userId, email, differentSecret) => {
          const differentJwtService = new JwtService({
            secret: differentSecret,
            signOptions: { expiresIn: '1h' },
          });

          const payload: JwtPayload = { sub: userId, email };
          const token = differentJwtService.sign(payload);

          const result = await authService.validateToken(token);
          expect(result).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should return null for expired tokens', async () => {
    const expiredJwtService = new JwtService({
      secret: JWT_SECRET,
      signOptions: { expiresIn: '-1s' },
    });

    await fc.assert(
      fc.asyncProperty(fc.uuid(), fc.emailAddress(), async (userId, email) => {
        const payload: JwtPayload = { sub: userId, email };
        const token = expiredJwtService.sign(payload);

        const result = await authService.validateToken(token);
        expect(result).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
