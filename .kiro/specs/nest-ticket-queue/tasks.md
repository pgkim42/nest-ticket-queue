# Implementation Plan

## Commit Convention

각 주요 태스크 완료 시 커밋합니다. 50/72 규칙을 따르며, 커밋 메시지 예시는 각 태스크에 포함되어 있습니다.

---

- [x] 1. Set up project structure and core infrastructure
  - [x] 1.1 Initialize NestJS project with TypeScript configuration
    - Create new NestJS project using `@nestjs/cli`
    - Configure TypeScript strict mode
    - Set up ESLint and Prettier
    - _Requirements: Non-functional (project setup)_

  - [x] 1.2 Configure Docker Compose for local development
    - Create `docker-compose.yml` with PostgreSQL and Redis services
    - Add health checks for database readiness

    - _Requirements: Non-functional (infrastructure)_

  - [x] 1.3 Set up database connection with TypeORM
    - Install and configure `@nestjs/typeorm` with PostgreSQL
    - Create database configuration module
    - _Requirements: Non-functional (infrastructure)_

  - [x] 1.4 Set up Redis connection
    - Install and configure `ioredis`
    - Create RedisModule and RedisService with connection pooling
    - _Requirements: Non-functional (infrastructure)_

  - [x] 1.5 Set up BullMQ for background jobs
    - Install and configure `@nestjs/bullmq`
    - Create queue configuration for reservation expiration jobs
    - _Requirements: 7.1_

  - [x] 1.6 Write unit tests for RedisService
    - Test connection handling
    - Test basic Redis operations
    - _Requirements: Non-functional (testing)_

  - **Commit**: `chore: initialize NestJS project with infrastructure`

- [x] 2. Implement User and Authentication module









  - [x] 2.1 Create User entity and repository

    - Define User entity with id, email, passwordHash, name, role (USER/ADMIN), timestamps
    - Create UsersModule and UsersService
    - _Requirements: 9.1_

  - [x] 2.2 Implement AuthModule with JWT strategy

    - Install `@nestjs/jwt` and `@nestjs/passport`
    - Create JwtStrategy for token validation
    - Implement login endpoint returning JWT token
    - _Requirements: 9.1, 9.2_

  - [x] 2.3 Create JwtAuthGuard and RolesGuard for protected routes

    - Implement guard that validates JWT from Authorization header
    - Create CurrentUser decorator to extract user from request
    - Create RolesGuard for admin-only endpoints
    - _Requirements: 9.2, 9.3_
  - [x] 2.4 Write property test for JWT authentication


    - **Property 11: JWT Authentication Correctness**
    - **Validates: Requirements 9.2, 9.3**
  - [x] 2.5 Write unit tests for AuthService


    - Test login with valid/invalid credentials
    - Test token generation and validation
    - _Requirements: 9.1, 9.2, 9.3_
  - **Commit**: `feat(auth): implement JWT authentication with guards`

- [x] 3. Implement Events module






  - [x] 3.1 Create Event entity and repository

    - Define Event entity with id, name, totalSeats, salesStartAt, salesEndAt, timestamps
    - Create EventsModule and EventsService
    - _Requirements: 1.1_

  - [x] 3.2 Implement event CRUD endpoints

    - POST /admin/events - Create event (admin only)
    - GET /events - List all events
    - GET /events/:id - Get event details with remaining seats
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 3.3 Implement Redis seat counter initialization

    - On event creation, initialize `remainingSeats:{eventId}` in Redis
    - Implement getRemainingSeats method in RedisService
    - _Requirements: 1.4_

  - [x] 3.4 Write property test for event creation and Redis initialization

    - **Property 1: Event Creation Initializes Redis Counter**
    - **Validates: Requirements 1.4**

  - [x] 3.5 Write unit tests for EventsService

    - Test event creation
    - Test event retrieval with Redis seat count
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - **Commit**: `feat(events): add event CRUD with Redis seat counter`

- [x] 4. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.
  - **Commit (if fixes needed)**: `fix: resolve test failures in auth/events`

