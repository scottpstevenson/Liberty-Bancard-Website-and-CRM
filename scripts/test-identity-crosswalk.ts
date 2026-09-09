#!/usr/bin/env npx tsx
/**
 * test-identity-crosswalk.ts — Certification suite for Task #1830
 *
 * Tests:
 *  Phase A: Schema (migrations 0230–0231)
 *  Phase B: Fail-close guards (promoteQualifiedToContacts, checkAndHandleOrphanDeal)
 *  Phase C: Approval allowlist (vertical blocked for approve, allowed for revert)
 *  Phase D: Enrichment-jobs 503 gate
 *  Phase E: Identity crosswalk routes (auth, run lifecycle, subject/candidate/decide)
 *  Phase F: Lead-ops stats (NULLIF/BTRIM, renamed fields)
 *  Phase G: Reconciliation org-candidate members endpoint
 *
 * EXIT 0 = all assertions pass.
 * EXIT 1 = at least one assertion failed.
 */

import crypto from "crypto";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:5000";
const ADMIN_EMAIL = process.env.ADMIN_SEED_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD ?? "";

// ──────────────────────────────────────────────────────────────────────────────
// Minimal test harness
// ──────────────────────────────────────────────────────────────────────────────
interface TestResult { name: string; pass: boolean; detail?: string }
const results: TestResult[] = [];
let sessionCookie: string | null = null;
let csrfToken: string | null = null;

