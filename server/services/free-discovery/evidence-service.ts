/**
 * Task #1978: Free-discovery candidate evidence service.
 *
 * Canonical write path for candidates discovered by FREE (non-paid) email
 * discovery — today, Task #1977's first-party contact-page crawler. Nothing
 * in this module ever writes a newly-discovered, unvalidated address directly
 * to contacts.email or businesses.mainEmail: it persists encrypted candidate
 * evidence only. Only the governed validation/projection path
 * (server/services/cro03/business-validation-service.ts +
 * projection-service.ts, gated by ZeroBounce provider_valid) may fill an
 * operational email field — and only after an explicit operator-authorized
 * promotion (see promoteCandidateForValidation below).
 *
 * Domain-cache reuse (correction #4): cached role-inbox evidence
 * (info@/sales@/etc — attributionScope='role') is reusable across contacts at
 * the SAME business without recrawling. Named-person evidence
 * (attributionScope='named') is never cached and never copied onto a
 * different contact — it only ever attaches to the one contact whose
 * name/title evidence justified it.
 */

import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { seal, unseal } from "../cro03/candidate-evidence-service";

const rows = (result: any): any[] => result?.rows ?? result ?? [];

const DOMAIN_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type FreeDiscoveryAttributionScope = "role" | "named";

export interface RecordFreeDiscoveryCandidateInput {
  generationId: string;
  subjectType: "business" | "person";
  businessId?: number | null;
  contactId?: number | null;
  domain: string;
  email: string;
  source: string; // e.g. "first_party_contact_page", "jsonld"
  attributionScope: FreeDiscoveryAttributionScope;
  personNameEvidence?: string | null;
  personTitleEvidence?: string | null;
  confidence: number;
  /**
   * True only when this role candidate came from a physical outbound crawl
   * performed for this exact call (not a domain-cache read, and not a reader
   * riding another contact's in-flight crawl in the same batch). Domain-cache
   * metadata (last_crawled_at/crawl_count/TTL) must only ever advance on a
   * genuine crawl — otherwise merely re-staging an already-cached role
   * address into a new generation would refresh its TTL for a crawl that
   * never happened, letting a frequently-read domain's evidence go stale
   * without ever being re-verified. Defaults to false (no cache refresh) so
   * callers must opt in explicitly.
   */
  refreshDomainCache?: boolean;
}

export interface FreeDiscoveryCandidateRecord {
  id: string;
  wasNew: boolean;
  maskedValue: string;
}

/**
 * Start (or resume, by runKey) a free-discovery generation. This is the
 * durable run envelope from correction #2: an immutable id future validation
 * work can reference, without impersonating a paid pilot/command generation.
 */
export async function createFreeDiscoveryGeneration(input: {
  runKey: string;
  actorId: string;
  reason: string;
  purpose?: string;
}): Promise<{ id: string; replayed: boolean }> {
  const existing = rows(await db.execute(sql`
    SELECT id FROM free_discovery_generations WHERE run_key = ${input.runKey}
  `))[0];
  if (existing) return { id: String(existing.id), replayed: true };
  const inserted = rows(await db.execute(sql`
    INSERT INTO free_discovery_generations (run_key, actor_id, purpose, reason, state)
    VALUES (${input.runKey}, ${input.actorId}, ${input.purpose ?? "email_discovery"}, ${input.reason}, 'running')
    ON CONFLICT (run_key) DO NOTHING
    RETURNING id
  `))[0];
  if (!inserted) {
    const raced = rows(await db.execute(sql`SELECT id FROM free_discovery_generations WHERE run_key = ${input.runKey}`))[0];
    return { id: String(raced.id), replayed: true };
  }
  return { id: String(inserted.id), replayed: false };
}

/**
 * Reclaim generations left in state='running' well past any realistic batch
 * duration — the outcome of a hard process crash (kill/OOM/deploy restart)
 * mid-batch, which no in-process try/finally can ever observe. Without this,
 * a crashed batch's generation row (and the telemetry/UI counters that key
 * off it) would report "in progress" forever. Marks each as 'stalled' (never
 * silently as 'completed' — a stalled run's true final counts are unknown
 * beyond whatever candidates it managed to persist before crashing) and
 * writes one audit_logs row per reclaimed generation so the auto-recovery is
 * inspectable, per the task's "auditable manual reconcile control" mandate.
 * Idempotent and safe to call from any periodic tick — an already-terminal
 * generation is never touched twice.
 */
