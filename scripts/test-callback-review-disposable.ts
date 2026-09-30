/**
 * Behavioral callback review test. Never run against a shared database:
 * scripts/run-callback-review-disposable.ts provisions this database and
 * disables provider transports before invoking this test.
 */
import assert from "node:assert/strict";
import express from "express";
import { and, eq } from "drizzle-orm";

async function main() {
  if (process.env.NODE_ENV !== "test" || !process.env.TEST_DATABASE_URL
    || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
    || process.env.GHL_TRANSPORT_FAILFAST !== "true") {
    throw new Error("CALLBACK_REVIEW_REQUIRES_DISPOSABLE_DATABASE_AND_FAILFAST_TRANSPORT");
  }
  const { db, pool } = await import("../server/db");
  const { contacts, inboundRequests, inboundRequestEffects, notifications, deals, tasks } = await import("../shared/schema");
  const { registerPublicRoutes } = await import("../server/routes/public");
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  registerPublicRoutes(app);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("TEST_SERVER_PORT_MISSING");
    const base = `http://127.0.0.1:${address.port}`;
    const phone = "+15550104233";
    const candidates = await db.insert(contacts).values([
      { firstName: "Candidate", lastName: "One", email: "candidate-one@test.invalid", phone },
      { firstName: "Candidate", lastName: "Two", email: "candidate-two@test.invalid", phone: "(555) 010-4233" },
    ]).returning();
    const body = { name: "Caller Example", phone: "555-010-4233", bestTime: "Afternoon" };
    const key = crypto.randomUUID();
    const submit = (idempotencyKey: string) => fetch(`${base}/api/public/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
    const first = await submit(key);
    const receipt = await first.json();
    assert.equal(first.status, 201, JSON.stringify(receipt));
    assert.equal(receipt.status, "review_required");
    assert.equal(typeof receipt.requestReceipt, "string");
    const [request] = await db.select().from(inboundRequests).where(eq(inboundRequests.id, receipt.requestReceipt));
    assert.equal(request.contactId, null, "ambiguous identity must not attach either candidate");
    assert.equal(request.assignmentStatus, "review_required");
    assert.ok(request.slaDueAt, "review must carry the original sales SLA deadline");
    assert.equal(request.terminalReason, "AMBIGUOUS_CALLBACK_IDENTITY");
    const notices = await db.select().from(notifications).where(eq(notifications.inboundRequestId, request.id));
    assert.equal(notices.length, 1, "exactly one durable review notification");
    assert.equal(notices[0].commandKey, `inbound:${request.id}:callback-identity-review`);
    assert.deepEqual([...((notices[0].metadata as { candidateContactIds: number[] }).candidateContactIds)].sort(),
      candidates.map((candidate) => candidate.id).sort());
    assert.match(notices[0].message, /Review request/);
    const effects = await db.select().from(inboundRequestEffects).where(eq(inboundRequestEffects.requestId, request.id));
    assert.ok(effects.length > 0 && effects.every((effect) => effect.state === "held"),
      "do not certify sales work, SLA, or external effects without resolved identity");
    assert.equal((await db.select().from(deals).where(eq(deals.contactId, candidates[0].id))).length, 0);
    assert.equal((await db.select().from(tasks).where(eq(tasks.contactId, candidates[0].id))).length, 0);
    assert.equal((await db.select().from(contacts)).length, 2, "no duplicate contact created");

    const replay = await submit(key);
    assert.equal(replay.status, 200);
    assert.deepEqual((await replay.json()).requestReceipt, request.id);
    assert.equal((await db.select().from(notifications).where(eq(notifications.inboundRequestId, request.id))).length, 1);
    const second = await submit(crypto.randomUUID());
    const secondReceipt = await second.json();
    assert.equal(second.status, 201, JSON.stringify(secondReceipt));
    assert.notEqual(secondReceipt.requestReceipt, request.id, "new legitimate occurrence gets a new request");
    assert.equal((await db.select().from(contacts)).length, 2);
    assert.equal((await db.select().from(notifications)).length, 2);
    console.log("PASS ambiguous callback: 201 review receipt, durable notification, held effects, no merge, replay and second occurrence");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });