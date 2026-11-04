# Hoarding blocking & queue

**ONE HOARDING = MAXIMUM ONE ACTIVE BLOCK.** Everyone else waits in a FIFO queue.

| Token status | Meaning |
|---|---|
| `BLOCKED` / `EXTENSION_REQUESTED` | the single **active block** (48 h) |
| `PENDING` | **waiting in queue** (queuePosition 2, 3, ... ; the active block is 1) |
| `EXPIRED` | 48 h elapsed without booking |
| `APPROVED` | **booked / converted** |
| `RELEASED` / `CANCELLED` | closed (released, queue closed because the hoarding was booked, ...) |

## Rules (all in `src/services/blockQueue.service.ts`)
- Finalizing a proposal on a hoarding that nobody holds -> **active block**, 48 h.
- Finalizing on a hoarding that already has an active block -> **added to the queue** (same sales user or a different one).
- The same client cannot hold / queue the same hoarding twice.
- Active block expires (job runs every minute) -> marked `EXPIRED`, queue position 1 is promoted automatically with a **fresh 48 h**, the rest move up.
- Releasing the active block ("Unblock") promotes the next client the same way; leaving the queue compacts positions.
- Active client books -> hoarding `booked`/`under_process`, **the whole queue is closed** (`RELEASED`, reason `booked`), no further promotion.
- A DRAFT proposal never blocks anything. Regenerating a proposal PDF never drops a block.
- Every operation on a hoarding runs under a Postgres advisory lock, and a partial unique index
  (`BookingToken_one_active_block_per_hoarding`) makes a second active block impossible at DB level.

## Single source of truth
`hoarding.status = 'blocked'` is **derived** from "a valid, unexpired active block exists" (`syncHoardingStatus`).
It is never set by hand (manual `finalize-status = BLOCKED` is refused; "Unblock" releases the real token).
`GET /hoardings`, `GET /hoardings/:id`, `GET /proposals/:id`, `GET /blocked-hoardings/by-client`
and `GET /blocked-hoardings/:hoardingId/queue` all read the same token data, and the job repairs any stale flag.

## Rollout (IMPORTANT - do this BEFORE deploying the new backend)
1. Back up / snapshot the production database.
2. Apply the schema changes:
   - if you use Prisma migrations: `npx prisma migrate deploy`
   - otherwise (database created with `db push`): run `scripts/sql/2026-10-29_blocking_queue_integrity.sql`
     (idempotent; adds Phase-3 columns if missing, `BookingToken.proposalId`, cleans duplicate/expired blocks,
     creates the unique index, adds `TodoItem.locationLink` / `attachments`).
3. Deploy the backend. Phase-3 support is now **auto-detected** (`src/lib/dbCapabilities.ts`); it was hard-coded off before.
   Set `FORCE_LEGACY_BLOCKING=true` only as an emergency switch.
4. Deploy the frontend.

## Testing locally
```
docker run -d --name hoarding_pg_local -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=hoarding_test -p 5433:5432 postgres:16-alpine
export DATABASE_URL="postgresql://postgres:postgres@localhost:5433/hoarding_test?schema=public"
npx prisma migrate deploy && npx prisma db push      # db push adds tables that only exist in schema.prisma
# re-create the partial index if db push removed it (see migration 20261029120000)
NODE_ENV=test npx jest --runInBand --selectProjects integration \
  --runTestsByPath tests/integration/blockingQueue.test.ts tests/integration/tasksAndBlockingApi.test.ts
```
`test.env` forces `MEDIA_STORAGE_PROVIDER=local` so tests never upload to the real Firebase bucket.
