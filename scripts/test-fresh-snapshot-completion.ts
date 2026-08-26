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

type RelationName = "outbound_send_log" | "webhook_event_log";

class FakeMigrationClient implements MigrationQueryClient {
  readonly relations = new Set<RelationName>();
  foundationExecutions = 0;
  readonly userRelations: Array<{ schema_name: string; relation_name: string }>;

  constructor(
    initialRelations: RelationName[] = [],
    userRelations: Array<{ schema_name: string; relation_name: string }> = [],
  ) {
    for (const relation of initialRelations) this.relations.add(relation);
    this.userRelations = userRelations;
  }

  async query(queryText: string): Promise<{ rows: Array<Record<string, unknown>> }> {
    if (queryText.includes("FROM pg_class c")) {
      return { rows: this.userRelations };
    }
    if (queryText.includes("to_regclass('public.outbound_send_log')")) {
      return {
        rows: [{
          outbound_send_log: this.relations.has("outbound_send_log"),
          webhook_event_log: this.relations.has("webhook_event_log"),
        }],
      };
    }
    if (
      queryText.includes("CREATE TABLE IF NOT EXISTS outbound_send_log") &&
      queryText.includes("CREATE TABLE IF NOT EXISTS webhook_event_log")
    ) {
      this.foundationExecutions++;
      this.relations.add("outbound_send_log");
      this.relations.add("webhook_event_log");
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
  const client = new FakeMigrationClient();
  const result = await verifyOrCompleteFreshSnapshotFoundation(client, true);
  expect(result.appliedFoundation, "fresh completion did not report an applied foundation");
  expect(client.foundationExecutions === 1, "0076 foundation SQL was not executed exactly once");
  expect(client.relations.has("outbound_send_log"), "outbound_send_log was not restored");
  expect(client.relations.has("webhook_event_log"), "webhook_event_log was not restored");
});

await check("existing complete database is verified without mutation", async () => {
  const client = new FakeMigrationClient(["outbound_send_log", "webhook_event_log"]);
  const result = await verifyOrCompleteFreshSnapshotFoundation(client, false);
  expect(!result.appliedFoundation, "complete existing database was unexpectedly mutated");
  expect(client.foundationExecutions === 0, "0076 replayed on a complete existing database");
});

await check("existing database with drift fails closed without repair", async () => {
  const client = new FakeMigrationClient(["outbound_send_log"]);
  let error = "";
  try {
    await verifyOrCompleteFreshSnapshotFoundation(client, false);
  } catch (caught: any) {
    error = caught?.message ?? String(caught);
  }
  expect(error.includes("Existing database schema drift"), "missing relation did not produce the drift error");
  expect(error.includes("webhook_event_log"), "drift error did not identify the missing relation");
  expect(client.foundationExecutions === 0, "existing database drift was silently repaired");
  expect(!client.relations.has("webhook_event_log"), "missing existing relation was recreated");
});

await check("repeated runner behavior is idempotent after fresh completion", async () => {
  const client = new FakeMigrationClient();
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
  expect(client.relations.size === 0, "snapshot or foundation relations were created");
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

if (failures.length > 0) {
  console.error(`\nFresh snapshot completion checks failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nFresh snapshot completion checks passed (${passed}/${passed}).`);