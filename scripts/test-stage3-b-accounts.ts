import assert from "node:assert/strict";
import { stage3BHttpFixture } from "./fixtures/stage3-b-http";

const h = await stage3BHttpFixture(async app => {
  const { registerAdminRoutes } = await import("../server/routes/admin");
  registerAdminRoutes(app);
});
try {
  const { issueAuthAction, isAuthActionValid, consumeAuthAction } = await import("../server/services/auth-actions");
  const target = h.userId("other");
  const path = `/api/admin/users/${target}/lifecycle`;
  const input = { action: "deactivate", expectedVersion: 1 };
  assert.equal((await h.request("anonymous", "POST", path, input)).status, 401);
  for (const role of ["manager", "agent", "merchant", "affiliate", "partner"]) {
    assert.equal((await h.request(role, "POST", path, input)).status, 403);
  }
  assert.equal((await h.request("admin", "POST", path, input, false)).status, 403);
  assert.equal((await h.request("admin", "POST", path, { ...input, operatorId: "forged" })).status, 400);
  assert.equal((await h.request("admin", "POST", path, { action: "deactivate" })).status, 400);
  assert.equal((await h.request("admin", "POST", `/api/admin/users/${h.userId("admin")}/lifecycle`, input)).status, 409);
  assert.equal((await h.request("admin", "PUT", `/api/admin/users/${h.userId("admin")}/role`,
    { role: "agent", expectedVersion: 1 })).status, 409);
  await h.pool.query(`UPDATE users SET verification_token='fixture-private',reset_token='fixture-private',
    totp_backup_codes='[{"code":"fixture-private","used":false}]'::jsonb,
    trusted_devices='[{"token":"fixture-private","name":"Fixture","expiresAt":"2099-01-01T00:00:00Z"}]'::jsonb WHERE id=$1`, [target]);
  const publicProfile = await h.request("other", "GET", "/api/auth/user");
  assert.equal(publicProfile.status, 200);
  for (const field of ["passwordHash","totpSecret","totpBackupCodes","trustedDevices","verificationToken","resetToken","authEpoch"]) {
    assert.equal(field in publicProfile.body, false, `${field} excluded from profile DTO`);
  }
  const bearer = await issueAuthAction({ subject: { type: "user", id: target }, purpose: "user_password_reset", ttlMs: 60000 });
  assert.equal(await isAuthActionValid(bearer.token, "user_password_reset"), true);
  await h.pool.query(`CREATE FUNCTION stage3_b_account_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='user_deactivated' THEN RAISE EXCEPTION 'fixture_account_audit_failure'; END IF; RETURN NEW; END $$`);
  await h.pool.query(`CREATE TRIGGER stage3_b_account_audit_fail BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION stage3_b_account_audit_fail()`);
  assert.equal((await h.request("admin", "POST", path, input)).status, 500);
  assert.equal((await h.request("other", "GET", "/api/auth/user")).status, 200, "failed audit leaves prior session usable");
  assert.equal(await isAuthActionValid(bearer.token, "user_password_reset"), true, "failed audit rolls back bearer revocation");
  await h.pool.query("DROP TRIGGER stage3_b_account_audit_fail ON audit_logs");
  await h.pool.query("DROP FUNCTION stage3_b_account_audit_fail()");
  // Real pending MFA session, then prove lifecycle epoch blocks continuation.
  await h.pool.query("UPDATE users SET totp_enabled=true,totp_secret='JBSWY3DPEHPK3PXP' WHERE id=$1", [target]);
  await h.login("other");
  const pending = { ...h.sessions.get("other")! };
  const deactivated = await h.request("admin", "POST", path, input);
  assert.equal(deactivated.status, 200); assert.equal(deactivated.body.user.accountState, "deactivated");
  assert.equal(deactivated.body.user.accountVersion, 2);
  assert.equal((await h.request("other", "GET", "/api/auth/user")).status, 401);
  assert.equal((await h.request("other", "POST", "/api/auth/totp/verify-login", { code: "000000" })).status, 400);
  const loginDenied = await fetch(`${h.base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: h.email("other"), password: h.password }) });
  assert.equal(loginDenied.status, 401);
  assert.equal(await isAuthActionValid(bearer.token, "user_password_reset"), false);
  let mutated = false;
  assert.equal((await consumeAuthAction({ token: bearer.token, purpose: "user_password_reset",
    mutate: async () => { mutated = true; return true; } })).ok, false);
  assert.equal(mutated, false);
  assert.equal((await h.request("admin", "POST", path, { action: "reactivate", expectedVersion: 1 })).status, 409);
  const restored = await h.request("admin", "POST", path, { action: "reactivate", expectedVersion: 2 });
  assert.equal(restored.status, 200); assert.equal(restored.body.user.accountVersion, 3);
  assert.equal(restored.body.user.accountState, "active");
  assert.equal((await h.request("other", "POST", "/api/auth/totp/verify-login", { code: "000000" })).status, 400, "old pending MFA remains invalid after restore");
  assert.equal(await isAuthActionValid(bearer.token, "user_password_reset"), false, "old recovery remains revoked after restore");
  const reset = await h.request("admin", "POST", `/api/admin/users/${target}/reset-2fa`, { expectedVersion: 3 });
  assert.equal(reset.status, 200); assert.equal(reset.body.accountVersion, 4);
  const newLogin = await h.login("other");
  assert.equal(newLogin.body.accountState, "active");
  assert.equal((await h.request("other", "GET", "/api/auth/user")).status, 200);
  const current = { ...h.sessions.get("other")! };
  h.sessions.set("other", pending);
  assert.equal((await h.request("other", "GET", "/api/auth/user")).status, 401, "old cookie cannot regain a login");
  h.sessions.set("other", current);
  await h.pool.query("ALTER TABLE users RENAME TO users_fixture_unavailable");
  const unavailable = await h.request("other", "GET", "/api/auth/user");
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.getSetCookie().some(v => /connect.sid=.*Expires=Thu, 01 Jan 1970/i.test(v)), false);
  await h.pool.query("ALTER TABLE users_fixture_unavailable RENAME TO users");
  assert.equal((await h.request("other", "GET", "/api/auth/user")).status, 200, "same cookie retries after authority recovery");
  assert.equal((await h.request("admin", "PUT", `/api/admin/users/${target}/role`,
    { role: "admin", expectedVersion: 4 })).status, 200);
  await h.login("other");
  // Declare effective-admin fixture explicitly: extra bootstrap admins have
  // no admission authority here. This is ONLY the proved disposable database.
  await h.pool.query("UPDATE users SET role='merchant' WHERE role='admin' AND id<>$1 AND id<>$2", [target, h.userId("admin")]);
  await h.pool.query("UPDATE users SET password_hash=NULL WHERE id=$1", [h.userId("admin")]);
  assert.equal((await h.request("admin", "POST", path, { action: "deactivate", expectedVersion: 5 })).status, 409, "pending/nonworking admin cannot justify losing last effective admin");
  await h.pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [h.passwordHash, h.userId("admin")]);
  const race = await Promise.all([
    h.request("admin", "PUT", `/api/admin/users/${target}/role`, { role: "manager", expectedVersion: 5 }),
    h.request("other", "PUT", `/api/admin/users/${h.userId("admin")}/role`, { role: "manager", expectedVersion: 1 }),
  ]);
  assert.equal(race.filter(r => r.status === 200).length, 1);
  assert.ok(race.every(r => [200,401,404,409].includes(r.status)));
  assert.equal((await h.pool.query("SELECT count(*)::int n FROM users WHERE role='admin' AND account_state='active' AND password_hash IS NOT NULL")).rows[0].n, 1);
  const attribution = await h.pool.query("SELECT count(*)::int n FROM users WHERE id=$1", [target]);
  assert.equal(attribution.rows[0].n, 1, "no account hard deletion");
  assert.equal(h.externalCalls(), 0);
  console.log("PASS Stage 3 B actual account/session/CSRF: deactivation/restore/stale versions, atomic audit+token+session rollback, pending-MFA epoch, old cookie/recovery denial, public DTO, non-destructive authority outage, self-lockout and serialized last-effective-admin race. No invitations, GHL or provider calls. Provision/resend/browser gates remain separately uncertified.");
} finally { await h.close(); }
