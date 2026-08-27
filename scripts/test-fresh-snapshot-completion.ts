#!/usr/bin/env tsx
/**
 * Pure regression guard for the fresh-snapshot completion boundary.
 * No database, provider, network, or application module is imported.
 */
import fs from "fs";
import path from "path";
import {
  assertSnapshotTargetIsEmpty,
  verifyOrCompleteFreshSnapshotFoundation,
  type MigrationQueryClient,
} from "../server/fresh-snapshot-completion";

const NO_FINGERPRINT_OVERRIDE = Symbol("no-fingerprint-override");

class FakeMigrationClient implements MigrationQueryClient {
  foundationExecutions = 0;
  readonly userRelations: Array<{ schema_name: string; relation_name: string }>;
  foundationIssues: string[];

  constructor(
    foundationIssues: string[] = [],
    userRelations: Array<{ schema_name: string; relation_name: string }> = [],
    readonly fingerprintOverride: unknown = NO_FINGERPRINT_OVERRIDE,
  ) {
    this.foundationIssues = [...foundationIssues];
    this.userRelations = userRelations;
  }

  async query(queryText: string): Promise<{ rows: Array<Record<string, unknown>> }> {
    if (queryText.includes("foundation_fingerprint_issues")) {
      if (this.fingerprintOverride !== NO_FINGERPRINT_OVERRIDE) {
        return { rows: [{ missing_components: this.fingerprintOverride }] };
      }
      return { rows: [{ missing_components: [...this.foundationIssues] }] };
    }
    if (queryText.includes("FROM pg_class c")) {
      return { rows: this.userRelations };
    }
    if (
      queryText.includes("CREATE TABLE IF NOT EXISTS outbound_send_log") &&
      queryText.includes("CREATE TABLE IF NOT EXISTS webhook_event_log")
    ) {
      this.foundationExecutions++;
      this.foundationIssues = [];
      return { rows: [] };
    }
    throw new Error(`Unexpected query in fake migration client: ${queryText.slice(0, 80)}`);
  }
}

let passed = 0;
const failures: string[] = [];