export async function reclaimStaleFreeDiscoveryGenerations(
  staleAfterMs: number = 2 * 60 * 60 * 1000,
): Promise<{ reclaimed: number; ids: string[] }> {
  const { db: _db } = await import("../../db");
  const { auditLogs } = await import("@shared/schema");
  const threshold = new Date(Date.now() - staleAfterMs);
  const stale = rows(await db.execute(sql`
    UPDATE free_discovery_generations
       SET state = 'stalled', completed_at = NOW(),
           subject_count = (
             SELECT COUNT(DISTINCT
               CASE WHEN business_id IS NOT NULL THEN 'business_id:' || business_id::text
                    ELSE 'contact_id:' || contact_id::text END
             )
             FROM free_discovery_candidates WHERE generation_id = free_discovery_generations.id
           ),
           candidate_count = (SELECT COUNT(*) FROM free_discovery_candidates WHERE generation_id = free_discovery_generations.id)
     WHERE state = 'running' AND started_at < ${threshold}
     RETURNING id, run_key, actor_id, reason, started_at, subject_count, candidate_count
  `));
  if (stale.length === 0) return { reclaimed: 0, ids: [] };
  for (const row of stale) {
    await _db.insert(auditLogs).values({
      action: "free_discovery_generation_auto_reclaimed",
      entityType: "free_discovery_generation",
      entityKey: String(row.id),
      details: {
        runKey: row.run_key,
        actorId: row.actor_id,
        reason: row.reason,
        startedAt: row.started_at,
        staleAfterMs,
        recoveredSubjectCount: row.subject_count,
        recoveredCandidateCount: row.candidate_count,
      },
      actorType: "system",
      actorId: "free_discovery_generation_reaper",
    }).catch((err) => console.error("[FreeDiscoveryReaper] Failed to write audit log for reclaimed generation", row.id, err));
  }
  return { reclaimed: stale.length, ids: stale.map((r) => String(r.id)) };
}

export async function completeFreeDiscoveryGeneration(generationId: string): Promise<void> {
  await db.execute(sql`
    UPDATE free_discovery_generations
       SET state = 'completed', completed_at = NOW(),
           -- business_id and contact_id are different id namespaces (a
           -- business #1 and a contact #1 are not the same subject, and a
           -- role candidate can be owned by EITHER FK depending on whether a
           -- business link existed yet — see the contactId fallback in
           -- enrichment.ts). Prefixing with subject_type does NOT disambiguate
           -- this, since both a business-owned and a contact-fallback role
           -- row share subject_type='business'. Key off which FK column is
           -- actually populated instead, so the two id spaces can never
           -- collide into a single counted subject.
           subject_count = (
             SELECT COUNT(DISTINCT
               CASE WHEN business_id IS NOT NULL THEN 'business_id:' || business_id::text
                    ELSE 'contact_id:' || contact_id::text END
             )
             FROM free_discovery_candidates WHERE generation_id = ${generationId}::uuid
           ),
           candidate_count = (SELECT COUNT(*) FROM free_discovery_candidates WHERE generation_id = ${generationId}::uuid)
     WHERE id = ${generationId}::uuid
  `);
}

/**
 * Persist one discovered email as encrypted candidate evidence. Never writes
 * contacts.email or businesses.mainEmail. Idempotent on
 * (generation_id, field, normalized_value_hash).
 */
