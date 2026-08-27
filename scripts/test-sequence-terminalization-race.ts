#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { pool } from "../server/db";
import { communicationContactLockKey } from "../server/services/communication-contact-lock";
import { recordInboundEvent } from "../server/services/communication-events";
import { terminalizeSequenceEnrollment } from "../server/services/sequence-terminalization";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const suffix = `${Date.now()}-${process.pid}`;
let contactId = 0;
let sequenceId = 0;
let enrollmentId = 0;

try {
  contactId = Number((await pool.query(
    `INSERT INTO contacts (first_name, last_name, email, phone) VALUES ('Race', 'Fixture', $1, $2) RETURNING id`,
    [`sequence-race-${suffix}@example.test`, `+1555${String(Date.now()).slice(-7)}`],
  )).rows[0].id);
  sequenceId = Number((await pool.query(
    `INSERT INTO follow_up_sequences (name, trigger_type, status) VALUES ($1, 'manual', 'paused') RETURNING id`,
    [`sequence-race-${suffix}`],
  )).rows[0].id);
  enrollmentId = Number((await pool.query(
    `INSERT INTO sequence_enrollments (sequence_id, contact_id, status, current_step, next_action_at)
     VALUES ($1, $2, 'active', 0, NOW()) RETURNING id`,
    [sequenceId, contactId],
  )).rows[0].id);
  const enrolledAt = new Date((await pool.query(
    `SELECT created_at FROM sequence_enrollments WHERE id=$1`, [enrollmentId],
  )).rows[0].created_at);

  async function runOrder(first: "inbound" | "terminal") {
    await pool.query(`DELETE FROM communication_events WHERE contact_id=$1`, [contactId]);
    await pool.query(
      `UPDATE sequence_enrollments SET status='active', current_step=0, completed_at=NULL, metadata=NULL WHERE id=$1`,
      [enrollmentId],
    );
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock($1::bigint)", [
      communicationContactLockKey(contactId).toString(),
    ]);
    const inbound = () => recordInboundEvent({ contactId, channel: "email", provider: "internal", body: "reply" });
    const terminal = () => terminalizeSequenceEnrollment({
      enrollmentId, contactId, enrolledAt, expectedCurrentStep: 0, terminalCurrentStep: 1,
      noResponseReason: "sequence_exhausted_no_response",
    });
    let inboundPromise: ReturnType<typeof inbound>;
    let terminalPromise: ReturnType<typeof terminal>;
    if (first === "inbound") {
      inboundPromise = inbound();
      await sleep(75);
      terminalPromise = terminal();
    } else {
      terminalPromise = terminal();
      await sleep(75);
      inboundPromise = inbound();
    }
    await sleep(75);
    await blocker.query("COMMIT");
    blocker.release();
    const [, operation] = await Promise.all([inboundPromise, terminalPromise]);
    const terminalState = (await pool.query(`SELECT metadata->'terminal' AS terminal FROM sequence_enrollments WHERE id=$1`, [enrollmentId])).rows[0].terminal;
    return { operation, terminalState };
  }

  const inboundWins = await runOrder("inbound");
  assert.equal(inboundWins.operation.outcome, "COMPLETED_REPLY");
  assert.equal(inboundWins.terminalState.category, "reply");
  assert.notEqual(inboundWins.terminalState.category, "no_response", "committed-before-terminal inbound can never become no_response");
  const terminalWins = await runOrder("terminal");
  assert.equal(terminalWins.operation.outcome, "COMPLETED_NO_RESPONSE");
  assert.equal(terminalWins.terminalState.category, "no_response");
  const committedInboundCount = Number((await pool.query(
    `SELECT COUNT(*) AS n FROM communication_events WHERE contact_id=$1 AND direction='inbound' AND created_at > $2`,
    [contactId, enrolledAt],
  )).rows[0].n);
  assert.ok(committedInboundCount > 0);
  console.log("✓ shared-lock terminalization race verified in both lock orders");
} finally {
  if (contactId) await pool.query(`DELETE FROM communication_events WHERE contact_id=$1`, [contactId]).catch(() => {});
  if (enrollmentId) await pool.query(`DELETE FROM sequence_enrollments WHERE id=$1`, [enrollmentId]).catch(() => {});
  if (sequenceId) await pool.query(`DELETE FROM follow_up_sequences WHERE id=$1`, [sequenceId]).catch(() => {});
  if (contactId) await pool.query(`DELETE FROM contacts WHERE id=$1`, [contactId]).catch(() => {});
  await pool.end();
}