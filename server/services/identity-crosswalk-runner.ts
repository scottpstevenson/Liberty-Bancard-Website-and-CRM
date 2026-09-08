/**
 * Identity Crosswalk Runner — admin-triggered, read-only evidence sweep.
 *
 * Safety guarantees:
 *  - Zero external provider calls
 *  - Zero writes to contacts, businesses, deals, prospects, sunbiz_entities
 *  - BACKGROUND_JOB_PROFILE must be 'off' to start a run
 *  - All fingerprints are HMAC digests; no raw PII stored in evidence rows
 *
 * Single-run ownership:
 *  - identity_runs_one_active partial unique index enforces at most one row
 *    in status IN ('pending','running','paused') globally.
 *  - Lease owner/expires pattern mirrors census runner exactly.
 *
 * Frozen membership:
 *  - All watermarks and denominators are captured atomically in the POST /runs
 *    transaction. The runner loads them from the run row; never recaptures.
 *  - Contacts with id > frozen_contacts_max_id are never touched.
 *
 * Pagination:
 *  - sunbiz/prospects: WHERE id > $cursor AND id <= $frozen_max ORDER BY id
 *  - master_leads: WHERE (created_at, id) > ($cursor_ts, $cursor_uuid)
 *                   AND (created_at, id) <= ($frozen_ts, $frozen_uuid)
 *                  ORDER BY created_at, id
 *
 * Evidence rules:
 *  - FK chain (sunbiz→prospect→contact): EXPLICIT_LINK, tier 1
 *  - Filing number exact match: DETERMINISTIC_MATCH, tier 2 — deferred to Gen-2
 *    (filing_number via businesses deferred: businesses table has no filing_number column)
 *  - Exact normalized email (requires positive provider-readiness via
 *    decideMarketingEmailValidation — active/unvalidated/stale/mismatched produce
 *    only weak evidence at tier 7, never deterministic): DETERMINISTIC_MATCH, tier 3
 *  - Company + domain: AMBIGUOUS_MATCH, tier 4
 *  - Company + phone: AMBIGUOUS_MATCH, tier 5
 *  - Company + address (street+city+state): AMBIGUOUS_MATCH, tier 6
 *  - Company name alone: INSUFFICIENT_EVIDENCE, tier 7 (never deterministic)
 *  - Phone alone / unvalidated email alone: INSUFFICIENT_EVIDENCE, tier 7
 *  - Two signals from same root_source count as ONE for confidence
 *  - Two sources needed for STRONG_REVIEW_CANDIDATE: different providers AND root_sources
 *  - Ambiguous email (>1 contact matches): write AMBIGUOUS_MATCH per candidate, not
 *    INSUFFICIENT_EVIDENCE — preserves all candidates for review
 *
 * Atomicity:
 *  - Cursor advancement and evidence inserts commit in a SINGLE transaction.
 *    If the CAS cursor update returns 0 rows (lease superseded) the entire
 *    batch is rolled back, preventing orphaned evidence with a stale cursor.
 */

import crypto from "crypto";
import os from "os";
import type { PoolClient } from 'pg';
import { pool } from "../db";
import { decideMarketingEmailValidation, hashEmailToken } from "./provider-readiness-decision";
import { resolveCanonicalVertical } from "./sdr/canonical-vertical-resolver";
import type { VerticalResolutionInput } from "./sdr/canonical-vertical-resolver";
import { normalizeBusinessName as normalizeBusinessNameCanonical, normalizeDomain } from "./sdr/dedupe";

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────
export const RULES_VERSION = "gen1-2.0.0";
const BATCH_SIZE = 500;
const BATCH_TIMEOUT_MS = 30_000;
const POOL_PRESSURE_SLEEP_MS = 5_000;
const LEASE_DURATION_SECS = 120;
const LEASE_REFRESH_EVERY_N = 10;

// ──────────────────────────────────────────────────────────────────────────────
// Lease owner tag
// ──────────────────────────────────────────────────────────────────────────────
/**
 * Returns a unique claim token for this invocation.  Including a UUID means
 * that even if the same process re-invokes executeIdentityRun (e.g. pause →
 * resume in the same PID), the resumed invocation gets a different token and
 * the old worker's CAS cursor updates will find 0 matching rows and abort.
 */
export function leaseOwnerTag(): string {
  return `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// HMAC fingerprint (versioned; no raw PII stored)
// ──────────────────────────────────────────────────────────────────────────────
function hmacFingerprint(data: string): string {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "[CrosswalkRunner] CREDENTIAL_ENCRYPTION_KEY is required for HMAC fingerprinting. " +
      "Refusing to store predictably-keyed PII digests.",
    );
  }
  return "v1:" + crypto.createHmac("sha256", key).update(data).digest("hex");
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.trim().toLowerCase();
}

function normalizeCompany(name: string | null | undefined): string | null {
  if (!name) return null;
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Extract registrable domain from an email address (part after @). */
function extractEmailDomain(normalizedEmail: string | null): string | null {
  if (!normalizedEmail) return null;
  const idx = normalizedEmail.indexOf("@");
  if (idx < 0) return null;
  const domain = normalizedEmail.slice(idx + 1).toLowerCase().trim();
  return domain.length > 0 ? domain : null;
}

/**
 * Free-mail domains that must NEVER be used for company+domain matching.
 * Matching contacts by a gmail.com or yahoo.com domain shared with a business entity
 * would create massive false positives across unrelated people.
 */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
  "aol.com", "icloud.com", "me.com", "msn.com", "comcast.net",
  "sbcglobal.net", "verizon.net", "att.net", "bellsouth.net",
  "protonmail.com", "proton.me", "mail.com", "zoho.com", "yandex.com",
]);

function isFreeMail(domain: string | null): boolean {
  return domain !== null && FREE_MAIL_DOMAINS.has(domain.toLowerCase());
}

// ──────────────────────────────────────────────────────────────────────────────
// Pool metrics
// ──────────────────────────────────────────────────────────────────────────────
function poolWaitingCount(): number {
  return (pool as any).waitingCount ?? 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Lease refresh
// ──────────────────────────────────────────────────────────────────────────────
async function refreshLease(runId: string, owner: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE contact_identity_reconciliation_runs
     SET lease_expires_at = now() + interval '${LEASE_DURATION_SECS} seconds', updated_at = now()
     WHERE id = $1 AND lease_owner = $2 AND status = 'running'`,
    [runId, owner],
  );
  return (r.rowCount ?? 0) > 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// CAS-protected status check
// ──────────────────────────────────────────────────────────────────────────────
async function getRunStatus(runId: string): Promise<{ status: string; leaseOwner: string | null } | null> {
  const r = await pool.query(
    `SELECT status, lease_owner FROM contact_identity_reconciliation_runs WHERE id = $1`,
    [runId],
  );
  if (r.rows.length === 0) return null;
  return { status: r.rows[0].status, leaseOwner: r.rows[0].lease_owner };
}