export async function recordFreeDiscoveryCandidate(
  input: RecordFreeDiscoveryCandidateInput,
): Promise<FreeDiscoveryCandidateRecord> {
  if (input.attributionScope === "named" && !input.contactId) {
    // A named (non-role) address must always be scoped to the one contact it
    // was found for — it is never eligible for domain-cache reuse. Sources
    // that also capture a name/title match (e.g. a future Apollo-style
    // reveal) should populate personNameEvidence too, but a bare source like
    // the contact-page crawler — which finds the address without pairing it
    // to a parsed person name — can still record it as contact-scoped
    // evidence as long as it names the contact it belongs to.
    throw new Error("FREE_DISCOVERY_NAMED_ATTRIBUTION_REQUIRES_CONTACT");
  }
  if (!input.businessId && !input.contactId) {
    // Every candidate row must be attributable to some subject — a row with
    // both FKs null is an orphan nobody's downstream review UI or ownership
    // logic can ever find. Callers must resolve a concrete owner (falling
    // back to contactId when no businessId link exists) before staging.
    throw new Error("FREE_DISCOVERY_CANDIDATE_REQUIRES_SUBJECT_SCOPE");
  }
  // subject_type must agree with attribution_scope: 'business' evidence is
  // eligible for businesses.mainEmail projection (governed promotion path),
  // so ONLY a genuine role/shared inbox may ever carry it. 'person' evidence
  // is held for person-level validation and must never be promoted onto a
  // business's shared email field. Mixing these up is exactly the kind of
  // misclassification that would let a named person's address get promoted
  // as if it were a business's own inbox.
  if (input.attributionScope === "role" && input.subjectType !== "business") {
    throw new Error("FREE_DISCOVERY_ROLE_ATTRIBUTION_REQUIRES_BUSINESS_SUBJECT_TYPE");
  }
  if (input.attributionScope === "named" && input.subjectType !== "person") {
    throw new Error("FREE_DISCOVERY_NAMED_ATTRIBUTION_REQUIRES_PERSON_SUBJECT_TYPE");
  }
  // A 'person' (named) candidate is scoped to exactly the one contact it was
  // found for and must never simultaneously carry a business_id — that would
  // make it look reusable/business-owned, defeating the whole point of
  // person-scoping (correction #4's no-cross-contact-leak guarantee).
  if (input.subjectType === "person" && input.businessId) {
    throw new Error("FREE_DISCOVERY_PERSON_SUBJECT_CANNOT_CARRY_BUSINESS_ID");
  }
  const { ciphertext, nonce, tag, normalizedValueHash, maskedValue } = seal("email", input.email);
  const inserted = rows(await db.execute(sql`
    INSERT INTO free_discovery_candidates
      (generation_id, field, subject_type, business_id, contact_id, domain, source,
       attribution_scope, person_name_evidence, person_title_evidence, disposition,
       confidence, envelope_ciphertext, envelope_nonce, envelope_tag, envelope_key_version,
       normalized_value_hash, masked_value)
    VALUES
      (${input.generationId}::uuid, 'email', ${input.subjectType}, ${input.businessId ?? null},
       ${input.contactId ?? null}, ${input.domain}, ${input.source}, ${input.attributionScope},
       ${input.personNameEvidence ?? null}, ${input.personTitleEvidence ?? null}, 'staged',
       ${input.confidence}, ${ciphertext}, ${nonce}, ${tag}, 1, ${normalizedValueHash}, ${maskedValue})
    ON CONFLICT (generation_id, field, normalized_value_hash) DO NOTHING
    RETURNING id
  `))[0];
  if (!inserted) {
    const existing = rows(await db.execute(sql`
      SELECT id FROM free_discovery_candidates
       WHERE generation_id = ${input.generationId}::uuid AND field = 'email' AND normalized_value_hash = ${normalizedValueHash}
    `))[0];
    return { id: String(existing.id), wasNew: false, maskedValue };
  }
  if (input.attributionScope === "role" && input.refreshDomainCache) {
    await touchDomainCacheRoleEmail(input.domain, input.email, input.confidence, input.generationId);
  }
  return { id: String(inserted.id), wasNew: true, maskedValue };
}

export interface DomainCacheLookup {
  /** True when there is a within-TTL cache row for this domain at all — a recrawl is NOT needed, even if emails is empty (a fresh negative result). */
  fresh: boolean;
  emails: { email: string; confidence: number }[];
}

/**
 * Fresh (within TTL) domain-cache state. Distinguishes "no fresh cache row —
 * must crawl" (fresh:false) from "freshly crawled, found zero role emails —
 * do NOT recrawl" (fresh:true, emails:[]). Collapsing those two cases (as an
 * earlier version of this function did, by returning null for an empty list)
 * defeated the whole point of markDomainCrawled's negative-result caching.
 */
