/**
 * Focused integration test: rate-review statement upload must create exactly
 * ONE document for a submission.
 *
 * Run with:
 *   npx tsx server/tests/rate-review-single-document.test.ts
 *
 * Requires DATABASE_URL. Creates and cleans up its own rows.
 *
 * Reproduces the production rate-review path shape:
 *   1. Route creates the rate_review_statement document itself.
 *   2. Route claims the idempotency command.
 *   3. Route invokes runStatementUploadChain with existingDocumentId.
 *
 * Asserts:
 *   - A request-owned rate review is created and linked to its document/deal
 *     before the statement command is handed to the generic chain.
 *   - The command/request link is replay-safe and the open-review guard sees it.
 *   - Portal/CRM status queries can see and progress the linked review.
 *   - Chain Step 4 REUSES the pre-created document (no duplicate file/document).
 *   - The chain result and command row reference that same document.
 *   - The command reaches a terminal state owned by the chain.
 *   - A second chain execution (retry shape) still creates no extra document.
 */

import { randomUUID } from "crypto";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { runStatementUploadChain } from "../services/statement-upload-chain";
import {
  claimCommand,
  computeRequestFingerprint,
  getCommandForOwner,
} from "../services/statement-upload-idempotency";

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓  ${label}`);
    pass++;
  } else {
    console.error(`  ✗  ${label}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────────

let contactId: number;
let dealId: number;
const commandIds: string[] = [];

async function createFixtures(): Promise<void> {
  const suffix = Date.now();
  const contactRes = await db.execute(sql`
    INSERT INTO contacts (first_name, last_name, email, phone, created_at, updated_at)
    VALUES ('RateReview', 'SingleDocTest', ${`rate-review-singledoc-${suffix}@test.invalid`},
            ${`+1555${String(suffix).slice(-7)}`}, NOW(), NOW())
    RETURNING id
  `);
  contactId = (contactRes.rows[0] as { id: number }).id;

  const dealRes = await db.execute(sql`
    INSERT INTO deals (contact_id, pipeline, stage, name, created_at, updated_at)
    VALUES (${contactId}, 'sales', 'Statement Received', ${`rate-review-singledoc-test-${suffix}`}, NOW(), NOW())
    RETURNING id
  `);
  dealId = (dealRes.rows[0] as { id: number }).id;
}

async function countDocumentsForContact(): Promise<number> {
  const res = await db.execute(
    sql`SELECT COUNT(*)::text AS cnt FROM documents WHERE contact_id = ${contactId}`
  );
  return parseInt((res.rows[0] as { cnt: string }).cnt, 10);
}

async function cleanup(): Promise<void> {
  // FK-safe order. Audit logs are append-only (cannot be cleaned).
  await db.execute(sql`DELETE FROM rate_review_requests WHERE contact_id = ${contactId}`).catch(() => {});
  await db.execute(sql`DELETE FROM statement_proposals WHERE deal_id = ${dealId}`).catch(() => {});
  await db.execute(sql`DELETE FROM underwriting_decisions WHERE deal_id = ${dealId}`).catch(() => {});
  await db.execute(sql`DELETE FROM tasks WHERE contact_id = ${contactId}`).catch(() => {});
  await db.execute(sql`DELETE FROM documents WHERE contact_id = ${contactId}`).catch(() => {});
  for (const id of commandIds) {
    await db.execute(sql`DELETE FROM statement_upload_commands WHERE id = ${id}`).catch(() => {});
  }
  await db.execute(sql`DELETE FROM deals WHERE id = ${dealId}`).catch(() => {});
  await db.execute(sql`DELETE FROM contacts WHERE id = ${contactId}`).catch(() => {});
}