// ──────────────────────────────────────────────────────────────────────────────
// Pause a run
// ──────────────────────────────────────────────────────────────────────────────
async function pauseRun(runId: string, owner: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE contact_identity_reconciliation_runs
     SET status = 'paused', pause_reason = $3,
         pool_waiting_count_at_checkpoint = $4, updated_at = now()
     WHERE id = $1 AND lease_owner = $2 AND status = 'running'`,
    [runId, owner, reason, poolWaitingCount()],
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Evidence class from tier + signal count
// ──────────────────────────────────────────────────────────────────────────────
type EvidenceClass =
  | "EXPLICIT_LINK"
  | "DETERMINISTIC_MATCH"
  | "STRONG_REVIEW_CANDIDATE"
  | "AMBIGUOUS_MATCH"
  | "SOURCE_CONFLICT"
  | "INSUFFICIENT_EVIDENCE";

/**
 * Classify evidence given the best signal tier and the number of DISTINCT root sources
 * that corroborate the same candidate. STRONG_REVIEW_CANDIDATE requires signals from
 * at least 2 independent root sources (different source tables or different source rows).
 *
 * Gen-1 processes one source row at a time (distinctRootSources = 1 always), so
 * STRONG_REVIEW_CANDIDATE is unreachable in this generation. This is intentional — do
 * not substitute providers.length; that would count signals from the same root source
 * and falsely elevate evidence class.
 */
function classifyEvidence(
  minTier: number,
  distinctRootSources: number,
  conflicting: boolean,
): EvidenceClass {
  if (conflicting) return "SOURCE_CONFLICT";
  if (minTier === 1) return "EXPLICIT_LINK";
  if (minTier <= 3 && distinctRootSources >= 1) return "DETERMINISTIC_MATCH";
  if (minTier <= 6 && distinctRootSources >= 2) return "STRONG_REVIEW_CANDIDATE";
  if (minTier <= 6 && distinctRootSources === 1) return "AMBIGUOUS_MATCH";
  return "INSUFFICIENT_EVIDENCE";
}

// ──────────────────────────────────────────────────────────────────────────────
// CursorUpdateFn — called inside the batch transaction before COMMIT
// Returns true if the CAS update matched (lease still held); false if superseded.
// ──────────────────────────────────────────────────────────────────────────────
type CursorUpdateFn = (tx: PoolClient, processed: number, exceptions: number) => Promise<boolean>;

// ──────────────────────────────────────────────────────────────────────────────
// Process a single population batch
// Returns: { processed, exceptions, classCounts, cursorUpdated }
// cursorUpdated=false means the batch was rolled back (lease superseded).
// ──────────────────────────────────────────────────────────────────────────────
interface BatchSourceRow {
  id: number | string;
  entity_name?: string | null;
  owner_email?: string | null;
  email?: string | null;
  phone?: string | null;
  owner_phone?: string | null;
  filing_number?: string | null;
  vertical?: string | null;
  prospect_id?: number | null;
  contact_id?: number | null;
  business_id?: number | null;
  // sunbiz_entities address fields
  principal_address?: string | null;
  principal_city?: string | null;
  principal_state?: string | null;
  // prospects
  sunbiz_entity_id?: number | null;
  website?: string | null;        // prospects: explicit website URL
  // master_leads
  created_at?: string | Date | null;
  domain?: string | null;         // master_leads: pre-normalized domain field
}

// ──────────────────────────────────────────────────────────────────────────────
// Vertical candidate writer — calls resolveCanonicalVertical for real output
// ──────────────────────────────────────────────────────────────────────────────
async function insertVerticalCandidate(
  tx: PoolClient,
  runId: string,
  contactId: number,
  sourceTable: string,
  sourceId: string,
  sourceVertical: string,
): Promise<void> {
  // Fetch the contact's current vertical classification fields
  const contactR = await tx.query(
    `SELECT vertical, vertical_source, vertical_confidence, manual_vertical_override
     FROM contacts WHERE id = $1`,
    [contactId],
  );
  const c = contactR.rows[0];
  if (!c) return; // contact not found (outside frozen window) — skip silently

  const resolverInput: VerticalResolutionInput = {
    // Contact side (existing classification)
    contactVertical: c.vertical ?? null,
    contactVerticalSource: c.vertical_source ?? null,
    contactVerticalConfidence: c.vertical_confidence ?? null,
    contactManualOverride: c.manual_vertical_override ?? null,
    // Source side (proposed new value from sunbiz/prospect/master_lead)
    merchantVertical: sourceVertical,
    merchantVerticalSource: "import_classification",
    merchantVerticalConfidence: 50,
    merchantManualOverride: false,
  };
  const resolverOutput = resolveCanonicalVertical(resolverInput);

  const currentVertical = c.vertical ?? null;
  const conflictState = !currentVertical ? "proposed_upgrade"
    : currentVertical === resolverOutput.vertical ? "agree"
    : "proposed_change";

  // Only write when there is something to say (skip if resolver produces null with no existing)
  if (!resolverOutput.vertical && !currentVertical && !sourceVertical) return;

  await tx.query(
    `INSERT INTO contact_vertical_candidates
       (run_id, contact_id, source_table, source_id, source_vertical,
        current_contact_vertical, conflict_state, resolver_input, resolver_output)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [runId, contactId, sourceTable, sourceId, sourceVertical,
     currentVertical, conflictState,
     JSON.stringify(resolverInput), JSON.stringify(resolverOutput)],
  );
}

