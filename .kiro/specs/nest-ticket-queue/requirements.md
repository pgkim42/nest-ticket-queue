# Requirements Document

## Introduction

Nest Ticket Queue는 NestJS 기반의 선착순 티켓팅 및 대기열 시스템입니다. 좌석 수가 한정된 이벤트에 여러 사용자가 동시에 접속해도 초과 판매(오버셀)가 발생하지 않도록 하는 것이 핵심 목표입니다. Redis를 활용한 대기열 관리와 원자적 좌석 차감, WebSocket을 통한 실시간 상태 알림을 구현합니다.

이 프로젝트는 학습 및 포트폴리오 목적으로, NestJS의 모듈 구조, DI, Guard, WebSocket, Scheduler와 Redis 기반 동시성 제어, Jest 테스트를 실습하기 위한 것입니다.

## Scope Constraints

- **1인 1좌석 원칙**: 이 프로젝트에서는 한 번의 예약 요청은 정확히 1좌석만 차감한다. 다좌석 예약은 범위 밖이다.
- **타이머 단순화**: ACTIVE 승격 시점부터 결제 완료까지 단일 5분 타이머를 사용한다. ACTIVE 승격 시 즉시 Reservation을 생성하며, Reservation의 expiresAt이 유일한 타이머이다.
- **CANCELED 상태**: 이번 구현에서는 사용자/관리자 취소 기능을 제공하지 않는다. CANCELED 상태는 향후 확장을 위해 enum에만 정의하고, 실제로 생성되지 않는다.
- **역할 구분**: USER(일반 사용자)와 ADMIN(관리자) 두 가지 역할만 존재한다. 관리자 전용 API는 `/admin/**` prefix를 사용한다.

## Glossary

- **Event**: 티켓팅 대상이 되는 공연/이벤트. 총 좌석 수와 판매 기간 정보를 포함
- **TicketInventory**: 특정 이벤트의 남은 좌석 수를 관리하는 Redis 카운터
- **QueueEntry**: 대기열에 진입한 사용자의 상태 정보 (WAITING, ACTIVE, DONE, EXPIRED)
- **Reservation**: 좌석 예약 정보. ACTIVE 상태의 사용자가 좌석을 홀드할 때 생성
- **ACTIVE 상태**: 대기열에서 자신의 차례가 되어 티켓 예약이 가능한 상태
- **WAITING 상태**: 대기열에서 자신의 차례를 기다리는 상태
- **오버셀(Oversell)**: 실제 좌석 수보다 많은 예약이 발생하는 상황
- **Redis 원자 연산**: DECR, INCR 등 중간 상태 없이 완료되는 Redis 명령어
- **WebSocket Gateway**: NestJS에서 실시간 양방향 통신을 처리하는 컴포넌트

## Requirements

### Requirement 1: Event Management

**User Story:** As an administrator, I want to create and manage events, so that users can view available events and participate in ticketing.

#### Acceptance Criteria

1. WHEN an administrator creates an event with name, totalSeats, salesStartAt, and salesEndAt, THEN the System SHALL store the event and return the created event with a unique identifier.
2. WHEN a user requests the list of events, THEN the System SHALL return all events with their basic information including remaining seats count.
3. WHEN a user requests a specific event by ID, THEN the System SHALL return the event details including current remaining seats from Redis.
4. WHEN an event is created, THEN the System SHALL initialize the Redis counter `remainingSeats:{eventId}` with the totalSeats value.

### Requirement 2: Queue Entry

**User Story:** As a user, I want to join the queue for an event, so that I can wait for my turn to purchase tickets.

#### Acceptance Criteria

1. WHEN an authenticated user calls `/events/{id}/queue/join` during the sales period, THEN the System SHALL add the user to the Redis queue `queue:{eventId}` and return the user's position in the queue.
2. WHEN a user attempts to join a queue they have already joined, THEN the System SHALL return the existing queue position without creating a duplicate entry.
3. WHEN a user attempts to join a queue before salesStartAt, THEN the System SHALL reject the request with an appropriate error message.
4. WHEN a user attempts to join a queue after salesEndAt, THEN the System SHALL reject the request with an appropriate error message.
5. WHEN a user successfully joins the queue, THEN the System SHALL create a QueueEntry record with status WAITING and the assigned position.

### Requirement 3: Queue Position Query

**User Story:** As a user, I want to check my current position in the queue, so that I can know how long I need to wait.

#### Acceptance Criteria

1. WHEN an authenticated user calls `/events/{id}/queue/me`, THEN the System SHALL return the user's current position and status in the queue.
2. WHEN a user queries their position and they are not in the queue, THEN the System SHALL return a not-found response.
3. WHEN a user's status is ACTIVE, THEN the System SHALL include the remaining time to complete the reservation in the response.

### Requirement 4: Queue Promotion to ACTIVE

**User Story:** As a user, I want to be notified when it's my turn, so that I can proceed to make a reservation.

#### Acceptance Criteria

1. WHEN the system processes queue promotions, THEN the System SHALL promote users from WAITING to ACTIVE in FIFO order based on their queue position.
2. WHEN a user is promoted to ACTIVE status, THEN the System SHALL immediately create a Reservation with PENDING_PAYMENT status and expiresAt set to current time plus 5 minutes.
3. WHEN a user is promoted to ACTIVE status, THEN the System SHALL send a WebSocket notification to that user with the reservation details and expiration time.
4. WHEN an ACTIVE user's QueueEntry becomes DONE or EXPIRED, THEN the System SHALL attempt to promote the next WAITING user in FIFO order while keeping the number of ACTIVE users below the configured limit.
5. WHEN promoting users, THEN the System SHALL limit the number of concurrent ACTIVE users to prevent system overload (configurable limit).

