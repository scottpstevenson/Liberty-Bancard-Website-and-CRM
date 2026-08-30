/**
 * Replit Publish owns production schema reconciliation. Application startup
 * migrations are limited to non-production environments so a published schema
 * cannot be replayed from an older production Drizzle journal.
 */
export function shouldRunStartupMigrations(nodeEnv: string | undefined): boolean {
  return nodeEnv !== "production";
}