async function processBatch(
  runId: string,
  owner: string,
  frozenContactsMaxId: bigint,
  frozenBusinessesMaxId: bigint,
  sourceRows: BatchSourceRow[],
  sourceTable: string,
  cursorUpdateFn: CursorUpdateFn,
): Promise<{ processed: number; exceptions: number; classCounts: Record<string, number>; cursorUpdated: boolean }> {
  // ── Systemic configuration preflight ────────────────────────────────────
  // hmacFingerprint requires CREDENTIAL_ENCRYPTION_KEY. If the key is missing,
  // every row in the loop would throw, be counted as an exception, and the cursor
  // would still advance — producing a run that marks 'completed' with 0 useful
  // evidence. Validate the key before opening the transaction so the error
  // propagates to the lifecycle handler, which marks the run 'failed'.
  hmacFingerprint("_preflight_check_");

  let processed = 0;
  let exceptions = 0;
  const classCounts: Record<string, number> = {};

  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");

    for (const row of sourceRows) {
      const sourceId = String(row.id);
      const savepointName = `row_${sourceTable}_${String(sourceId).replace(/[^a-zA-Z0-9]/g, "_")}`;

      try {
        // ── Root source resolution ────────────────────────────────────────────
        let rootSourceTable = sourceTable;
        let rootSourceId = sourceId;
        let existingFkContactId: number | null = null;
        let existingFkBusinessId: number | null = null;
        const importExecutionId: string | null = null;

        if (sourceTable === "sunbiz_entities" && row.sunbiz_entity_id) {
          rootSourceTable = "sunbiz_entities";
          rootSourceId = String(row.sunbiz_entity_id);
        }

        // ── SAVEPOINT: wraps BOTH probe queries and writes ────────────────────
        // Opening the SAVEPOINT here (before any DB reads) ensures that a PostgreSQL
        // error inside a probe query (which aborts the transaction) is contained
        // within this savepoint and can be rolled back. Without this, a probe SQL
        // error would abort the batch transaction, and all subsequent SAVEPOINT
        // commands would fail with "current transaction is aborted, commands ignored".
        await tx.query(`SAVEPOINT ${savepointName}`);
        try {
          // ── FK chain traversal (read-only; within savepoint) ─────────────────
          // sunbiz → prospect (via prospect_id on sunbiz_entities) → contact
          // prospects has contact_id but no business_id column
          if (sourceTable === "sunbiz_entities" && row.prospect_id) {
            const pR = await tx.query(
              `SELECT contact_id FROM prospects WHERE id = $1`,
              [row.prospect_id],
            );
            if (pR.rows.length > 0) {
              existingFkContactId = pR.rows[0].contact_id ?? null;
            }
          } else {
            if (row.contact_id) existingFkContactId = Number(row.contact_id);
            if (row.business_id) existingFkBusinessId = Number(row.business_id);
          }

          // ── Normalize identifiers ─────────────────────────────────────────────
          const normalizedEmail = normalizeEmail(row.email);
          const normalizedOwnerEmail = normalizeEmail(row.owner_email);
          const sourceCompany = normalizeCompany(row.entity_name);
          // Canonical business-name normalization (matches businesses.normalized_name column,
          // which was written by the same normalizeBusinessName function from sdr/dedupe).
          // Strips legal suffixes (LLC, Inc, Corp…) and punctuation before DB comparison.
          const sourceBusinessName = row.entity_name
            ? normalizeBusinessNameCanonical(row.entity_name)
            : null;
          const rawPhone = row.phone ? row.phone.replace(/\D/g, "") : null;
          const rawOwnerPhone = row.owner_phone ? row.owner_phone.replace(/\D/g, "") : null;
          const sourceVertical = row.vertical ?? null;

          // Unique email addresses to probe (probe each independently)
          const emailsToProbe = new Set<string>();
          if (normalizedEmail) emailsToProbe.add(normalizedEmail);
          if (normalizedOwnerEmail && normalizedOwnerEmail !== normalizedEmail) {
            emailsToProbe.add(normalizedOwnerEmail);
          }

          // Unique phone digits to probe (probe each independently)
          const phonesToProbe = new Set<string>();
          if (rawPhone && rawPhone.length >= 10) phonesToProbe.add(rawPhone);
          if (rawOwnerPhone && rawOwnerPhone.length >= 10 && rawOwnerPhone !== rawPhone) {
            phonesToProbe.add(rawOwnerPhone);
          }

          // Domain for company+domain matching (tier 4 contact) and business website probe.
          // Priority: explicit website/domain field on the row > email-derived domain.
          // NEVER use free-mail provider domains (gmail.com, yahoo.com…) — these are personal
          // addresses unrelated to the business and would create false positives across
          // thousands of unrelated contacts.
          const explicitWebsiteDomain: string | null =
            row.website ? normalizeDomain(row.website)     // prospects
            : row.domain ? normalizeDomain(row.domain)    // master_leads
            : null;
          // Try primary email domain; if free-mail, try owner email domain independently.
          // This ensures a corporate owner-email domain is used even when the primary email
          // is gmail.com — the independent-probe model requires independent domain checks too.
          const primaryEmailDomain = extractEmailDomain(normalizedEmail);
          const ownerEmailDomain = extractEmailDomain(normalizedOwnerEmail);
          const emailDerivedDomain: string | null =
            (!isFreeMail(primaryEmailDomain) ? primaryEmailDomain : null) ??
            (!isFreeMail(ownerEmailDomain) ? ownerEmailDomain : null);
          // Use explicit if available; fall back to email-derived only when non-free-mail
          const sourceDomain: string | null =
            (explicitWebsiteDomain && !isFreeMail(explicitWebsiteDomain))
              ? explicitWebsiteDomain
              : emailDerivedDomain;

          // ── Skip-to-explicit check ────────────────────────────────────────────
          let skipToExplicit = false;
          let explicitContactUpdatedAt: Date | null = null;

          if (existingFkContactId && existingFkContactId <= Number(frozenContactsMaxId)) {
            const contactCheck = await tx.query(
              `SELECT id, updated_at FROM contacts
               WHERE id = $1 AND archived_at IS NULL AND record_class = 'production'`,
              [existingFkContactId],
            );
            if (contactCheck.rows.length > 0) {
              skipToExplicit = true;
              explicitContactUpdatedAt = contactCheck.rows[0].updated_at;
            }
          }

          // ── Build fingerprint ─────────────────────────────────────────────────
          const sourceFingerprint = hmacFingerprint([
            sourceTable, sourceId,
            normalizedEmail ?? normalizedOwnerEmail ?? "",
            sourceCompany ?? "",
            row.filing_number ?? "",
            rawPhone ?? rawOwnerPhone ?? "",
          ].join("|"));

          if (skipToExplicit) {
            // ── Tier 1: Explicit FK link ────────────────────────────────────────
            const subjectR = await tx.query(
              `INSERT INTO contact_identity_subjects
                 (run_id, source_table, source_id, root_source_table, root_source_id,
                  import_execution_id, existing_fk_contact_id, existing_fk_business_id,
                  disposition, candidate_count, source_fingerprint)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'MATCHED',1,$9)
               ON CONFLICT (run_id, source_table, source_id) DO NOTHING
               RETURNING id`,
              [runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
               importExecutionId, existingFkContactId, existingFkBusinessId, sourceFingerprint],
            );
            if (subjectR.rows.length > 0) {
              const subjectId = subjectR.rows[0].id;
              const candidateR = await tx.query(
                `INSERT INTO contact_identity_candidates
                   (subject_id, run_id, candidate_type, candidate_id, candidate_updated_at,
                    evidence_class, confidence_score, match_tier)
                 VALUES ($1,$2,'contact',$3,$4,'EXPLICIT_LINK',100,1)
                 RETURNING id`,
                [subjectId, runId, existingFkContactId, explicitContactUpdatedAt],
              );
              const candidateId = candidateR.rows[0].id;
              const fp = hmacFingerprint(`fk_chain|${sourceTable}|${sourceId}|${existingFkContactId}`);
              await tx.query(
                `INSERT INTO contact_identity_evidence
                   (candidate_id, run_id, root_source_table, root_source_id, evidence_provider, evidence_fingerprint)
                 VALUES ($1,$2,$3,$4,'fk_chain',$5)
                 ON CONFLICT (candidate_id, root_source_table, root_source_id, evidence_fingerprint) DO NOTHING`,
                [candidateId, runId, rootSourceTable, rootSourceId, fp],
              );
              await tx.query(
                `UPDATE contact_identity_reconciliation_runs
                 SET explicit_link_count = explicit_link_count + 1, updated_at = now() WHERE id = $1`,
                [runId],
              );
              if (sourceVertical) {
                await insertVerticalCandidate(tx, runId, existingFkContactId!, sourceTable, sourceId, sourceVertical);
              }
              classCounts["EXPLICIT_LINK"] = (classCounts["EXPLICIT_LINK"] ?? 0) + 1;
            }
            await tx.query(`RELEASE SAVEPOINT ${savepointName}`);
            processed++;
            continue;
          }

          // ── Signal map ──────────────────────────────────────────────────────
          // candidateMap: contact id → { providers, minTier }
          // businessCandidateMap: business id → { providers, minTier }
          const candidateMap = new Map<number, { providers: Array<{ provider: string; tier: number }>; minTier: number }>();
          const businessCandidateMap = new Map<number, { providers: Array<{ provider: string; tier: number }>; minTier: number }>();

          // Contacts matched by email with ambiguous result (>1 contacts share the email)
          // Each gets an AMBIGUOUS_MATCH candidate row — NOT collapsed to INSUFFICIENT_EVIDENCE.
          const ambiguousEmailCandidates: Array<{ id: number; updatedAt: Date | null }> = [];

          const addContactSignal = (cid: number, provider: string, tier: number) => {
            const ex = candidateMap.get(cid);
            if (ex) { ex.providers.push({ provider, tier }); ex.minTier = Math.min(ex.minTier, tier); }
            else candidateMap.set(cid, { providers: [{ provider, tier }], minTier: tier });
          };
          const addBusinessSignal = (bid: number, provider: string, tier: number) => {
            const ex = businessCandidateMap.get(bid);
            if (ex) { ex.providers.push({ provider, tier }); ex.minTier = Math.min(ex.minTier, tier); }
            else businessCandidateMap.set(bid, { providers: [{ provider, tier }], minTier: tier });
          };

          // ── Tier 3: Email signals ─────────────────────────────────────────────
          // Each email (primary, owner) is probed independently. Results are not
          // short-circuited: a unique match from owner_email survives even when
          // primary_email is ambiguous.
          //
          // Safety cap: LIMIT 100. In production, >100 contacts sharing an email
          // is a data-quality problem; if the cap is hit the ambiguous set is still
          // written as AMBIGUOUS_MATCH so an admin can investigate.
          //
          // Evidence generation: `contacts.email_mutation_generation` is the expected
          // (subject) generation stored on the contact. The *evidence* generation is
          // the `subject_generation` persisted in provider_observations for that
          // email+contact pair. Passing both the same value makes the generation
          // check tautological — so we query provider_observations for the latest
          // observation that matches the contact's current email_token_hash.
          for (const emailNorm of emailsToProbe) {
            const eR = await tx.query(
              `SELECT id, email, email_status, email_token_hash,
                      email_mutation_generation, email_validation_updated_at, updated_at
               FROM contacts
               WHERE lower(trim(email)) = $1
                 AND archived_at IS NULL AND record_class = 'production' AND id <= $2
               LIMIT 100`,
              [emailNorm, frozenContactsMaxId],
            );

            if (eR.rows.length === 0) {
              // no match for this email — continue to next probe
            } else if (eR.rows.length === 1) {
              const c = eR.rows[0];
              // Query the latest provider_observations row for this contact+email.
              // `po.subject_generation` is the evidence generation recorded at validation
              // time — distinct from `contacts.email_mutation_generation` (the subject's
              // current generation). Passing contacts.email_mutation_generation as
              // evidenceGeneration would make the generation gate tautological.
              const poR = await tx.query(
                `SELECT email_token_hash, subject_generation, outcome, observed_at
                 FROM provider_observations
                 WHERE subject_id = $1 AND subject_type = 'contact'
                   AND email_token_hash = $2
                 ORDER BY observed_at DESC LIMIT 1`,
                [c.id, c.email_token_hash],
              );
              const po = poR.rows[0] ?? null;
              const decision = decideMarketingEmailValidation(
                c.email,
                {
                  emailStatus: c.email_status,
                  emailTokenHash: c.email_token_hash,        // subject's expected hash
                  subjectGeneration: c.email_mutation_generation, // contact's current generation
                  evidenceGeneration: po ? (po.subject_generation ?? null) : null, // from provider obs
                  verifiedAt: po ? po.observed_at : (c.email_validation_updated_at ?? null),
                  providerOutcome: po ? po.outcome : null,
                },
              );
              if (decision.allowed) {
                addContactSignal(c.id, "exact_email_validated", 3);
              } else {
                // Unvalidated / stale / generation-mismatch: treat as weak tier 7 evidence.
                // This includes contacts whose email_status is 'valid' but whose provider
                // observation is absent or has a different generation (token rotation).
                addContactSignal(c.id, "exact_email_unvalidated", 7);
              }
            } else {
              // Ambiguous: multiple contacts share the same email address (within frozen window).
              // Record each as a distinct AMBIGUOUS_MATCH candidate. This does NOT prevent
              // other email probes from contributing unique matches to candidateMap — each
              // probe's results are accumulated independently.
              for (const c of eR.rows) {
                if (Number(c.id) <= Number(frozenContactsMaxId)) {
                  if (!ambiguousEmailCandidates.some(x => x.id === c.id)) {
                    ambiguousEmailCandidates.push({ id: c.id, updatedAt: c.updated_at });
                  }
                }
              }
            }
          }

          // Reconcile ambiguous email candidates against unique matches collected
          // by other email probes. A contact that arrived via an ambiguous probe but
          // was also uniquely matched by another probe is already in candidateMap and
          // does not need an AMBIGUOUS_MATCH row — remove it from the purely-ambiguous
          // set so it is handled as a normal candidate. Contacts that remain in
          // purelyAmbiguousEmailCandidates have NO unique probe path and must be written
          // as AMBIGUOUS_MATCH for admin review.
          const purelyAmbiguousEmailCandidates = ambiguousEmailCandidates.filter(
            ac => !candidateMap.has(ac.id),
          );

          // ── Tier 4: Company + domain ──────────────────────────────────────────
          // Skip only when we already have an ambiguous email set that would make
          // any extra candidate evidence redundant. Unique email matches in candidateMap
          // do NOT block these probes.
          if (sourceCompany && sourceDomain && purelyAmbiguousEmailCandidates.length === 0) {
            const cdR = await tx.query(
              `SELECT id FROM contacts
               WHERE lower(trim(company_name)) = $1
                 AND lower(trim(split_part(email, '@', 2))) = $2
                 AND archived_at IS NULL AND record_class = 'production' AND id <= $3
               LIMIT 20`,
              [sourceCompany, sourceDomain, frozenContactsMaxId],
            );
            // Only add when uniquely matched — >1 is an ambiguous tier 4, skip.
            if (cdR.rows.length === 1) {
              addContactSignal(Number(cdR.rows[0].id), "company_domain", 4);
            }
          }

          // ── Tier 5: Company + phone ───────────────────────────────────────────
          if (sourceCompany && purelyAmbiguousEmailCandidates.length === 0) {
            for (const phoneNorm of phonesToProbe) {
              const cpR = await tx.query(
                `SELECT id FROM contacts
                 WHERE lower(trim(company_name)) = $1
                   AND regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g') = $2
                   AND archived_at IS NULL AND record_class = 'production' AND id <= $3
                 LIMIT 20`,
                [sourceCompany, phoneNorm, frozenContactsMaxId],
              );
              if (cpR.rows.length === 1) {
                addContactSignal(Number(cpR.rows[0].id), "company_phone", 5);
              }
            }
          }

          // ── Tier 6: Company + address ─────────────────────────────────────────
          // Available when source row has principal_address/city/state (sunbiz_entities).
          // street + city + state = tier 6 (strong); city + state alone = tier 7 (weak).
          if (sourceCompany && purelyAmbiguousEmailCandidates.length === 0) {
            const srcCity = row.principal_city?.trim().toLowerCase() ?? null;
            const srcState = row.principal_state?.trim().toLowerCase() ?? null;
            const srcStreet = row.principal_address?.trim().toLowerCase() ?? null;

            if (srcStreet && srcCity && srcState) {
              const addrR = await tx.query(
                `SELECT id FROM contacts
                 WHERE lower(trim(company_name)) = $1
                   AND lower(trim(COALESCE(address,''))) = $2
                   AND lower(trim(COALESCE(city,''))) = $3
                   AND lower(trim(COALESCE(state,''))) = $4
                   AND archived_at IS NULL AND record_class = 'production' AND id <= $5
                 LIMIT 20`,
                [sourceCompany, srcStreet, srcCity, srcState, frozenContactsMaxId],
              );
              if (addrR.rows.length === 1) {
                addContactSignal(Number(addrR.rows[0].id), "company_address", 6);
              }
            } else if (srcCity && srcState && !srcStreet) {
              // city+state only = tier 7 weak
              const addrWeakR = await tx.query(
                `SELECT id FROM contacts
                 WHERE lower(trim(company_name)) = $1
                   AND lower(trim(COALESCE(city,''))) = $2
                   AND lower(trim(COALESCE(state,''))) = $3
                   AND archived_at IS NULL AND record_class = 'production' AND id <= $4
                 LIMIT 20`,
                [sourceCompany, srcCity, srcState, frozenContactsMaxId],
              );
              if (addrWeakR.rows.length === 1) {
                addContactSignal(Number(addrWeakR.rows[0].id), "company_city_state", 7);
              }
            }
          }

          // ── Business matching (tiers 4–7) ─────────────────────────────────────
          // Matches businesses table entries for candidate_type='business' rows.
          // frozenBusinessesMaxId=0 means businesses table is empty / not populated.
          //
          // All matching rows from each probe are accumulated in businessCandidateMap.
          // A probe returning >1 row means multiple businesses share that signal; all
          // are recorded and the later "multiple business candidates" branch writes them
          // as SOURCE_CONFLICT so an admin can resolve the ambiguity.
          // Safety cap: LIMIT 20. >20 businesses sharing an identifier is a data-quality
          // issue; cap prevents runaway scans while still recording all practical cases.
          if (frozenBusinessesMaxId > BigInt(0)) {
            // Business by website domain (tier 4)
            if (sourceDomain) {
              const bDomR = await tx.query(
                `SELECT id FROM businesses
                 WHERE website_domain = $1 AND id <= $2
                 LIMIT 20`,
                [sourceDomain, frozenBusinessesMaxId],
              );
              for (const bRow of bDomR.rows) {
                addBusinessSignal(Number(bRow.id), "business_website_domain", 4);
              }
            }

            // Business by company + phone (tier 5)
            // Uses sourceBusinessName (canonical normalizer matching businesses.normalized_name).
            if (sourceBusinessName) {
              for (const phoneNorm of phonesToProbe) {
                const bPhoneR = await tx.query(
                  `SELECT id FROM businesses
                   WHERE normalized_name = $1
                     AND regexp_replace(COALESCE(main_phone,''), '[^0-9]', '', 'g') = $2
                     AND id <= $3
                   LIMIT 20`,
                  [sourceBusinessName, phoneNorm, frozenBusinessesMaxId],
                );
                for (const bRow of bPhoneR.rows) {
                  addBusinessSignal(Number(bRow.id), "business_company_phone", 5);
                }
              }
            }

            // Business by normalized_name + city + state (tier 6)
            // Uses sourceBusinessName (canonical normalizer matching businesses.normalized_name).
            if (sourceBusinessName) {
              const srcCity = row.principal_city?.trim().toLowerCase() ?? null;
              const srcState = row.principal_state?.trim().toLowerCase() ?? null;
              if (srcCity && srcState) {
                const bAddrR = await tx.query(
                  `SELECT id FROM businesses
                   WHERE normalized_name = $1
                     AND lower(trim(COALESCE(city,''))) = $2
                     AND lower(trim(COALESCE(state,''))) = $3
                     AND id <= $4
                   LIMIT 20`,
                  [sourceBusinessName, srcCity, srcState, frozenBusinessesMaxId],
                );
                for (const bRow of bAddrR.rows) {
                  addBusinessSignal(Number(bRow.id), "business_company_city_state", 6);
                }
              }
            }

            // Business by company name alone (tier 7, weak) — only when no stronger
            // business signal found yet, to avoid redundant tier-7 entries.
            // Uses sourceBusinessName (canonical normalizer matching businesses.normalized_name).
            if (sourceBusinessName && businessCandidateMap.size === 0) {
              const bNameR = await tx.query(
                `SELECT id FROM businesses
                 WHERE normalized_name = $1 AND id <= $2
                 LIMIT 20`,
                [sourceBusinessName, frozenBusinessesMaxId],
              );
              for (const bRow of bNameR.rows) {
                addBusinessSignal(Number(bRow.id), "business_name_only", 7);
              }
            }
          }

          // ── Tier 7: Company name alone (contact) ──────────────────────────────
          // Only run when no stronger signals found and no purely-ambiguous email candidates.
          if (sourceCompany && candidateMap.size === 0 && purelyAmbiguousEmailCandidates.length === 0) {
            const coR = await tx.query(
              `SELECT id FROM contacts
               WHERE lower(trim(company_name)) = $1
                 AND archived_at IS NULL AND record_class = 'production' AND id <= $2
               LIMIT 20`,
              [sourceCompany, frozenContactsMaxId],
            );
            if (coR.rows.length === 1) {
              addContactSignal(Number(coR.rows[0].id), "company_only", 7);
            }
          }

          // ── Case: Purely-ambiguous email ───────────────────────────────────────
          // Write one AMBIGUOUS_MATCH candidate per contact that was ONLY found via an
          // ambiguous probe (>1 contacts sharing an email), with no unique match from any
          // other probe. Contacts that have a unique match via another email/phone/company
          // signal are already in candidateMap and are handled in the normal resolution path.
          //
          // When businessCandidateMap is also non-empty, we cannot write only the ambiguous
          // contact candidates and continue — that would discard valid business evidence.
          // Instead, promote the ambiguous contacts into candidateMap and fall through to
          // the combined resolution path so both contact and business candidates are written.
          if (purelyAmbiguousEmailCandidates.length > 0 && candidateMap.size === 0 && businessCandidateMap.size > 0) {
            for (const ac of purelyAmbiguousEmailCandidates) {
              addContactSignal(ac.id, "ambiguous_email", 3);
            }
            // Fall through to the combined resolution below (no continue here).
          } else if (purelyAmbiguousEmailCandidates.length > 0 && candidateMap.size === 0) {
            // Pure ambiguous email, no business candidates — write AMBIGUOUS_MATCH rows.
            const subjectR = await tx.query(
              `INSERT INTO contact_identity_subjects
                 (run_id, source_table, source_id, root_source_table, root_source_id,
                  import_execution_id, existing_fk_contact_id, existing_fk_business_id,
                  disposition, candidate_count, source_fingerprint)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'AMBIGUOUS',$9,$10)
               ON CONFLICT (run_id, source_table, source_id) DO NOTHING
               RETURNING id`,
              [runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
               importExecutionId, existingFkContactId, existingFkBusinessId,
               purelyAmbiguousEmailCandidates.length, sourceFingerprint],
            );
            if (subjectR.rows.length > 0) {
              const subjectId = subjectR.rows[0].id;
              for (const ac of purelyAmbiguousEmailCandidates) {
                const candR = await tx.query(
                  `INSERT INTO contact_identity_candidates
                     (subject_id, run_id, candidate_type, candidate_id, candidate_updated_at,
                      evidence_class, confidence_score, match_tier)
                   VALUES ($1,$2,'contact',$3,$4,'AMBIGUOUS_MATCH',35,3)
                   RETURNING id`,
                  [subjectId, runId, ac.id, ac.updatedAt],
                );
                const candId = candR.rows[0].id;
                const fp = hmacFingerprint(`ambiguous_email|${sourceTable}|${sourceId}|${ac.id}`);
                await tx.query(
                  `INSERT INTO contact_identity_evidence
                     (candidate_id, run_id, root_source_table, root_source_id, evidence_provider, evidence_fingerprint)
                   VALUES ($1,$2,$3,$4,'ambiguous_email',$5)
                   ON CONFLICT (candidate_id, root_source_table, root_source_id, evidence_fingerprint) DO NOTHING`,
                  [candId, runId, rootSourceTable, rootSourceId, fp],
                );
              }
              await tx.query(
                `UPDATE contact_identity_reconciliation_runs
                 SET ambiguous_count = ambiguous_count + 1, updated_at = now() WHERE id = $1`,
                [runId],
              );
              classCounts["AMBIGUOUS_MATCH"] = (classCounts["AMBIGUOUS_MATCH"] ?? 0) + 1;
            }
            await tx.query(`RELEASE SAVEPOINT ${savepointName}`);
            processed++;
            continue;
          }

          // When both purelyAmbiguousEmailCandidates AND candidateMap are non-empty,
          // the ambiguous contacts are additional competing candidates. Add them to
          // candidateMap so they participate in SOURCE_CONFLICT resolution.
          if (purelyAmbiguousEmailCandidates.length > 0 && candidateMap.size > 0) {
            for (const ac of purelyAmbiguousEmailCandidates) {
              addContactSignal(ac.id, "ambiguous_email", 3);
            }
          }

          // ── Build combined candidate list ────────────────────────────────────
          const contactIds = Array.from(candidateMap.keys());
          const businessIds = Array.from(businessCandidateMap.keys());

          if (contactIds.length === 0 && businessIds.length === 0) {
            // NO_MATCH
            const nmR = await tx.query(
              `INSERT INTO contact_identity_subjects
                 (run_id, source_table, source_id, root_source_table, root_source_id,
                  import_execution_id, disposition, candidate_count, source_fingerprint)
               VALUES ($1,$2,$3,$4,$5,$6,'NO_MATCH',0,$7)
               ON CONFLICT (run_id, source_table, source_id) DO NOTHING
               RETURNING id`,
              [runId, sourceTable, sourceId, rootSourceTable, rootSourceId, importExecutionId, sourceFingerprint],
            );
            if (nmR.rows.length > 0) {
              await tx.query(
                `UPDATE contact_identity_reconciliation_runs
                 SET no_match_count = no_match_count + 1, updated_at = now() WHERE id = $1`,
                [runId],
              );
              classCounts["NO_MATCH"] = (classCounts["NO_MATCH"] ?? 0) + 1;
            }
            await tx.query(`RELEASE SAVEPOINT ${savepointName}`);
            processed++;
            continue;
          }

          // ── Evidence class ───────────────────────────────────────────────────
          // SOURCE_CONFLICT: multiple distinct contacts matched by different signals.
          // Mixed (contact + business): write all candidates; contact class governs disposition.
          // Multiple businesses only: write all; use SOURCE_CONFLICT if > 1.
          const conflictingContacts = contactIds.length > 1;
          let finalClass: EvidenceClass;
          let finalContactId: number | null = null;
          let overallMinTier = 7;

          if (conflictingContacts) {
            finalClass = "SOURCE_CONFLICT";
          } else if (contactIds.length === 1) {
            finalContactId = contactIds[0];
            const sig = candidateMap.get(finalContactId)!;
            overallMinTier = sig.minTier;
            // Gen-1: always 1 distinct root source per batch row — STRONG requires >= 2
            finalClass = classifyEvidence(overallMinTier, 1, false);
          } else if (businessIds.length > 1) {
            // Multiple business-only matches — conflict among businesses
            finalClass = "SOURCE_CONFLICT";
          } else if (businessIds.length === 1) {
            const sig = businessCandidateMap.get(businessIds[0])!;
            overallMinTier = sig.minTier;
            finalClass = classifyEvidence(overallMinTier, 1, false);
          } else {
            // Should not reach — NO_MATCH handled above
            finalClass = "INSUFFICIENT_EVIDENCE";
          }

          // ── Write subjects / candidates / evidence ──────────────────────────
          let newSubject = false;
          if (conflictingContacts) {
            // Multiple contact candidates → SOURCE_CONFLICT; include any business candidates too.
            // Each candidate carries its FULL providers array so all evidence signals are written.
            const multiCands: Parameters<typeof insertSubjectWithCandidates>[11] = [
              ...contactIds.map(cid => {
                const s = candidateMap.get(cid)!;
                return { candidateType: "contact" as const, candidateId: cid,
                         class: "SOURCE_CONFLICT" as EvidenceClass,
                         tier: s.minTier, confidence: 30, providers: s.providers };
              }),
              ...businessIds.map(bid => {
                const s = businessCandidateMap.get(bid)!;
                return { candidateType: "business" as const, candidateId: bid,
                         class: "SOURCE_CONFLICT" as EvidenceClass,
                         tier: s.minTier, confidence: 30, providers: s.providers };
              }),
            ];
            newSubject = await insertSubjectWithCandidates(
              tx, runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
              sourceFingerprint, importExecutionId, null, null, "CONFLICTING", multiCands,
            );
          } else if (finalContactId !== null) {
            const sig = candidateMap.get(finalContactId)!;
            const confidence = finalClass === "DETERMINISTIC_MATCH"
              ? (sig.providers.length >= 2 ? 90 : 80)
              : finalClass === "AMBIGUOUS_MATCH" ? 40
              : 20; // INSUFFICIENT_EVIDENCE; STRONG unreachable in Gen-1
            const disposition = finalClass === "INSUFFICIENT_EVIDENCE" ? "INSUFFICIENT_EVIDENCE" : "MATCHED";
            if (businessIds.length === 0) {
              // Contact-only match (common case)
              newSubject = await insertSubjectWithSingleCandidate(
                tx, runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
                sourceFingerprint, importExecutionId, existingFkContactId, existingFkBusinessId,
                disposition, finalContactId, finalClass, overallMinTier, confidence,
                sig.providers,
              );
            } else {
              // Mixed: 1 contact + 1 or more businesses — write all candidates together.
              // Each candidate is classified independently from its own evidence signals:
              //   - Contact: uses finalClass (derived from the contact's minimum tier)
              //   - Business: uses classifyEvidence() on its own minTier — a business found
              //     only by website domain (tier 4) is AMBIGUOUS_MATCH, not DETERMINISTIC_MATCH
              //     just because the contact matched by email.
              // Each candidate carries its FULL providers array so all evidence signals are written.
              const mixedCands: Parameters<typeof insertSubjectWithCandidates>[11] = [
                { candidateType: "contact" as const, candidateId: finalContactId,
                  class: finalClass, tier: overallMinTier, confidence,
                  providers: sig.providers },
                ...businessIds.map(bid => {
                  const bs = businessCandidateMap.get(bid)!;
                  const bizClass = classifyEvidence(bs.minTier, 1, false);
                  const bizConfidence = bizClass === "DETERMINISTIC_MATCH" ? 70
                    : bizClass === "AMBIGUOUS_MATCH" ? 35
                    : 15;
                  return { candidateType: "business" as const, candidateId: bid,
                           class: bizClass, tier: bs.minTier, confidence: bizConfidence,
                           providers: bs.providers };
                }),
              ];
              newSubject = await insertSubjectWithCandidates(
                tx, runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
                sourceFingerprint, importExecutionId, existingFkContactId, existingFkBusinessId,
                disposition, mixedCands,
              );
            }
            // Vertical candidate only on new subject — prevents duplicates on replay
            if (newSubject && sourceVertical) {
              await insertVerticalCandidate(tx, runId, finalContactId, sourceTable, sourceId, sourceVertical);
            }
          } else if (businessIds.length > 1) {
            // Multiple business-only candidates → SOURCE_CONFLICT among businesses.
            // Each candidate carries its FULL providers array so all evidence signals are written.
            const multiBusinessCands: Parameters<typeof insertSubjectWithCandidates>[11] = businessIds.map(bid => {
              const s = businessCandidateMap.get(bid)!;
              return { candidateType: "business" as const, candidateId: bid,
                       class: "SOURCE_CONFLICT" as EvidenceClass,
                       tier: s.minTier, confidence: 30, providers: s.providers };
            });
            newSubject = await insertSubjectWithCandidates(
              tx, runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
              sourceFingerprint, importExecutionId, null, null, "CONFLICTING", multiBusinessCands,
            );
          } else if (businessIds.length === 1) {
            // Single business candidate
            const bid = businessIds[0];
            const sig = businessCandidateMap.get(bid)!;
            const confidence = finalClass === "AMBIGUOUS_MATCH" ? 40 : 20;
            newSubject = await insertSubjectWithBusinessCandidate(
              tx, runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
              sourceFingerprint, importExecutionId, bid, finalClass, overallMinTier, confidence,
              sig.providers,
            );
          } else {
            // Should not reach here — handled by NO_MATCH above
            const insR = await tx.query(
              `INSERT INTO contact_identity_subjects
                 (run_id, source_table, source_id, root_source_table, root_source_id,
                  import_execution_id, disposition, candidate_count, source_fingerprint)
               VALUES ($1,$2,$3,$4,$5,$6,'INSUFFICIENT_EVIDENCE',0,$7)
               ON CONFLICT (run_id, source_table, source_id) DO NOTHING
               RETURNING id`,
              [runId, sourceTable, sourceId, rootSourceTable, rootSourceId, importExecutionId, sourceFingerprint],
            );
            newSubject = insR.rows.length > 0;
          }

          // ── Run-level counter (only on new subject — replay idempotency) ────
          if (newSubject) {
            const counterField: string = finalClass === "EXPLICIT_LINK" ? "explicit_link_count"
              : finalClass === "DETERMINISTIC_MATCH" ? "deterministic_match_count"
              : finalClass === "STRONG_REVIEW_CANDIDATE" ? "strong_candidate_count"
              : finalClass === "AMBIGUOUS_MATCH" ? "ambiguous_count"
              : finalClass === "SOURCE_CONFLICT" ? "source_conflict_count"
              : "insufficient_evidence_count";
            await tx.query(
              `UPDATE contact_identity_reconciliation_runs
               SET ${counterField} = ${counterField} + 1, updated_at = now() WHERE id = $1`,
              [runId],
            );
            classCounts[finalClass] = (classCounts[finalClass] ?? 0) + 1;
          }
          await tx.query(`RELEASE SAVEPOINT ${savepointName}`);
          processed++;

        } catch (writeErr) {
          // Roll back only this row's writes; cursor advances and exceptions accumulates
          await tx.query(`ROLLBACK TO SAVEPOINT ${savepointName}`).catch(() => {});
          await tx.query(`RELEASE SAVEPOINT ${savepointName}`).catch(() => {});
          console.error(`[CrosswalkRunner] Row write failed (${sourceTable} id=${sourceId}); rolled back to savepoint:`, writeErr);
          exceptions++;
        }
      } catch (rowErr) {
        // Outer per-row catch: fires only when root-source resolution or the
        // SAVEPOINT command itself throws (no savepoint to roll back at this level).
        // All probe/write errors are caught by the inner try block above.
        console.error(`[CrosswalkRunner] Row pre-savepoint error (${sourceTable} id=${row.id}):`, rowErr);
        exceptions++;
      }
    } // end row loop

    // ── Atomic cursor advancement ────────────────────────────────────────────
    // Execute the cursor update INSIDE this transaction so that evidence writes and
    // cursor advancement are a single atomic operation. If the CAS returns 0 rows
    // (lease superseded by a resumed invocation), roll back all writes and return
    // cursorUpdated=false so the caller can abort the sweep cleanly.
    const cursorUpdated = await cursorUpdateFn(tx, processed, exceptions);
    if (!cursorUpdated) {
      await tx.query("ROLLBACK");
      return { processed, exceptions, classCounts, cursorUpdated: false };
    }

    await tx.query("COMMIT");
    return { processed, exceptions, classCounts, cursorUpdated: true };

  } catch (batchErr) {
    await tx.query("ROLLBACK").catch(() => {});
    throw batchErr;
  } finally {
    tx.release();
  }
}