### Requirement 5: Ticket Reservation (Seat Decrement)

**User Story:** As a system, I want to atomically decrement seats during queue promotion, so that overselling is prevented.

Note: In this design, reservation creation happens automatically during ACTIVE promotion (Requirement 4.2). This requirement focuses on the atomic seat decrement logic that occurs at that moment.

#### Acceptance Criteria

1. WHEN promoting a user to ACTIVE status, THEN the System SHALL execute Redis DECR on `remainingSeats:{eventId}` atomically before creating the Reservation.
2. WHEN the Redis DECR result is greater than or equal to 0, THEN the System SHALL proceed with Reservation creation.
3. WHEN the Redis DECR result is less than 0, THEN the System SHALL immediately execute INCR to restore the count and skip promoting that user (mark as EXPIRED due to sold out).
4. WHEN a Reservation is successfully created during promotion, THEN the System SHALL change the user's QueueEntry status to ACTIVE.
5. WHEN a user completes payment, THEN the System SHALL change the user's QueueEntry status to DONE.

### Requirement 6: Payment Processing

**User Story:** As a user with a pending reservation, I want to complete payment, so that I can finalize my ticket purchase.

#### Acceptance Criteria

1. WHEN a user calls `/reservations/{id}/pay` for their PENDING_PAYMENT reservation within the expiration time, THEN the System SHALL update the reservation status to PAID.
2. WHEN a user attempts to pay for an expired reservation, THEN the System SHALL reject the request with an appropriate error.
3. WHEN a user attempts to pay for another user's reservation, THEN the System SHALL reject the request with an unauthorized error.
4. WHEN payment is successful, THEN the System SHALL send a WebSocket notification confirming the payment.

### Requirement 7: Reservation Expiration

**User Story:** As a system operator, I want expired reservations to be automatically handled, so that seats are released back to the pool.

#### Acceptance Criteria

1. WHEN a PENDING_PAYMENT reservation reaches its expiresAt time without payment, THEN the System SHALL update the status to EXPIRED.
2. WHEN a reservation expires, THEN the System SHALL execute Redis INCR on `remainingSeats:{eventId}` to restore the seat exactly once.
3. WHEN processing expiration, THEN the System SHALL use idempotent operations to prevent duplicate seat restoration.
4. WHEN a reservation expires, THEN the System SHALL send a WebSocket notification to the user about the expiration.

### Requirement 8: WebSocket Real-time Notifications

**User Story:** As a user, I want to receive real-time updates about my queue and reservation status, so that I don't need to manually refresh.

#### Acceptance Criteria

1. WHEN a user connects to the WebSocket gateway with a valid JWT token, THEN the System SHALL authenticate the connection and associate it with the user ID.
2. WHEN a user's queue position changes, THEN the System SHALL emit a `queue:position` event with the new position.
3. WHEN a user is promoted to ACTIVE status, THEN the System SHALL emit a `queue:active` event with the expiration time.
4. WHEN a reservation status changes, THEN the System SHALL emit a `reservation:update` event with the new status.
5. WHEN a user disconnects and reconnects, THEN the System SHALL resume sending notifications for their active queue entries and reservations.

### Requirement 9: Authentication

**User Story:** As a system, I want to authenticate users, so that only authorized users can access ticketing features.

#### Acceptance Criteria

1. WHEN a user provides valid credentials to the login endpoint, THEN the System SHALL return a JWT token.
2. WHEN a request includes a valid JWT token in the Authorization header, THEN the System SHALL extract the user ID and allow access to protected endpoints.
3. WHEN a request includes an invalid or expired JWT token, THEN the System SHALL reject the request with an unauthorized error.
4. WHEN a WebSocket connection attempt includes an invalid token, THEN the System SHALL reject the connection.

### Requirement 10: Admin Statistics

**User Story:** As an administrator, I want to view statistics for events, so that I can monitor the ticketing system.

#### Acceptance Criteria

1. WHEN an administrator requests statistics for an event, THEN the System SHALL return the remaining seats count from Redis.
2. WHEN an administrator requests statistics for an event, THEN the System SHALL return the current queue length.
3. WHEN an administrator requests statistics for an event, THEN the System SHALL return reservation counts grouped by status (PENDING_PAYMENT, PAID, EXPIRED).

### Requirement 11: Data Serialization

**User Story:** As a developer, I want consistent data serialization, so that API responses are predictable and testable.

#### Acceptance Criteria

1. WHEN the System serializes domain objects to JSON for API responses, THEN the System SHALL use consistent field naming and date formatting.
2. WHEN the System deserializes JSON request bodies, THEN the System SHALL validate required fields and data types.
3. WHEN serializing and then deserializing a domain object, THEN the System SHALL produce an equivalent object (round-trip consistency).

### Requirement 12: Concurrency Safety

**User Story:** As a system operator, I want the system to handle concurrent requests safely, so that data integrity is maintained under load.

#### Acceptance Criteria

1. WHEN multiple users simultaneously attempt to reserve the last available seat, THEN the System SHALL ensure exactly one reservation succeeds and others receive a sold-out response.
2. WHEN multiple requests attempt to expire the same reservation, THEN the System SHALL ensure the seat count is restored exactly once.
3. WHEN processing queue promotions concurrently, THEN the System SHALL ensure each user is promoted exactly once without skipping or duplicating.