// ── test ─────────────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log("\n=== Rate-review single-document tests ===\n");
  const { readFileSync } = await import("fs");
  const routeSource = readFileSync("server/routes/rate-review.ts", "utf8");
  const guardOffset = routeSource.indexOf("getOpenRateReviewsByContact");
  const createOffset = routeSource.indexOf("createRateReviewRequest");
  const handoffOffset = routeSource.lastIndexOf("persistAndEnqueueStatementCommand");
  assert(
    guardOffset >= 0 && createOffset > guardOffset && handoffOffset > createOffset,
    "route guards then persists request-owned review before command handoff",
  );
  assert(
    /statementUploadCommandId:\s*commandId/.test(routeSource),
    "route binds the review to the claimed command identity",
  );
  await createFixtures();
  console.log(`(fixtures: contact ${contactId}, deal ${dealId})\n`);

  const fileBuffer = Buffer.from(`fake-statement-pdf-${Date.now()}`);
  const fileName = "test-statement.pdf";
  const ownerScope = "user:rate-review-singledoc-test";

  // ── Step 1 shape: route creates the rate_review_statement document ─────────
  const doc = await storage.createDocument({
    contactId,
    dealId, // route resolves the contact deal before creating its review document
    type: "rate_review_statement",
    category: "Rate Review Statement",
    fileName,
    fileSize: fileBuffer.length,
    mimeType: "application/pdf",
    uploadedBy: "Test Merchant",
    storageKey: `merchant_docs/test_${Date.now()}.pdf`,
    accessScope: "merchant",
  });
  assert(doc?.id > 0, "route-shape document created");
  assert((await countDocumentsForContact()) === 1, "exactly 1 document before chain");

  // ── Step 2 shape: route claims the idempotency command ─────────────────────
  const idempotencyKey = randomUUID();
  const fingerprint = computeRequestFingerprint({
    fields: { contactId, source: "portal-rate-review", workflow: "rate-review-upload", fileName },
    fileBuffer,
  });
  const claim = await claimCommand({
    requestId: idempotencyKey,
    fingerprint,
    ownerScope,
    source: "portal-rate-review",
    contactId,
  });
  assert(claim.outcome === "claimed", "idempotency slot claimed", `got ${claim.outcome}`);
  if (claim.outcome !== "claimed") throw new Error("cannot continue without a claim");
  const commandId = claim.command.id;
  commandIds.push(commandId);

  // ── Step 3 shape: route owns the review before generic chain handoff ───────
  const review = await storage.createRateReviewRequest({
    statementUploadCommandId: commandId,
    contactId,
    dealId,
    documentId: doc.id,
    status: "requested",
    requestNotes: "Please review my rates",
  });
  assert(review.statementUploadCommandId === commandId, "review is owned by the claimed command");
  assert(review.documentId === doc.id && review.dealId === dealId, "review is associated to document and deal");

  const linkedReview = await storage.getRateReviewRequestByStatementUploadCommandId(commandId);
  assert(linkedReview?.id === review.id, "command replay lookup resolves the original review");
  const openReviews = await storage.getOpenRateReviewsByContact(contactId);
  assert(openReviews.some(r => r.id === review.id), "open-review guard sees the new review");

  const portalReviews = await storage.getRateReviewRequestsByContact(contactId);
  assert(portalReviews.some(r => r.id === review.id && r.status === "requested"), "portal status query sees requested review");
  const repViewed = await storage.updateRateReviewRequest(review.id, { status: "rep_viewed", repViewedAt: new Date() });
  assert(repViewed?.status === "rep_viewed", "CRM can progress review to rep_viewed");

  // ── Step 4 shape: chain runs with existingDocumentId ───────────────────────
  const result = await runStatementUploadChain({
    contactId,
    dealId,
    fileBuffer,
    fileName,
    source: "portal-rate-review",
    commandId,
    existingDocumentId: doc.id,
  });

  const step4 = result.steps.find(s => s.step === 4);
  assert(step4?.success === true, "chain Step 4 succeeded");
  assert(step4?.data?.reused === true, "chain Step 4 reused the existing document");
  assert(result.documentId === doc.id, "chain result references the pre-created document", `got ${result.documentId}`);

  // ── Core kill-line assertion: exactly ONE document exists ──────────────────
  const countAfter = await countDocumentsForContact();
  assert(countAfter === 1, `exactly 1 document after chain (no duplicate)`, `got ${countAfter}`);

  // Deal linkage backfilled on the reused document
  const refreshed = await storage.getDocumentById(doc.id);
  assert(refreshed?.dealId === dealId, "reused document linked to the resolved deal");

  // Command row references the reused document and reached a terminal state
  const cmd = await getCommandForOwner(commandId, ownerScope);
  assert(cmd?.documentId === doc.id, "command row FK references the reused document");
  assert(
    cmd?.status === "succeeded" || cmd?.status === "recoverable_failed",
    "command reached a chain-owned terminal state",
    `got ${cmd?.status}`
  );

  // A completed command is a replay, not a second request/review. (A chain
  // step failure remains honestly recoverable_failed under the same contract.)
  const replay = await claimCommand({
    requestId: idempotencyKey,
    fingerprint,
    ownerScope,
    source: "portal-rate-review",
    contactId,
  });
  assert(
    replay.outcome === "replay" || replay.outcome === "recoverable_failed_replay",
    "same idempotency key resolves to the owned command rather than a new review",
    `got ${replay.outcome}`,
  );
  assert(
    (await storage.getRateReviewRequestByStatementUploadCommandId(commandId))?.id === review.id,
    "replay preserves exactly one request-owned review",
  );

  // ── Retry shape: a second chain execution must not add a document either ───
  // (Simulates a crashed-response retry where the chain is re-run with the
  // same existingDocumentId under a NEW command.)
  const retryKey = randomUUID();
  const retryClaim = await claimCommand({
    requestId: retryKey,
    fingerprint,
    ownerScope,
    source: "portal-rate-review",
    contactId,
  });
  if (retryClaim.outcome === "claimed") {
    commandIds.push(retryClaim.command.id);
    await runStatementUploadChain({
      contactId,
      dealId,
      fileBuffer,
      fileName,
      source: "portal-rate-review",
      commandId: retryClaim.command.id,
      existingDocumentId: doc.id,
    });
    const countAfterRetry = await countDocumentsForContact();
    assert(countAfterRetry === 1, "still exactly 1 document after a chain re-run", `got ${countAfterRetry}`);
  } else {
    assert(false, "retry claim precondition", `got ${retryClaim.outcome}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(50)}`);
  console.log(`Passed: ${pass}  Failed: ${fail}`);
  if (fail > 0) {
    process.exitCode = 1;
  } else {
    console.log("\nAll tests passed ✓");
  }
}

runTests()
  .catch(err => {
    console.error("\nFatal test error:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
      console.log("(fixtures cleaned up)");
    } catch (e) {
      console.warn("Cleanup error:", e);
    }
    setTimeout(() => process.exit(process.exitCode ?? 0), 500);
  });