/**
 * Insert subject + candidate + evidence rows atomically (within the caller's tx).
 * Returns true when a new subject was inserted; false when the subject already existed
 * (ON CONFLICT DO NOTHING). Callers MUST skip counter increments on false to preserve
 * replay idempotency — replaying a batch after a post-COMMIT crash must not inflate
 * class counts or vertical candidates.
 */
async function insertSubjectWithSingleCandidate(
  tx: PoolClient,
  runId: string,
  sourceTable: string,
  sourceId: string,
  rootSourceTable: string,
  rootSourceId: string,
  sourceFingerprint: string,
  importExecutionId: string | null,
  existingFkContactId: number | null,
  existingFkBusinessId: number | null,
  disposition: string,
  contactId: number,
  evidenceClass: string,
  matchTier: number,
  confidence: number,
  providers: Array<{ provider: string; tier: number }>,
): Promise<boolean> {
  const subjectR = await tx.query(
    `INSERT INTO contact_identity_subjects
       (run_id, source_table, source_id, root_source_table, root_source_id,
        import_execution_id, existing_fk_contact_id, existing_fk_business_id,
        disposition, candidate_count, source_fingerprint)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)
     ON CONFLICT (run_id, source_table, source_id) DO NOTHING
     RETURNING id`,
    [runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
     importExecutionId, existingFkContactId, existingFkBusinessId,
     disposition, sourceFingerprint],
  );
  if (subjectR.rows.length === 0) return false; // subject already existed — idempotent replay
  const subjectId = subjectR.rows[0].id;

  const updR = await tx.query(
    `SELECT updated_at FROM contacts WHERE id = $1`,
    [contactId],
  );
  const updAt = updR.rows[0]?.updated_at ?? new Date();

  const candR = await tx.query(
    `INSERT INTO contact_identity_candidates
       (subject_id, run_id, candidate_type, candidate_id, candidate_updated_at,
        evidence_class, confidence_score, match_tier)
     VALUES ($1,$2,'contact',$3,$4,$5,$6,$7)
     RETURNING id`,
    [subjectId, runId, contactId, updAt, evidenceClass, confidence, matchTier],
  );
  const candidateId = candR.rows[0].id;

  for (const { provider } of providers) {
    const fp = hmacFingerprint(`${provider}|${sourceTable}|${sourceId}|${contactId}`);
    await tx.query(
      `INSERT INTO contact_identity_evidence
         (candidate_id, run_id, root_source_table, root_source_id, evidence_provider, evidence_fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (candidate_id, root_source_table, root_source_id, evidence_fingerprint) DO NOTHING`,
      [candidateId, runId, rootSourceTable, rootSourceId, provider, fp],
    );
  }
  return true; // new subject inserted
}

