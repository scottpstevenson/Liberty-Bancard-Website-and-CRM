/**
 * Merchant Application Security — Focused Static + Service Assertions (v2)
 * ========================================================================
 * DB-less assertions covering the hardened security invariants:
 *   1. Routes/storage contain no forbidden full-row/snapshot patterns.
 *   2. Capability header-only, constant-time, expiry/revocation.
 *   3. Strict DTOs reject unknown/protected/esign keys.
 *   4. Status transition graph.
 *   5. Safe projections (forbidden columns, public ack, operator masks).
 *   6. Same/different idempotency key semantics.
 *   7. Protected-write ownership + outbox purity.
 *   8. Finalize replay: deterministic capability derivation; token match required.
 *   9. No catch-and-swallow: effect handlers throw on failure.
 *  10. Split outbox: individually-keyed rows; no combined finalize_side_effects.
 *  11. Worker: stale reclaim, dead_letter, audit-scrubbed errors.
 *  12. applyEsignDocumentState increments stateVersion; revokes on signed.
 *  13. applyUnderwritingRiskState exists; relationship-extractor uses it.
 *  14. Boarding submit: Idempotency-Key required, 409 without application.
 *  15. POST /api/merchant-applications gated to isAdminOrManager.
 *  16. operatorUpdateDto excludes esignStatus/esignedAt.
 *  17. EIN unique index in migration + schema.
 *
 * Run: npx tsx scripts/test-merchant-application-security.ts
 */

import { readFileSync } from "fs";
import { join } from "path";

let failures = 0;
let passed = 0;

function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failures++; console.error(`  ✗ ${msg}`); }
}

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

