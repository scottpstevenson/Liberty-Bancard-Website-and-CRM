/**
 * DEPRECATED — this file is retained only to avoid breaking any lingering imports.
 *
 * Schema migrations are now managed by drizzle-kit via `server/db-migrate.ts`.
 * The migration history is tracked in the `drizzle.__drizzle_migrations` table.
 * All historical raw SQL has been consolidated into `migrations/0014_startup_sql_consolidation.sql`.
 *
 * To run migrations manually:
 *   npx tsx scripts/migrate.ts
 */

export async function runStartupMigrations(): Promise<void> {
  // No-op: drizzle migration runner in server/db-migrate.ts handles all migrations.
}
