# Git Commit Conventions

## 50/72 Rule

- Subject line: 50자 이내 (hard limit 72자)
- Body: 72자에서 줄바꿈
- Subject과 body 사이에 빈 줄 추가

## Commit Message Format

```
<type>(<scope>): 한국어 설명 (English description)

<body>
```

### Types

- feat: 새로운 기능
- fix: 버그 수정
- refactor: 리팩토링
- test: 테스트 추가/수정
- docs: 문서 수정
- chore: 빌드, 설정 등 기타 변경
- style: 코드 포맷팅

### Examples

```
feat(queue): FIFO 큐 승격 로직 구현 (implement FIFO queue promotion)

Add promoteNextUser method that atomically decrements
seats and creates reservations during promotion.
Includes sold-out handling with INCR rollback.
```

```
fix(reservation): 중복 좌석 복원 방지 (prevent duplicate seat restoration)

Use Redis SETNX for idempotency lock to ensure
seat count is incremented exactly once on expiration.
```

```
chore: NestJS 프로젝트 초기화 (initialize NestJS project)
```

## Important Rules

- 커밋 메시지는 사람이 직접 작성한 것처럼 자연스럽게 작성
- "AI", "generated", "auto-generated" 등의 표현 절대 사용 금지
- 기술적이고 구체적인 내용 위주로 작성
- Subject는 반드시 "한국어 (English)" 형식으로 작성