// ── 1. Static: no forbidden full-row response / snapshot patterns ──────────
console.log("\n[1] Static forbidden-pattern scan");
{
  const routesFull = read("server/routes/merchants.ts");
  const profileMarker = routesFull.indexOf('app.get("/api/merchant-profile"');
  const routes = profileMarker > 0 ? routesFull.slice(0, profileMarker) : routesFull;

  assert(!/res\.json\(\s*application\s*\)/.test(routes), "routes never `res.json(application)` (raw row)");
  assert(!/res\.json\(\s*updated\s*\)/.test(routes), "routes never `res.json(updated)` (raw row)");
  assert(!/res\.status\(201\)\.json\(\s*application\s*\)/.test(routes), "POST never returns raw application row");
  assert(!/\(async \(\) => \{/.test(routes), "no fire-and-forget IIFE side effects in routes");
  assert(!/syncMerchantApplicationToGhl\(/.test(routes), "routes do not call GHL sync directly");
  assert(!/scanApplicationRisk\(/.test(routes), "routes do not call risk scan directly");
  assert(!/req\.query\.token/.test(routes), "no query-param draft token in routes");

  const storage = read("server/storage/merchants.ts");
  assert(!/after:\s*created as unknown as Record/.test(storage), "storage create audit does not persist full `after` row");
  assert(!/before:\s*before as unknown as Record/.test(storage), "storage update audit does not persist full `before` row");
}

// ── 2. Capability verification semantics ────────────────────────────────────
console.log("\n[2] Capability verification semantics");
{
  const routes = read("server/routes/merchants.ts");
  assert(/x-draft-token/i.test(routes), "draft token read from x-draft-token header");
  assert(/x-esign-capability/i.test(routes), "e-sign capability read from x-esign-capability header");
  assert(/idempotency-key/i.test(routes), "finalize requires Idempotency-Key header");

  const svc = read("server/services/merchant-application-service.ts");
  assert(/timingSafeEqual/.test(svc), "service uses timingSafeEqual for constant-time compare");
  assert(/draftTokenRevokedAt/.test(svc) && /draftTokenExpiresAt/.test(svc), "draft token expiry+revocation checked");
  assert(/esignCapabilityRevokedAt/.test(svc) && /esignCapabilityExpiresAt/.test(svc), "esign capability expiry+revocation checked");
}

// ── 8. Finalize replay: deterministic capability derivation ─────────────────
console.log("\n[8] Finalize replay — deterministic capability");
{
  const svc = read("server/services/merchant-application-service.ts");
  assert(/deriveEsignCapability/.test(svc), "service exports deriveEsignCapability");
  assert(/createHmac.*sha256.*draftToken/.test(svc.replace(/\s+/g, "")), "capability derived via HMAC(draftToken, domain)");
  assert(/verifyDraftTokenForReplay/.test(svc), "replay path uses verifyDraftTokenForReplay");
  assert(/verifyDraftTokenForReplay\(draftToken/.test(svc.replace(/\s+/g, "")), "replay verifies token match before returning ack");
  // No plaintext stored
  assert(!/esignCapabilityPlaintext/.test(svc), "capability plaintext never stored");
}

// ── Service behavior assertions (import) ────────────────────────────────────
async function serviceAssertions() {
  const svc = await import("../server/services/merchant-application-service");

  console.log("\n[3] Strict DTO unknown-key / esign-key rejection");
  {
    const r = svc.autosaveDto.safeParse({ legalBusinessName: "x", ein: "123456789" });
    assert(!r.success, "autosaveDto rejects protected key `ein`");
    const r2 = svc.autosaveDto.safeParse({ notAField: true });
    assert(!r2.success, "autosaveDto rejects unknown key");
    const r3 = svc.operatorUpdateDto.safeParse({ ein: "123456789" });
    assert(!r3.success, "operatorUpdateDto rejects protected key `ein`");
    const r4 = svc.operatorUpdateDto.safeParse({ draftTokenHash: "x" });
    assert(!r4.success, "operatorUpdateDto rejects privileged internal key");
    const r5 = svc.operatorUpdateDto.safeParse({ status: "under_review" });
    assert(r5.success, "operatorUpdateDto accepts allowlisted status");
    // esignStatus and esignedAt removed from operatorUpdateDto (item 7)
    const r6 = svc.operatorUpdateDto.safeParse({ esignStatus: "signed" });
    assert(!r6.success, "operatorUpdateDto rejects esignStatus (use applyEsignDocumentState)");
    const r7 = svc.operatorUpdateDto.safeParse({ esignedAt: new Date() });
    assert(!r7.success, "operatorUpdateDto rejects esignedAt (use applyEsignDocumentState)");
  }

  console.log("\n[2b] Draft token verification BEHAVIOR (revocation + replay expiry)");
  {
    const crypto = await import("crypto");
    const token = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);

    // Normal path: valid token, not revoked, not expired → true.
    assert(svc.verifyDraftToken(token, { draftTokenHash: hash, draftTokenExpiresAt: future, draftTokenRevokedAt: null }),
      "verifyDraftToken accepts a valid, unrevoked, unexpired token");
    // Normal path: revoked → MUST reject.
    assert(!svc.verifyDraftToken(token, { draftTokenHash: hash, draftTokenExpiresAt: future, draftTokenRevokedAt: new Date() }),
      "verifyDraftToken REJECTS a revoked token (autosave/read)");
    // Normal path: expired → reject.
    assert(!svc.verifyDraftToken(token, { draftTokenHash: hash, draftTokenExpiresAt: past, draftTokenRevokedAt: null }),
      "verifyDraftToken rejects an expired token");
    // Wrong token → reject.
    assert(!svc.verifyDraftToken("deadbeef".repeat(8), { draftTokenHash: hash, draftTokenExpiresAt: future, draftTokenRevokedAt: null }),
      "verifyDraftToken rejects a mismatched token");

    // Replay path: revoked is allowed (finalize sets revokedAt) → true.
    assert(svc.verifyDraftTokenForReplay(token, { draftTokenHash: hash, draftTokenExpiresAt: future }),
      "verifyDraftTokenForReplay accepts a valid (revoked-ok) token");
    // Replay path: expired MUST still be rejected.
    assert(!svc.verifyDraftTokenForReplay(token, { draftTokenHash: hash, draftTokenExpiresAt: past }),
      "verifyDraftTokenForReplay REJECTS an expired token");
    // Replay path: wrong token → reject.
    assert(!svc.verifyDraftTokenForReplay("deadbeef".repeat(8), { draftTokenHash: hash, draftTokenExpiresAt: future }),
      "verifyDraftTokenForReplay rejects a mismatched token");
  }

  console.log("\n[4] Status transition graph");
  {
    assert(svc.canTransition("draft", "in_progress"), "draft->in_progress allowed");
    assert(svc.canTransition("draft", "submitted"), "draft->submitted allowed");
    assert(svc.canTransition("in_progress", "submitted"), "in_progress->submitted allowed");
    assert(svc.canTransition("submitted", "under_review"), "submitted->under_review allowed");
    assert(svc.canTransition("under_review", "approved"), "under_review->approved allowed");
    assert(svc.canTransition("under_review", "declined"), "under_review->declined allowed");
    assert(!svc.canTransition("approved", "under_review"), "approved terminal — no reopen");
    assert(!svc.canTransition("declined", "submitted"), "declined terminal — no reopen");
    assert(!svc.canTransition("withdrawn", "submitted"), "withdrawn terminal — no reopen");
    assert(!svc.canTransition("draft", "approved"), "draft->approved NOT allowed (skip)");
  }

  console.log("\n[5] Safe projections never leak protected data");
  {
    const fakeRow: Record<string, any> = {
      id: 42, status: "submitted", esignStatus: "pending", legalBusinessName: "Acme",
      einMask: "••-•••1234",
      ein: "mpd_v1:42:...", ownerSsn: "mpd_v1:42:...", ownerDob: "mpd_v1:42:...",
      bankRoutingNumber: "mpd_v1:42:...", bankAccountNumber: "mpd_v1:42:...",
      additionalOwners: "mpd_v1:42:...",
      draftTokenHash: "abc", esignCapabilityHash: "def",
      einFingerprint: "fp", ssnFingerprint: "fp", bankAccountFingerprint: "fp",
      protectedDataMetadata: { fields: ["ein"] }, protectedDataIdempotencyKey: "k",
      finalizeIdempotencyKey: "k",
    };
    const forbidden = Array.from(svc.FORBIDDEN_PROJECTION_COLUMNS);
    for (const proj of [svc.toOperatorDto(fakeRow), svc.toUserDto(fakeRow), svc.toAutosaveDto(fakeRow)]) {
      for (const f of forbidden) {
        assert(!(f in proj), `projection excludes forbidden column ${f}`);
      }
    }
    const ack = svc.toPublicAckDto(fakeRow, "capability-plaintext");
    assert(Object.keys(ack).every(k => ["id", "status", "esignStatus", "esignCapability"].includes(k)),
      "public ack only exposes id/status/esignStatus/esignCapability");
    assert((svc.toOperatorDto(fakeRow) as any).einMask === "••-•••1234", "operator DTO retains display-safe mask");
  }

  console.log("\n[6] Idempotency semantics (structural)");
  {
    const src = read("server/services/merchant-application-service.ts");
    assert(/row\.finalizeIdempotencyKey === idempotencyKey/.test(src), "same-key returns stored ack (replay)");
    assert(/finalize_key_mismatch/.test(src), "different-key raises 409 conflict");
    assert(/isNull\(merchantApplications\.finalizeIdempotencyKey\)/.test(src), "atomic finalize guarded by null-key condition");
    assert(/eq\(merchantApplications\.stateVersion, expectedVersion\)/.test(src), "atomic finalize guarded by stateVersion");
  }

  console.log("\n[7] Protected-write ownership + outbox purity");
  {
    const src = read("server/services/merchant-application-service.ts");
    assert(/processProtectedData\(/.test(src), "service calls processProtectedData for protected writes");
    const worker = read("server/services/merchant-application-outbox-worker.ts");
    assert(/FOR UPDATE SKIP LOCKED/.test(worker), "worker uses SKIP LOCKED claim");
    assert(/backoffMs/.test(worker), "worker implements backoff");
    assert(!/ownerSsn|bankAccountNumber|\bein\b.*plaintext/.test(worker), "worker payload carries no sensitive plaintext");
  }

  console.log("\n[9] No catch-and-swallow in effect handlers");
  {
    const worker = read("server/services/merchant-application-outbox-worker.ts");
    // GHL sync propagates error
    assert(/throw new Error.*GHL sync failed/.test(worker), "ghl_sync handler propagates failure");
    // Workflow enroll propagates error when ghlContactId missing
    assert(/throw new Error.*GHL contact ID not populated/.test(worker), "workflow_enroll propagates missing ghlContactId");
    // Email handlers guard with audit evidence
    assert(/hasAuditEvidence.*approval_email\|hasAuditEvidence.*decline_email/.test(worker.replace(/\s+/g, "")) || /hasAuditEvidence/.test(worker),
      "email handlers check durable audit evidence before re-sending");
    // No bare .catch(() => {}) swallowing
    const swallowPattern = /\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/g;
    const swallowCount = (worker.match(swallowPattern) || []).length;
    assert(swallowCount === 0, `no catch-and-swallow in worker (found ${swallowCount})`);
  }

  console.log("\n[10] Split outbox rows (individually keyed)");
  {
    const svc = read("server/services/merchant-application-service.ts");
    assert(/contact_link/.test(svc), "enqueues contact_link outbox row");
    assert(/consent_record/.test(svc), "enqueues consent_record outbox row");
    assert(/ghl_sync/.test(svc), "enqueues ghl_sync outbox row");
    assert(/workflow_enroll/.test(svc), "enqueues workflow_enroll outbox row");
    assert(/risk_scan/.test(svc), "enqueues risk_scan outbox row");
    assert(/approval_email/.test(svc), "enqueues approval_email outbox row");
    assert(/decline_email/.test(svc), "enqueues decline_email outbox row");
    // Old combined row type should not be enqueued
    assert(!/enqueueOutbox.*finalize_side_effects/.test(svc), "no combined finalize_side_effects row enqueued");
    assert(!/enqueueOutbox.*status_changed/.test(svc), "no combined status_changed row enqueued");
    // Item 4: unknown/legacy event types must throw (dead-letter), never be
    // silently marked delivered.
    const worker = read("server/services/merchant-application-outbox-worker.ts");
    assert(/throw new Error\(`Unknown outbox event type/.test(worker), "worker throws (dead-letters) on unknown/legacy event type");
    assert(!/case "finalize_side_effects":\s*\n\s*case "status_changed":\s*\n\s*return;/.test(worker), "legacy combined events no longer silently return delivered");
  }

  console.log("\n[3b] scrubError BEHAVIOR — never leaks arbitrary message");
  {
    const { __test__ } = await import("../server/services/merchant-application-outbox-worker");
    const { __test__: bt } = await import("../server/services/deal-boarding-outbox-worker");
    for (const [name, scrub] of [["merchant", __test__.scrubError], ["boarding", bt.scrubError]] as const) {
      const secret = "SSN 123-45-6789 token=sk_live_abcdef provider said BOOM";
      const err = new Error(secret);
      const out = scrub(err);
      assert(!out.includes("123-45-6789") && !out.includes("sk_live") && !out.includes("BOOM"),
        `${name} scrubError never returns arbitrary error message content`);
      assert(out === "Error", `${name} scrubError returns safe class name for plain Error`);
      const coded: any = new Error(secret); coded.code = "23505"; coded.name = "DbError";
      assert(scrub(coded) === "DbError:23505", `${name} scrubError appends only allowlisted codes`);
      const unlisted: any = new Error(secret); unlisted.code = "SUPERSECRET_INTERNAL"; unlisted.name = "X";
      assert(scrub(unlisted) === "X", `${name} scrubError drops non-allowlisted codes`);
      assert(scrub({ raw: "provider object" }) === "NonError", `${name} scrubError never stringifies non-Error values`);
    }
  }

  console.log("\n[11] Worker stale reclaim + dead_letter + scrubbed errors");
  {
    const worker = read("server/services/merchant-application-outbox-worker.ts");
    assert(/reclaimStale/.test(worker), "worker has reclaimStale function");
    assert(/STALE_LOCK_MS/.test(worker), "worker defines STALE_LOCK_MS");
    assert(/dead_letter/.test(worker), "worker uses dead_letter for terminal failures");
    assert(/scrubError/.test(worker), "worker scrubs errors to safe class/code only");
    // scrubError must NOT pass arbitrary error.message through the audit
    // sanitizer (which only strips keys, not values). It returns an allowlist.
    assert(!/sanitizeAuditPayload/.test(worker), "worker no longer routes raw error msg through sanitizeAuditPayload");
    assert(/SAFE_ERROR_CODE_ALLOWLIST/.test(worker), "worker uses a safe error-code allowlist");
    const workerNoComments = worker.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
    assert(!/err\.message/.test(workerNoComments) && !/error\.message/.test(workerNoComments), "worker never returns raw error.message");
    assert(!/console\.error\|console\.warn\|console\.log/.test(worker.replace(/\/\/.*/g, "")), "worker uses process.stderr, not console");
    assert(/attempts < \$\{MAX_ATTEMPTS\}/.test(worker), "claim query filters attempts < MAX_ATTEMPTS");
  }

  console.log("\n[12] applyEsignDocumentState increments stateVersion + revokes on signed");
  {
    const src = read("server/services/merchant-application-service.ts");
    // Find the applyEsignDocumentState function body specifically
    const fnStart = src.indexOf("export async function applyEsignDocumentState");
    const fnEnd = src.indexOf("\nexport async function", fnStart + 1);
    const fnBody = fnStart >= 0 ? src.slice(fnStart, fnEnd > 0 ? fnEnd : undefined) : src;
    assert(/stateVersion/.test(fnBody) && /expectedVersion \+ 1/.test(fnBody), "applyEsignDocumentState increments stateVersion");
    assert(/esignCapabilityRevokedAt/.test(fnBody) && /new Date\(\)/.test(fnBody), "signed state revokes esign capability");
    assert(/eq\(merchantApplications\.stateVersion, expectedVersion\)/.test(fnBody), "applyEsignDocumentState is conditional on stateVersion");
  }

  console.log("\n[13] applyUnderwritingRiskState + relationship-extractor uses canonical writer");
  {
    const src = read("server/services/merchant-application-service.ts");
    assert(/applyUnderwritingRiskState/.test(src), "service exports applyUnderwritingRiskState");
    assert(/underwritingStatus/.test(src) && /riskNote/.test(src), "applyUnderwritingRiskState accepts underwritingStatus and riskNote");
    const extractor = read("server/services/relationship-extractor.ts");
    assert(/applyUnderwritingRiskState/.test(extractor), "relationship-extractor uses canonical applyUnderwritingRiskState");
    assert(!/\.update\(merchantApplications\)/.test(extractor) || !(/underwritingStatus/.test(extractor) && /\.update\(merchantApplications\)/.test(extractor)),
      "relationship-extractor no longer calls db.update(merchantApplications) directly for underwriting");
  }

  console.log("\n[14] Boarding submit: Idempotency-Key required, 409 without application");
  {
    const boarding = read("server/routes/boarding.ts");
    assert(/Idempotency-Key header required/.test(boarding), "boarding route requires Idempotency-Key header");
    assert(/No merchant application linked/.test(boarding), "boarding route returns 409 without linked application");
    assert(/202/.test(boarding), "boarding route returns 202 accepted");
    assert(/dealBoardingOutbox/.test(boarding), "boarding route enqueues to dealBoardingOutbox");
    assert(/startDealBoardingOutboxWorker/.test(boarding), "boarding route starts durable outbox worker");
    // Item 5: audit inside enqueue tx via auditChange(..., tx); no full key.
    assert(/auditChange\(\{[\s\S]*?\}, tx\)/.test(boarding), "boarding enqueue audit uses auditChange(..., tx) (rolls back with queue)");
    assert(/idempotencyKeyHashPrefix/.test(boarding) && !/details:\s*\{[^}]*idempotencyKey[^H]/.test(boarding),
      "boarding audit stores idempotency-key hash prefix, not the full key");
    // Item 8: broad decrypt import removed from route (moved into worker).
    assert(!/decryptProtectedFields/.test(boarding), "boarding route no longer imports broad decryptProtectedFields");
  }

  console.log("\n[6] Boarding worker: transactional post-provider commit + idempotent task");
  {
    const bw = read("server/services/deal-boarding-outbox-worker.ts");
    assert(/commitBoardingSuccess/.test(bw), "boarding worker has a single-transaction commit helper");
    assert(/db\.transaction/.test(bw), "boarding worker commits local state + audit + task in a db.transaction");
    assert(/automationKey/.test(bw) && /boarding_monitor_/.test(bw), "boarding worker uses deterministic task automationKey");
    // processorApplicationId already set → reconcile, not early-return.
    assert(/if \(deal\.processorApplicationId\)/.test(bw) && /commitBoardingSuccess\(/.test(bw),
      "already-submitted path reconciles missing audit/task instead of early-return");
    assert(/boardingStatus: "dead_letter"/.test(bw), "terminal dead-letter sets deal.boardingStatus='dead_letter' transactionally");
    const bwNoComments = bw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
    assert(!/err\.message/.test(bwNoComments) && /SAFE_ERROR_CODE_ALLOWLIST/.test(bw), "boarding worker scrubError uses safe allowlist");
  }

  console.log("\n[9] E-sign send-state routed through canonical helper");
  {
    const svcSrc = read("server/services/merchant-application-service.ts");
    assert(/export async function applyEsignSendState/.test(svcSrc), "service exports canonical applyEsignSendState");
    const fnStart = svcSrc.indexOf("export async function applyEsignSendState");
    const fnEnd = svcSrc.indexOf("\nexport async function", fnStart + 1);
    const fnBody = fnStart >= 0 ? svcSrc.slice(fnStart, fnEnd > 0 ? fnEnd : undefined) : "";
    assert(/stateVersion/.test(fnBody) && /expectedVersion \+ 1/.test(fnBody), "applyEsignSendState increments stateVersion (conditional)");
    const worker = read("server/services/merchant-application-outbox-worker.ts");
    const esStart = worker.indexOf("async function handleEsignSend");
    const esEnd = worker.indexOf("\n// ── Dispatch", esStart);
    const esBody = esStart >= 0 ? worker.slice(esStart, esEnd > 0 ? esEnd : undefined) : "";
    assert(/applyEsignSendState\(/.test(esBody) && !/db\.update\(merchantApplications\).*esignSendState/.test(esBody.replace(/\s+/g, " ")),
      "e-sign worker routes send-state changes through applyEsignSendState, not raw db.update");
  }

  console.log("\n[15] POST /api/merchant-applications gated to isAdminOrManager");
  {
    const routes = read("server/routes/merchants.ts");
    assert(/app\.post\("\/api\/merchant-applications", isAdminOrManager/.test(routes), "POST /api/merchant-applications requires isAdminOrManager");
  }

  console.log("\n[16] Client: no-draft fallback creates draft then finalizes (no operator POST)");
  {
    const client = read("client/src/pages/MerchantApplication.tsx");
    assert(!/apiRequest.*POST.*\/api\/merchant-applications/.test(client.replace(/\s+/g, "")), "client does not call legacy operator POST");
    assert(/\/api\/merchant-applications\/draft/.test(client), "client creates draft via /draft endpoint as fallback");
    assert(/Idempotency-Key.*finalizeIdempotencyKey/.test(client.replace(/\s+/g, "")), "client sends Idempotency-Key header on finalize");
  }

  console.log("\n[17] EIN unique index in migration + schema");
  {
    const migration = read("migrations/0143_merchant_application_ein_unique.sql");
    assert(/CREATE UNIQUE INDEX/.test(migration), "migration creates UNIQUE index");
    assert(/ein_fingerprint/.test(migration), "unique index is on ein_fingerprint");
    const schema = read("shared/schema.ts");
    assert(/uniqueIndex.*merchant_applications_ein_fingerprint_unique_idx/.test(schema.replace(/\s+/g, "")), "schema uses uniqueIndex for EIN fingerprint");
    // Item 1: 0143 registered in the drizzle journal (idx 146, above 0142).
    const journal = JSON.parse(read("migrations/meta/_journal.json"));
    const entry = journal.entries.find((e: any) => e.tag === "0143_merchant_application_ein_unique");
    assert(!!entry, "0143 migration registered in _journal.json");
    assert(entry && entry.idx === 146, "0143 journal idx is 146");
    assert(entry && entry.when === 1792600000000, "0143 journal when is above 0142 high-water");
  }
}

// ── 18. Integration-boundary hardening (source guards) ──────────────────────
console.log("\n[18] Integration-boundary hardening");
{
  // ── 18a. merchant-protected-data: object additionalOwners rejection +
  //         exact system purpose ──────────────────────────────────────────
  const mpd = read("server/services/merchant-protected-data.ts");
  assert(/must be a string mpd_v1 envelope/.test(mpd),
    "decryptProtectedFields rejects legacy JSON object/array additionalOwners");
  assert(!/result\.additionalOwners = raw;/.test(mpd),
    "decryptProtectedFields no longer passes object additionalOwners through as-is");
  assert(/BOARDING_PROCESSOR_SUBMISSION_PURPOSE = "boarding_processor_submission"/.test(mpd),
    "exact boarding purpose constant defined");
  const mpdCollapsed = mpd.replace(/\s+/g, "");
  assert(/role==="system"&&purpose===BOARDING_PROCESSOR_SUBMISSION_PURPOSE/.test(mpdCollapsed),
    "system role gated to EXACT boarding_processor_submission purpose");
  assert(/isPrivilegedUser=role==="admin"\|\|role==="manager"/.test(mpdCollapsed),
    "admin/manager remain privileged");

  // ── 18b. merchant-application-status: least-privilege DTO, no full row,
  //         no recipient/provider logging, no audit, truthful result ───────
  const status = read("server/services/merchant-application-status.ts");
  const statusCode = status.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  assert(!/MerchantApplication/.test(statusCode),
    "status helper never references MerchantApplication type in code (least-privilege DTO only)");
  assert(/ApplicationStatusEmailInput/.test(status),
    "status helper defines explicit least-privilege email DTO");
  assert(/status: "sent"/.test(status) && /status: "skipped"/.test(status),
    "status helper returns a truthful discriminated (sent/skipped) result");
  assert(/"no_recipient"/.test(status) && /"no_ghl_contact"/.test(status),
    "status helper enumerates explicit skip reasons");
  assert(!/createAuditLog/.test(status), "status helper performs NO audit writes");
  const statusNoComments = status.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  assert(!/console\.(log|warn|error)/.test(statusNoComments),
    "status helper logs NOTHING (no recipient/provider ids, no error bodies)");
  assert(!/catch\s*\(/.test(statusNoComments),
    "status helper does not catch/swallow — transient failures propagate");

  // ── 18c. outbox worker: safe-field email query + distinct sent/skipped
  //         evidence ─────────────────────────────────────────────────────
  const worker = read("server/services/merchant-application-outbox-worker.ts");
  assert(/loadStatusEmailInput/.test(worker), "worker projects explicit safe email fields via loadStatusEmailInput");
  assert(!/db\.select\(\)\.from\(merchantApplications\)[\s\S]*sendApplicationApprovedEmail/.test(worker),
    "email handlers do not select the full application row");
  const emailInputProj = worker.slice(worker.indexOf("async function loadStatusEmailInput"), worker.indexOf("async function handleApprovalEmail"));
  for (const forbidden of ["ownerSsn", "einFingerprint", "ssnFingerprint", "bankAccountFingerprint", "einMask", "draftTokenHash", "esignCapabilityHash", "bankAccountNumber", "bankRoutingNumber"]) {
    assert(!new RegExp(`merchantApplications\\.${forbidden}\\b`).test(emailInputProj),
      `email projection excludes ${forbidden}`);
  }
  assert(/merchant_application_approved_email_sent/.test(worker) && /merchant_application_approved_email_skipped/.test(worker),
    "approval email writes distinct *_email_sent and *_email_skipped evidence");
  assert(/merchant_application_declined_email_sent/.test(worker) && /merchant_application_declined_email_skipped/.test(worker),
    "decline email writes distinct *_email_sent and *_email_skipped evidence");
  const workerCollapsed = worker.replace(/\s+/g, "");
  assert(/if\(result\.status==="sent"\)\{[\s\S]*?merchant_application_approved_email_sent/.test(workerCollapsed),
    "*_email_sent evidence written ONLY when result.status==='sent'");

  // ── 18d. ghl-form-sync: explicit projection, masks only, safe generic
  //         errors ───────────────────────────────────────────────────────
  const ghl = read("server/services/ghl-form-sync.ts");
  const syncFn = ghl.slice(ghl.indexOf("export async function syncMerchantApplicationToGhl"), ghl.indexOf("export async function syncStatementUploadToGhl"));
  assert(!/storage\.getMerchantApplication\(/.test(syncFn),
    "syncMerchantApplicationToGhl no longer loads the full application row");
  assert(/db[\s\S]{0,20}\.select\(\{/.test(syncFn),
    "syncMerchantApplicationToGhl uses an explicit db projection");
  for (const forbidden of ["merchantApplications.ein\\b", "merchantApplications.ownerSsn", "merchantApplications.ownerDob", "merchantApplications.bankAccountNumber", "merchantApplications.bankRoutingNumber", "merchantApplications.einFingerprint", "merchantApplications.additionalOwners"]) {
    assert(!new RegExp(forbidden).test(syncFn), `ghl merchant projection excludes ${forbidden}`);
  }
  assert(/merchantApplications\.einMask/.test(syncFn), "ghl projection includes persisted einMask (display-safe)");
  assert(/merchant_app_sync_failed/.test(syncFn), "ghl merchant sync returns a safe generic error code");
  const syncFnNoComments = syncFn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  assert(!/err\.message/.test(syncFnNoComments), "ghl merchant sync never logs/returns raw err.message");
  assert(!/ghlContactId=\$\{ghlContactId\}/.test(syncFnNoComments), "ghl merchant sync opportunity error omits contact ids");

  // ── 18e. relationship-extractor: explicit projection, no ciphertext ─────
  const rel = read("server/services/relationship-extractor.ts");
  assert((rel.match(/MERCHANT_APP_MATCH_PROJECTION/g) || []).length >= 4,
    "relationship-extractor uses explicit match projection in single + batch paths");
  const relProjBlocks = rel.match(/MERCHANT_APP_MATCH_PROJECTION = \{[\s\S]*?\};/g) || [];
  assert(relProjBlocks.length >= 2, "both single and batch paths define the projection");
  for (const block of relProjBlocks) {
    assert(/contactId:/.test(block) && /ownerFirstName:/.test(block) && /ownerLastName:/.test(block) && /einFingerprint:/.test(block),
      "projection contains exactly contactId/ownerFirstName/ownerLastName/einFingerprint");
    for (const forbidden of ["ssnFingerprint", "bankAccountFingerprint", "ownerSsn", "bankAccountNumber", "additionalOwners", "einMask"]) {
      assert(!new RegExp(`${forbidden}:`).test(block) && !new RegExp(`merchantApplications\\.${forbidden}\\b`).test(block),
        `relationship projection excludes ${forbidden}`);
    }
  }
  assert(!/\.select\(\)\s*\n?\s*\.from\(merchantApplications\)/.test(rel),
    "relationship-extractor never selects full merchantApplications rows");

  // ── 18f. Provider adapters: no raw error bodies / provider payloads ─────
  const nmi = read("server/services/processors/nmi.adapter.ts");
  const nmiBoard = nmi.slice(nmi.indexOf("async boardMerchant"), nmi.indexOf("async getMerchantStatus"));
  assert(!/errBody/.test(nmiBoard), "nmi boardMerchant never logs raw errBody");
  assert(!/err\.message/.test(nmiBoard), "nmi boardMerchant never logs/returns exception message");
  assert(/HTTP \$\{resp\.status\}/.test(nmiBoard), "nmi boardMerchant logs status code only");

  const payarc = read("server/services/processors/payarc.adapter.ts");
  const payarcBoard = payarc.slice(payarc.indexOf("async boardMerchant"), payarc.indexOf("// ── getMerchantStatus"));
  assert(!/err\.message/.test(payarcBoard), "payarc boardMerchant never logs/returns exception message");
  assert(!/console\.error\([^)]*msg/.test(payarcBoard), "payarc boardMerchant never logs provider message");
  assert(!/no application ID in response", data\)/.test(payarcBoard), "payarc boardMerchant never logs raw provider response body");
  assert(/Payarc API error \(\$\{status\}\)/.test(payarcBoard), "payarc boardMerchant returns status-based error");
  assert(!/Payarc API error \(\$\{status\}\): \$\{msg\}/.test(payarcBoard), "payarc boardMerchant error omits provider msg");
  const payarcRetry = payarc.slice(payarc.indexOf("async function payarcRequest"), payarc.indexOf("export class PayarcProcessorAdapter"));
  assert(!/retrying after error: \$\{err\.message\}/.test(payarcRetry), "payarc retry log never includes raw err.message");

  // Mock adapter: boardMerchant may log only deal/application ids, never profile.
  const mock = read("server/services/processors/mock.adapter.ts");
  const mockBoard = mock.slice(mock.indexOf("async boardMerchant"), mock.indexOf("async getMerchantStatus"));
  assert(/profile\.dealId/.test(mockBoard), "mock boardMerchant logs deal id");
  for (const profileField of ["ownerSsn", "ein", "ownerEmail", "legalBusinessName", "bankAccountNumber", "ownerDob"]) {
    assert(!new RegExp(`profile\\.${profileField}\\b`).test(mockBoard),
      `mock boardMerchant never logs profile.${profileField}`);
  }
}

// ── 19. Browser local-storage scrub covers additionalOwners ─────────────────
console.log("\n[19] Browser local-storage scrub covers additionalOwners");
{
  const client = read("client/src/pages/MerchantApplication.tsx");
  const sensitiveList = client.match(/const SENSITIVE_DRAFT_KEYS = \[([\s\S]*?)\];/)?.[1] ?? "";
  assert(/["']additionalOwners["']/.test(sensitiveList),
    "SENSITIVE_DRAFT_KEYS includes camelCase additionalOwners");
  assert(/["']additional_owners["']/.test(sensitiveList),
    "SENSITIVE_DRAFT_KEYS includes snake_case additional_owners (legacy)");
  // Verify all original protected keys are still present.
  for (const key of ["ein", "ownerDob", "ownerSsn", "bankRoutingNumber", "bankAccountNumber", "owner", "owners"]) {
    assert(new RegExp(`["']${key}["']`).test(sensitiveList),
      `SENSITIVE_DRAFT_KEYS still includes ${key}`);
  }
}

// ── 20. Boarding route: atomic conditional claim + stable provider key ───────
console.log("\n[20] Boarding route: atomic conditional claim + stable providerIdempotencyKey + cross-deal isolation");
{
  const boarding = read("server/routes/boarding.ts");
  // Conditional UPDATE must restrict to eligible boarding statuses.
  assert(/boarding_status IN \('not_submitted', 'declined', 'dead_letter'\)/.test(boarding),
    "boarding UPDATE is conditional on eligible statuses");
  // Must check affected rows (RETURNING id) and handle the 0-row case.
  assert(/RETURNING id/.test(boarding), "boarding UPDATE uses RETURNING id to detect race");
  assert(/updated\.rows.*\.length\s*===\s*0/.test(boarding),
    "boarding checks for 0 affected rows after conditional UPDATE");
  assert(/claimed = false/.test(boarding) || /!claimed/.test(boarding),
    "boarding returns 409 when claim fails (another request won the race)");
  // Stable provider idempotency key derived and stored in outbox payload.
  assert(/providerIdempotencyKey/.test(boarding),
    "boarding derives providerIdempotencyKey at enqueue time");
  assert(/payload.*providerIdempotencyKey/.test(boarding.replace(/\s+/g, "")),
    "boarding stores providerIdempotencyKey in outbox payload");
  // Worker must extract and forward the key to the adapter.
  const worker = read("server/services/deal-boarding-outbox-worker.ts");
  assert(/providerIdempotencyKey.*row\.payload/.test(worker.replace(/\s+/g, "")),
    "boarding worker extracts providerIdempotencyKey from outbox payload");
  assert(/providerIdempotencyKey/.test(worker),
    "boarding worker forwards providerIdempotencyKey in the profile to the adapter");
  // IProcessorAdapter interface declares the field.
  const iface = read("server/services/processors/IProcessorAdapter.ts");
  assert(/providerIdempotencyKey\?:/.test(iface),
    "MerchantProfile declares optional providerIdempotencyKey field");

  // ── Cross-deal application isolation (route) ────────────────────────────
  // The boarding route must NOT use contact_id as a fallback to find an
  // application — that would allow a deal with no own application to select
  // and submit another deal's application, disclosing protected data.
  const boardingRoute = read("server/routes/boarding.ts");
  const submitFn = boardingRoute.slice(
    boardingRoute.indexOf("app.post(\"/api/deals/:id/submit-to-processor\""),
    boardingRoute.indexOf("app.post(\"/api/deals/:id/refresh-boarding-status\""),
  );
  assert(!/merchantApplications\.contactId/.test(submitFn),
    "boarding application lookup does NOT fall back to contact_id (prevents cross-deal PII disclosure)");
  assert(!/ or\(/.test(submitFn) && !/\.where\(.*conditions\.length === 1/.test(submitFn),
    "boarding application lookup does NOT use OR-conditions (single explicit deal_id match)");
  assert(/eq\(merchantApplications\.dealId,\s*dealId\)/.test(submitFn),
    "boarding application lookup requires merchantApplications.dealId === dealId (exact deal link)");

  // ── Provider adapter idempotency key forwarding ─────────────────────────
  // Both real adapters must forward providerIdempotencyKey as the standard
  // HTTP Idempotency-Key header so providers can deduplicate retries.
  const payarcSrc = read("server/services/processors/payarc.adapter.ts");
  const payarcBoard2 = payarcSrc.slice(payarcSrc.indexOf("async boardMerchant"), payarcSrc.indexOf("// ── getMerchantStatus"));
  assert(/"Idempotency-Key"/.test(payarcBoard2),
    "payarc boardMerchant sends Idempotency-Key header");
  assert(/profile\.providerIdempotencyKey/.test(payarcBoard2),
    "payarc boardMerchant sources Idempotency-Key from profile.providerIdempotencyKey");
  // Must pass the extra headers into the payarcRequest helper (not just build them and discard).
  assert(/payarcRequest[\s\S]{0,300}idempotencyHeaders/.test(payarcBoard2.replace(/\s+/g, " ")),
    "payarc boardMerchant passes idempotencyHeaders into payarcRequest");

  const nmiSrc = read("server/services/processors/nmi.adapter.ts");
  const nmiBoard2 = nmiSrc.slice(nmiSrc.indexOf("async boardMerchant"), nmiSrc.indexOf("async getMerchantStatus"));
  assert(/"Idempotency-Key"/.test(nmiBoard2),
    "nmi boardMerchant sends Idempotency-Key header");
  assert(/profile\.providerIdempotencyKey/.test(nmiBoard2),
    "nmi boardMerchant sources Idempotency-Key from profile.providerIdempotencyKey");
  assert(/\.\.\.idempotencyHeaders/.test(nmiBoard2),
    "nmi boardMerchant spreads idempotencyHeaders into fetch headers");

  // ── Cross-deal application isolation (worker — immutable version snapshot) ─
  // The worker uses an immutable version-checked snapshot: the enqueue route
  // captures the application's updatedAt inside the atomic deal-claim
  // transaction (FOR UPDATE) and stores it as applicationLinkageVersion in the
  // outbox payload.  The worker verifies that version before any decryption.
  const boardingWorker = read("server/services/deal-boarding-outbox-worker.ts");
  assert(/applicationLinkageVersion/.test(boardingWorker),
    "boarding worker reads applicationLinkageVersion from outbox payload");
  assert(/AND deal_id =/.test(boardingWorker.replace(/\s+/g, " ")),
    "boarding worker verifies deal_id linkage in the version check query");
  assert(/updated_at.*applicationLinkageVersion/.test(boardingWorker.replace(/\s+/g, " ")),
    "boarding worker compares updated_at to stored linkage version (version-check)");
  assert(/Cross-deal linkage mismatch|stale version/.test(boardingWorker),
    "boarding worker dead-letters on version mismatch / re-link without decrypting");
  // Decrypt must come AFTER the version check, never before.
  const linkageCheckPosW = boardingWorker.indexOf("applicationLinkageVersion missing");
  const decryptPosW = boardingWorker.indexOf("decryptProtectedFields(");
  assert(linkageCheckPosW > 0 && linkageCheckPosW < decryptPosW,
    "boarding worker verifies linkage version BEFORE calling decryptProtectedFields");

  // ── Enqueue-time version capture (route) ─────────────────────────────────
  // The boarding route must capture the application's updatedAt version inside
  // its atomic transaction (FOR UPDATE) and store it in the outbox payload.
  assert(/applicationLinkageVersion/.test(boardingRoute),
    "boarding route stores applicationLinkageVersion in outbox payload at enqueue time");
  assert(/FOR UPDATE/.test(boardingRoute),
    "boarding route uses FOR UPDATE inside atomic transaction to capture linkage version");
  const payloadBlock = boardingRoute.slice(
    boardingRoute.lastIndexOf("payload:"),
    boardingRoute.lastIndexOf("payload:") + 400,
  );
  assert(/applicationLinkageVersion/.test(payloadBlock),
    "boardingOutbox payload includes applicationLinkageVersion from the locked snapshot");
}

serviceAssertions()
  .then(() => {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`Passed: ${passed}  Failed: ${failures}`);
    if (failures > 0) {
      console.error("SECURITY ASSERTIONS FAILED");
      process.exit(1);
    }
    console.log("ALL SECURITY ASSERTIONS PASSED");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test harness error:", err);
    process.exit(1);
  });