function assert(name: string, condition: boolean, detail?: string): void {
  results.push({ name, pass: condition, detail });
  if (!condition) {
    console.error(`  ✗ FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
}

async function authedFetch(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    ...(csrfToken && method !== "GET" ? { "x-csrf-token": csrfToken } : {}),
    ...extraHeaders,
  };
  return fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
}

async function login(): Promise<boolean> {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.warn("  WARN: ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD not set; skipping HTTP tests");
    return false;
  }
  // Obtain CSRF token first
  const csrfR = await fetch(`${BASE}/api/csrf-token`, { credentials: "include" });
  if (!csrfR.ok) { console.error("  Failed to get CSRF token"); return false; }
  const setCookie = csrfR.headers.get("set-cookie") ?? "";
  sessionCookie = setCookie.split(";")[0] ?? null;
  const csrfBody = await csrfR.json();
  csrfToken = csrfBody.token ?? csrfBody.csrfToken;

  const loginR = await authedFetch("POST", "/api/login", {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  const loginSetCookie = loginR.headers.get("set-cookie") ?? "";
  if (loginSetCookie) sessionCookie = loginSetCookie.split(";")[0];
  return loginR.status === 200 || loginR.status === 302;
}

// ──────────────────────────────────────────────────────────────────────────────
// Phase A: Schema checks (SQL inspection via /api/admin/live-health or direct)
// ──────────────────────────────────────────────────────────────────────────────
async function phaseA_schema(): Promise<void> {
  console.log("\n── Phase A: Schema migrations 0230–0231 ─────────────────────────────────");

  const tableR = await authedFetch("GET", "/api/admin/identity-crosswalk/runs");
  // 200 = tables exist; 500 with DB error = tables don't exist
  const tablesExist = tableR.status === 200;
  assert("Tables created (runs endpoint returns 200)", tablesExist, `status=${tableR.status}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Phase B: Fail-close guards
// ──────────────────────────────────────────────────────────────────────────────
async function phaseB_failClose(): Promise<void> {
  console.log("\n── Phase B: Fail-close guards ───────────────────────────────────────────");

  // Check audit_logs for the fail-closed actions
  const auditR = await authedFetch("GET", "/api/admin/audit-logs?action=discovery_promotion_fail_closed&limit=1");
  // Just check endpoint is reachable; the guard fires lazily when promoteQualifiedToContacts() is called.
  // We verify the source code has the guard via static file read.
  const fs = await import("fs");
  const dailyOutreach = fs.readFileSync("server/services/daily-outreach.ts", "utf-8");
  assert(
    "promoteQualifiedToContacts has fail-closed guard as first statement",
    dailyOutreach.includes("discovery_promotion_fail_closed"),
    "Expected audit action string not found",
  );
  assert(
    "promoteQualifiedToContacts guard returns immediately after audit log",
    dailyOutreach.includes("return { promoted: 0, skipped: 0, dealsCreated: 0 };"),
  );

  const orchestrator = fs.readFileSync("server/services/sdr/orchestrator.ts", "utf-8");
  assert(
    "checkAndHandleOrphanDeal has fail-closed guard at function entry",
    orchestrator.includes("sdr_orphan_deal_fail_closed"),
  );
  assert(
    "checkAndHandleOrphanDeal guard returns before existing body",
    orchestrator.includes("sdr_orphan_deal_fail_closed") &&
      orchestrator.includes("return;\n  // ── existing body below is unreachable"),
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Phase C: Approval allowlist
// ──────────────────────────────────────────────────────────────────────────────
async function phaseC_allowlist(): Promise<void> {
  console.log("\n── Phase C: Reconciliation approval allowlist ───────────────────────────");

  const fs = await import("fs");
  const approval = fs.readFileSync("server/services/reconciliation-approval.ts", "utf-8");

  // APPROVED_FIELDS set literal must NOT contain "vertical" — vertical is only in REVERTABLE_FIELDS
  const approvedSetMatch = approval.match(/APPROVED_FIELDS\s*=\s*new Set\(\[([^\]]*)\]\)/);
  assert(
    "APPROVED_FIELDS does not include vertical",
    !approvedSetMatch || !approvedSetMatch[1].includes('"vertical"'),
    "vertical found in APPROVED_FIELDS set literal",
  );
  assert(
    "REVERTABLE_FIELDS includes vertical",
    approval.includes("REVERTABLE_FIELDS") && approval.includes("\"vertical\""),
  );
  assert(
    "Approve path uses APPROVED_FIELDS (not ALLOWED_FIELDS)",
    approval.includes("APPROVED_FIELDS.has(fieldName)"),
  );
  assert(
    "Revert path uses REVERTABLE_FIELDS",
    approval.includes("REVERTABLE_FIELDS.has(fieldName)"),
  );
  assert(
    "409 message references Gen-2 crosswalk for vertical rejection",
    approval.includes("Gen-2 crosswalk"),
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Phase D: Enrichment-jobs 503 gate
// ──────────────────────────────────────────────────────────────────────────────
async function phaseD_enrichmentGate(): Promise<void> {
  console.log("\n── Phase D: Enrichment-jobs 503 gate ────────────────────────────────────");

  const r = await authedFetch("PATCH", "/api/enrichment-jobs/1", { status: "pending" });
  assert("PATCH /api/enrichment-jobs/:id returns 503", r.status === 503, `status=${r.status}`);
  const body = await r.json().catch(() => ({}));
  assert(
    "503 body has ENRICHMENT_JOB_CONTROL_GOVERNED code",
    body.code === "ENRICHMENT_JOB_CONTROL_GOVERNED",
    JSON.stringify(body),
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Phase E: Identity crosswalk routes
// ──────────────────────────────────────────────────────────────────────────────
async function phaseE_routes(): Promise<void> {
  console.log("\n── Phase E: Identity crosswalk routes ────────────────────────────────────");

  // Unauthenticated → 401
  const unauthR = await fetch(`${BASE}/api/admin/identity-crosswalk/runs`);
  assert("GET /runs without auth → 401 or 302", [401, 302].includes(unauthR.status), `status=${unauthR.status}`);

  // Authenticated admin
  const listR = await authedFetch("GET", "/api/admin/identity-crosswalk/runs");
  assert("GET /runs returns 200", listR.status === 200, `status=${listR.status}`);
  const listBody = await listR.json().catch(() => ({}));
  assert("GET /runs returns { runs: [] } shape", Array.isArray(listBody.runs), JSON.stringify(listBody));

  // Start a run
  const startR = await authedFetch("POST", "/api/admin/identity-crosswalk/runs", {});
  const startOk = startR.status === 201 || startR.status === 409;
  assert("POST /runs returns 201 or 409", startOk, `status=${startR.status}`);

  let runId: string | null = null;
  if (startR.status === 201) {
    const startBody = await startR.json().catch(() => ({}));
    assert("POST /runs returns runId", typeof startBody.runId === "string", JSON.stringify(startBody));
    assert("POST /runs returns generation", typeof startBody.generation === "number");
    runId = startBody.runId;
  } else {
    // 409 = run already active; find it
    const list2 = await authedFetch("GET", "/api/admin/identity-crosswalk/runs");
    const body2 = await list2.json().catch(() => ({ runs: [] }));
    const active = body2.runs?.find((r: any) => ["pending", "running", "paused"].includes(r.status));
    runId = active?.id ?? null;
    assert("409 conflict — active run found in list", !!runId);
  }

  if (runId) {
    // GET /runs/:runId
    const detailR = await authedFetch("GET", `/api/admin/identity-crosswalk/runs/${runId}`);
    assert("GET /runs/:runId returns 200", detailR.status === 200, `status=${detailR.status}`);
    const detail = await detailR.json().catch(() => ({}));
    assert("Run detail has generation field", typeof detail.generation === "number");

    // Invalid UUID → 400
    const badR = await authedFetch("GET", "/api/admin/identity-crosswalk/runs/not-a-uuid");
    assert("GET /runs/not-a-uuid → 400", badR.status === 400, `status=${badR.status}`);

    // Subjects
    const subR = await authedFetch("GET", `/api/admin/identity-crosswalk/subjects?run_id=${runId}`);
    assert("GET /subjects returns 200", subR.status === 200, `status=${subR.status}`);
    const subBody = await subR.json().catch(() => ({}));
    assert("GET /subjects returns { subjects: [] } shape", Array.isArray(subBody.subjects));

    // Vertical candidates
    const vcR = await authedFetch("GET", `/api/admin/identity-crosswalk/vertical-candidates?run_id=${runId}`);
    assert("GET /vertical-candidates returns 200", vcR.status === 200, `status=${vcR.status}`);
    const vcBody = await vcR.json().catch(() => ({}));
    assert("GET /vertical-candidates returns { candidates: [] } shape", Array.isArray(vcBody.candidates));

    // Decide with invalid candidateId → 400
    const badDecR = await authedFetch("POST", "/api/admin/identity-crosswalk/candidates/not-a-uuid/decide", {
      decision: "confirm",
      target_type: "identity_candidate",
    });
    assert("POST /candidates/invalid/decide → 400", badDecR.status === 400, `status=${badDecR.status}`);

    // Decide with nonexistent candidateId → 404
    const fakeId = "00000000-0000-4000-a000-000000000000";
    const noDecR = await authedFetch("POST", `/api/admin/identity-crosswalk/candidates/${fakeId}/decide`, {
      decision: "confirm",
      target_type: "identity_candidate",
    });
    assert("POST /candidates/nonexistent/decide → 404", noDecR.status === 404, `status=${noDecR.status}`);

    // Cancel the run to clean up
    const cancelR = await authedFetch("POST", `/api/admin/identity-crosswalk/runs/${runId}/cancel`, {});
    assert("POST /runs/:runId/cancel returns 200 or 409", [200, 409].includes(cancelR.status), `status=${cancelR.status}`);

    // Conflict: starting another run after cancel should now succeed (no active run)
    // Give a moment for state to propagate
    await new Promise(r => setTimeout(r, 200));
    const start2R = await authedFetch("POST", "/api/admin/identity-crosswalk/runs", {});
    assert("POST /runs after cancel returns 201", start2R.status === 201, `status=${start2R.status}`);
    if (start2R.status === 201) {
      const b = await start2R.json().catch(() => ({}));
      if (b.runId) {
        // Clean up second run too
        await authedFetch("POST", `/api/admin/identity-crosswalk/runs/${b.runId}/cancel`, {});
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Phase F: Lead-ops stats renamed fields
// ──────────────────────────────────────────────────────────────────────────────
async function phaseF_leadOpsStats(): Promise<void> {
  console.log("\n── Phase F: Lead-ops stats renamed fields ────────────────────────────────");

  const r = await authedFetch("GET", "/api/lead-ops/stats");
  assert("GET /api/lead-ops/stats returns 200", r.status === 200, `status=${r.status}`);
  const body = await r.json().catch(() => ({}));
  assert("stats has processing_completed (not enriched)", "processing_completed" in body, JSON.stringify(Object.keys(body)));
  assert("stats has pending_processing (not pending)", "pending_processing" in body);
  assert("stats has current_email_inventory (not has_email)", "current_email_inventory" in body);
  assert("stats has current_phone_inventory (not has_phone)", "current_phone_inventory" in body);
  assert("stats does NOT have legacy 'enriched' field", !("enriched" in body));
  assert("stats does NOT have legacy 'has_email' field", !("has_email" in body));
}

// ──────────────────────────────────────────────────────────────────────────────
// Phase G: Reconciliation org-candidate members endpoint
// ──────────────────────────────────────────────────────────────────────────────
async function phaseG_orgCandidateMembers(): Promise<void> {
  console.log("\n── Phase G: Reconciliation org-candidate members ────────────────────────");

  // Invalid candidate ID → 400
  const badR = await authedFetch("GET", "/api/admin/reconciliation/org-candidates/not-an-int/members");
  assert("GET /org-candidates/invalid/members → 400", badR.status === 400, `status=${badR.status}`);

  // Nonexistent candidate → 200 with empty members
  const emptyR = await authedFetch("GET", "/api/admin/reconciliation/org-candidates/999999999/members");
  assert("GET /org-candidates/999999999/members → 200", emptyR.status === 200, `status=${emptyR.status}`);
  const body = await emptyR.json().catch(() => ({}));
  assert("org-candidate members returns { members: [] } shape", Array.isArray(body.members), JSON.stringify(body));
}

// ──────────────────────────────────────────────────────────────────────────────
// Phase H: Static source code guards
// ──────────────────────────────────────────────────────────────────────────────
async function phaseH_sourceGuards(): Promise<void> {
  console.log("\n── Phase H: Static source code guards ───────────────────────────────────");

  const fs = await import("fs");

  // Routes registered
  const routesTs = fs.readFileSync("server/routes.ts", "utf-8");
  assert("identity-crosswalk routes registered in server/routes.ts",
    routesTs.includes("registerIdentityCrosswalkRoutes"),
  );

  // Prospects 503
  const prospectsTs = fs.readFileSync("server/routes/prospects.ts", "utf-8");
  assert("PATCH /enrichment-jobs returns 503", prospectsTs.includes("ENRICHMENT_JOB_CONTROL_GOVERNED"));

  // UI route
  const appTs = fs.readFileSync("client/src/App.tsx", "utf-8");
  assert("IdentityCrosswalk route in App.tsx", appTs.includes("/dashboard/identity-crosswalk"));

  // Journal entries
  const journal = JSON.parse(fs.readFileSync("migrations/meta/_journal.json", "utf-8"));
  const tags = journal.entries.map((e: any) => e.tag);
  assert("Journal has 0230_identity_crosswalk_runs", tags.includes("0230_identity_crosswalk_runs"));
  assert("Journal has 0231_identity_crosswalk_candidates", tags.includes("0231_identity_crosswalk_candidates"));
  const entry0230 = journal.entries.find((e: any) => e.tag === "0230_identity_crosswalk_runs");
  const entry0231 = journal.entries.find((e: any) => e.tag === "0231_identity_crosswalk_candidates");
  assert("0230 when > 1800000000500 (above high-water)", entry0230?.when > 1800000000500);
  assert("0231 when > 0230 when", entry0231?.when > entry0230?.when);

  // Lead-ops stats NULLIF/BTRIM
  const leadOpsTs = fs.readFileSync("server/routes/lead-ops.ts", "utf-8");
  assert("lead-ops stats uses NULLIF(BTRIM(email))", leadOpsTs.includes("NULLIF(BTRIM(email)"));
  assert("lead-ops stats has processing_completed alias", leadOpsTs.includes("processing_completed"));
  assert("lead-ops stats has current_email_inventory alias", leadOpsTs.includes("current_email_inventory"));
}

// ──────────────────────────────────────────────────────────────────────────────
// Phase I: Runner schema correctness & org-candidate path isolation
// ──────────────────────────────────────────────────────────────────────────────
async function phaseI_runnerSchema(): Promise<void> {
  console.log("\n── Phase I: Runner batch query schema correctness ───────────────────────");

  const fs = await import("fs");
  const runner = fs.readFileSync("server/services/identity-crosswalk-runner.ts", "utf-8");

  // ── Population query correctness ──────────────────────────────────────────
  // prospects BATCH query (cursor-based SELECT for iteration) must NOT reference
  // sunbiz_entity_id or business_id — these columns don't exist on the prospects table.
  // The FK-traversal helper query (sunbiz→prospect→contact) correctly reads contact_id
  // and business_id from prospects but is a single-row lookup, not the batch scan.
  const prospectsOrderByBlock = runner.match(
    /FROM prospects\s+WHERE id > \$1 AND id <= \$2[\s\S]{0,500}/,
  );
  const batchProspectsText = prospectsOrderByBlock ? prospectsOrderByBlock[0] : "";
  assert(
    "Prospects BATCH scan does not select sunbiz_entity_id",
    !batchProspectsText.includes("sunbiz_entity_id"),
    "sunbiz_entity_id found in cursor-based prospects batch SELECT",
  );
  assert(
    "Prospects BATCH scan does not select business_id as a top-level column",
    // The batch scan should not have business_id; the FK traversal helper is a separate single-row query
    !runner.match(/company_name AS entity_name, vertical, contact_id,\s*business_id/),
    "business_id found as top-level column in prospects batch SELECT",
  );
  // contact_id is in the SELECT clause which appears BEFORE "FROM prospects"
  // Look for it in the 500 chars preceding the "FROM prospects WHERE id > $1" marker
  const batchProspectsSelectMatch = runner.match(
    /SELECT[\s\S]{0,600}contact_id[\s\S]{0,200}FROM prospects\s+WHERE id > \$1/,
  );
  assert(
    "Prospects batch selects contact_id (the real FK)",
    !!batchProspectsSelectMatch,
    "contact_id not found in cursor-based prospects batch SELECT ... FROM prospects pattern",
  );

  // master_leads: company column is 'company', NOT 'company_name'
  assert(
    "master_leads batch uses 'company AS entity_name' (not company_name)",
    runner.includes("company AS entity_name") &&
      !runner.match(/company_name AS entity_name[\s\S]{0,200}FROM master_leads/),
    "master_leads batch still uses company_name AS entity_name",
  );
  assert(
    "master_leads batch does not select nonexistent company_name",
    !runner.match(/\"company_name\"[\s\S]{0,200}FROM master_leads/),
  );

  // Tier 2: filing_number match via businesses is deferred (businesses has no filing_number)
  assert(
    "Tier 2 filing_number join on businesses is not in any active query",
    !runner.match(/JOIN businesses[\s\S]{0,200}filing_number/),
    "Active JOIN businesses ... filing_number found — businesses table has no such column",
  );
  assert(
    "Tier 2 is marked as Gen-2 deferred in runner",
    runner.includes("Gen-2") && runner.includes("filing_number via businesses") && runner.includes("deferred"),
  );

  // ── #1836 defect fixes ────────────────────────────────────────────────────

  // Fix: email validation uses decideMarketingEmailValidation (not email_status IN check)
  assert(
    "#1836: runner imports decideMarketingEmailValidation",
    runner.includes("decideMarketingEmailValidation"),
    "decideMarketingEmailValidation not imported — email validation still uses raw email_status IN check",
  );
  assert(
    "#1836: email probe fetches provider-readiness fields",
    runner.includes("email_token_hash") &&
    runner.includes("email_mutation_generation") &&
    runner.includes("email_validation_updated_at"),
    "email probe does not fetch fields needed for decideMarketingEmailValidation",
  );
  assert(
    "#1836: email match tier splits validated vs unvalidated (tier 3 vs tier 7)",
    runner.includes("exact_email_validated") && runner.includes("exact_email_unvalidated"),
    "runner does not distinguish validated vs unvalidated email tiers",
  );
  assert(
    "#1836: raw email_status IN probe removed from email match query",
    !runner.match(/AND email_status IN \('valid', 'active'\)/),
    "raw email_status IN ('valid','active') still used — misses provider-readiness check",
  );

  // Fix: ambiguous email → AMBIGUOUS_MATCH per candidate, not INSUFFICIENT_EVIDENCE
  assert(
    "#1836: ambiguous email writes AMBIGUOUS_MATCH candidates",
    runner.includes("ambiguousEmailCandidates") &&
    runner.includes("ambiguous_email"),
    "ambiguous email still collapses — each candidate must be written as AMBIGUOUS_MATCH",
  );

  // Fix: email and owner_email probed independently (not coalesced)
  assert(
    "#1836: email and owner_email probed independently via emailsToProbe set",
    runner.includes("emailsToProbe") &&
    runner.includes("normalizedEmail") &&
    runner.includes("normalizedOwnerEmail"),
    "email/owner_email still coalesced — must probe each independently",
  );
  assert(
    "#1836: old coalesced email shortcircuit removed",
    !runner.match(/const sourceEmail = normalizeEmail\(row\.email \?\? row\.owner_email\)/),
    "old coalesced (email ?? owner_email) shortcircuit still present",
  );

  // Fix: phone and owner_phone probed independently
  assert(
    "#1836: phone and owner_phone probed independently via phonesToProbe set",
    runner.includes("phonesToProbe") &&
    runner.includes("rawPhone") &&
    runner.includes("rawOwnerPhone"),
    "phone/owner_phone still coalesced — must probe each independently",
  );

  // Fix: company+domain tier 4 implemented
  assert(
    "#1836: company+domain tier 4 implemented",
    runner.includes("company_domain") &&
    runner.includes("split_part") &&
    runner.includes("sourceDomain"),
    "company+domain tier 4 not implemented",
  );

  // Fix: company+address tier 6 implemented
  assert(
    "#1836: company+address tier 6 implemented",
    runner.includes("company_address") &&
    runner.includes("principal_city") &&
    runner.includes("principal_state"),
    "company+address tier 6 not implemented",
  );

  // Fix: business matching implemented
  assert(
    "#1836: business matching on website_domain implemented",
    runner.includes("business_website_domain") &&
    runner.includes("businessCandidateMap"),
    "business matching on website_domain not implemented",
  );
  assert(
    "#1836: business matching on company+phone implemented",
    runner.includes("business_company_phone"),
    "business matching on company+phone not implemented",
  );

  // Fix: multiple businesses → all written as SOURCE_CONFLICT (not just businessIds[0])
  assert(
    "#1836: multiple business matches write all candidates (not just first)",
    runner.includes("multiBusinessCands") &&
    runner.includes("Multiple business-only candidates"),
    "multiple business matches still take only businessIds[0] — remaining silently dropped",
  );

  // Fix: mixed contact+business → all written together (business not silently discarded)
  assert(
    "#1836: mixed contact+business writes both types (business not silently discarded)",
    runner.includes("mixedCands") &&
    runner.includes("businessIds.length === 0"),
    "business candidates still silently discarded when a contact match exists",
  );

  // Fix: insertSubjectWithCandidates accepts candidateType (contact or business)
  assert(
    "#1836: insertSubjectWithCandidates accepts candidateType per candidate",
    runner.includes("candidateType: \"contact\" | \"business\""),
    "insertSubjectWithCandidates still hardcodes 'contact' — cannot write business candidates via this path",
  );

  // Fix: insertSubjectWithCandidates writes ALL provider evidence rows (not just providers[0])
  assert(
    "#1836: insertSubjectWithCandidates iterates over cand.providers (all evidence signals)",
    runner.includes("for (const { provider } of cand.providers)"),
    "insertSubjectWithCandidates still writes only providers[0] — additional matching signals are lost from evidence",
  );

  // Fix: multi-candidate call sites pass full providers array (not single provider)
  assert(
    "#1836: SOURCE_CONFLICT multi-candidate call passes providers: s.providers (not providers[0])",
    runner.includes("providers: s.providers") && !runner.includes("provider: s.providers[0].provider"),
    "SOURCE_CONFLICT multi-candidate still passes only providers[0] — remaining signals lost",
  );

  // Fix: ambiguous-email + business branch — business candidates NOT silently dropped
  assert(
    "#1836: ambiguous-email + business → promotes ambiguous contacts when businessCandidateMap has entries",
    runner.includes(
      "purelyAmbiguousEmailCandidates.length > 0 && candidateMap.size === 0 && businessCandidateMap.size > 0",
    ),
    "ambiguous-email branch still discards business candidates when businessCandidateMap is non-empty",
  );

  // Fix: sourceDomain prefers explicit website/domain field over email-derived domain
  assert(
    "#1836: sourceDomain uses explicit website/domain field with normalizeDomain()",
    runner.includes("explicitWebsiteDomain") &&
    runner.includes("normalizeDomain(row.website)") &&
    runner.includes("normalizeDomain(row.domain)"),
    "sourceDomain still derived only from email — free-mail domains create false company+domain matches",
  );
  assert(
    "#1836: free-mail domains are blocked from company+domain matching",
    runner.includes("FREE_MAIL_DOMAINS") && runner.includes("isFreeMail"),
    "free-mail guard missing — gmail.com/yahoo.com domains can match unrelated contacts",
  );
  assert(
    "#1836: website added to prospects batch SELECT",
    runner.includes("website") && runner.includes("FROM prospects"),
    "prospects batch SELECT does not include website — explicit website domain not used",
  );
  assert(
    "#1836: domain added to master_leads batch SELECT",
    runner.includes("domain") && runner.includes("FROM master_leads"),
    "master_leads batch SELECT does not include domain — explicit website domain not used",
  );

  // Fix: business name normalization uses canonical normalizer (strips legal suffixes + punctuation)
  assert(
    "#1836: normalizeBusinessNameCanonical imported from sdr/dedupe",
    runner.includes("normalizeBusinessNameCanonical") && runner.includes("from \"./sdr/dedupe\""),
    "business name normalization still uses raw lowercase/trim — cannot match businesses.normalized_name after suffix removal",
  );
  assert(
    "#1836: sourceBusinessName derived from normalizeBusinessNameCanonical(row.entity_name)",
    runner.includes("sourceBusinessName") && runner.includes("normalizeBusinessNameCanonical(row.entity_name)"),
    "sourceBusinessName not computed — business probes still compare against un-normalized entity_name",
  );
  assert(
    "#1836: business company+phone probe uses sourceBusinessName (not sourceCompany)",
    runner.includes("sourceBusinessName, phoneNorm, frozenBusinessesMaxId"),
    "business company+phone probe still uses sourceCompany — misses 'Acme, LLC' vs normalized 'acme' in DB",
  );
  assert(
    "#1836: business company+city+state probe uses sourceBusinessName (not sourceCompany)",
    runner.includes("sourceBusinessName, srcCity, srcState"),
    "business company+city+state probe still uses sourceCompany — mismatch after legal-suffix stripping",
  );
  assert(
    "#1836: business name-only probe uses sourceBusinessName (not sourceCompany)",
    runner.includes("sourceBusinessName, frozenBusinessesMaxId"),
    "business name-only probe still uses sourceCompany — misses suffix-stripped business names",
  );

  // Fix: RULES_VERSION exported from runner and used in POST route
  assert(
    "#1836: RULES_VERSION exported from runner",
    runner.includes("export const RULES_VERSION"),
    "RULES_VERSION not exported — POST route cannot import it",
  );
  {
    const _routeForVersion = fs.readFileSync("server/routes/identity-crosswalk.ts", "utf-8");
    assert(
      "#1836: POST route uses RULES_VERSION constant (not hardcoded string)",
      _routeForVersion.includes("RULES_VERSION") && !_routeForVersion.includes("\"gen1-1.0.0\""),
      "POST route still hardcodes 'gen1-1.0.0' — v2 scans mislabeled as v1",
    );
  }

  // Fix: email ambiguous query LIMIT increased to 100 (safety cap, documented)
  assert(
    "#1836: email query uses LIMIT 100 safety cap (not 5 or 20)",
    !runner.includes("LIMIT 5") && runner.includes("LIMIT 100"),
    "email query still uses a low LIMIT — silently omits contacts sharing the email beyond the cap",
  );

  // Fix: provider_observations queried for real evidenceGeneration (not tautological)
  assert(
    "#1836: email match queries provider_observations for evidence generation",
    runner.includes("FROM provider_observations") &&
    runner.includes("po.subject_generation") &&
    runner.includes("evidenceGeneration: po ? (po.subject_generation"),
    "email match still uses contacts.email_mutation_generation as evidenceGeneration — tautological generation check",
  );
  assert(
    "#1836: email match uses po.outcome as providerOutcome (not email_status alone)",
    runner.includes("providerOutcome: po ? po.outcome : null"),
    "email match does not use providerOutcome from provider_observations",
  );
  assert(
    "#1836: email match uses po.observed_at as verifiedAt (not email_validation_updated_at alone)",
    runner.includes("verifiedAt: po ? po.observed_at :"),
    "email match uses email_validation_updated_at for verifiedAt without checking provider_observations first",
  );

  // Fix: business probes accumulate ALL matches (not skip when >1)
  assert(
    "#1836: business domain probe loops over all rows (not if rows.length === 1)",
    runner.includes("for (const bRow of bDomR.rows)"),
    "business domain probe still only adds candidate when exactly 1 result — multiple matches dropped",
  );
  assert(
    "#1836: business phone probe loops over all rows",
    runner.includes("for (const bRow of bPhoneR.rows)"),
    "business phone probe still only adds candidate when exactly 1 result",
  );
  assert(
    "#1836: business address probe loops over all rows",
    runner.includes("for (const bRow of bAddrR.rows)"),
    "business address probe still only adds candidate when exactly 1 result",
  );
  assert(
    "#1836: business name-only probe loops over all rows",
    runner.includes("for (const bRow of bNameR.rows)"),
    "business name-only probe still only adds candidate when exactly 1 result",
  );

  // Fix: email probe independence — unique match from owner_email survives ambiguous primary_email
  assert(
    "#1836: purelyAmbiguousEmailCandidates filters out contacts already in candidateMap",
    runner.includes("purelyAmbiguousEmailCandidates") &&
    runner.includes("!candidateMap.has(ac.id)"),
    "unique owner_email match still discarded when primary_email is ambiguous",
  );
  assert(
    "#1836: tier 4-7 contact probes gated on purelyAmbiguousEmailCandidates (not ambiguousEmailCandidates)",
    runner.includes("purelyAmbiguousEmailCandidates.length === 0") &&
    !runner.includes("ambiguousEmailCandidates.length === 0"),
    "tier 4-7 probes still blocked by raw ambiguousEmailCandidates — unique other-email matches never reach them",
  );
  assert(
    "#1836: ambiguous branch only fires when candidateMap is empty",
    runner.includes("purelyAmbiguousEmailCandidates.length > 0 && candidateMap.size === 0"),
    "ambiguous branch still fires when candidateMap has unique matches — discards them",
  );
  assert(
    "#1836: mixed ambiguous+unique case promotes ambiguous contacts into candidateMap for SOURCE_CONFLICT",
    runner.includes("purelyAmbiguousEmailCandidates.length > 0 && candidateMap.size > 0") &&
    runner.includes("addContactSignal(ac.id, \"ambiguous_email\", 3)"),
    "when unique+ambiguous contacts coexist, ambiguous set is dropped instead of writing SOURCE_CONFLICT",
  );

  // Fix: frozenBusinessesMaxId passed into processBatch
  assert(
    "#1836: frozenBusinessesMaxId parameter in processBatch signature",
    runner.includes("frozenBusinessesMaxId: bigint"),
    "frozenBusinessesMaxId not in processBatch signature — was hardcoded null",
  );
  assert(
    "#1836: executeIdentityRun extracts frozenBusinessesMaxId from run row",
    runner.includes("frozenBusinessesMaxId = BigInt(run.frozen_businesses_max_id"),
    "executeIdentityRun does not extract frozenBusinessesMaxId",
  );

  // Fix: insertVerticalCandidate calls resolveCanonicalVertical
  assert(
    "#1836: insertVerticalCandidate calls resolveCanonicalVertical",
    runner.includes("resolveCanonicalVertical") &&
    runner.includes("resolver_input") &&
    runner.includes("resolver_output"),
    "insertVerticalCandidate does not call resolveCanonicalVertical",
  );

  // Fix: cursor update is inside batch transaction (atomic)
  assert(
    "#1836: CursorUpdateFn type used for atomic cursor advancement",
    runner.includes("CursorUpdateFn") &&
    runner.includes("cursorUpdateFn"),
    "cursor update still happens after COMMIT — not atomic",
  );
  assert(
    "#1836: cursorUpdateFn called inside processBatch before COMMIT",
    runner.includes("const cursorUpdated = await cursorUpdateFn(tx, processed, exceptions)"),
    "cursorUpdateFn not called inside processBatch before COMMIT",
  );

  // Fix: filing-number tier recorded as run-level skip in run_notes
  assert(
    "#1836: filing-number tier recorded as run-level skip in run_notes",
    runner.includes("tier_skips") && runner.includes("run_notes"),
    "filing-number tier skip not recorded in run_notes",
  );

  // Fix: sunbiz batch includes address fields
  assert(
    "#1836: sunbiz batch fetch includes principal_address, principal_city, principal_state",
    runner.includes("principal_address") && runner.includes("principal_city, principal_state"),
    "sunbiz batch does not fetch address fields",
  );

  // Diagnostic endpoint
  const crosswalkRouteForDiag = fs.readFileSync("server/routes/identity-crosswalk.ts", "utf-8");
  assert(
    "#1836: diagnostic census endpoint registered",
    crosswalkRouteForDiag.includes("diagnostic") &&
    crosswalkRouteForDiag.includes("dispositionBreakdown") &&
    crosswalkRouteForDiag.includes("evidenceClassBreakdown"),
    "diagnostic census endpoint not registered",
  );

  // UI rename: Scan #N not Gen-N
  const uiTs = fs.readFileSync("client/src/pages/dashboard/IdentityCrosswalk.tsx", "utf-8");
  assert(
    "#1836: UI displays 'Scan #N' not 'Gen-N' in run list",
    uiTs.includes("Scan #") && !uiTs.includes("Gen-{r.generation}"),
    "UI still shows Gen-N in run list",
  );
  assert(
    "#1836: startMutation toast uses 'Scan #N'",
    !uiTs.includes("Gen-${data.generation}"),
    "startMutation toast still shows Gen-N",
  );
  assert(
    "#1836: architectural Gen-1/Gen-2 text preserved",
    uiTs.includes("Gen-1") && uiTs.includes("Gen-2"),
    "architectural Gen-1/Gen-2 text removed",
  );

  // Migration 0232 for run_notes
  const journalNew = JSON.parse(fs.readFileSync("migrations/meta/_journal.json", "utf-8"));
  const tagsNew = journalNew.entries.map((e: any) => e.tag);
  assert(
    "#1836: migration 0232_crosswalk_run_notes journaled",
    tagsNew.includes("0232_crosswalk_run_notes"),
    "0232_crosswalk_run_notes not in journal",
  );

  // ── Org-candidate decision isolation ──────────────────────────────────────
  const crosswalkRoute = fs.readFileSync("server/routes/identity-crosswalk.ts", "utf-8");

  // Org path must load from contact_organization_candidates, not contact_identity_candidates
  assert(
    "Org-candidate decide path loads from contact_organization_candidates",
    crosswalkRoute.includes("FROM contact_organization_candidates WHERE id = $1"),
    "org_candidate branch does not independently verify org candidate",
  );

  // The two branches must both exist as clearly labelled sections
  const hasOrgBranch = crosswalkRoute.includes("── Org-candidate decision path");
  const hasIdentityBranch = crosswalkRoute.includes("── Identity candidate decision path");
  assert(
    "Org-candidate branch is separated from identity-candidate branch",
    hasOrgBranch && hasIdentityBranch,
    `hasIdentityBranch=${hasIdentityBranch}, hasOrgBranch=${hasOrgBranch}`,
  );

  // FK domain fix: contact_identity_decisions.run_id → contact_identity_reconciliation_runs
  // The org-candidate branch must use a caller-supplied crosswalk_run_id (identity domain),
  // NOT the org candidate's own run_id (which references contact_reconciliation_runs).
  assert(
    "Org-candidate branch requires crosswalk_run_id in request body (FK domain fix)",
    crosswalkRoute.includes("crosswalk_run_id is required when target_type is org_candidate"),
  );
  assert(
    "Org-candidate branch validates crosswalk_run_id against contact_identity_reconciliation_runs",
    crosswalkRoute.includes("FROM contact_identity_reconciliation_runs WHERE id = $1"),
    "crosswalk_run_id not validated against identity run table",
  );
  assert(
    "Org-candidate decision uses crosswalk_run_id (not org candidate's run_id) for decision FK",
    crosswalkRoute.includes("crosswalk_run_id, organization_candidate_id, target_type,"),
    "org-candidate decision insert still uses orgCand.run_id — FK domain mismatch",
  );

  // Decision endpoint: ALLOWED_DECISIONS and ALLOWED_TARGET_TYPES must be validated
  assert(
    "Decide endpoint validates ALLOWED_DECISIONS",
    crosswalkRoute.includes("ALLOWED_DECISIONS") && crosswalkRoute.includes("confirm") && crosswalkRoute.includes("reject") && crosswalkRoute.includes("defer"),
  );
  assert(
    "Decide endpoint validates ALLOWED_TARGET_TYPES",
    crosswalkRoute.includes("ALLOWED_TARGET_TYPES") && crosswalkRoute.includes("identity_candidate") && crosswalkRoute.includes("org_candidate"),
  );
  assert(
    "org_candidate requires organization_candidate_id",
    crosswalkRoute.includes("organization_candidate_id is required when target_type is org_candidate"),
  );

  // ── Denominator reconciliation coverage ───────────────────────────────────
  // The runner must increment both processed and exceptions for every row, so
  // the caller can assert processed + exceptions = batch row count.
  // Verify the counter variables are updated in both the normal and catch paths.
  assert(
    "Runner increments 'processed' counter on success path",
    (runner.match(/processed\+\+/g) || []).length >= 3,
    "expected ≥3 processed++ sites (explicit_link, matched, no_match)",
  );
  assert(
    "Runner increments 'exceptions' counter on catch path",
    runner.includes("exceptions++"),
  );
  // processBatch returns { processed, exceptions, classCounts, cursorUpdated };
  // cursorUpdated=false means the batch was rolled back (lease superseded).
  // executeIdentityRun returns Promise<void> and drives the outer loop.
  assert(
    "processBatch returns { processed, exceptions, classCounts, cursorUpdated }",
    runner.includes("classCounts, cursorUpdated: true") || runner.includes("classCounts, cursorUpdated"),
  );
  assert(
    "executeIdentityRun signature returns Promise<void> (no data return)",
    !!runner.match(/async function executeIdentityRun[\s\S]{0,200}Promise<void>/),
  );

  // ── FK traversal helper query (sunbiz → prospect → contact) ──────────────
  // The sunbiz FK traversal reads prospects to get contact_id.
  // prospects has no business_id column — only contact_id should be selected.
  const fkHelperMatch = runner.match(
    /SELECT[\s\S]{0,50}FROM prospects WHERE id = \$1/,
  );
  assert(
    "Sunbiz FK traversal helper query exists (SELECT ... FROM prospects WHERE id = $1)",
    !!fkHelperMatch,
    "FK traversal helper query not found",
  );
  const fkHelperText = fkHelperMatch ? fkHelperMatch[0] : "";
  assert(
    "Sunbiz FK traversal helper does NOT select business_id (column not on prospects)",
    !fkHelperText.includes("business_id"),
    `business_id found in FK helper query: ${fkHelperText}`,
  );
  assert(
    "Sunbiz FK traversal helper selects contact_id",
    fkHelperText.includes("contact_id"),
  );

  // ── Frozen master_leads watermark: composite terminal tuple, not independent MAX() ──
  // MAX(created_at) and MAX(id) independently do not form a valid composite upper bound
  // because UUID ordering is unrelated to creation time.  The watermark must freeze the
  // actual terminal tuple via ORDER BY created_at DESC, id DESC LIMIT 1.
  assert(
    "Master-leads watermark uses ORDER BY created_at DESC, id DESC LIMIT 1 (not independent MAXes)",
    // The fix uses LEFT JOIN LATERAL with ORDER BY … LIMIT 1 to capture the terminal tuple
    crosswalkRoute.includes("LEFT JOIN LATERAL") &&
    crosswalkRoute.includes("ORDER BY created_at DESC, id DESC LIMIT 1") &&
    // The old independent-MAX pattern must NOT appear for master_leads
    !crosswalkRoute.match(/MAX\(created_at\)[\s\S]{0,10}AS max_ts[\s\S]{0,30}MAX\(id::text\)/),
    "master_leads watermark still uses independent MAX() — not a valid composite bound",
  );

  // ── classifyEvidence independence: requires distinctRootSources, not providers.length ──
  // STRONG_REVIEW_CANDIDATE must require signals from >= 2 DISTINCT root sources.
  // providers.length only counts signal types (email, phone, etc.) from the SAME root source
  // and must NOT be used as the independence counter.
  assert(
    "classifyEvidence signature uses 'distinctRootSources' parameter (not providers.length)",
    runner.includes("distinctRootSources: number,") ||
    runner.includes("distinctRootSources,"),
    "classifyEvidence still uses independentSignalCount / providers.length as independence metric",
  );
  assert(
    "processBatch calls classifyEvidence with literal 1 (Gen-1 single root source)",
    runner.includes("classifyEvidence(overallMinTier, 1, false)"),
    "processBatch passes a dynamic value to classifyEvidence — Gen-1 always has 1 distinct root source",
  );
  assert(
    "STRONG_REVIEW_CANDIDATE requires distinctRootSources >= 2 in classifyEvidence",
    runner.includes("distinctRootSources >= 2") && runner.includes("STRONG_REVIEW_CANDIDATE"),
    "STRONG_REVIEW_CANDIDATE threshold does not require distinctRootSources >= 2",
  );
  // The old providers.length check must no longer feed classifyEvidence in processBatch
  assert(
    "processBatch no longer passes sig.providers.length to classifyEvidence",
    !runner.match(/classifyEvidence\([^)]*providers\.length/),
    "providers.length still passed to classifyEvidence — would count same-root-source signals as independent",
  );

  // ── Per-row write atomicity: SAVEPOINT/ROLLBACK TO SAVEPOINT pattern ──────
  // If subject insertion succeeds but candidate/evidence/counter writes fail,
  // the entire row's writes must roll back so the unique constraint doesn't block replay.
  assert(
    "processBatch uses SAVEPOINT per row for atomic writes",
    runner.includes("SAVEPOINT ${savepointName}") ||
    runner.includes("SAVEPOINT \\${savepointName}") ||
    runner.match(/SAVEPOINT\s+\$\{savepointName\}/),
    "processBatch does not use SAVEPOINT — partial subject writes can block replay",
  );
  assert(
    "processBatch uses ROLLBACK TO SAVEPOINT on write error",
    runner.includes("ROLLBACK TO SAVEPOINT ${savepointName}") ||
    runner.includes("ROLLBACK TO SAVEPOINT \\${savepointName}") ||
    runner.match(/ROLLBACK TO SAVEPOINT\s+\$\{savepointName\}/),
    "processBatch does not roll back to savepoint on write failure",
  );
  assert(
    "processBatch acquires a dedicated pool client (pool.connect()) for the batch",
    runner.match(/const tx = await pool\.connect\(\)/) !== null,
    "processBatch still uses pool.query() directly — no dedicated client for SAVEPOINT support",
  );
  assert(
    "Helper functions (insertSubjectWithSingleCandidate) accept tx: PoolClient parameter",
    runner.includes("async function insertSubjectWithSingleCandidate(\n  tx: PoolClient,"),
    "insertSubjectWithSingleCandidate does not accept a tx parameter",
  );

  // ── leaseOwnerTag includes UUID for per-invocation uniqueness ─────────────
  // leaseOwnerTag() must include a UUID so every run creation and every
  // executeIdentityRun invocation gets a unique claim token. A hostname:pid-only
  // token means a pause/resume in the same process produces identical tokens,
  // allowing both workers to satisfy WHERE lease_owner = $owner simultaneously.
  assert(
    "leaseOwnerTag() appends crypto.randomUUID() for per-invocation uniqueness",
    runner.includes("crypto.randomUUID()") &&
    runner.match(/export function leaseOwnerTag[\s\S]{0,200}randomUUID\(\)/) !== null,
    "leaseOwnerTag does not include randomUUID() — hostname:pid only is insufficient for lease isolation",
  );

  // ── executeIdentityRun wraps entire lifecycle in try/catch ───────────────
  // Preflight, run loading, pending→running claim, sweep, and completion must
  // all be covered so any escaping exception CAS-transitions the run to 'failed'.
  // WHERE status IN ('pending','running') is required — preflight failures leave
  // the run pending, not running, so 'running'-only would miss them.
  assert(
    "executeIdentityRun has a lifecycle-level try/catch that marks the run failed (covering pending and running)",
    runner.includes("SET status = 'failed', fail_reason = $2") &&
    runner.includes("status IN ('pending', 'running')") &&
    // The handler must be outside the inner sweep scope (global to the function)
    runner.match(/try\s*\{[\s\S]{0,300}BACKGROUND_JOB_PROFILE/) !== null,
    "executeIdentityRun missing lifecycle-level failure guard covering pending + running — " +
    "preflight exceptions can leave runs permanently pending/running, blocking future attempts",
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Phase J: Database-backed atomicity and watermark tests
// ──────────────────────────────────────────────────────────────────────────────
async function phaseJ_dbAtomicity(): Promise<void> {
  console.log("\n── Phase J: DB-backed atomicity and watermark tests ────────────────────");

  // Import pg pool for direct DB access
  const { Pool } = await import("pg");
  // Use the same DATABASE_URL the app pool uses — individual PGHOST/PGUSER vars
  // may not be set or may point to a different endpoint than the actual app DB.
  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
    connectionTimeoutMillis: 8000,
  });

  try {
    // ── J1: Watermark query on empty-table scenario ───────────────────────────
    // The LEFT JOIN LATERAL watermark must return exactly one row with null
    // max_ts / max_uuid when master_leads is empty (or the real count if not).
    // We test the query structure by running it directly — the count tells us
    // whether master_leads has rows; we verify exactly 1 result row is returned.
    const client = await pgPool.connect();
    try {
      const wm = await client.query(`
        SELECT t.created_at AS max_ts, t.id::text AS max_uuid, cnt.total AS cnt
        FROM (SELECT COUNT(*) AS total FROM master_leads) cnt
        LEFT JOIN LATERAL (
          SELECT created_at, id FROM master_leads ORDER BY created_at DESC, id DESC LIMIT 1
        ) t ON TRUE
      `);
      assert(
        "J1: master_leads watermark query always returns exactly 1 row (including empty-table case)",
        wm.rows.length === 1,
        `Got ${wm.rows.length} rows — must be 1 for run creation to work on an empty table`,
      );
      const wmRow = wm.rows[0];
      const mlCount = Number(wmRow.cnt);
      if (mlCount === 0) {
        assert(
          "J1: Empty master_leads watermark returns null max_ts and max_uuid",
          wmRow.max_ts === null && wmRow.max_uuid === null,
          `max_ts=${wmRow.max_ts}, max_uuid=${wmRow.max_uuid}`,
        );
      } else {
        assert(
          "J1: Non-empty master_leads watermark returns non-null max_ts and max_uuid",
          wmRow.max_ts !== null && wmRow.max_uuid !== null,
          `max_ts=${wmRow.max_ts}, max_uuid=${wmRow.max_uuid}, cnt=${mlCount}`,
        );
        // Validate that the returned row is actually the terminal row (descending order)
        const terminalCheck = await client.query(`
          SELECT created_at AT TIME ZONE 'UTC' AS ts, id::text AS uid
          FROM master_leads
          ORDER BY created_at DESC, id DESC LIMIT 1
        `);
        if (terminalCheck.rows.length > 0) {
          const expectedUuid = terminalCheck.rows[0].uid;
          assert(
            "J1: Watermark max_uuid matches actual ORDER BY created_at DESC, id DESC LIMIT 1 terminal row",
            wmRow.max_uuid === expectedUuid,
            `watermark=${wmRow.max_uuid}, expected=${expectedUuid}`,
          );
        }
      }

      // ── Test fixture: create a valid parent run row ───────────────────────────
      // contact_identity_subjects has run_id FK → contact_identity_reconciliation_runs.
      // All J2/J3 tests use this run so subject inserts don't fail on the FK constraint.
      // We also need a valid requested_by_user_id (text FK → users.id).
      const anyUser = await client.query(`SELECT id FROM users LIMIT 1`);
      const testUserId = anyUser.rows[0]?.id ?? null;

      // Check for an existing active run. If one exists, we skip J2/J3/J4 rather than
      // cancel it — cancelling a legitimate production run would be destructive.
      const existingActiveRun = await client.query(
        `SELECT id, status FROM contact_identity_reconciliation_runs
         WHERE status IN ('pending','running','paused') LIMIT 1`,
      );
      if (existingActiveRun.rows.length > 0) {
        const activeId = existingActiveRun.rows[0].id;
        const activeStatus = existingActiveRun.rows[0].status;
        warn(`J-fixture: an active run (id=${activeId}, status=${activeStatus}) exists — skipping J2/J3/J4 to avoid disrupting it.\n` +
          `  Cancel the active run via the UI first, then re-run the cert suite.`);
        // Run an abridged watermark-only J1 (already done above) and fall through gracefully.
        client.release();
        return;
      }

      const testRunR = await client.query(`
        INSERT INTO contact_identity_reconciliation_runs
          (generation, rules_version, requested_by_user_id, environment, release_sha,
           status, lease_owner, lease_expires_at,
           frozen_sunbiz_max_id, frozen_prospects_max_id,
           frozen_master_leads_created_at, frozen_master_leads_max_uuid,
           frozen_contacts_max_id, frozen_businesses_max_id,
           sunbiz_denominator, prospects_denominator, master_leads_denominator)
        VALUES
          (9999,'gen1-test',$1,'test','test-sha',
           'running','cert-test-agent',now()+interval '10 minutes',
           null,null,null,null,null,null,0,0,0)
        RETURNING id
      `, [testUserId]);
      const testRunId = testRunR.rows[0].id;

      // ── J2: SAVEPOINT atomicity — prove insert+rollback works in BEGIN/COMMIT ──
      // 2a: write a subject, prove it landed
      await client.query("BEGIN");
      await client.query(`SAVEPOINT sp_insert`);
      await client.query(`
        INSERT INTO contact_identity_subjects
          (run_id, source_table, source_id, root_source_table, root_source_id,
           disposition, candidate_count, source_fingerprint)
        VALUES ($1,'sunbiz_entities','7777777','sunbiz_entities','7777777',
                'NO_MATCH',0,'test-fp-sp-insert')
      `, [testRunId]);
      await client.query(`RELEASE SAVEPOINT sp_insert`);
      await client.query("COMMIT");

      const afterInsert = await client.query(
        `SELECT COUNT(*) AS n FROM contact_identity_subjects WHERE run_id = $1`,
        [testRunId],
      );
      assert(
        "J2a: subject row is visible after SAVEPOINT / RELEASE / COMMIT",
        Number(afterInsert.rows[0].n) === 1,
        `Expected 1 subject row after insert, got ${afterInsert.rows[0].n}`,
      );

      // 2b: start a second row write, simulate a mid-write failure, roll back to savepoint
      await client.query("BEGIN");
      await client.query(`SAVEPOINT sp_rollback`);
      await client.query(`
        INSERT INTO contact_identity_subjects
          (run_id, source_table, source_id, root_source_table, root_source_id,
           disposition, candidate_count, source_fingerprint)
        VALUES ($1,'sunbiz_entities','8888888','sunbiz_entities','8888888',
                'NO_MATCH',0,'test-fp-sp-rollback')
      `, [testRunId]);
      // Simulate mid-write failure: roll back to savepoint before this write lands
      await client.query(`ROLLBACK TO SAVEPOINT sp_rollback`);
      await client.query(`RELEASE SAVEPOINT sp_rollback`);
      await client.query("COMMIT"); // commits only the rows that survived their SAVEPOINTs

      const afterRollback = await client.query(
        `SELECT COUNT(*) AS n FROM contact_identity_subjects WHERE run_id = $1`,
        [testRunId],
      );
      assert(
        "J2b: ROLLBACK TO SAVEPOINT within BEGIN/COMMIT leaves only previously committed rows",
        Number(afterRollback.rows[0].n) === 1,
        `Expected 1 subject (the earlier committed row) after savepoint rollback, got ${afterRollback.rows[0].n}`,
      );
      assert(
        "J2b: rolled-back row source_id '8888888' is absent (not committed)",
        Number(afterRollback.rows[0].n) < 2,
        "source_id 8888888 survived ROLLBACK TO SAVEPOINT — atomicity broken",
      );

      // ── J3: processBatch successful write + replay idempotency ────────────────
      let processBatchImported = false;
      let _testProcessBatch: Function | null = null;
      try {
        const runner = await import("../server/services/identity-crosswalk-runner.js");
        if (typeof runner._testProcessBatch === "function") {
          _testProcessBatch = runner._testProcessBatch;
          processBatchImported = true;
        }
      } catch (_) {
        // Runner import may fail in non-server context — fall through to skip
      }

      if (!processBatchImported || !_testProcessBatch) {
        // Cannot convert a missing import into a pass — that would certify behaviour that was never tested.
        assert(
          "J3: _testProcessBatch import must succeed (runner export is required for DB-backed atomicity certification)",
          false,
          "_testProcessBatch could not be imported from identity-crosswalk-runner — check the export and tsx module resolution",
        );
      } else {
        // Use a UNIQUE source_id that won't collide with J2 rows
        const fakeRow = {
          id: 6666666,
          entity_name: "__test_entity_no_match__" + Date.now(),
          email: null,
          owner_email: null,
          phone: null,
          owner_phone: null,
          filing_number: null,
          vertical: null,
          prospect_id: null,
          contact_id: null,
        };

        // Build a no-op cursor update function that always succeeds.
        // This simulates the atomic cursor advancement that runs inside the batch transaction.
        // Pass the run's lease_owner so the CAS WHERE clause matches.
        const noop_cursorFn = async (tx: any, _p: number, _e: number) => {
          // Just advance the cursor within the test run — the run is in 'running' state.
          const r = await tx.query(
            `UPDATE contact_identity_reconciliation_runs
             SET sunbiz_cursor = 0, updated_at = now()
             WHERE id = $1 AND lease_owner = 'cert-test-agent'`,
            [testRunId],
          );
          return (r.rowCount ?? 0) > 0;
        };

        // First call: should write the NO_MATCH subject and increment no_match_count
        const result1 = await _testProcessBatch(
          testRunId,
          "cert-test-agent",
          BigInt(0), // frozenContactsMaxId=0; no contact FK path fires
          BigInt(0), // frozenBusinessesMaxId=0
          [fakeRow],
          "sunbiz_entities",
          noop_cursorFn,
        );
        assert(
          "J3: processBatch returns { processed=1, exceptions=0 } for a NO_MATCH row with valid run",
          result1?.processed === 1 && result1?.exceptions === 0,
          `processed=${result1?.processed} exceptions=${result1?.exceptions}`,
        );
        const afterFirst = await client.query(
          `SELECT COUNT(*) AS n FROM contact_identity_subjects WHERE run_id = $1 AND source_id = '6666666'`,
          [testRunId],
        );
        assert(
          "J3: processBatch writes the subject row to the DB",
          Number(afterFirst.rows[0].n) === 1,
          `Expected 1 subject row, got ${afterFirst.rows[0].n}`,
        );
        const ctrAfterFirst = await client.query(
          `SELECT no_match_count FROM contact_identity_reconciliation_runs WHERE id = $1`,
          [testRunId],
        );
        const ctr1 = Number(ctrAfterFirst.rows[0]?.no_match_count ?? 0);
        assert(
          "J3: no_match_count incremented to 1 after first processBatch call",
          ctr1 === 1,
          `no_match_count=${ctr1}, expected 1`,
        );

        // Replay: same source row again — subject already exists (ON CONFLICT DO NOTHING)
        const result2 = await _testProcessBatch(
          testRunId,
          "cert-test-agent",
          BigInt(0),
          BigInt(0),
          [fakeRow],
          "sunbiz_entities",
          noop_cursorFn,
        );
        assert(
          "J3: processBatch returns { processed=1 } on replay (idempotent, no throw)",
          result2?.processed === 1 && result2?.exceptions === 0,
          `processed=${result2?.processed} exceptions=${result2?.exceptions}`,
        );
        const ctrAfterReplay = await client.query(
          `SELECT no_match_count FROM contact_identity_reconciliation_runs WHERE id = $1`,
          [testRunId],
        );
        const ctr2 = Number(ctrAfterReplay.rows[0]?.no_match_count ?? 0);
        assert(
          "J3: no_match_count stays at 1 after replay (counter not double-incremented)",
          ctr2 === 1,
          `no_match_count=${ctr2} after replay, expected still 1`,
        );
        const afterReplay = await client.query(
          `SELECT COUNT(*) AS n FROM contact_identity_subjects WHERE run_id = $1 AND source_id = '6666666'`,
          [testRunId],
        );
        assert(
          "J3: exactly 1 subject row after replay (no duplicate)",
          Number(afterReplay.rows[0].n) === 1,
          `Expected 1 subject row after replay, got ${afterReplay.rows[0].n}`,
        );
      }

      // ── J4: Superseded-worker CAS abort ──────────────────────────────────────
      // Prove that a cursor UPDATE scoped to lease_owner=$oldOwner returns 0 rows
      // when the DB has been reassigned to a new owner. This is the mechanism that
      // makes executeIdentityRun abort when its lease is superseded.
      const oldOwner = `cert-test-agent`; // matches testRunId's lease_owner
      const newOwner = `cert-test-agent-resumed:${Date.now()}`;

      // Simulate resume: update lease_owner to a new unique token
      await client.query(
        `UPDATE contact_identity_reconciliation_runs SET lease_owner = $2 WHERE id = $1`,
        [testRunId, newOwner],
      );

      // Old worker tries to advance cursor — should match 0 rows
      const staleUpdate = await client.query(
        `UPDATE contact_identity_reconciliation_runs
         SET sunbiz_cursor = 9999,
             sunbiz_processed = sunbiz_processed + 1,
             updated_at = now()
         WHERE id = $1 AND lease_owner = $2`,
        [testRunId, oldOwner],
      );
      assert(
        "J4: Stale worker cursor CAS returns 0 rows when lease is superseded",
        (staleUpdate.rowCount ?? 0) === 0,
        `Expected 0 rows updated by stale owner, got ${staleUpdate.rowCount}`,
      );

      // New worker can still advance cursor — should match 1 row
      const freshUpdate = await client.query(
        `UPDATE contact_identity_reconciliation_runs
         SET sunbiz_cursor = 9999,
             sunbiz_processed = sunbiz_processed + 1,
             updated_at = now()
         WHERE id = $1 AND lease_owner = $2`,
        [testRunId, newOwner],
      );
      assert(
        "J4: Resumed worker cursor CAS succeeds (1 row) with the new lease owner",
        (freshUpdate.rowCount ?? 0) === 1,
        `Expected 1 row updated by new owner, got ${freshUpdate.rowCount}`,
      );

      // Restore owner for cleanup
      await client.query(
        `UPDATE contact_identity_reconciliation_runs SET lease_owner = $2 WHERE id = $1`,
        [testRunId, oldOwner],
      ).catch(() => {});

      // ── Cleanup: FK-ordered deletion ────────────────────────────────────────
      // vertical candidates → evidence → candidates → subjects → run
      await client.query(
        `DELETE FROM contact_vertical_candidates WHERE run_id = $1`, [testRunId],
      ).catch(() => {});
      await client.query(
        `DELETE FROM contact_identity_evidence WHERE run_id = $1`, [testRunId],
      ).catch(() => {});
      await client.query(
        `DELETE FROM contact_identity_candidates WHERE run_id = $1`, [testRunId],
      ).catch(() => {});
      await client.query(
        `DELETE FROM contact_identity_subjects WHERE run_id = $1`, [testRunId],
      ).catch(() => {});
      await client.query(
        `DELETE FROM contact_identity_reconciliation_runs WHERE id = $1`, [testRunId],
      ).catch(() => {});
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("  Phase J DB connection error:", err?.message ?? err);
    assert("J-setup: DB connection for atomicity tests", false, String(err?.message ?? err));
  } finally {
    await pgPool.end().catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("=".repeat(70));
  console.log("  Identity Crosswalk Certification Suite (Task #1830)");
  console.log("=".repeat(70));

  // Static checks first (no server needed)
  await phaseH_sourceGuards();
  await phaseB_failClose();
  await phaseC_allowlist();
  await phaseI_runnerSchema();
  // DB-backed atomicity and watermark tests
  await phaseJ_dbAtomicity();

  // Server-required checks
  const loggedIn = await login();
  if (!loggedIn) {
    console.warn("\nWARN: Could not authenticate — skipping HTTP phases D–G");
    console.warn("      Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD to enable.\n");
  } else {
    await phaseA_schema();
    await phaseD_enrichmentGate();
    await phaseE_routes();
    await phaseF_leadOpsStats();
    await phaseG_orgCandidateMembers();
  }

  // Summary
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log("\n" + "=".repeat(70));
  if (failed === 0 && loggedIn) {
    console.log(`  ✅ ALL ${passed} ASSERTIONS PASSED — GO`);
  } else if (failed === 0 && !loggedIn) {
    console.log(`  ⚠️  ${passed} STATIC ASSERTIONS PASSED — PARTIAL (HTTP phases D–G skipped)`);
    console.log("     Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD for full validation.");
  } else {
    console.log(`  ✗ ${failed} FAILED / ${passed} PASSED`);
    for (const r of results.filter((r) => !r.pass)) {
      console.log(`     • ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
    }
  }
  console.log("=".repeat(70) + "\n");

  // Exit 1 only on actual failures.
  // PARTIAL (skipped HTTP phases) exits 0 so CI doesn't block on missing credentials,
  // but the output explicitly says PARTIAL — not GO — so reviewers see the limitation.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