async function check(name: string, test: () => void | Promise<void>) {
  try {
    await test();
    console.log(`  PASS ${name}`);
    passed++;
  } catch (error: any) {
    failures.push(`${name}: ${error?.message ?? error}`);
    console.error(`  FAIL ${name}: ${error?.message ?? error}`);
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

await check("empty snapshot restores both omitted 0076 foundation tables", async () => {
  const client = new FakeMigrationClient([
    "table:public.outbound_send_log:missing",
    "table:public.webhook_event_log:missing",
  ]);
  const result = await verifyOrCompleteFreshSnapshotFoundation(client, true);
  expect(result.appliedFoundation, "fresh completion did not report an applied foundation");
  expect(client.foundationExecutions === 1, "0076 foundation SQL was not executed exactly once");
  expect(client.foundationIssues.length === 0, "fresh completion did not verify the full foundation");
});

await check("existing complete database is verified without mutation", async () => {
  const client = new FakeMigrationClient();
  const result = await verifyOrCompleteFreshSnapshotFoundation(client, false);
  expect(!result.appliedFoundation, "complete existing database was unexpectedly mutated");
  expect(client.foundationExecutions === 0, "0076 replayed on a complete existing database");
});

await check("existing database missing a table fails closed without repair", async () => {
  const client = new FakeMigrationClient(["table:public.webhook_event_log:missing"]);
  let error = "";
  try {
    await verifyOrCompleteFreshSnapshotFoundation(client, false);
  } catch (caught: any) {
    error = caught?.message ?? String(caught);
  }
  expect(error.includes("foundation mismatch"), "missing table did not produce a foundation mismatch");
  expect(error.includes("table:public.webhook_event_log:missing"), "error did not identify the missing table");
  expect(client.foundationExecutions === 0, "existing database was silently repaired");
  expect(client.foundationIssues.length === 1, "existing database mismatch was mutated");
});

await check("existing database missing a required index fails closed", async () => {
  const client = new FakeMigrationClient(["index:idx_osl_status:missing-or-mismatched"]);
  let error = "";
  try {
    await verifyOrCompleteFreshSnapshotFoundation(client, false);
  } catch (caught: any) {
    error = caught?.message ?? String(caught);
  }
  expect(error.includes("index:idx_osl_status:missing-or-mismatched"), "error omitted the missing index");
  expect(client.foundationExecutions === 0, "missing index caused 0076 replay");
  expect(client.foundationIssues.length === 1, "missing index was silently repaired");
});

await check("existing database missing required uniqueness fails closed", async () => {
  const client = new FakeMigrationClient(["unique:outbound_send_log.idempotency_key:missing"]);
  let error = "";
  try {
    await verifyOrCompleteFreshSnapshotFoundation(client, false);
  } catch (caught: any) {
    error = caught?.message ?? String(caught);
  }
  expect(error.includes("unique:outbound_send_log.idempotency_key:missing"), "error omitted missing uniqueness");
  expect(client.foundationExecutions === 0, "missing uniqueness caused 0076 replay");
  expect(client.foundationIssues.length === 1, "missing uniqueness was silently repaired");
});

await check("malformed fingerprint result fails closed", async () => {
  const client = new FakeMigrationClient([], [], "not-an-array");
  let error = "";
  try {
    await verifyOrCompleteFreshSnapshotFoundation(client, false);
  } catch (caught: any) {
    error = caught?.message ?? String(caught);
  }
  expect(error.includes("Invalid 0076 foundation fingerprint result"), "malformed result was accepted");
  expect(client.foundationExecutions === 0, "malformed result caused 0076 replay");
});

await check("repeated runner behavior is idempotent after fresh completion", async () => {
  const client = new FakeMigrationClient(["table:public.outbound_send_log:missing"]);
  await verifyOrCompleteFreshSnapshotFoundation(client, true);
  await verifyOrCompleteFreshSnapshotFoundation(client, false);
  expect(client.foundationExecutions === 1, "0076 foundation SQL executed more than once");
});

await check("non-empty noncanonical database is rejected before snapshot or repair", async () => {
  const client = new FakeMigrationClient([], [{
    schema_name: "public",
    relation_name: "legacy_contacts",
  }]);
  let error = "";
  try {
    await assertSnapshotTargetIsEmpty(client);
  } catch (caught: any) {
    error = caught?.message ?? String(caught);
  }
  expect(error.includes("non-empty noncanonical database"), "non-empty target was not rejected");
  expect(error.includes("public.legacy_contacts"), "error omitted the blocking relation");
  expect(client.foundationExecutions === 0, "0076 executed for a non-empty target");
});

await check("non-empty drizzle schema is rejected before snapshot or repair", async () => {
  const client = new FakeMigrationClient([], [{
    schema_name: "drizzle",
    relation_name: "legacy_contacts",
  }]);
  let error = "";
  try {
    await assertSnapshotTargetIsEmpty(client);
  } catch (caught: any) {
    error = caught?.message ?? String(caught);
  }
  expect(error.includes("non-empty noncanonical database"), "drizzle user relation was not rejected");
  expect(error.includes("drizzle.legacy_contacts"), "error omitted the drizzle relation");
  expect(client.foundationExecutions === 0, "0076 executed for a non-empty drizzle schema");
});

await check("canonical runner completes the snapshot before migration baselining", () => {
  const runner = fs.readFileSync(
    path.join(process.cwd(), "server", "db-migrate.ts"),
    "utf8",
  );
  const snapshotIndex = runner.indexOf("appliedFreshSnapshot = true");
  const emptyCheckIndex = runner.indexOf("await assertSnapshotTargetIsEmpty(client)");
  const completionIndex = runner.indexOf(
    "await verifyOrCompleteFreshSnapshotFoundation(client, appliedFreshSnapshot)",
  );
  const baselineIndex = runner.indexOf("const entriesToBaseline");
  expect(emptyCheckIndex >= 0, "runner does not verify snapshot target emptiness");
  expect(emptyCheckIndex < snapshotIndex, "runner can apply the snapshot before proving emptiness");
  expect(snapshotIndex >= 0, "runner does not track fresh snapshot application");
  expect(completionIndex > snapshotIndex, "snapshot completion does not follow snapshot application");
  expect(baselineIndex > completionIndex, "0076 can be baselined before snapshot completion");
});

await check("GitHub integration starts empty and invokes the guarded canonical runner twice", () => {
  const workflow = fs.readFileSync(
    path.join(process.cwd(), ".github", "workflows", "ci.yml"),
    "utf8",
  );
  expect(!workflow.includes("Bootstrap disposable schema snapshot"), "CI still preloads snapshot 0109");
  expect(!workflow.includes("CI_SNAPSHOT_BOOTSTRAP"), "CI still uses the snapshot preload bypass");
  expect(!workflow.includes("run: npx tsx server/db-migrate.ts"), "CI bypasses the guarded launcher");
  const invocations =
    workflow.match(/run: npx tsx scripts\/run-guarded-canonical-migration\.ts/g) ?? [];
  expect(
    invocations.length === 2,
    `expected two guarded canonical migration invocations, found ${invocations.length}`,
  );

  const guardedLauncher = fs.readFileSync(
    path.join(process.cwd(), "scripts", "run-guarded-canonical-migration.ts"),
    "utf8",
  );
  expect(
    guardedLauncher.includes("spawnCertificationTsx(") &&
      guardedLauncher.includes('"scripts/run-guarded-canonical-migration-child.ts"'),
    "guarded launcher does not spawn the clean migration child",
  );
  const guardedChild = fs.readFileSync(
    path.join(process.cwd(), "scripts", "run-guarded-canonical-migration-child.ts"),
    "utf8",
  );
  const denyIndex = guardedChild.indexOf("applyCertificationProviderDenyBoundary(");
  const importIndex = guardedChild.indexOf('await import("../server/db-migrate")');
  const runIndex = guardedChild.indexOf("await runDrizzleMigrations()");
  expect(denyIndex >= 0, "migration child does not apply the provider-denial boundary");
  expect(importIndex > denyIndex, "canonical runner is imported before child provider denial");
  expect(runIndex > importIndex, "guarded launcher does not call the canonical migration runner");
});

if (failures.length > 0) {
  console.error(`\nFresh snapshot completion checks failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nFresh snapshot completion checks passed (${passed}/${passed}).`);