export async function getDomainCache(domain: string): Promise<DomainCacheLookup> {
  const row = rows(await db.execute(sql`
    SELECT role_emails, last_crawled_at FROM email_discovery_domain_cache WHERE domain = ${domain}
  `))[0];
  if (!row) return { fresh: false, emails: [] };
  const age = Date.now() - new Date(row.last_crawled_at).getTime();
  if (age > DOMAIN_CACHE_TTL_MS) return { fresh: false, emails: [] };
  const list = Array.isArray(row.role_emails) ? row.role_emails : [];
  return { fresh: true, emails: list };
}

/** Back-compat convenience wrapper: fresh, non-empty role emails only, or null. Prefer getDomainCache for new call sites that must also honor a fresh-but-empty negative cache. */
export async function getCachedRoleEmails(domain: string): Promise<{ email: string; confidence: number }[] | null> {
  const cache = await getDomainCache(domain);
  return cache.fresh && cache.emails.length > 0 ? cache.emails : null;
}

async function touchDomainCacheRoleEmail(domain: string, email: string, confidence: number, generationId: string): Promise<void> {
  const existing = rows(await db.execute(sql`SELECT role_emails, last_crawled_at FROM email_discovery_domain_cache WHERE domain = ${domain}`))[0];
  const fresh = existing && (Date.now() - new Date(existing.last_crawled_at).getTime()) <= DOMAIN_CACHE_TTL_MS;
  // Only carry forward previously-cached addresses if that cache entry is
  // still fresh — an expired entry's addresses are stale and must not be
  // revived just because a later crawl happens to find a different address.
  const current: { email: string; confidence: number }[] = fresh && Array.isArray(existing.role_emails) ? existing.role_emails : [];
  const merged = current.filter((c) => c.email !== email);
  merged.push({ email, confidence });
  await db.execute(sql`
    INSERT INTO email_discovery_domain_cache (domain, role_emails, last_generation_id)
    VALUES (${domain}, ${JSON.stringify(merged)}::jsonb, ${generationId}::uuid)
    ON CONFLICT (domain) DO UPDATE
      SET role_emails = ${JSON.stringify(merged)}::jsonb,
          last_crawled_at = NOW(),
          crawl_count = email_discovery_domain_cache.crawl_count + 1,
          last_generation_id = ${generationId}::uuid
  `);
}

/**
 * Records a crawl attempt that genuinely completed and found NO eligible
 * (role-inbox) address, so the domain isn't recrawled every batch during its
 * TTL window. This is an authoritative negative result for role emails: it
 * always clears any previously-cached role addresses for the domain (they
 * cannot still be valid if the same domain was just re-crawled and none of
 * them turned up), rather than leaving a stale positive list to be served
 * under a freshly-bumped last_crawled_at timestamp.
 */
