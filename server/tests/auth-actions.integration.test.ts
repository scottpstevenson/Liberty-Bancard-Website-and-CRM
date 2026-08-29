import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

if (process.env.NODE_ENV !== "test") throw new Error("NODE_ENV=test is required");
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
if (process.env.AUTH_ACTION_DB_TEST_OPT_IN !== "1") throw new Error("AUTH_ACTION_DB_TEST_OPT_IN=1 is required");
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
  throw new Error("Refusing to run while DATABASE_URL points elsewhere");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

const bootstrap = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
const schema = await bootstrap.query<{ auth_actions: string | null }>(
  "SELECT to_regclass('public.auth_actions')::text AS auth_actions",
);
await bootstrap.end();
assert.equal(
  schema.rows[0]?.auth_actions,
  "auth_actions",
  "canonical migration 0176 must be applied before the auth-action integration suite",
);

const [{ issueAuthAction, consumeAuthAction, revokeAuthActions }, { db, pool }, { authActions }] =
  await Promise.all([import("../services/auth-actions"), import("../db"), import("../../shared/models/auth")]);
const { and, eq, like } = await import("drizzle-orm");
const correlation = `rvr03-test-${crypto.randomUUID()}`;
const subject = (suffix: string) => ({ type: "integration_test", id: `${correlation}-${suffix}` });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

try {
  const issued = await Promise.all([
    issueAuthAction({ purpose: "user_password_reset", subject: subject("ordering"), ttlMs: 60_000 }),
    issueAuthAction({ purpose: "user_password_reset", subject: subject("ordering"), ttlMs: 60_000 }),
  ]);
  assert.deepEqual(issued.map(x => x.version).sort(), [1, 2]);
  const stale = issued.find(x => x.version === 1)!;
  const live = issued.find(x => x.version === 2)!;
  assert.equal((await consumeAuthAction({ token: stale.token, purpose: "user_password_reset", mutate: async () => true })).ok, false);
  assert.equal((await consumeAuthAction({ token: live.token, purpose: "user_email_verification", mutate: async () => true })).ok, false);

  for (const [name, rejected] of [["false", false], ["null", null], ["undefined", undefined]] as const) {
    const rollback = await issueAuthAction({ purpose: "user_password_reset", subject: subject(`rollback-${name}`), ttlMs: 60_000 });
    assert.equal((await consumeAuthAction({ token: rollback.token, purpose: "user_password_reset", mutate: async () => rejected })).ok, false);
    assert.equal((await consumeAuthAction({ token: rollback.token, purpose: "user_password_reset", mutate: async () => true })).ok, true);
  }

  const race = await issueAuthAction({ purpose: "partner_invite", subject: subject("race"), ttlMs: 60_000 });
  const raceResults = await Promise.all([
    consumeAuthAction({ token: race.token, purpose: "partner_invite", mutate: async () => true }),
    consumeAuthAction({ token: race.token, purpose: "partner_invite", mutate: async () => true }),
  ]);
  assert.equal(raceResults.filter(x => x.ok).length, 1);

  const revoked = await issueAuthAction({ purpose: "merchant_activation", subject: subject("revoked"), ttlMs: 60_000 });
  await revokeAuthActions(subject("revoked"), "merchant_activation");
  assert.equal((await consumeAuthAction({ token: revoked.token, purpose: "merchant_activation", mutate: async () => true })).ok, false);

  const expired = await issueAuthAction({ purpose: "partner_password_reset", subject: subject("expired"), ttlMs: 1 });
  await sleep(10);
  assert.equal((await consumeAuthAction({ token: expired.token, purpose: "partner_password_reset", mutate: async () => true })).ok, false);
  console.log("auth-action service integration passed");
} finally {
  await db.delete(authActions).where(and(
    eq(authActions.subjectType, "integration_test"),
    like(authActions.subjectId, `${correlation}-%`),
  ));
  await pool.end();
}