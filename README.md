# WORLDVIEW

## Database (SQLite + Drizzle)

| Command               | When                                                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run db:migrate`  | Apply `migrations/*.sql`. Uses Drizzle's runtime migrator (`scripts/migrate.ts`), so it works in dev **and** in the production image without `drizzle-kit`. This is the only migrate command to use.              |
| `npm run db:generate` | After editing `src/lib/server/db/schema.ts`: generate a new migration (dev only, needs `drizzle-kit`). FTS5 tables/triggers live in the hand-written `migrations/0001_fts.sql` (`drizzle-kit generate --custom`). |
| `npm run db:seed`     | Dev data: Academy catalog from `content/academy/**` plus fictional demo news (`is_demo = true`). Idempotent; a second run reports `0 changes`.                                                                    |
| `npm run db:reset`    | Dev only (refuses when `NODE_ENV=production`): delete `DATABASE_URL`'s file (+ `-wal`/`-shm`), migrate, seed. Stop `npm run dev` first on Windows (open file handles).                                            |
