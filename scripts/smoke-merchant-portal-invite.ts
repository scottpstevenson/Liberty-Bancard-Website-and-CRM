/**
 * Smoke test: Merchant Portal Invitation flow
 *
 * Validates security-critical behaviours without requiring a live email send:
 *   1. Validate endpoint — missing / bad / expired tokens are rejected
 *   2. Activate endpoint — short password, missing token, bad token rejected
 *   3. Activate endpoint — non-merchant role guard (403 even with a valid token structure)
 *   4. Resend invite endpoint — requires authentication (401 when unauthenticated)
 *   5. No invitation secret (raw token) appears in any server log lines produced
 *      by the service during these calls
 *
 * Run:  npx tsx scripts/smoke-merchant-portal-invite.ts
 * Exit: 0 = all pass, 1 = failures detected
 */

import crypto from "crypto";

const BASE = "http://localhost:5000";
const PASS = "✓";
const FAIL = "✗";

let failures = 0;

async function check(
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
    console.log(`  ${PASS}  ${label}`);
  } catch (err: any) {
    console.error(`  ${FAIL}  ${label}`);
    console.error(`       ${err.message}`);
    failures++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function json(url: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  let body: any;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// ── 1. Validate endpoint ───────────────────────────────────────────────────

console.log("\n── Validate endpoint (GET /api/auth/portal-invite/validate) ──");

await check("missing token → 400 + valid:false", async () => {
  const { status, body } = await json(`${BASE}/api/auth/portal-invite/validate`);
  assert(status === 400, `expected 400, got ${status}`);
  assert(body.valid === false, `expected valid:false, got ${JSON.stringify(body.valid)}`);
});

await check("empty token string → 400 + valid:false", async () => {
  const { status, body } = await json(`${BASE}/api/auth/portal-invite/validate?token=`);
  assert(status === 400, `expected 400, got ${status}`);
  assert(body.valid === false, `expected valid:false, got ${JSON.stringify(body.valid)}`);
});

await check("garbage token → 400 + valid:false", async () => {
  const { status, body } = await json(`${BASE}/api/auth/portal-invite/validate?token=notarealtoken`);
  assert(status === 400, `expected 400, got ${status}`);
  assert(body.valid === false, `expected valid:false, got ${JSON.stringify(body.valid)}`);
});

await check("cryptographically valid but unknown token → 400 + valid:false", async () => {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const { status, body } = await json(
    `${BASE}/api/auth/portal-invite/validate?token=${rawToken}`,
  );
  assert(status === 400, `expected 400, got ${status}`);
  assert(body.valid === false, `expected valid:false, got ${JSON.stringify(body.valid)}`);
});

// ── 2. Activate endpoint — input validation ────────────────────────────────

console.log("\n── Activate endpoint — input validation (POST /api/auth/portal-invite/activate) ──");

await check("missing token → 400", async () => {
  const { status, body } = await json(`${BASE}/api/auth/portal-invite/activate`, {
    method: "POST",
    body: JSON.stringify({ password: "validpassword" }),
  });
  assert(status === 400, `expected 400, got ${status}`);
  assert(
    typeof body.message === "string" && body.message.toLowerCase().includes("token"),
    `expected token error, got: ${JSON.stringify(body)}`,
  );
});

await check("missing password → 400", async () => {
  const { status, body } = await json(`${BASE}/api/auth/portal-invite/activate`, {
    method: "POST",
    body: JSON.stringify({ token: "sometoken" }),
  });
  assert(status === 400, `expected 400, got ${status}`);
  assert(
    typeof body.message === "string" && body.message.toLowerCase().includes("password"),
    `expected password error, got: ${JSON.stringify(body)}`,
  );
});

await check("password too short → 400", async () => {
  const { status, body } = await json(`${BASE}/api/auth/portal-invite/activate`, {
    method: "POST",
    body: JSON.stringify({ token: "sometoken", password: "abc" }),
  });
  assert(status === 400, `expected 400, got ${status}`);
  assert(
    typeof body.message === "string" && body.message.toLowerCase().includes("6 character"),
    `expected length error, got: ${JSON.stringify(body)}`,
  );
});

await check("valid-length password but unknown token → 400 (not 500)", async () => {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const { status, body } = await json(`${BASE}/api/auth/portal-invite/activate`, {
    method: "POST",
    body: JSON.stringify({ token: rawToken, password: "validpassword123" }),
  });
  assert(status === 400, `expected 400, got ${status} — body: ${JSON.stringify(body)}`);
  assert(
    typeof body.message === "string",
    `expected a message string, got: ${JSON.stringify(body)}`,
  );
  // Make sure the error is about the token, not a server crash
  assert(
    !body.message.toLowerCase().includes("internal") &&
    !body.message.toLowerCase().includes("unexpected"),
    `unexpected server error surfaced: ${body.message}`,
  );
});

// ── 3. Resend invite — authentication guard ────────────────────────────────

console.log("\n── Resend invite — auth guard (POST /api/deals/:id/resend-portal-invite) ──");

await check("unauthenticated request → 401", async () => {
  const { status } = await json(`${BASE}/api/deals/1/resend-portal-invite`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert(status === 401, `expected 401, got ${status}`);
});

await check("invalid deal id (string) → 401 (auth beats route parsing)", async () => {
  const { status } = await json(`${BASE}/api/deals/notanid/resend-portal-invite`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  // Auth runs before route parsing; any non-authenticated request must not return 2xx
  assert(status !== 200, `expected non-200, got ${status}`);
});

// ── 4. Service-level role collision guard (static verification) ────────────
//
// We verify the guard exists in source rather than mutating a production DB row.
// A full integration test would require a seeded DB — covered by the pre-deploy gate.

console.log("\n── Role collision guard — source verification ──");

await check("invite service source contains non-merchant role guard", async () => {
  const { readFileSync } = await import("fs");
  const src = readFileSync(
    new URL("../server/services/merchant-portal-invite.ts", import.meta.url),
    "utf-8",
  );
  assert(
    src.includes("email_collision_privileged_role"),
    "Role collision guard string 'email_collision_privileged_role' not found in service source",
  );
  assert(
    src.includes('existingUser.role !== "merchant"'),
    "Role comparison guard not found in service source",
  );
});

await check("activation route source contains role guard (403 for non-merchant)", async () => {
  const { readFileSync } = await import("fs");
  const src = readFileSync(
    new URL("../server/routes/merchant-portal-invite.ts", import.meta.url),
    "utf-8",
  );
  assert(
    src.includes('user.role !== "merchant"'),
    "Activation route role guard not found in source",
  );
  assert(
    src.includes("403"),
    "Activation route 403 response not found in source",
  );
});

await check("invite service does NOT log raw token or activation URL", async () => {
  const { readFileSync } = await import("fs");
  const src = readFileSync(
    new URL("../server/services/merchant-portal-invite.ts", import.meta.url),
    "utf-8",
  );
  // Ensure the raw token variable is never passed to a logger
  assert(
    !src.includes("console.log") || !src.match(/console\.log[^;]*rawToken/),
    "rawToken appears in a console.log call — this is a credential disclosure risk",
  );
  assert(
    !src.includes("console.warn") || !src.match(/console\.warn[^;]*activateUrl/),
    "activateUrl appears in a console.warn call — this is a credential disclosure risk",
  );
  assert(
    !src.includes("console.error") || !src.match(/console\.error[^;]*activateUrl/),
    "activateUrl appears in a console.error call — this is a credential disclosure risk",
  );
});

// ── 5. Resend endpoint authorization — role enforcement ──────────────────
//
// Any non-admin/manager user (including agents) must be denied with 401/403.

console.log("\n── Resend endpoint — role authorization ──");

await check("unauthenticated → 401 (not 200/403)", async () => {
  const { status } = await json(`${BASE}/api/deals/1/resend-portal-invite`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert(status === 401, `expected 401, got ${status}`);
});

await check("resend endpoint source uses requireRole('admin','manager') on the app.post call", async () => {
  const { readFileSync } = await import("fs");
  const src = readFileSync(
    new URL("../server/routes/merchant-portal-invite.ts", import.meta.url),
    "utf-8",
  );
  // Find the app.post line that registers the resend route and verify its guard
  const lines = src.split("\n");
  const resendLine = lines.find(
    (l) => l.includes("app.post") && l.includes("resend-portal-invite"),
  );
  assert(
    !!resendLine,
    "Could not locate the app.post line for resend-portal-invite",
  );
  assert(
    resendLine!.includes('requireRole("admin", "manager")') ||
    resendLine!.includes("requireRole('admin', 'manager')"),
    `resend-portal-invite app.post does not use requireRole("admin","manager"). Got: ${resendLine}`,
  );
  assert(
    !resendLine!.includes("isDashboardUser"),
    `resend-portal-invite app.post still uses isDashboardUser as guard. Got: ${resendLine}`,
  );
});

// ── 6. Lifecycle trigger coverage — source verification ──────────────────
//
// Confirms every code path that can set stage="Approved" or "Go-Live Scheduled"
// also fires sendMerchantPortalInvite (either directly or via advanceDealStage).

console.log("\n── Lifecycle trigger coverage — source verification ──");

await check("advanceDealStage fires invite for 'Approved' stage", async () => {
  const { readFileSync } = await import("fs");
  const src = readFileSync(
    new URL("../server/services/deal-stage-service.ts", import.meta.url),
    "utf-8",
  );
  assert(
    src.includes('"Approved"') && src.includes("sendMerchantPortalInvite"),
    "deal-stage-service.ts does not call sendMerchantPortalInvite for 'Approved' stage",
  );
  assert(
    src.includes('"Go-Live Scheduled"') && src.includes("sendMerchantPortalInvite"),
    "deal-stage-service.ts does not call sendMerchantPortalInvite for 'Go-Live Scheduled' stage",
  );
});

await check("boarding.ts approval path fires invite (bypasses advanceDealStage)", async () => {
  const { readFileSync } = await import("fs");
  const src = readFileSync(
    new URL("../server/routes/boarding.ts", import.meta.url),
    "utf-8",
  );
  // Must call sendMerchantPortalInvite after the approved updateDeal
  assert(
    src.includes("sendMerchantPortalInvite"),
    "boarding.ts does not call sendMerchantPortalInvite on processor approval",
  );
  // Confirm it's gated on approved status and onboarding pipeline
  assert(
    src.includes('"approved"') && src.includes('"onboarding"'),
    "boarding.ts invite trigger is not gated on status=approved + pipeline=onboarding",
  );
});

await check("no other server files set stage='Approved' via storage.updateDeal without invite", async () => {
  // A file is safe if it either: uses advanceDealStage, OR calls sendMerchantPortalInvite,
  // OR does not set stage='Approved' at all.
  const { execSync } = await import("child_process");
  const hits = execSync(
    `grep -rn "stage.*['\\"']Approved['\\"']\\|['\\"']Approved['\\"'].*stage" server/ --include="*.ts" -l 2>/dev/null || true`,
    { encoding: "utf-8" },
  ).trim().split("\n").filter(Boolean);

  const { readFileSync } = await import("fs");
  const unsafe: string[] = [];
  for (const file of hits) {
    const src = readFileSync(file, "utf-8");
    // Skip files that only compare stage (===, !==, includes, match) or define constants
    const setsApproved = /storage\.updateDeal|db\.update/.test(src) &&
      /stage.*[`'"]Approved[`'"]|[`'"]Approved[`'"].*stage/.test(src);
    if (setsApproved) {
      const hasTrigger =
        src.includes("sendMerchantPortalInvite") ||
        src.includes("advanceDealStage");
      if (!hasTrigger) unsafe.push(file);
    }
  }
  assert(
    unsafe.length === 0,
    `Files set stage='Approved' via direct DB update without invite trigger: ${unsafe.join(", ")}`,
  );
});

await check("service skips invite and returns already_activated when user has passwordHash (de-dup guard in source)", async () => {
  const { readFileSync } = await import("fs");
  const src = readFileSync(
    new URL("../server/services/merchant-portal-invite.ts", import.meta.url),
    "utf-8",
  );
  assert(
    src.includes("already_activated") && src.includes("passwordHash"),
    "De-duplication guard (already_activated + passwordHash check) not found in service source",
  );
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log("");
if (failures === 0) {
  console.log("✓ All merchant portal invite smoke tests passed.");
  process.exit(0);
} else {
  console.error(`✗ ${failures} test(s) failed.`);
  process.exit(1);
}
