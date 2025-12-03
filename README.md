# Nest Ticket Queue

NestJS 기반의 선착순 티켓팅 및 대기열 시스템입니다.

## 주요 기능

- **대기열 관리**: Redis Sorted Set을 활용한 FIFO 대기열
- **원자적 좌석 관리**: Redis DECR/INCR을 통한 오버셀 방지
- **실시간 알림**: WebSocket을 통한 상태 변경 즉시 전달
- **예약 만료 처리**: BullMQ를 활용한 자동 만료 및 좌석 복원

## 기술 스택

- **Framework**: NestJS
- **Database**: PostgreSQL + TypeORM
- **Cache/Queue**: Redis + ioredis
- **Background Jobs**: BullMQ
- **Real-time**: Socket.io
- **Testing**: Jest + fast-check (Property-Based Testing)

## 시작하기

### 사전 요구사항

- Node.js 18+
- Docker & Docker Compose

### 설치

```bash
# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env

# Docker 서비스 실행 (PostgreSQL, Redis)
docker-compose up -d

# 개발 서버 실행
npm run start:dev
```

### 테스트

```bash
# 단위 테스트
npm test

# 테스트 커버리지
npm run test:cov
```

## 프로젝트 구조

```
src/
├── auth/           # 인증 모듈 (JWT)
├── events/         # 이벤트 관리
├── queue/          # 대기열 관리
├── reservations/   # 예약 관리
├── notification/   # WebSocket 알림
├── redis/          # Redis 서비스
├── database/       # TypeORM 설정
└── users/          # 사용자 관리
```

## API 엔드포인트

| Method | Endpoint                  | Description    |
| ------ | ------------------------- | -------------- |
| POST   | `/auth/login`             | 로그인         |
| GET    | `/events`                 | 이벤트 목록    |
| GET    | `/events/:id`             | 이벤트 상세    |
| POST   | `/events/:id/queue/join`  | 대기열 참가    |
| GET    | `/events/:id/queue/me`    | 내 대기열 상태 |
| POST   | `/reservations/:id/pay`   | 결제 처리      |
| GET    | `/admin/events/:id/stats` | 통계 (관리자)  |

## 라이선스

ISC