- [x] 5. Implement Queue module - Core logic





  - [x] 5.1 Create QueueEntry entity and repository


    - Define QueueEntry entity with id, eventId, userId, status, position, reservationId (nullable), timestamps
    - Define QueueEntryStatus enum (WAITING, ACTIVE, DONE, EXPIRED)
    - _Requirements: 2.5_

  - [x] 5.2 Implement Redis queue operations in RedisService

    - addToQueue: ZADD queue:{eventId} with timestamp as score
    - getQueuePosition: ZRANK to get position
    - getQueueLength: ZCARD to get total count
    - removeFromQueue: ZREM to remove user
    - _Requirements: 2.1_

  - [x] 5.3 Implement queue join endpoint

    - POST /events/:id/queue/join
    - Validate sales period (salesStartAt <= now <= salesEndAt)
    - Check for duplicate entry (idempotent join)
    - Add to Redis queue and create QueueEntry in DB
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 5.4 Write property test for queue join idempotency

    - **Property 2: Queue Join Idempotency**
    - **Validates: Requirements 2.2**

  - [x] 5.5 Write property test for sales period enforcement

    - **Property 3: Sales Period Enforcement**
    - **Validates: Requirements 2.3, 2.4**

  - [x] 5.6 Implement queue position query endpoint

    - GET /events/:id/queue/me
    - Return current position and status
    - Include remaining time (expiresAt) if ACTIVE
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 5.7 Write unit tests for QueueService

    - Test queue join
    - Test position query
    - Test duplicate join handling
    - _Requirements: 2.1, 2.2, 3.1, 3.2_
  - **Commit**: `feat(queue): implement queue join and position query`

- [x] 6. Implement Reservation entity and atomic seat operations






  - [x] 6.1 Create Reservation entity and repository

    - Define Reservation entity with id, eventId, userId, status, expiresAt, paidAt, timestamps
    - Define ReservationStatus enum (PENDING_PAYMENT, PAID, CANCELED, EXPIRED)
    - Note: CANCELED is defined for future use but not created in this implementation
    - _Requirements: 4.2_

  - [x] 6.2 Implement atomic seat decrement in RedisService

    - decrementSeats: DECR remainingSeats:{eventId}
    - incrementSeats: INCR remainingSeats:{eventId}
    - These MUST be atomic Redis operations
    - _Requirements: 5.1_
  - **Commit**: `feat(reservation): add entity and atomic seat ops`

- [x] 7. Implement Queue promotion with integrated reservation creation (Critical)





  - [x] 7.1 Implement ACTIVE user management in RedisService


    - setActiveUser: SETEX active:{eventId}:{userId} with TTL
    - isActiveUser: EXISTS check
    - removeActiveUser: DEL
    - getActiveCount: Track concurrent active users
    - _Requirements: 4.2_
  - [x] 7.2 Implement queue promotion with seat decrement and reservation creation


    - promoteNextUser: Get next user from queue (FIFO)
    - Execute DECR remainingSeats:{eventId}
    - If result >= 0: Create Reservation (PENDING_PAYMENT, expiresAt=now+5min), set ACTIVE
    - If result < 0: INCR to restore, mark user as EXPIRED (sold out)
    - Single 5-minute timer covers entire payment window
    - _Requirements: 4.1, 4.2, 4.4, 5.1, 5.2, 5.3_
  - [x] 7.3 Write property test for FIFO promotion order


    - **Property 4: Queue Promotion FIFO Order**
    - **Validates: Requirements 4.1**
  - [x] 7.4 Write property test for oversell prevention (CRITICAL)


    - **Property 6: Reservation Seat Decrement Atomicity (Oversell Prevention)**
    - **Validates: Requirements 5.1, 5.2, 5.3, 12.1**
  - [x] 7.5 Write property test for concurrent last-seat promotion (CRITICAL)


    - **Property 9: Concurrent Last-Seat Reservation**
    - Test concurrent promotion attempts for last seat
    - **Validates: Requirements 12.1**
  - [x] 7.6 Implement promotion trigger mechanism


    - Option A: Scheduler-based periodic promotion check
    - Option B: Event-driven promotion when slot becomes available
    - Respect concurrent ACTIVE user limit
    - _Requirements: 4.4, 4.5_
  - [x] 7.7 Write unit tests for queue promotion


    - Test promotion order
    - Test concurrent active user limit
    - Test sold out handling
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 5.1, 5.2, 5.3_
  - **Commit**: `feat(queue): implement FIFO promotion with oversell prevention`

- [x] 8. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.
  - **Commit (if fixes needed)**: `fix: resolve queue/reservation test failures`

