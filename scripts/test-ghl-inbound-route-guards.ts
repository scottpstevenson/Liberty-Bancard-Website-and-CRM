/** Middleware/validation tests only: no HTTP server, session bypass, or service mutations. */
import assert from "node:assert/strict";
import { registerGhlInboundSyncRoutes } from "../server/routes/ghl-inbound-sync";
import { pool } from "../server/db";

type Registered = { method: string; path: string; guard: any; handler: any };
const registered: Registered[] = [];
const app: Record<string, any> = {};
for (const method of ["get", "post", "patch"]) {
  app[method] = (path: string, guard: any, handler: any) => registered.push({ method, path, guard, handler });
}
const response = () => {
  const result: any = { code: 200, body: null };
  result.status = (code: number) => { result.code = code; return result; };
  result.json = (body: unknown) => { result.body = body; return result; };
  return result;
};
try {
  registerGhlInboundSyncRoutes(app as any);
  assert.equal(registered.length, 6);
  let guardChecks = 0;
  for (const route of registered) {
    assert.deepEqual(route.guard._requiredRoles, ["admin"]);
    for (const role of [null, "agent", "manager", "merchant", "affiliate", "partner_admin", "admin"]) {
      const res = response();
      let advanced = false;
      // Absence of sessionID prevents session-store I/O. This tests the actual
      // route middleware's authentication/role checks, not session persistence.
      const req: any = { isAuthenticated: () => role !== null, user: role ? { role } : undefined };
      await route.guard(req, res, () => { advanced = true; });
      if (role === "admin") assert.equal(advanced, true);
      else {
        assert.equal(advanced, false, `${route.method} ${route.path} must reject ${role}`);
        assert.equal(res.code, role === null ? 401 : 403);
      }
      guardChecks++;
    }
  }
  console.log(`PASS ${guardChecks} actual incoming-route authentication/role middleware checks`);

  let validationChecks = 0;
  for (const route of registered) {
    if (route.path === "/api/admin/ghl/inbound-contact-sync") continue; // Would read real status.
    const req: any = {
      params: { runId: "invalid-uuid" },
      body: { enabled: "invalid-not-a-boolean", previewHash: "invalid-hash" },
      get: () => "invalid-uuid",
      user: {}, // No actor authority even if validation is accidentally weakened.
    };
    const res = response();
    await route.handler(req, res);
    assert.equal(res.code, 400, `${route.method} ${route.path} must reject malformed input`);
    validationChecks++;
  }
  console.log(`PASS ${validationChecks} route input-validation checks before any service call`);
  console.log("Incoming route guards passed. No sessions, contacts, controls, or provider requests were created.");
} finally {
  await pool.end();
}