#!/usr/bin/env tsx
/**
 * SEC-02 regression test — session-validity authority failure must fail
 * closed (no next(), no session destruction, stable 503) and must be
 * distinguishable from a proven expired/invalidated session (401, session
 * destroyed).
 *
 * This exercises the real exported guards (isAuthenticated, isDashboardUser,
 * requireRole, etc.) against a fake req/res, monkey-patching the real
 * `authStorage` singleton so no DB is required.
 */
import assert from "node:assert";
import { authStorage } from "../server/replit_integrations/auth/storage";
import { isAuthenticated, isDashboardUser, requireRole } from "../server/replit_integrations/auth/replitAuth";

function fakeReqRes(sessionId: string, userId: string) {
  let destroyed = false;
  let loggedOut = false;
  let cookieCleared = false;
  const req: any = {
    sessionID: sessionId,
    isAuthenticated: () => true,
    user: { id: userId, role: "admin" },
    logout: (cb: () => void) => { loggedOut = true; cb(); },
    session: { destroy: (cb: () => void) => { destroyed = true; cb(); } },
    headers: {},
    socket: {},
  };
  let statusCode: number | null = null;
  let body: any = null;
  const res: any = {
    status(code: number) { statusCode = code; return this; },
    json(payload: any) { body = payload; return this; },
    clearCookie() { cookieCleared = true; },
  };
  return { req, res, get destroyed() { return destroyed; }, get loggedOut() { return loggedOut; }, get cookieCleared() { return cookieCleared; }, getStatus: () => statusCode, getBody: () => body };
}

async function withPatchedGetUserSession<T>(impl: (sessionId: string) => Promise<any>, fn: () => Promise<T>): Promise<T> {
  const original = authStorage.getUserSession.bind(authStorage);
  (authStorage as any).getUserSession = impl;
  try {
    return await fn();
  } finally {
    (authStorage as any).getUserSession = original;
  }
}

async function main() {
  let failures = 0;
  const assertCase = (label: string, cond: boolean) => {
    if (cond) { console.log(`✓ ${label}`); } else { console.log(`✗ ${label}`); failures++; }
  };

  // ── Case 1: validity authority throws → fail closed, no next(), 503, session untouched ──
  await withPatchedGetUserSession(
    async () => { throw new Error("simulated DB outage"); },
    async () => {
      const h = fakeReqRes("sess-outage-1", "user-1");
      let nextCalled = false;
      await isAuthenticated(h.req, h.res, () => { nextCalled = true; });
      assertCase("authority-unavailable: next() NOT called", !nextCalled);
      assertCase("authority-unavailable: responds 503", h.getStatus() === 503);
      assertCase("authority-unavailable: code=SESSION_VALIDATION_UNAVAILABLE", h.getBody()?.code === "SESSION_VALIDATION_UNAVAILABLE");
      assertCase("authority-unavailable: session NOT destroyed", !h.destroyed);
      assertCase("authority-unavailable: user NOT logged out", !h.loggedOut);
      assertCase("authority-unavailable: cookie NOT cleared", !h.cookieCleared);
      assertCase("authority-unavailable: no internal exception text leaked", JSON.stringify(h.getBody() ?? "").indexOf("simulated DB outage") === -1);
    },
  );

  // ── Case 2: same outage behavior for isDashboardUser and requireRole ──
  await withPatchedGetUserSession(
    async () => { throw new Error("simulated DB outage"); },
    async () => {
      const h1 = fakeReqRes("sess-outage-2", "user-2");
      let next1 = false;
      await isDashboardUser(h1.req, h1.res, () => { next1 = true; });
      assertCase("isDashboardUser: fails closed on authority outage (no next, 503)", !next1 && h1.getStatus() === 503);

      const h2 = fakeReqRes("sess-outage-3", "user-3");
      let next2 = false;
      const guard = requireRole("admin", "manager");
      await guard(h2.req, h2.res, () => { next2 = true; });
      assertCase("requireRole: fails closed on authority outage (no next, 503)", !next2 && h2.getStatus() === 503);
    },
  );

  // ── Case 3: proven-invalidated session still gets 401 + destroyed (unchanged behavior) ──
  await withPatchedGetUserSession(
    async () => ({ isInvalidated: true, lastActiveAt: new Date(), createdAt: new Date() }),
    async () => {
      const h = fakeReqRes("sess-invalidated-1", "user-4");
      let nextCalled = false;
      await isAuthenticated(h.req, h.res, () => { nextCalled = true; });
      assertCase("invalidated: next() NOT called", !nextCalled);
      assertCase("invalidated: responds 401", h.getStatus() === 401);
      assertCase("invalidated: session IS destroyed", h.destroyed);
      assertCase("invalidated: cookie IS cleared", h.cookieCleared);
    },
  );

  // ── Case 4: proven-expired session still gets 401 + destroyed (unchanged behavior) ──
  await withPatchedGetUserSession(
    async () => ({ isInvalidated: false, lastActiveAt: new Date(0), createdAt: new Date(0) }),
    async () => {
      const h = fakeReqRes("sess-expired-1", "user-5");
      let nextCalled = false;
      await isAuthenticated(h.req, h.res, () => { nextCalled = true; });
      assertCase("expired: next() NOT called", !nextCalled);
      assertCase("expired: responds 401", h.getStatus() === 401);
      assertCase("expired: session IS destroyed", h.destroyed);
    },
  );

  // ── Case 5: anonymous requests remain 401 regardless of validity authority ──
  {
    const h = fakeReqRes("sess-anon", "user-6");
    h.req.isAuthenticated = () => false;
    let nextCalled = false;
    await isAuthenticated(h.req, h.res, () => { nextCalled = true; });
    assertCase("anonymous: still 401, no next()", !nextCalled && h.getStatus() === 401);
  }

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: session-validity-fail-closed (${failures} failure(s))`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("test-session-validity-fail-closed threw:", err);
  process.exit(1);
});