- [x] 9. Implement payment and expiration handling




  - [x] 9.1 Implement payment endpoint

    - POST /reservations/:id/pay
    - Verify ownership and PENDING_PAYMENT status
    - Verify not expired (expiresAt > now)
    - Update status to PAID, set paidAt
    - Update QueueEntry status to DONE
    - _Requirements: 6.1, 6.2, 6.3, 5.5_


  - [x] 9.2 Implement reservation expiration with idempotency
    - Create BullMQ delayed job on reservation creation (delay = 5 minutes)
    - On job execution: check if still PENDING_PAYMENT
    - Use Redis SETNX for idempotency lock (reservationExpired:{id})
    - If first to expire: INCR seat, update status to EXPIRED, update QueueEntry to EXPIRED
    - Trigger next user promotion after expiration

    - _Requirements: 7.1, 7.2, 7.3, 4.4_
  - [x] 9.3 Write property test for expiration idempotency (CRITICAL)

    - **Property 8: Reservation Expiration Idempotency**
    - **Validates: Requirements 7.2, 7.3, 12.2**


  - [x] 9.4 Write property test for ACTIVE status TTL
    - **Property 5: ACTIVE Status TTL Enforcement**
    - **Validates: Requirements 4.2, 4.4**
  - [x] 9.5 Write unit tests for payment and expiration



    - Test successful payment
    - Test expired reservation payment rejection
    - Test ownership validation
    - Test idempotent expiration
    - _Requirements: 6.1, 6.2, 6.3, 7.1, 7.2, 7.3_
  - **Commit**: `feat(reservation): add payment and idempotent expiration`

- [x] 10. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.
  - **Commit (if fixes needed)**: `fix: resolve payment/expiration issues`

- [x] 11. Implement WebSocket notification module




  - [x] 11.1 Create NotificationModule and WebSocket Gateway

    - Install `@nestjs/websockets` and `socket.io`
    - Create NotificationGateway with JWT authentication
    - Implement handleConnection with token validation
    - _Requirements: 8.1, 9.4_


  - [x] 11.2 Implement user-specific room management

    - Join user to room `user:{userId}` on connection
    - Handle disconnection and reconnection

    - _Requirements: 8.5_


  - [x] 11.3 Implement NotificationService
    - notifyQueuePosition: emit `queue:position` event
    - notifyActiveStatus: emit `queue:active` event with reservation details
    - notifySoldOut: emit `queue:soldout` event
    - notifyReservationExpired: emit `reservation:expired` event
    - notifyPaymentSuccess: emit `reservation:paid` event

    - _Requirements: 8.2, 8.3, 8.4_


  - [x] 11.4 Integrate notifications into existing services

    - QueueService: notify on position change and ACTIVE promotion
    - ReservationService: notify on payment success and expiration

    - _Requirements: 4.3, 6.4, 7.4_
  - [x] 11.5 Write unit tests for NotificationService

    - Test event emission
    - Test room management
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - **Commit**: `feat(notification): add WebSocket gateway with events`

- [x] 12. Implement Admin statistics endpoint






  - [x] 12.1 Create admin statistics endpoint

    - GET /admin/events/:id/stats (admin only, protected by RolesGuard)
    - Return remaining seats from Redis
    - Return queue length
    - Return reservation counts by status (PENDING_PAYMENT, PAID, EXPIRED)
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 12.2 Write unit tests for statistics endpoint

    - Test stats aggregation
    - _Requirements: 10.1, 10.2, 10.3_
  - **Commit**: `feat(admin): add event statistics endpoint`

- [x] 13. Implement DTO validation and serialization






  - [x] 13.1 Create DTOs with class-validator decorators

    - CreateEventDto, EventResponseDto
    - JoinQueueDto, QueueStatusDto
    - ReservationResponseDto
    - LoginDto, AuthResponseDto
    - StatsResponseDto
    - _Requirements: 11.1, 11.2_

  - [x] 13.2 Configure global validation pipe

    - Enable whitelist and transform options
    - Set up consistent date serialization (ISO 8601)
    - _Requirements: 11.1, 11.2_

  - [x] 13.3 Write property test for serialization round-trip

    - **Property 10: Domain Object Serialization Round-Trip**
    - **Validates: Requirements 11.3**

  - [x] 13.4 Write unit tests for DTO validation

    - Test required field validation
    - Test type validation
    - _Requirements: 11.2_
  - **Commit**: `feat(dto): add validation and serialization`

- [x] 14. Final integration and E2E testing






  - [x] 14.1 Create simple demo HTML page

    - Basic UI for queue join, payment
    - WebSocket connection for real-time updates
    - Display queue position, ACTIVE status, reservation details
    - _Requirements: Non-functional (demo)_

  - [x] 14.2 Write E2E test for complete ticketing flow

    - User login → Queue join → Wait for ACTIVE promotion → Receive reservation → Pay
    - _Requirements: All_

  - [x] 14.3 Write integration test for concurrent promotion scenario

    - Multiple users in queue competing for last seat
    - Verify exactly one gets reservation, others get sold out
    - _Requirements: 12.1_
  - **Commit**: `feat: add demo page and E2E tests`

- [x] 15. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - **Commit**: `chore: finalize v1.0 release`
