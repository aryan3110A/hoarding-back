# Hoarding Backend — Overview

## Purpose

This repository is the backend service for the Hoarding/Billboard management system. It implements the HTTP API, background jobs, data-import scripts, and database schema (Prisma + Postgres) used by the platform.

## Quick Start (developer)

1. Copy environment file:

   ```bash
   cp .env.example .env
   ```

2. Start dependent services (Postgres + Redis). Example using Docker:

   ```bash
   docker run -d --name hoarding-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=hoarding_dev -p 5432:5432 postgres:15
   docker run -d --name hoarding-redis -p 6379:6379 redis:7
   ```

3. Install dependencies:

   ```bash
   npm ci
   ```

4. Generate Prisma client and run migrations (dev):

   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```

5. Optionally seed the database:

   ```bash
   npm run seed
   ```

6. Run dev server (hot reload):

   ```bash
   npm run dev
   ```

7. Build + start production:

   ```bash
   npm run build
   npm start
   ```

8. Run tests:

   ```bash
   npm run test        # all tests
   npm run test:unit  # unit tests
   npm run test:integration
   ```

## Key Scripts (see `package.json`)

- `dev`: nodemon + ts-node for local development
- `build` / `start`: compile and run `dist/index.js`
- `prisma:generate`, `prisma:migrate`, `prisma:studio`
- `seed`: run `prisma/seed.ts`
- `import:hoardings`: run `scripts/import-hoardings.ts`
- `regenerate:codes`, `check:landlords` and other maintenance scripts

## Repository Layout

- [prisma](prisma): Prisma schema and migration history. The canonical DB schema is [prisma/schema.prisma](prisma/schema.prisma). Use Prisma for migrations, client generation and Studio.
- [src](src): Application source code (TypeScript)
  - [src/index.ts](src/index.ts) — process bootstrap
  - [src/app.ts](src/app.ts) — Express app configuration (middleware, routes)
  - [src/server.ts](src/server.ts) — listener + graceful shutdown
  - [src/config](src/config) — environment & typed config
  - [src/controllers] — HTTP controllers (auth, hoardings, bookings, etc.)
  - [src/services] — business logic
  - [src/repositories] — Prisma data access layer
  - [src/routes] — express route definitions
  - [src/middleware] — auth, validation, error handlers
  - [src/validators] — Zod request schemas
  - [src/jobs] — scheduled/background jobs (rent reminders, notifications)
  - [src/utils] / [src/lib] / [src/types] — helpers and shared types
- [scripts](scripts): Utility scripts for import, checks and data fixes (run with `npx ts-node scripts/<name>.ts` or `npm run <script>`)
- [tests](tests): `unit` and `integration` suites and test setup (`tests/jest.setup.ts`)
- [uploads](uploads): Local file storage for uploads (images, CSVs)
- [docs](docs): architecture and implementation notes
- .github/workflows: CI workflows used to run lint/tests/build on PRs

## Data Model Summary

The main entities (see [prisma/schema.prisma](prisma/schema.prisma)):

- `User`, `Role` — authentication and RBAC
- `Hoarding` — billboard/hoarding metadata and status
- `Booking`, `BookingToken` — booking / token lifecycle, designer & fitter workflow fields
- `Client`, `Proposal`, `ProposalHoarding` — sales proposals and relations
- `Rent`, `PropertyRent` — rent records and escalation/increment tracking
- `Notification`, `AuditLog`, `RefreshSession`, `UserDevice`, `Territory` — auxiliary models used across features

Read the Prisma schema carefully to understand relationships and constraints; it's the best source of truth for data shapes.

## Environment / Configuration

- Use `.env` (copy `.env.example`). Key vars:
  - `DATABASE_URL` — Postgres DSN used by Prisma
  - `REDIS_URL` — Redis for caching/sessions
  - `JWT_SECRET`, `JWT_ACCESS_EXPIRATION`, `JWT_REFRESH_EXPIRATION_DAYS`
  - `PORT` and `NODE_ENV`

## Common Tasks & Troubleshooting

- Run Prisma Studio: `npm run prisma:studio` to inspect DB in-browser.
- If migrations fail, confirm `DATABASE_URL` and Postgres availability.
- For import scripts, ensure CSVs are in the expected path (see `scripts/import-hoardings.ts`).
- Use `npm run lint` to auto-fix style issues.

## CI / Local Test Notes

- CI workflows are in `.github/workflows`. They typically run `npm ci`, `npm run lint`, `npm run test`.
- Integration tests require a test database and `test.env` settings; prefer running them inside a test Docker compose or a test container configured like local dev.

## Next Steps for a New Developer

1. Read [prisma/schema.prisma](prisma/schema.prisma) to learn the data model.
2. Start Postgres + Redis locally (docker recommended) and set `.env`.
3. `npm ci`, `npm run prisma:generate`, `npm run prisma:migrate`, `npm run seed`.
4. `npm run dev` and explore endpoints defined in `src/routes` and `src/controllers`.

---

If you want, I can also:

- expand any specific folder's documentation (controllers, jobs, or scripts),
- or prepare exact Windows + Docker commands to run everything locally.
