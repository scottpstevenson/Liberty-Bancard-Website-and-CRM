/**
 * Durable statement-command worker regression tests.
 *
 * Uses only intentionally missing local file paths. The statement chain is
 * never invoked, so this suite cannot send mail, call GHL, or reach a provider.
 *
 * Run with:
 *   npx tsx server/tests/statement-command-worker.test.ts
 */
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { statementUploadCommands } from "@shared/schema";
import { claimCommand, computeRequestFingerprint, getCommandForOwner, updateContext } from "../services/statement-upload-idempotency";
import { executeStatementUploadCommand } from "../services/statement-command-worker";

let passed = 0;
let failed = 0;
const createdIds: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓  ${label}`);
    passed++;
  } else {
    console.error(`  ✗  ${label}`);
    failed++;
  }
}

async function makeMissingFileCommand(tag: string) {
  const requestId = randomUUID();
  const ownerScope = `statement-worker-test:${tag}`;
  const claimed = await claimCommand({
    requestId,
    fingerprint: computeRequestFingerprint({ fields: { tag }, fileBuffer: Buffer.from(tag) }),
    ownerScope,
  });
  if (claimed.outcome !== "claimed") throw new Error(`Expected claimed, got ${claimed.outcome}`);
  createdIds.push(claimed.command.id);
  await updateContext(claimed.command.id, {
    contactId: 999999999,
    source: "website",
    durableFilePath: `/tmp/statement-worker-test-missing-${requestId}.pdf`,
  });
  return { id: claimed.command.id, ownerScope };
}

async function run(): Promise<void> {
  console.log("\n=== Durable Statement Command Worker Tests ===\n");

  console.log("T1: missing durable file is terminally recoverable, never chained");
  const missing = await makeMissingFileCommand("missing");
  await executeStatementUploadCommand(missing.id);
  const afterMissing = await getCommandForOwner(missing.id, missing.ownerScope);
  assert(afterMissing?.status === "recoverable_failed", "missing file becomes recoverable_failed");
  assert((afterMissing?.result as { code?: string } | null)?.code === "durable_upload_unreadable", "missing file records safe failure code");
  assert(afterMissing?.attemptCount === 1, "missing file consumes exactly one claimed attempt");

  console.log("\nT2: duplicate delivery cannot reclaim terminal command");
  await executeStatementUploadCommand(missing.id);
  const afterDuplicate = await getCommandForOwner(missing.id, missing.ownerScope);
  assert(afterDuplicate?.attemptCount === 1, "duplicate terminal delivery does not increment attempts");
  assert(afterDuplicate?.status === "recoverable_failed", "duplicate terminal delivery preserves outcome");

  console.log("\nT3: expired lease is taken over by one worker");
  const stale = await makeMissingFileCommand("expired-lease");
  await db.update(statementUploadCommands).set({
    leaseToken: randomUUID(),
    leaseExpiresAt: new Date(Date.now() - 1_000),
    heartbeatAt: new Date(Date.now() - 1_000),
  }).where(eq(statementUploadCommands.id, stale.id));
  await executeStatementUploadCommand(stale.id);
  const afterTakeover = await getCommandForOwner(stale.id, stale.ownerScope);
  assert(afterTakeover?.status === "recoverable_failed", "expired lease is claimed and resolved");
  assert(afterTakeover?.attemptCount === 1, "takeover records one worker attempt");
  assert(afterTakeover?.leaseToken === null, "worker releases its lease after terminal recovery");

  console.log("\nT4: stale lease cannot receive an unfenced terminal write");
  const fenced = await makeMissingFileCommand("fenced-terminal");
  const activeToken = randomUUID();
  await db.update(statementUploadCommands).set({
    leaseToken: activeToken,
    leaseExpiresAt: new Date(Date.now() + 60_000),
  }).where(eq(statementUploadCommands.id, fenced.id));
  await executeStatementUploadCommand(fenced.id);
  const afterFenced = await getCommandForOwner(fenced.id, fenced.ownerScope);
  assert(afterFenced?.status === "in_progress", "active lease blocks duplicate executor");
  assert(afterFenced?.attemptCount === 0, "blocked executor cannot consume an attempt");

  console.log("\nT5: routes acknowledge only durable queue ownership");
  const { readFileSync } = await import("fs");
  const readRoute = (file: string) => readFileSync(`${process.cwd()}/${file}`, "utf8");
  const queuedRoutes = [
    "server/routes/public.ts",
    "server/routes/documents.ts",
    "server/routes/rate-review.ts",
    "server/routes/sdr.ts",
  ];
  for (const file of queuedRoutes) {
    const source = readRoute(file);
    const handoffs = source.split("if (!statementQueued)").slice(1);
    assert(handoffs.length > 0, `${file}: has durable statement queue handoff`);
    assert(
      handoffs.every(block =>
        /status\(503\)/.test(block.slice(0, 400)) &&
        /status\(202\)/.test(block.slice(0, 8_000)),
      ),
      `${file}: queue failure is 503 and accepted handoff is 202`,
    );
  }
  const sdrRoute = readRoute("server/routes/sdr.ts");
  assert(sdrRoute.includes("STATEMENT_FILE_REQUIRED"), "token upload rejects a missing statement file");
  assert(sdrRoute.includes("STATEMENT_UPLOAD_CONTACT_REQUIRED"), "token upload rejects an unlinked contact");
  assert(!sdrRoute.includes("handleStatementReceived("), "token upload route never records receipt outside worker ownership");
  assert(!sdrRoute.includes("idemMarkSucceeded"), "token upload route never terminalizes command success");

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Passed: ${passed}  Failed: ${failed}`);
  if (failed) process.exitCode = 1;
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (createdIds.length) {
      for (const id of createdIds) {
        await db.delete(statementUploadCommands).where(eq(statementUploadCommands.id, id));
      }
    }
    setTimeout(() => process.exit(process.exitCode ?? 0), 200);
  });