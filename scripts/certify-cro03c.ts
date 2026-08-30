import { spawnSync } from "node:child_process";
import { CRO03C_CURRENT_MIGRATION_HEAD } from "../server/services/cro03/contracts";

const args = new Set(process.argv.slice(2));
const production = args.has("--mode=production");
if (process.argv.includes("--all") || process.argv.some((arg) => arg.includes("*"))) {
  throw new Error("CRO03C_CERT_WILDCARD_DENIED");
}

if (!production) {
  const result = spawnSync("npx", ["tsx", "scripts/test-cro03c-static.ts"], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      CRO03_PROVIDER_TRANSPORT_ENABLED: "true",
      ZEROBOUNCE_API_KEY: "realistic-denied-placeholder",
      SERPER_API_KEY: "realistic-denied-placeholder",
      OUTSCRAPER_API_KEY: "realistic-denied-placeholder",
      APOLLO_API_KEY: "realistic-denied-placeholder",
      AI_INTEGRATIONS_OPENAI_API_KEY: "realistic-denied-placeholder",
    },
  });
  process.exit(result.status ?? 1);
}

const requiredPrefixes = [
  "--target=https://", "--activation-id=", "--attestation-id=", "--canary-command-ids=",
  "--initial-command-id=", "--artifact-sha=", "--migration-head=",
  "--recipe-hash=", "--policy-hash=", "--cohort-hash=", "--stage-plan-hash=", "--caps=",
];
for (const prefix of requiredPrefixes) {
  if (!process.argv.some((arg) => arg.startsWith(prefix) && arg.length > prefix.length)) {
    throw new Error(`CRO03C_CERT_REQUIRED_ARGUMENT_MISSING:${prefix}`);
  }
}
const target = process.argv.find((arg) => arg.startsWith("--target="))!.slice(9);
if (!target.startsWith("https://") || /localhost|127\.0\.0\.1|\.replit\.dev/i.test(target)) {
  throw new Error("CRO03C_CERT_PRODUCTION_TARGET_REQUIRED");
}
const migrationHead = process.argv.find((arg) => arg.startsWith("--migration-head="))!.slice(17);
if (migrationHead !== CRO03C_CURRENT_MIGRATION_HEAD) {
  throw new Error("CRO03C_CERT_MIGRATION_MISMATCH");
}
throw new Error(
  "CRO03C_CERT_LIVE_EXECUTION_REQUIRES_COMMITTED_APPROVAL_RECEIPTS_AND_AUTHENTICATED_EXACT_RELEASE_OPERATOR_SESSION",
);