import assert from "node:assert/strict";
import { shouldRunStartupMigrations } from "../server/startup-migration-policy";

assert.equal(
  shouldRunStartupMigrations("production"),
  false,
  "production startup must not execute application-owned schema migrations",
);
assert.equal(
  shouldRunStartupMigrations("development"),
  true,
  "development startup must continue applying journaled migrations",
);
assert.equal(
  shouldRunStartupMigrations("test"),
  true,
  "disposable test environments must remain able to apply migrations",
);
assert.equal(
  shouldRunStartupMigrations(undefined),
  true,
  "an unset NODE_ENV must preserve the existing non-production behavior",
);

console.log("✓ Startup migration policy: production skips DDL; development and tests still migrate.");