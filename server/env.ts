/**
 * server/env.ts — Environment bootstrap for standalone scripts.
 *
 * Import this at the top of any tsx script that runs outside the Express
 * server context (e.g. migration scripts, test harnesses, backfill jobs):
 *
 *   import "../server/env";
 *
 * In the Replit environment DATABASE_URL and all other secrets are injected
 * directly as process.env by the platform — no .env file is needed or read.
 * This module validates that the minimum required variables are present so
 * scripts fail fast with a clear message rather than a cryptic pg error.
 */

const REQUIRED_VARS = ["DATABASE_URL"] as const;

for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    console.error(
      `[env] Required environment variable ${key} is not set.\n` +
      `      In Replit, ensure the secret is configured in the Secrets panel.\n` +
      `      When running locally, export ${key} before running the script.`,
    );
    process.exit(1);
  }
}
