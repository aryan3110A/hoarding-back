# Testing Guide

This document describes the testing infrastructure and strategy for the Hoarding/OOH Advertising Management System.

## Test Strategy

### Unit Tests (`tests/unit/`)
- Test individual services and repositories in isolation
- Mock Prisma client and Redis using Jest mocks
- Fast execution, no external dependencies
- Location: `tests/unit/**/*.spec.ts`

### Integration Tests (`tests/integration/`)
- Test complete API endpoints with real database and Redis
- Verify end-to-end behavior including DB writes
- Use test database and Redis instance
- Location: `tests/integration/**/*.test.ts`

## Running Tests

### Prerequisites

1. **Start test infrastructure:**
```bash
docker-compose -f docker-compose.test.yml up -d
```

2. **Run migrations:**
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/hoarding_test?schema=public" npx prisma migrate deploy
```

3. **Seed test database:**
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/hoarding_test?schema=public" npm run seed
```

### Test Commands

```bash
# Run all tests (unit + integration)
npm test

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Test Infrastructure

### Test Database & Redis
- **PostgreSQL Test DB:** `localhost:5433` (user: postgres, password: postgres, db: hoarding_test)
- **Redis Test Instance:** `localhost:6380`
- Configuration: `docker-compose.test.yml`
- Environment: `test.env`

### Test Data
The test suite automatically:
1. Resets the database before all tests
2. Seeds initial data (roles + admin user)
3. Cleans up after test execution

**Default Test User:**
- Email: `admin@hoarding.local`
- Password: `Admin@123`
- Role: admin

## Test Coverage

### Unit Tests
- ✅ `tests/unit/services/auth.service.spec.ts` - Authentication logic
- ✅ `tests/unit/services/device.service.spec.ts` - Device management
- ✅ `tests/unit/services/hoarding.service.spec.ts` - RBAC territory filtering

### Integration Tests
- ✅ `tests/integration/auth.routes.test.ts` - Login/refresh/logout flows
- ✅ `tests/integration/device.routes.test.ts` - Device ping & checkin
- ✅ `tests/integration/hoarding.routes.test.ts` - Hoarding RBAC & territory enforcement
- ✅ `tests/integration/booking.routes.test.ts` - Booking creation

## CI/CD

GitHub Actions workflow (`.github/workflows/main.yml`) automatically:
1. Runs linter
2. Builds the project
3. Spins up PostgreSQL and Redis services
4. Runs all tests
5. Reports results

## Troubleshooting

### Tests failing with connection errors
```bash
# Check if test services are running
docker-compose -f docker-compose.test.yml ps

# Restart test services
docker-compose -f docker-compose.test.yml restart
```

### Database state issues
```bash
# Reset test database
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/hoarding_test?schema=public" npx prisma migrate reset --force
```

### Port conflicts
If ports 5433 or 6380 are in use, update `docker-compose.test.yml` and `test.env` to use different ports.

## Writing New Tests

### Unit Test Example
```typescript
// tests/unit/services/my.service.spec.ts
import { MyService } from '../../../src/services/my.service';

jest.mock('../../../src/lib/prisma');

describe('MyService (unit)', () => {
  it('should do something', () => {
    // Test implementation
  });
});
```

### Integration Test Example
```typescript
// tests/integration/my.routes.test.ts
import request from 'supertest';
import { createTestServer } from '../../utils/testServer';

let app: any;

beforeAll(async () => {
  app = await createTestServer();
  await resetDatabase();
  await seedTestData();
});

describe('My Routes (integration)', () => {
  it('should return data', async () => {
    const res = await request(app)
      .get('/api/my-route')
      .expect(200);
    
    expect(res.body.success).toBe(true);
  });
});
```

## Notes

- Integration tests run with `--runInBand` to avoid race conditions
- Test timeout is set to 30 seconds
- Console logs are mocked in tests to reduce noise
- Tests use `test.env` for configuration