/**
 * Insert subject + business candidate + evidence rows atomically.
 * Returns true when a new subject was inserted.
 */
async function insertSubjectWithBusinessCandidate(
  tx: PoolClient,
  runId: string,
  sourceTable: string,
  sourceId: string,
  rootSourceTable: string,
  rootSourceId: string,
  sourceFingerprint: string,
  importExecutionId: string | null,
  businessId: number,
  evidenceClass: string,
  matchTier: number,
  confidence: number,
  providers: Array<{ provider: string; tier: number }>,
): Promise<boolean> {
  const subjectR = await tx.query(
    `INSERT INTO contact_identity_subjects
       (run_id, source_table, source_id, root_source_table, root_source_id,
        import_execution_id, existing_fk_business_id,
        disposition, candidate_count, source_fingerprint)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9)
     ON CONFLICT (run_id, source_table, source_id) DO NOTHING
     RETURNING id`,
    [runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
     importExecutionId, businessId,
     evidenceClass === "INSUFFICIENT_EVIDENCE" ? "INSUFFICIENT_EVIDENCE" : "MATCHED",
     sourceFingerprint],
  );
  if (subjectR.rows.length === 0) return false;
  const subjectId = subjectR.rows[0].id;

  const bUpdR = await tx.query(`SELECT updated_at FROM businesses WHERE id = $1`, [businessId]);
  const bUpdAt = bUpdR.rows[0]?.updated_at ?? new Date();

  const candR = await tx.query(
    `INSERT INTO contact_identity_candidates
       (subject_id, run_id, candidate_type, candidate_id, candidate_updated_at,
        evidence_class, confidence_score, match_tier)
     VALUES ($1,$2,'business',$3,$4,$5,$6,$7)
     RETURNING id`,
    [subjectId, runId, businessId, bUpdAt, evidenceClass, confidence, matchTier],
  );
  const candidateId = candR.rows[0].id;

  for (const { provider } of providers) {
    const fp = hmacFingerprint(`${provider}|${sourceTable}|${sourceId}|business:${businessId}`);
    await tx.query(
      `INSERT INTO contact_identity_evidence
         (candidate_id, run_id, root_source_table, root_source_id, evidence_provider, evidence_fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (candidate_id, root_source_table, root_source_id, evidence_fingerprint) DO NOTHING`,
      [candidateId, runId, rootSourceTable, rootSourceId, provider, fp],
    );
  }
  return true;
}