export async function markDomainCrawled(domain: string, generationId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO email_discovery_domain_cache (domain, role_emails, last_generation_id)
    VALUES (${domain}, '[]'::jsonb, ${generationId}::uuid)
    ON CONFLICT (domain) DO UPDATE
      SET role_emails = '[]'::jsonb,
          last_crawled_at = NOW(),
          crawl_count = email_discovery_domain_cache.crawl_count + 1,
          last_generation_id = ${generationId}::uuid
  `);
}

// ── Governed promotion into the paid validation pipeline ──────────────────────

export type PromotionResult =
  | { status: "PENDING_OPERATOR_ACTIVATION"; reason: string }
  | { status: "PROMOTED"; candidateEvidenceId: string; admittedDisposition: string };

/**
 * The ONLY path by which a free-discovery candidate may enter the ZeroBounce
 * validation pipeline. Correction #2: FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED=true
 * now has a real effect — it advances the candidate's disposition to
 * 'validation_admitted' and writes a durable audit entry. Previously this
 * function returned a stub result for all callers regardless of gate outcomes;
 * that stub has been replaced with full gate evaluation + real state transition.
 *
 * Gate chain (all must pass; any failure returns PENDING_OPERATOR_ACTIVATION):
 *   1. FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED=true
 *   2. Candidate is in 'staged' disposition (idempotent — already-admitted is re-returned)
 *   3. Subject business has no DBPR lineage (fail-closed)
 *   4. Candidate email is not present on the canonical contact suppression surface
 *   5. An approved cro03c_activation_policies row (MI-09 ZeroBounce authorization)
 *   6. A live (non-expired) cro03c_runtime_attestations row (worker fleet active)
 *
 * When all gates pass:
 *   - Candidate disposition advances to 'validation_admitted'
 *   - One audit_logs row is written (action='free_discovery_candidate_admitted')
 *   - The caller (or a downstream queue job) is responsible for submitting the
 *     admitted candidate to ZeroBounce. Only provider_valid results may produce a
 *     master_leads staging intent — that step is governed by the projection-service.
 *   - Does NOT write to contacts, GHL, campaigns, or outreach.
 */
export async function promoteCandidateForValidation(candidateId: string): Promise<PromotionResult> {
  // Gate 1: operator opt-in
  if (process.env.FREE_DISCOVERY_VALIDATION_PROMOTION_ENABLED !== "true") {
    return { status: "PENDING_OPERATOR_ACTIVATION", reason: "FREE_DISCOVERY_VALIDATION_PROMOTION_DISABLED" };
  }

  // Load candidate record to check eligibility and state.
  const candidate = rows(await db.execute(sql`
    SELECT id, disposition, business_id, contact_id, domain, normalized_value_hash,
           envelope_ciphertext, envelope_nonce, envelope_tag, envelope_key_version
    FROM free_discovery_candidates WHERE id = ${candidateId}::uuid
  `))[0];
  if (!candidate) {
    return { status: "PENDING_OPERATOR_ACTIVATION", reason: "CANDIDATE_NOT_FOUND" };
  }

  // Gate 2: only 'staged' candidates may be admitted. Already-admitted is idempotent.
  if (candidate.disposition === "validation_admitted") {
    return { status: "PROMOTED", candidateEvidenceId: candidateId, admittedDisposition: "validation_admitted" };
  }
  if (candidate.disposition !== "staged") {
    return { status: "PENDING_OPERATOR_ACTIVATION", reason: `CANDIDATE_DISPOSITION_INELIGIBLE:${candidate.disposition}` };
  }

  // Gate 3: DBPR exclusion — fail-closed if the subject business carries DBPR lineage.
  if (candidate.business_id) {
    const { businessLacksDbprLineageSql } = await import("../dbpr");
    const dbprCheck = rows(await db.execute(sql`
      SELECT id FROM businesses WHERE id = ${candidate.business_id} AND ${businessLacksDbprLineageSql(sql`id`)}
    `))[0];
    if (!dbprCheck) {
      return { status: "PENDING_OPERATOR_ACTIVATION", reason: "DBPR_LINEAGE_EXCLUSION" };
    }
  }

  // Gate 4: use the canonical suppression/bounce surface that actually exists
  // in every deployed schema. Query errors deny admission; they must never be
  // silently treated as permission to spend or contact.
  let contactEmailTokenHash: string;
  try {
    const plaintext = unseal("email", {
      ciphertext: String(candidate.envelope_ciphertext),
      nonce: String(candidate.envelope_nonce),
      tag: String(candidate.envelope_tag),
      keyVersion: Number(candidate.envelope_key_version ?? 1),
    });
    contactEmailTokenHash = createHash("sha256").update(plaintext.trim().toLowerCase()).digest("hex");
  } catch (decryptErr: any) {
    console.error("[FreeDiscovery] candidate envelope could not be opened:", decryptErr?.message);
    return { status: "PENDING_OPERATOR_ACTIVATION", reason: "CANDIDATE_DECRYPTION_FAILED" };
  }

  let suppressed = false;
  try {
    // contacts.email_token_hash uses the long-standing plaintext-normalized
    // hash, while candidate evidence uses a field-scoped hash. Check both.
    const suppression = rows(await db.execute(sql`
      SELECT EXISTS(
        SELECT 1 FROM contacts c
         WHERE c.email_token_hash IN (${candidate.normalized_value_hash}, ${contactEmailTokenHash})
           AND (
             COALESCE(c.opted_out_email, FALSE) = TRUE
             OR c.opt_out_status = 'opted_out'
             OR c.unsubscribe_status = 'unsubscribed'
             OR c.complaint_status = 'reported'
             OR COALESCE(c.do_not_auto_contact, FALSE) = TRUE
             OR c.suppression_reason IS NOT NULL
             OR c.bounce_status = 'hard'
             OR c.email_status IN ('bounced', 'invalid')
           )
      ) AS suppressed
    `))[0];
    suppressed = suppression?.suppressed === true;
  } catch (suppressionErr: any) {
    console.error("[FreeDiscovery] canonical suppression query failed:", suppressionErr?.message);
    return { status: "PENDING_OPERATOR_ACTIVATION", reason: "SUPPRESSION_QUERY_ERROR" };
  }
  if (suppressed) {
    // Mark the candidate as suppressed so UI and downstream queries can see why.
    await db.execute(sql`
      UPDATE free_discovery_candidates SET disposition = 'suppressed'
      WHERE id = ${candidateId}::uuid AND disposition = 'staged'
    `).catch(() => {});
    return { status: "PENDING_OPERATOR_ACTIVATION", reason: "CANDIDATE_SUPPRESSED" };
  }

  // Gate 5: MI-09 ZeroBounce authorization — a currently-approved activation policy must exist.
  const policy = rows(await db.execute(sql`
    SELECT id FROM cro03c_activation_policies WHERE status = 'approved' ORDER BY expected_revision DESC LIMIT 1
  `))[0];
  if (!policy) return { status: "PENDING_OPERATOR_ACTIVATION", reason: "NO_APPROVED_ACTIVATION_POLICY" };

  // Gate 6: live runtime attestation — worker fleet must be active (non-expired attestation).
  // Schema note: the table uses `captured_at` (not `created_at`) for ordering.
  let attestation: { id: string } | undefined;
  try {
    attestation = rows(await db.execute(sql`
      SELECT id FROM cro03c_runtime_attestations WHERE expires_at > NOW() ORDER BY captured_at DESC LIMIT 1
    `))[0];
  } catch (attErr: any) {
    // Distinguish schema/DB errors from legitimate policy denial.
    // A DB error here (e.g. missing table or column) is a configuration failure,
    // not a policy denial.  Surface a distinct reason so callers can detect it.
    const msg = String(attErr?.message ?? "");
    const reason = /column.*does not exist|relation.*does not exist/i.test(msg)
      ? "ATTESTATION_SCHEMA_ERROR"
      : "ATTESTATION_QUERY_ERROR";
    console.error(`[FreeDiscovery] Gate 6 attestation query failed (${reason}):`, msg);
    return { status: "PENDING_OPERATOR_ACTIVATION", reason };
  }
  if (!attestation) return { status: "PENDING_OPERATOR_ACTIVATION", reason: "NO_LIVE_RUNTIME_ATTESTATION" };

  // All gates passed — advance disposition to 'validation_admitted' and write audit row.
  // This is a single-column UPDATE; use raw db.execute to avoid Drizzle's silent-drop
  // behaviour on cast-type SET objects (see drizzle-set-silent-drop memory note).
  const updated = rows(await db.execute(sql`
    UPDATE free_discovery_candidates
       SET disposition = 'validation_admitted'
     WHERE id = ${candidateId}::uuid AND disposition = 'staged'
     RETURNING id
  `))[0];
  if (!updated) {
    // Another concurrent caller already advanced the state — idempotent.
    return { status: "PROMOTED", candidateEvidenceId: candidateId, admittedDisposition: "validation_admitted" };
  }

  const { auditLogs } = await import("@shared/schema");
  await db.insert(auditLogs).values({
    action: "free_discovery_candidate_admitted",
    entityType: "free_discovery_candidate",
    entityKey: candidateId,
    details: {
      candidateId,
      businessId: candidate.business_id ?? null,
      contactId: candidate.contact_id ?? null,
      domain: candidate.domain,
      policyId: String(policy.id),
      attestationId: String(attestation.id),
    },
    actorType: "system",
    actorId: "free-discovery-promotion",
  }).catch((err) => console.error("[FreeDiscovery] Failed to write admission audit log for candidate", candidateId, err));

  return { status: "PROMOTED", candidateEvidenceId: candidateId, admittedDisposition: "validation_admitted" };
}

export function newFreeDiscoveryRunKey(prefix: string): string {
  return `${prefix}:${new Date().toISOString().slice(0, 10)}:${randomUUID()}`;
}
