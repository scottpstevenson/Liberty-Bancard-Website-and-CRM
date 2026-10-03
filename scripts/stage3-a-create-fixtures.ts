import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type CreationFault = "before_commit" | "after_commit" | "handoff" | undefined;

/** Uses real registered handlers, sessions, writer and request authority. */
export async function certifyStage3Creates(ctx: {
  pool: Pool; prefix: string; setFault: (value: CreationFault) => void;
  request: (role: string, method: string, path: string, body?: unknown, csrf?: boolean, headers?: Record<string, string>) =>
    Promise<{ status: number; body: any }>;
}) {
  const { pool, prefix, request, setFault } = ctx;
  const { storage } = await import("../server/storage");
  const { claimInboundRequest } = await import("../server/services/inbound-request-authority");
  const originalTask = storage.createAuthorityTask;
  const payload = (kind: string) => ({ firstName: "Recoverable", lastName: "Fixture",
    email: `${prefix}-create-${kind}@example.test`, phone: `+1555${randomInt(1000000, 9999999)}` });
  const create = (body: unknown, key: string, role = "admin") =>
    request(role, "POST", "/api/contacts", body, true, { "Idempotency-Key": key });
  try {
    for (const mode of ["before_commit", "after_commit", "handoff", "task"] as const) {
      const input = payload(mode); const key = randomUUID();
      setFault(mode === "task" ? undefined : mode);
      if (mode === "task") storage.createAuthorityTask = async () => { throw new Error("FIXTURE_TASK_HANDOFF_FAILED"); };
      const first = await create(input, key);
      assert.equal(first.status, mode === "before_commit" ? 500 : 202, JSON.stringify(first.body));
      if (mode !== "before_commit") {
        assert.ok(first.body.id);
        assert.equal(first.body.firstName, input.firstName);
        assert.equal(first.body._handoff.state, "degraded");
        assert.equal(first.body._handoff.retryable, true);
        assert.ok(first.body._handoff.requestId);
      }
      setFault(undefined); storage.createAuthorityTask = originalTask;
      const retry = await create(input, key);
      assert.ok([200, 201, 202].includes(retry.status), JSON.stringify(retry.body));
      assert.equal(retry.body.firstName, input.firstName, "source-event replay uses the canonical camelCase DTO");
      if (mode !== "before_commit") assert.equal(retry.body.id, first.body.id);
      const again = await create(input, key);
      assert.ok([200, 202].includes(again.status), JSON.stringify(again.body));
      assert.equal(again.body.id, retry.body.id);
      assert.equal(again.body._ghlSyncPending, true);
      assert.equal(again.body._handoff.providerProjection, "pending");
      assert.equal(again.body._handoff.providerDelivery, "not_observed");
      const contacts = await pool.query("SELECT count(*)::int AS n FROM contacts WHERE email=$1", [input.email]);
      assert.equal(contacts.rows[0].n, 1);
      const tasks = await pool.query("SELECT count(*)::int AS n FROM tasks WHERE contact_id=$1 AND source='inbound_request'", [retry.body.id]);
      assert.equal(tasks.rows[0].n, 1);
      const effects = await pool.query(`SELECT e.state FROM inbound_request_effects e JOIN inbound_requests r ON r.id=e.request_id
        WHERE r.idempotency_key=$1 AND e.external_side_effect=true`, [key]);
      assert.ok(effects.rows.every(r => r.state === "held"), "retries never release provider/sending effects");
      assert.equal((await create({ ...input, lastName: "Different" }, key)).status, 409);
      assert.equal((await create(input, key, "manager")).status, 403);
    }
    const concurrentInput = payload("concurrent"); const key = randomUUID();
    const attempts = await Promise.all([create(concurrentInput, key), create(concurrentInput, key)]);
    assert.ok(attempts.every(r => [200, 201, 202].includes(r.status)), JSON.stringify(attempts));
    assert.equal(attempts[0].body.id, attempts[1].body.id);
    const rows = await pool.query("SELECT count(*)::int AS n FROM contacts WHERE email=$1", [concurrentInput.email]);
    assert.equal(rows.rows[0].n, 1);
    const tasks = await pool.query("SELECT count(*)::int AS n FROM tasks WHERE contact_id=$1 AND source='inbound_request'", [attempts[0].body.id]);
    assert.equal(tasks.rows[0].n, 1);
    for (const mode of ["link", "work_link", "effect"] as const) {
      const input = payload(mode); const key = randomUUID();
      const claim = await claimInboundRequest({ idempotencyKey: key, sourceCategory: "manual_crm", sourceType: "dashboard",
        callerScope: `user:${prefix}-admin`, actorType: "user", actorId: `${prefix}-admin`, payload: input });
      const fid = `stage3_${mode}_${randomUUID().replaceAll("-", "")}`;
      const table = mode === "link" ? "inbound_requests" : mode === "work_link" ? "inbound_request_work_links" : "inbound_request_effects";
      const event = mode === "work_link" ? "INSERT" : "UPDATE";
      const condition = mode === "link" ? `NEW.id='${claim.request.id}'::uuid AND NEW.contact_id IS NOT NULL AND NEW.lifecycle_state='processing'`
        : `NEW.request_id='${claim.request.id}'::uuid${mode === "effect" ? " AND NEW.state='sent'" : ""}`;
      await pool.query(`CREATE FUNCTION ${fid}() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN IF ${condition} THEN RAISE EXCEPTION 'STAGE3_HANDOFF_BOUNDARY_FAILURE'; END IF; RETURN NEW; END $fn$`);
      await pool.query(`CREATE TRIGGER ${fid} BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fid}()`);
      let degraded: Awaited<ReturnType<typeof create>>;
      try {
        degraded = await create(input, key);
        assert.equal(degraded.status, 202);
        assert.equal(degraded.body._handoff.state, "degraded", mode);
        assert.ok(degraded.body.id);
      } finally {
        await pool.query(`DROP TRIGGER ${fid} ON ${table}`);
        await pool.query(`DROP FUNCTION ${fid}()`);
      }
      const recovered = await create(input, key);
      assert.equal(recovered.status, 202);
      assert.equal(recovered.body.id, degraded!.body.id);
      assert.equal(recovered.body.firstName, input.firstName);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM tasks WHERE contact_id=$1 AND source='inbound_request'", [recovered.body.id])).rows[0].n, 1);
    }
    console.log("PASS real manual-create pre/postcommit timeout, orchestration/task failures, stable identity, conflict/scope denial and concurrent replay; one contact/task, external effects held");
    console.log("PASS actual DB link/work-link/effect boundary faults recover the persisted contact and canonical one-task obligation; pending provider projection remains visible");
  } finally {
    setFault(undefined); storage.createAuthorityTask = originalTask;
  }
}