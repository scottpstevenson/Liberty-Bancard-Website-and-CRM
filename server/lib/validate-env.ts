/**
 * Startup environment validation.
 * Call this before any service initialization. Missing required vars cause
 * the process to exit with a clear, non-zero exit code in ALL environments.
 */

// Variables required in every environment (development and production alike).
// NOTE: NODE_ENV is intentionally excluded — esbuild bakes it as "production"
// in the compiled bundle, but the dynamic process.env["NODE_ENV"] lookup used
// here would not find it as a real Cloud Run env var, causing a false fatal.
const REQUIRED_ALL: string[] = [
  "DATABASE_URL",
  "SESSION_SECRET",
];

// Variables that are not strictly required but should be warned about when absent.
const OPTIONAL_WARN: string[] = [
  "ADMIN_SEED_EMAIL",
  "ADMIN_SEED_PASSWORD",
];

export function validateEnv(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const name of REQUIRED_ALL) {
    if (!process.env[name]) {
      errors.push(`  - ${name} is required but not set`);
    }
  }

  for (const name of OPTIONAL_WARN) {
    if (!process.env[name]) {
      warnings.push(`  - ${name} is not set (optional but recommended — admin seed will be skipped)`);
    }
  }

  if (warnings.length > 0) {
    console.warn("[Startup] Environment warnings:\n" + warnings.join("\n"));
  }

  if (errors.length > 0) {
    console.error(
      "[FATAL] Missing required environment variables — the server cannot start:\n" +
        errors.join("\n") +
        "\n\nSet these variables and restart the server."
    );
    process.exit(1);
  }
}