/**
 * Insert subject + multiple candidate + evidence rows.
 * Returns true when a new subject was inserted; false when subject already existed.
 * Callers MUST skip counter increments on false (replay idempotency).
 */
async function insertSubjectWithCandidates(
  tx: PoolClient,
  runId: string,
  sourceTable: string,
  sourceId: string,
  rootSourceTable: string,
  rootSourceId: string,
  sourceFingerprint: string,
  importExecutionId: string | null,
  existingFkContactId: number | null,
  existingFkBusinessId: number | null,
  disposition: string,
  candidates: Array<{
    /** 'contact' or 'business' — governs which entity table is joined for updated_at */
    candidateType: "contact" | "business";
    candidateId: number;
    class: string;
    tier: number;
    confidence: number;
    /** All accumulated provider signals for this candidate — each becomes an evidence row */
    providers: Array<{ provider: string; tier: number }>;
  }>,
): Promise<boolean> {
  const subjectR = await tx.query(
    `INSERT INTO contact_identity_subjects
       (run_id, source_table, source_id, root_source_table, root_source_id,
        import_execution_id, existing_fk_contact_id, existing_fk_business_id,
        disposition, candidate_count, source_fingerprint)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (run_id, source_table, source_id) DO NOTHING
     RETURNING id`,
    [runId, sourceTable, sourceId, rootSourceTable, rootSourceId,
     importExecutionId, existingFkContactId, existingFkBusinessId,
     disposition, candidates.length, sourceFingerprint],
  );
  if (subjectR.rows.length === 0) return false; // subject already existed — idempotent replay
  const subjectId = subjectR.rows[0].id;

  for (const cand of candidates) {
    // Look up candidate_updated_at from the appropriate entity table
    let updAt: Date = new Date();
    if (cand.candidateType === "contact") {
      const updR = await tx.query(`SELECT updated_at FROM contacts WHERE id = $1`, [cand.candidateId]);
      updAt = updR.rows[0]?.updated_at ?? new Date();
    } else {
      const updR = await tx.query(`SELECT updated_at FROM businesses WHERE id = $1`, [cand.candidateId]);
      updAt = updR.rows[0]?.updated_at ?? new Date();
    }
    const candR = await tx.query(
      `INSERT INTO contact_identity_candidates
         (subject_id, run_id, candidate_type, candidate_id, candidate_updated_at,
          evidence_class, confidence_score, match_tier)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [subjectId, runId, cand.candidateType, cand.candidateId, updAt,
       cand.class, cand.confidence, cand.tier],
    );
    const candidateId = candR.rows[0].id;
    // Write evidence for EVERY accumulated provider signal — all probes that matched
    // this candidate get their own evidence row. ON CONFLICT DO NOTHING makes this
    // idempotent on batch replay.
    for (const { provider } of cand.providers) {
      const fp = hmacFingerprint(`${provider}|${sourceTable}|${sourceId}|${cand.candidateType}|${cand.candidateId}`);
      await tx.query(
        `INSERT INTO contact_identity_evidence
           (candidate_id, run_id, root_source_table, root_source_id, evidence_provider, evidence_fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (candidate_id, root_source_table, root_source_id, evidence_fingerprint) DO NOTHING`,
        [candidateId, runId, rootSourceTable, rootSourceId, provider, fp],
      );
    }
  }
  return true; // new subject inserted
}

// ──────────────────────────────────────────────────────────────────────────────
// Main executor
// ──────────────────────────────────────────────────────────────────────────────
export async function executeIdentityRun(runId: string, owner: string): Promise<void> {
  // ── Top-level failure guard ───────────────────────────────────────────────
  // Wraps the ENTIRE lifecycle — preflight, run loading, pending→running claim,
  // sweep, and completion — so any escaping exception CAS-transitions the run
  // to 'failed' while the current lease_owner still matches.
  //
  // Coverage:
  //  - Preflight failures (BACKGROUND_JOB_PROFILE, run not found, pg errors):
  //    run may still be 'pending'; WHERE status IN ('pending','running') catches both.
  //  - Claim failures: run is 'pending'; caught by the same WHERE clause.
  //  - Sweep failures: run is 'running'; caught as before.
  //
  // A superseded worker (lease taken by a resumed invocation) finds 0 matching
  // rows on the failure UPDATE and leaves the resumed worker's run intact.
  try {
  const bgProfile = process.env.BACKGROUND_JOB_PROFILE ?? "off";
  if (bgProfile !== "off") {
    await pool.query(
      `UPDATE contact_identity_reconciliation_runs
       SET status = 'failed', fail_reason = $2, updated_at = now()
       WHERE id = $1 AND lease_owner = $3`,
      [runId, `BACKGROUND_JOB_PROFILE is '${bgProfile}', must be 'off' to run identity crosswalk`, owner],
    );
    return;
  }

  // Load frozen watermarks from run row
  const runR = await pool.query(
    `SELECT frozen_sunbiz_max_id, frozen_prospects_max_id,
            frozen_master_leads_created_at, frozen_master_leads_max_uuid,
            frozen_contacts_max_id, frozen_businesses_max_id,
            sunbiz_denominator, prospects_denominator, master_leads_denominator,
            sunbiz_cursor, prospects_cursor,
            master_leads_cursor_created_at, master_leads_cursor_uuid,
            run_notes
     FROM contact_identity_reconciliation_runs WHERE id = $1`,
    [runId],
  );
  if (runR.rows.length === 0) return;

  const run = runR.rows[0];
  const frozenContactsMaxId = BigInt(run.frozen_contacts_max_id ?? 0);
  const frozenBusinessesMaxId = BigInt(run.frozen_businesses_max_id ?? 0);

  // Transition pending → running
  const startR = await pool.query(
    `UPDATE contact_identity_reconciliation_runs
     SET status = 'running', started_at = COALESCE(started_at, now()),
         lease_expires_at = now() + interval '${LEASE_DURATION_SECS} seconds',
         updated_at = now()
     WHERE id = $1 AND lease_owner = $2 AND status IN ('pending', 'running')`,
    [runId, owner],
  );
  if ((startR.rowCount ?? 0) === 0) {
    console.warn(`[CrosswalkRunner] Could not claim running status for run ${runId}`);
    return;
  }

  // ── Unconditional HMAC-key preflight ─────────────────────────────────────
  // This check fires regardless of whether the frozen denominators are zero.
  // A missing CREDENTIAL_ENCRYPTION_KEY would otherwise produce a run that
  // marks 'completed' with 0 evidence on empty-population databases.
  // hmacFingerprint throws with a descriptive message when the key is absent;
  // the top-level lifecycle catch block marks the run 'failed' with that reason.
  hmacFingerprint("_preflight_check_");

  // ── Tier 2 filing-number: record as one-time run-level skip note ──────────
  // Gen-1 defers filing-number matching because the businesses table has no
  // filing_number column. Record this as a run-level skip in run_notes so the
  // sweep report clearly reflects the scope. Only write the first time (run just
  // entered running state from pending).
  const existingNotes: Record<string, unknown> = run.run_notes ?? {};
  if (!existingNotes["tier_skips"]) {
    await pool.query(
      `UPDATE contact_identity_reconciliation_runs
       SET run_notes = COALESCE(run_notes,'{}') ||
           '{"tier_skips":[{"tier":2,"status":"skipped","reason":"filing_number_no_governed_business_filing_identifier","deferred_to":"Gen-2"}]}'::jsonb,
           updated_at = now()
       WHERE id = $1 AND lease_owner = $2`,
      [runId, owner],
    );
  }

  let batchNum = 0;
  let consecutivePressure = 0;
  let sunbizCursor = Number(run.sunbiz_cursor ?? 0);
  let prospectsCursor = Number(run.prospects_cursor ?? 0);
  let mlCursorCreatedAt: Date | null = run.master_leads_cursor_created_at ?? null;
  let mlCursorUuid: string | null = run.master_leads_cursor_uuid ?? null;
  { // inner scope for sweep logic

  const populations: Array<"sunbiz" | "prospects" | "master_leads"> = ["sunbiz", "prospects", "master_leads"];

  for (const population of populations) {
    while (true) {
      // CAS status check
      const status = await getRunStatus(runId);
      if (!status || status.leaseOwner !== owner) {
        console.warn(`[CrosswalkRunner] Lease lost on run ${runId}`);
        return;
      }
      if (status.status === "cancelled") return;
      if (status.status === "paused") return;
      if (status.status !== "running") return;

      // Pool pressure
      const pressure = poolWaitingCount();
      if (pressure > 0) {
        consecutivePressure++;
        if (consecutivePressure >= 2) {
          await pauseRun(runId, owner, `Pool pressure: waitingCount=${pressure} sustained across 2 batches`);
          return;
        }
        await new Promise(r => setTimeout(r, POOL_PRESSURE_SLEEP_MS));
        continue;
      }
      consecutivePressure = 0;

      // Lease refresh
      if (batchNum > 0 && batchNum % LEASE_REFRESH_EVERY_N === 0) {
        const renewed = await refreshLease(runId, owner);
        if (!renewed) {
          console.warn(`[CrosswalkRunner] Lease not renewed for run ${runId}`);
          return;
        }
      }

      // Fetch batch
      const batchStart = Date.now();
      let rows: BatchSourceRow[] = [];
      let newCursorSunbiz = sunbizCursor;
      let newCursorProspects = prospectsCursor;
      let newMlCursorCreatedAt = mlCursorCreatedAt;
      let newMlCursorUuid = mlCursorUuid;

      try {
        if (population === "sunbiz") {
          const frozenMax = run.frozen_sunbiz_max_id;
          if (!frozenMax) break;
          const r = await pool.query(
            `SELECT id, entity_name, filing_number, email, owner_email,
                    phone, owner_phone, vertical, prospect_id,
                    principal_address, principal_city, principal_state
             FROM sunbiz_entities
             WHERE id > $1 AND id <= $2
             ORDER BY id ASC LIMIT $3`,
            [sunbizCursor, frozenMax, BATCH_SIZE],
          );
          rows = r.rows;
          if (rows.length > 0) newCursorSunbiz = Number(rows[rows.length - 1].id);
        } else if (population === "prospects") {
          const frozenMax = run.frozen_prospects_max_id;
          if (!frozenMax) break;
          // prospects has no sunbiz_entity_id or business_id — only contact_id is the FK
          const r = await pool.query(
            `SELECT id, email, owner_email, phone, owner_phone,
                    company_name AS entity_name, vertical, contact_id,
                    website
               FROM prospects
               WHERE id > $1 AND id <= $2
               ORDER BY id ASC LIMIT $3`,
            [prospectsCursor, frozenMax, BATCH_SIZE],
          );
          rows = r.rows;
          if (rows.length > 0) newCursorProspects = Number(rows[rows.length - 1].id);
        } else {
          // master_leads — UUID; composite keyset (created_at, id)
          const frozenTs = run.frozen_master_leads_created_at;
          const frozenUuid = run.frozen_master_leads_max_uuid;
          if (!frozenTs || !frozenUuid) break;
          const r = await pool.query(
            `SELECT id::text AS id, created_at, email, phone,
                    company AS entity_name, vertical,
                    domain
               FROM master_leads
             WHERE (created_at, id::text) > ($1, $2)
               AND (created_at, id::text) <= ($3, $4)
             ORDER BY created_at ASC, id ASC
             LIMIT $5`,
            [mlCursorCreatedAt ?? new Date(0), mlCursorUuid ?? "00000000-0000-0000-0000-000000000000",
             frozenTs, frozenUuid, BATCH_SIZE],
          );
          rows = r.rows;
          if (rows.length > 0) {
            const lastRow = rows[rows.length - 1];
            newMlCursorCreatedAt = lastRow.created_at instanceof Date ? lastRow.created_at : new Date(lastRow.created_at as string);
            newMlCursorUuid = String(lastRow.id);
          }
        }
      } catch (err) {
        console.error(`[CrosswalkRunner] Batch fetch error (${population}):`, err);
        await pauseRun(runId, owner, `Batch fetch error: ${String(err)}`);
        return;
      }

      const batchDuration = Date.now() - batchStart;
      if (batchDuration > BATCH_TIMEOUT_MS) {
        await pauseRun(runId, owner, `Batch exceeded ${BATCH_TIMEOUT_MS}ms`);
        return;
      }

      if (rows.length === 0) break; // Population exhausted

      // Process batch
      const sourceTable = population === "sunbiz" ? "sunbiz_entities"
        : population === "prospects" ? "prospects"
        : "master_leads";

      // Build cursor update closure — executes INSIDE the batch transaction for atomicity
      let cursorUpdateFn: CursorUpdateFn;
      if (population === "sunbiz") {
        const cursorVal = newCursorSunbiz;
        cursorUpdateFn = async (tx, p, e) => {
          const ur = await tx.query(
            `UPDATE contact_identity_reconciliation_runs
             SET sunbiz_cursor = $2,
                 sunbiz_processed = sunbiz_processed + $3,
                 sunbiz_exceptions = sunbiz_exceptions + $4,
                 updated_at = now()
             WHERE id = $1 AND lease_owner = $5`,
            [runId, cursorVal, p, e, owner],
          );
          return (ur.rowCount ?? 0) > 0;
        };
      } else if (population === "prospects") {
        const cursorVal = newCursorProspects;
        cursorUpdateFn = async (tx, p, e) => {
          const ur = await tx.query(
            `UPDATE contact_identity_reconciliation_runs
             SET prospects_cursor = $2,
                 prospects_processed = prospects_processed + $3,
                 prospects_exceptions = prospects_exceptions + $4,
                 updated_at = now()
             WHERE id = $1 AND lease_owner = $5`,
            [runId, cursorVal, p, e, owner],
          );
          return (ur.rowCount ?? 0) > 0;
        };
      } else {
        const cursorTs = newMlCursorCreatedAt;
        const cursorUuid = newMlCursorUuid;
        cursorUpdateFn = async (tx, p, e) => {
          const ur = await tx.query(
            `UPDATE contact_identity_reconciliation_runs
             SET master_leads_cursor_created_at = $2,
                 master_leads_cursor_uuid = $3,
                 master_leads_processed = master_leads_processed + $4,
                 master_leads_exceptions = master_leads_exceptions + $5,
                 updated_at = now()
             WHERE id = $1 AND lease_owner = $6`,
            [runId, cursorTs, cursorUuid, p, e, owner],
          );
          return (ur.rowCount ?? 0) > 0;
        };
      }

      const result = await processBatch(
        runId, owner, frozenContactsMaxId, frozenBusinessesMaxId,
        rows, sourceTable, cursorUpdateFn,
      );

      if (!result.cursorUpdated) {
        // Lease superseded: another invocation owns this run. Abort without marking failed
        // so the new owner can complete and mark it status='completed'.
        console.warn(`[CrosswalkRunner] Lease superseded for run ${runId} after batch ${batchNum}; aborting stale worker.`);
        return;
      }

      // Advance local cursor state after successful atomic commit
      if (population === "sunbiz") sunbizCursor = newCursorSunbiz;
      else if (population === "prospects") prospectsCursor = newCursorProspects;
      else { mlCursorCreatedAt = newMlCursorCreatedAt; mlCursorUuid = newMlCursorUuid; }

      batchNum++;
      if (rows.length < BATCH_SIZE) break; // Last batch for this population
    }
  }

  // Mark complete
  await pool.query(
    `UPDATE contact_identity_reconciliation_runs
     SET status = 'completed', completed_at = now(), updated_at = now()
     WHERE id = $1 AND lease_owner = $2 AND status = 'running'`,
    [runId, owner],
  );
  console.log(`[CrosswalkRunner] Run ${runId} completed`);
  } // end inner sweep scope
  } catch (lifecycleErr: any) {
    // CAS-scoped failure: marks the run failed only while this invocation's
    // lease_owner still matches and status is pending or running.
    // A superseded worker finds 0 rows and leaves the resumed worker intact.
    const reason = String(lifecycleErr?.message ?? lifecycleErr).slice(0, 1000);
    console.error(`[CrosswalkRunner] Lifecycle error for run ${runId}:`, lifecycleErr);
    await pool.query(
      `UPDATE contact_identity_reconciliation_runs
       SET status = 'failed', fail_reason = $2, updated_at = now()
       WHERE id = $1 AND lease_owner = $3 AND status IN ('pending', 'running')`,
      [runId, reason, owner],
    ).catch((markErr) => {
      console.error(`[CrosswalkRunner] Could not mark run ${runId} failed:`, markErr);
    });
  }
}

/** Exported for certification testing only — do not call from production code. */
export { processBatch as _testProcessBatch };
