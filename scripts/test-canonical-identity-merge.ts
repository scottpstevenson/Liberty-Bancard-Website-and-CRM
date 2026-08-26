#!/usr/bin/env npx tsx
/**
 * BT-07 deterministic integration suite.
 *
 * This is deliberately not a source scan. It uses the shared disposable
 * infrastructure guard before importing application DB modules, then exercises
 * the operation lifecycle against the migrated PostgreSQL schema. CI supplies
 * TEST_DATABASE_URL/DATABASE_URL for a disposable database.
 */
import crypto from "crypto";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";

if (process.env.GHL_TRANSPORT_FAILFAST !== "true") {
  throw new Error("GHL_TRANSPORT_FAILFAST=true is required for canonical identity merge tests");
}

let passed = 0;
function assert(condition: unknown, label: string) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

async function main() {
  await assertDisposableTestInfrastructure({ operation: "canonical-identity-merge" });
  const [{ db }, { contacts, deals }, { eq, sql }, identity, merge] = await Promise.all([
    import("../server/db"),
    import("../shared/schema"),
    import("drizzle-orm"),
    import("../server/services/contact-identity"),
    import("../server/services/contact-merge"),
  ]);

  const fixtureIds: number[] = [];
  const operationIds: string[] = [];
  const nonce = crypto.randomUUID().slice(0, 8);
  const makeContact = async (label: string, email: string, extra: Record<string, unknown> = {}) => {
    const [contact] = await db.insert(contacts).values({
      firstName: "BT07", lastName: label, email, phone: "3055550199",
      status: "New", ...extra,
    } as any).returning();
    fixtureIds.push(contact.id);
    await identity.recordContactIdentityObservations(db as any, contact, "storage_create", `bt07:${nonce}`);
    return contact;
  };

  try {
    const survivor = await makeContact("survivor", `bt07-${nonce}@example.test`);
    const deprecated = await makeContact("deprecated", `BT07-${nonce}@example.test`);
    const third = await makeContact("graph", `BT07-${nonce}@example.test`);
    const candidateIds = (await merge.findIdentityCandidates(survivor.id)).map((row: any) => row.id);
    assert(candidateIds.includes(deprecated.id) && candidateIds.includes(third.id), "eligible evidence forms a connected candidate component");

    const preview = await merge.previewContactMerge({
      survivorContactId: survivor.id, deprecatedContactId: deprecated.id,
      idempotencyKey: crypto.randomUUID(), actorId: "bt07-admin", actorRole: "admin",
      fieldDecisions: { email: "survivor", phone: "survivor" },
    });
    operationIds.push(preview.operationId);
    assert(preview.conflicts.length === 0, "same-class eligible pair produces a read-only conflict-free preview");
    const [previewOp] = (await db.execute(sql`SELECT status FROM contact_merge_operations WHERE id = ${preview.operationId}`) as any).rows;
    assert(previewOp.status === "previewed", "read-only preview persists as previewed");

    await db.insert(deals).values({ title: `BT07 ${nonce}`, pipeline: "sales", stage: "New Lead", contactId: deprecated.id } as any);
    await merge.approveContactMerge(preview.operationId, "bt07-admin");
    let staleRejected = false;
    try { await merge.executeContactMerge(preview.operationId, "bt07-admin"); } catch (error: any) {
      staleRejected = error?.code === "STALE_PREVIEW";
    }
    assert(staleRejected, "a relationship added after preview blocks execution rather than transferring unseen work");
    const [staleOperation] = (await db.execute(sql`SELECT status, conflict_reason FROM contact_merge_operations WHERE id = ${preview.operationId}`) as any).rows;
    assert(staleOperation.status === "blocked" && staleOperation.conflict_reason === "STALE_PREVIEW", "relationship-state drift is durably blocked");

    const freshPreview = await merge.previewContactMerge({
      survivorContactId: survivor.id, deprecatedContactId: deprecated.id,
      idempotencyKey: crypto.randomUUID(), actorId: "bt07-admin", actorRole: "admin",
      fieldDecisions: { email: "survivor", phone: "survivor" },
    });
    operationIds.push(freshPreview.operationId);
    await merge.approveContactMerge(freshPreview.operationId, "bt07-admin");
    const completed = await merge.executeContactMerge(freshPreview.operationId, "bt07-admin");
    assert(["completed", "reconciliation_pending"].includes(completed.status), "approved operation commits once without a provider call");
    const [redirect] = (await db.execute(sql`SELECT survivor_contact_id FROM contact_merge_redirects WHERE operation_id = ${preview.operationId} AND active`) as any).rows;
    assert(Number(redirect.survivor_contact_id) === survivor.id, "local commit creates one active redirect");
    const resolved = await identity.resolveLiveContactRedirect(deprecated.id);
    assert(resolved.effectiveContactId === survivor.id, "live redirect resolver returns survivor without changing generic reads");
    const [movedDeal] = (await db.execute(sql`SELECT contact_id FROM deals WHERE title = ${`BT07 ${nonce}`}`) as any).rows;
    assert(Number(movedDeal.contact_id) === survivor.id, "reversible relationship transfer updates the survivor");

    const replay = await merge.executeContactMerge(freshPreview.operationId, "bt07-admin");
    assert(replay.id === completed.id, "replay returns the existing durable operation");

    // Different classes must be terminally blocked during preview, and a blocked
    // operation cannot be promoted by the approval transition.
    const classA = await makeContact("class-a", `bt07-class-a-${nonce}@example.test`, { recordClass: "merchant" });
    const classB = await makeContact("class-b", `bt07-class-a-${nonce}@example.test`, { recordClass: "prospect" });
    const blocked = await merge.previewContactMerge({
      survivorContactId: classA.id, deprecatedContactId: classB.id,
      idempotencyKey: crypto.randomUUID(), actorId: "bt07-admin", actorRole: "admin",
      fieldDecisions: { email: "survivor", phone: "survivor" },
    });
    operationIds.push(blocked.operationId);
    assert(blocked.conflicts.includes("RECORD_CLASS_MISMATCH"), "class mismatch is exposed before execution");
    const [blockedOp] = (await db.execute(sql`SELECT status, conflict_reason FROM contact_merge_operations WHERE id = ${blocked.operationId}`) as any).rows;
    assert(blockedOp.status === "blocked" && blockedOp.conflict_reason === "RECORD_CLASS_MISMATCH", "known preview conflict is durably terminal");
    let approvalRejected = false;
    try { await merge.approveContactMerge(blocked.operationId, "bt07-admin"); } catch { approvalRejected = true; }
    assert(approvalRejected, "blocked preview cannot be approved");

    // Undo restores only reversible local ownership. It never removes redirect
    // evidence, consent subjects, or outbound history; it retires the redirect.
    const undone = await merge.undoContactMerge(freshPreview.operationId, "bt07-admin");
    assert(undone.status === "undone", "admin undo restores reversible local operation state");
    const [restoredDeal] = (await db.execute(sql`SELECT contact_id FROM deals WHERE title = ${`BT07 ${nonce}`}`) as any).rows;
    assert(Number(restoredDeal.contact_id) === deprecated.id, "undo restores transferred relationship ownership");

    // Active provider work belongs to the deprecated identity and must never
    // run after a merge. It is terminalized atomically, and undo fails closed
    // because recreating claimed external work would be unsafe.
    const queueSurvivor = await makeContact("queue-survivor", `bt07-queue-${nonce}@example.test`);
    const queueDeprecated = await makeContact("queue-deprecated", `BT07-queue-${nonce}@example.test`);
    await db.execute(sql`
      INSERT INTO contact_provider_projections (contact_id, provider, projection_key, state)
      VALUES (${queueDeprecated.id}, 'ghl', ${`bt07:${nonce}`}, 'pending')
    `);
    await db.execute(sql`
      INSERT INTO validation_intents (
        contact_id, normalized_email_token_hash, subject_generation, purpose, state
      ) VALUES (${queueDeprecated.id}, ${`bt07-token-${nonce}`}, 1, 'marketing_outreach', 'pending')
    `);
    const queuePreview = await merge.previewContactMerge({
      survivorContactId: queueSurvivor.id, deprecatedContactId: queueDeprecated.id,
      idempotencyKey: crypto.randomUUID(), actorId: "bt07-admin", actorRole: "admin",
      fieldDecisions: { email: "survivor", phone: "survivor" },
    });
    operationIds.push(queuePreview.operationId);
    await merge.approveContactMerge(queuePreview.operationId, "bt07-admin");
    await merge.executeContactMerge(queuePreview.operationId, "bt07-admin");
    const [terminalized] = (await db.execute(sql`
      SELECT
        (SELECT state FROM contact_provider_projections WHERE contact_id = ${queueDeprecated.id}) AS projection_state,
        (SELECT state FROM validation_intents WHERE contact_id = ${queueDeprecated.id}) AS validation_state
    `) as any).rows;
    assert(
      terminalized.projection_state === "terminal" && terminalized.validation_state === "superseded",
      "merge terminalizes active provider projection and validation work",
    );
    let unsafeUndoRejected = false;
    try { await merge.undoContactMerge(queuePreview.operationId, "bt07-admin"); } catch (error: any) {
      unsafeUndoRejected = error?.code === "UNDO_BLOCKED";
    }
    assert(unsafeUndoRejected, "undo fails closed after provider work is terminalized");
  } finally {
    // Delete dependents first; immutable authority/history evidence is left
    // attached in disposable CI DB and is removed with the fixture contacts.
    for (const operationId of operationIds) {
      await db.execute(sql`DELETE FROM contact_merge_undo_records WHERE operation_id = ${operationId}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM contact_merge_relationship_actions WHERE operation_id = ${operationId}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM contact_merge_redirects WHERE operation_id = ${operationId}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM contact_merge_reconciliations WHERE operation_id = ${operationId}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM contact_merge_operations WHERE id = ${operationId}`).catch(() => undefined);
    }
    if (fixtureIds.length) {
      await db.execute(sql`DELETE FROM deals WHERE title LIKE ${`BT07 ${nonce}%`}`).catch(() => undefined);
      await db.execute(sql`DELETE FROM contact_identity_observations WHERE contact_id = ANY(${fixtureIds})`).catch(() => undefined);
      await db.delete(contacts).where(sql`${contacts.id} = ANY(${fixtureIds})`).catch(() => undefined);
    }
  }
  console.log(`✓ Canonical identity merge integration passed (${passed} assertions)`);
}

main().catch((error) => { console.error(error); process.exit(1); });