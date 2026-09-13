/**
 * MI-07: Master Lead Stager Worker
 *
 * Consumes master_lead_staging_intents (pending rows) inserted atomically
 * by writeBusinessValidationResult() when email_discovery_status = 'provider_valid'.
 *
 * Per-job pipeline:
 *   1. Resolve canonical_business_id through provenance chain
 *   2. Re-verify businesses.email_discovery_status = 'provider_valid'
 *   3. Idempotency: if staging receipt already exists, exit cleanly
 *   4. Dedup against existing contacts (email token hash, phone, domain+company)
 *   5. Suppression check (DNC, bounce, opt-out)
 *   6. Dedup against existing pipeline master_leads (email token hash)
 *   7. Write master_leads row + receipt + mark intent consumed ATOMICALLY in one transaction
 *   8. Reconcile generation batch totals (fire-and-forget)
 *   9. Audit log
 *
 * Durability:
 *   - Steps 7a-c (lead INSERT + receipt INSERT + intent UPDATE) are a single db.transaction().
 *     If the transaction rolls back, the intent remains 'pending' and the worker retries via backoff.
 *   - recoverPendingIntents() re-enqueues any committed 'pending' intents not yet consumed,
 *     covering queue-outage windows. Call it on worker startup and on a periodic sweep.
 *
 * Readiness codes:
 *   VALID_EMAIL_PHONE_OWNER | VALID_EMAIL_NO_PHONE | VALID_EMAIL_NO_OWNER
 *   SUPPRESSED | DUPLICATE
 */

import { db } from "../db";
import { sql } from "drizzle-orm";
import { sanitizeAuditPayload } from "../services/audit-sanitizer";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MasterLeadStagerJobData {
  intentId: string;
}

type Disposition = "staged" | "duplicate" | "suppressed" | "failed";

interface ProvisionedBusiness {
  businessId: number;
  canonicalName: string | null;
  normalizedName: string | null;
  websiteDomain: string | null;
  phone: string | null;
  mainEmail: string | null;
  emailDiscoveryStatus: string | null;
  vertical: string | null;
  countyFips: string | null;
}

interface HandoffResolution {
  canonicalBusinessId: number;
  cro03GenerationId: string;
  qualityScore: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rows<T>(result: { rows: T[] }): T[] {
  return result.rows ?? [];
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***@***";
  const masked = local.length <= 1 ? "*" : local[0] + "***";
  return `${masked}@${domain}`;
}

function deriveFitTier(score: number | null): string {
  if (score == null) return "C";
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  return "C";
}

function deriveReadinessReason(
  hasPhone: boolean,
  hasContactName: boolean,
): string {
  if (hasPhone && hasContactName) return "VALID_EMAIL_PHONE_OWNER";
  if (hasPhone) return "VALID_EMAIL_NO_OWNER";
  return "VALID_EMAIL_NO_PHONE";
}

// ── Field provenance resolution ───────────────────────────────────────────────
// generation → cro03a_handoffs → cro03_source_observations
//   → canonical_source_links → businesses.id
// Also reads cro03a_qualification_decisions.score via the handoff's decision_id.

async function resolveProvenance(generationId: string, intentId?: string): Promise<HandoffResolution | null> {
  const result = rows<{
    canonical_business_id: number;
    cro03_generation_id: string;
    quality_score: number | null;
  }>(await db.execute(sql`
    SELECT
      b.id                                   AS canonical_business_id,
      g.id::text                             AS cro03_generation_id,
      qd.score                               AS quality_score
    FROM cro03c_generations g
    JOIN cro03a_handoffs h      ON h.id = g.handoff_id
    JOIN cro03_source_observations so ON so.id = h.source_observation_id
    JOIN canonical_source_links csl
      ON csl.source_system = so.source_system
     AND csl.source_type   = so.source_type
     AND csl.stable_key    = so.stable_key
    JOIN businesses b ON b.id = csl.business_id
    LEFT JOIN cro03a_qualification_decisions qd
      ON qd.id = h.decision_id
    WHERE g.id = ${generationId}::uuid
    LIMIT 1
  `));

  if (result.length > 0) {
    const r = result[0];
    return {
      canonicalBusinessId: Number(r.canonical_business_id),
      cro03GenerationId: String(r.cro03_generation_id),
      qualityScore: r.quality_score != null ? Number(r.quality_score) : null,
    };
  }

  // Fallback: if the CRO-03C generation chain doesn't exist in this DB (test environments
  // or post-migration edge cases), use the canonical_business_id already stored on the intent.
  // The intent was created atomically with the validated result, so its business ID is authoritative.
  if (intentId) {
    const intentFallback = rows<any>(await db.execute(sql`
      SELECT canonical_business_id FROM master_lead_staging_intents
      WHERE id = ${intentId}::uuid AND canonical_business_id IS NOT NULL
      LIMIT 1
    `));
    if (intentFallback.length > 0 && intentFallback[0].canonical_business_id) {
      return {
        canonicalBusinessId: Number(intentFallback[0].canonical_business_id),
        cro03GenerationId: generationId,
        qualityScore: null, // no generation chain — score defaults to null (tier C)
      };
    }
  }

  return null;
}

async function fetchBusiness(businessId: number): Promise<ProvisionedBusiness | null> {
  const result = rows<any>(await db.execute(sql`
    SELECT
      b.id,
      b.canonical_name,
      b.normalized_name,
      b.website_domain,
      b.main_phone,
      b.main_email,
      b.email_discovery_status,
      b.vertical,
      bl.county_fips
    FROM businesses b
    LEFT JOIN business_locations bl
      ON bl.business_id = b.id
     AND bl.is_primary = true
    WHERE b.id = ${businessId}
    LIMIT 1
  `));

  if (result.length === 0) return null;
  const r = result[0];
  return {
    businessId: Number(r.id),
    canonicalName: r.canonical_name ?? null,
    normalizedName: r.normalized_name ?? null,
    websiteDomain: r.website_domain ?? null,
    phone: r.main_phone ?? null,
    mainEmail: r.main_email ?? null,
    emailDiscoveryStatus: r.email_discovery_status ?? null,
    vertical: r.vertical ?? null,
    countyFips: r.county_fips ?? null,
  };
}

// Compute simple normalised domain (strip www. and protocol)
function normalizeDomain(domain: string | null): string | null {
  if (!domain) return null;
  return domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase().trim();
}

// Digits-only phone normalisation
function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

// Very simple company name similarity (Jaccard on trigrams) — 0..1
function companySimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const trigrams = (s: string): Set<string> => {
    const padded = `  ${s.toLowerCase()}  `;
    const set = new Set<string>();
    for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
    return set;
  };
  const ta = trigrams(a);
  const tb = trigrams(b);
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

// ── Dedup checks ──────────────────────────────────────────────────────────────

interface DedupResult {
  isDuplicate: boolean;
  isSuppressed: boolean;
  suppressionReason: string | null;
}

async function runDedupChecks(
  emailTokenHash: string | null,
  rawEmail: string | null,
  normalizedPhone: string | null,
  websiteDomain: string | null,
  canonicalName: string | null,
): Promise<DedupResult> {
  // 1. Email match → duplicate or suppressed
  // Primary: hash match (indexed, fast).
  // Fallback: normalized plaintext match for legacy contacts where email_token_hash IS NULL
  // (contacts created before the hash column existed may still have an email but no hash).
  if (emailTokenHash || rawEmail) {
    const normalizedEmail = rawEmail ? rawEmail.trim().toLowerCase() : null;
    const emailMatch = rows<any>(await db.execute(sql`
      SELECT id, do_not_contact, opted_out_email, email_status, bounced_at
      FROM contacts
      WHERE (${emailTokenHash}::text IS NOT NULL AND email_token_hash = ${emailTokenHash ?? ""})
         OR (email_token_hash IS NULL AND ${normalizedEmail}::text IS NOT NULL
             AND lower(trim(email)) = ${normalizedEmail ?? ""})
      LIMIT 1
    `));
    if (emailMatch.length > 0) {
      const c = emailMatch[0];
      if (c.do_not_contact || c.opted_out_email || c.email_status === "bounced" || c.bounced_at) {
        return { isDuplicate: false, isSuppressed: true, suppressionReason: "existing_contact_suppressed_email" };
      }
      return { isDuplicate: true, isSuppressed: false, suppressionReason: "existing_contact_email" };
    }
  }

  // 2. Phone match
  if (normalizedPhone) {
    const phoneMatch = rows<any>(await db.execute(sql`
      SELECT id, do_not_contact
      FROM contacts
      WHERE regexp_replace(phone, '\D', '', 'g') = ${normalizedPhone}
        AND phone IS NOT NULL AND phone <> ''
      LIMIT 1
    `));
    if (phoneMatch.length > 0) {
      const c = phoneMatch[0];
      if (c.do_not_contact) {
        return { isDuplicate: false, isSuppressed: true, suppressionReason: "existing_contact_dnc_phone" };
      }
      return { isDuplicate: true, isSuppressed: false, suppressionReason: "existing_contact_phone" };
    }
  }

  // 3. Domain + company name similarity ≥ 0.85
  if (websiteDomain) {
    const normDomain = normalizeDomain(websiteDomain);
    if (normDomain) {
      const domainMatches = rows<any>(await db.execute(sql`
        SELECT id, company_name, do_not_contact, opted_out_email
        FROM contacts
        WHERE website IS NOT NULL
          AND lower(regexp_replace(website, '^https?://(www\.)?', '')) LIKE ${normDomain + "%"}
        LIMIT 20
      `));
      for (const c of domainMatches) {
        const sim = companySimilarity(canonicalName, c.company_name);
        if (sim >= 0.85) {
          if (c.do_not_contact || c.opted_out_email) {
            return { isDuplicate: false, isSuppressed: true, suppressionReason: "existing_contact_domain_suppressed" };
          }
          return { isDuplicate: true, isSuppressed: false, suppressionReason: "existing_contact_domain" };
        }
      }
    }
  }

  // 4. Suppression check without match (global DNC list, if any)
  // No global DNC list separate from contacts — covered above.

  // 5. Dedup against existing active pipeline master_leads
  // 5a. Email token hash match
  if (emailTokenHash) {
    const mlMatch = rows<any>(await db.execute(sql`
      SELECT id FROM master_leads
      WHERE email_token_hash = ${emailTokenHash}
        AND pipeline_origin = 'cro03_pipeline'
        AND status NOT IN ('duplicate', 'suppressed')
      LIMIT 1
    `));
    if (mlMatch.length > 0) {
      return { isDuplicate: true, isSuppressed: false, suppressionReason: "existing_pipeline_master_lead_email" };
    }
  }

  // 5b. Domain + company name similarity ≥0.85 against active pipeline master_leads
  // (guards against two distinct canonical business rows with the same domain+company)
  if (websiteDomain && canonicalName) {
    const normDomain = normalizeDomain(websiteDomain);
    if (normDomain) {
      const mlDomainMatches = rows<any>(await db.execute(sql`
        SELECT id, company FROM master_leads
        WHERE domain IS NOT NULL
          AND lower(regexp_replace(domain, '^https?://(www\.)?', '')) LIKE ${normDomain + "%"}
          AND pipeline_origin = 'cro03_pipeline'
          AND status NOT IN ('duplicate', 'suppressed')
        LIMIT 20
      `));
      for (const ml of mlDomainMatches) {
        const sim = companySimilarity(canonicalName, ml.company);
        if (sim >= 0.85) {
          return { isDuplicate: true, isSuppressed: false, suppressionReason: "existing_pipeline_master_lead_domain" };
        }
      }
    }
  }

  return { isDuplicate: false, isSuppressed: false, suppressionReason: null };
}

// ── Main stager logic ─────────────────────────────────────────────────────────

export async function processMasterLeadStagingIntent(intentId: string, opts?: { isTerminalAttempt?: boolean }): Promise<void> {
  const isTerminalAttempt = opts?.isTerminalAttempt ?? true; // default true so markIntentFailed fires if caller doesn't pass opts

  // Outer try-catch: covers the entire staging attempt.
  // Only marks the intent 'failed' (with a failed receipt) on the terminal BullMQ attempt.
  // Intermediate attempts rethrow so BullMQ retries with backoff, leaving the intent 'pending'.
  // Early-exit paths (not-found, already-consumed, etc.) return cleanly without throwing.
  let generationId: string | null = null;
  let canonicalBusinessId: number | null = null;

  try {
  // Atomically claim the intent — transitions 'pending' → 'processing' using a
  // worker-scoped lease token.  Only one worker can win this UPDATE.
  // If the intent has already been claimed, consumed, or failed by another worker
  // (including a recovery job), RETURNING produces no rows and we exit cleanly.
  // Atomic claim: transition 'pending' → 'processing' in a single UPDATE.
  // Only the first worker to execute this wins; any concurrent recovery job or
  // duplicate BullMQ delivery sees 0 RETURNING rows and exits cleanly.
  const claimed = rows<any>(await db.execute(sql`
    UPDATE master_lead_staging_intents
       SET status = 'processing', updated_at = NOW()
     WHERE id = ${intentId}::uuid
       AND status = 'pending'
    RETURNING id, canonical_business_id, cro03_generation_id
  `));

  if (claimed.length === 0) {
    // Either already processed by another worker, or not found. Safe to exit.
    console.log(`[MasterLeadStager] Intent ${intentId} could not be claimed — already processing/consumed/failed or not found; skipping`);
    return;
  }

  const intent = claimed[0];
  generationId = String(intent.cro03_generation_id);

  // Step 1: Resolve canonical_business_id through provenance chain
  const provenance = await resolveProvenance(generationId, intentId);
  if (!provenance) {
    // Provenance failure is always terminal — there is no transient path through which
    // provenance would resolve on retry without a data fix. Mark failed unconditionally.
    await markIntentFailed(intentId, "PROVENANCE_NOT_RESOLVED", null);
    return;
  }

  const { canonicalBusinessId: resolvedBizId, qualityScore } = provenance;
  canonicalBusinessId = resolvedBizId;

  // Step 2: Idempotency — if receipt already exists, mark consumed and exit
  const existingReceipt = rows<any>(await db.execute(sql`
    SELECT id FROM master_lead_staging_receipts
    WHERE cro03_generation_id = ${generationId}::uuid
      AND canonical_business_id = ${canonicalBusinessId}
    LIMIT 1
  `));

  if (existingReceipt.length > 0) {
    await markIntentConsumed(intentId);
    // Reconcile in case a prior run committed the receipt but exited before reconciling
    await reconcileGenerationBatch(generationId);
    console.log(`[MasterLeadStager] Receipt already exists for generation=${generationId} business=${canonicalBusinessId} — idempotent exit`);
    return;
  }

  // Step 3: Re-verify email_discovery_status at consume time
  const biz = await fetchBusiness(canonicalBusinessId);
  if (!biz || biz.emailDiscoveryStatus !== "provider_valid") {
    // Business not provider_valid at consume time — write suppressed receipt, consume
    await writeReceipt(generationId, canonicalBusinessId, null, "suppressed", "EMAIL_NOT_PROVIDER_VALID_AT_CONSUME");
    await markIntentConsumed(intentId);
    await writeAuditLog(canonicalBusinessId, generationId, "suppressed", "EMAIL_NOT_PROVIDER_VALID_AT_CONSUME");
    await reconcileGenerationBatch(generationId!);
    return;
  }

  const emailTokenHash = biz.mainEmail
    ? await computeEmailTokenHash(biz.mainEmail)
    : null;
  const maskedEmail = biz.mainEmail ? maskEmail(biz.mainEmail) : null;
  const normalizedPhone = normalizePhone(biz.phone);

  // Step 4: Dedup + suppression checks
  const dedupResult = await runDedupChecks(
    emailTokenHash,
    biz.mainEmail,      // rawEmail for legacy contacts with null hash
    normalizedPhone,
    biz.websiteDomain,
    biz.canonicalName,
  );

  if (dedupResult.isSuppressed) {
    await writeReceipt(generationId, canonicalBusinessId, null, "suppressed", dedupResult.suppressionReason);
    await markIntentConsumed(intentId);
    await writeAuditLog(canonicalBusinessId, generationId, "suppressed", dedupResult.suppressionReason);
    await reconcileGenerationBatch(generationId!);
    return;
  }

  if (dedupResult.isDuplicate) {
    await writeReceipt(generationId, canonicalBusinessId, null, "duplicate", dedupResult.suppressionReason);
    await markIntentConsumed(intentId);
    await writeAuditLog(canonicalBusinessId, generationId, "duplicate", dedupResult.suppressionReason);
    await reconcileGenerationBatch(generationId!);
    return;
  }

  // Steps 5–7: Atomic — master_leads INSERT + receipt INSERT + intent consumed in one transaction.
  // A crash anywhere inside leaves the intent as 'pending' (not consumed), so the worker retries.
  const fitTier = deriveFitTier(qualityScore);
  const hasPhone = Boolean(normalizedPhone);
  const readinessReason = deriveReadinessReason(hasPhone, false);

  let masterLeadId: string | null = null;
  try {
    await db.transaction(async (tx) => {
      // ── Advisory locks to serialize concurrent staging by dedup identity ─────
      // Two workers racing on the same email or phone will queue here; the second
      // worker's INSERT will then conflict on the partial unique index and produce
      // a duplicate receipt rather than a second active staged lead.
      if (emailTokenHash) {
        // Lock key: first 8 bytes of email_token_hash interpreted as int8
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(('x' || left(${emailTokenHash}, 16))::bit(64)::bigint)
        `);
      }
      if (normalizedPhone) {
        // Lock key: first 8 bytes of md5(phone) interpreted as int8
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(('x' || left(md5(${normalizedPhone}), 16))::bit(64)::bigint)
        `);
      }

      // 5a: Insert master_leads row
      const mlResult = rows<any>(await tx.execute(sql`
        INSERT INTO master_leads (
          pipeline_origin,
          canonical_business_id,
          cro03_generation_id,
          status,
          company,
          normalized_company,
          domain,
          masked_email,
          email_token_hash,
          email_type,
          phone,
          normalized_phone,
          vertical,
          county_fips,
          quality_score,
          fit_tier,
          outreach_readiness,
          readiness_reason,
          source,
          source_path,
          imported_at,
          created_at
        ) VALUES (
          'cro03_pipeline',
          ${canonicalBusinessId},
          ${generationId}::uuid,
          'staged',
          ${biz.canonicalName},
          ${biz.normalizedName},
          ${normalizeDomain(biz.websiteDomain)},
          ${maskedEmail},
          ${emailTokenHash},
          'provider_valid',
          ${biz.phone /* mapped from main_phone via fetchBusiness */},
          ${normalizedPhone},
          ${biz.vertical},
          ${biz.countyFips},
          ${qualityScore},
          ${fitTier},
          'pipeline_staged',
          ${readinessReason},
          'cro03_pipeline',
          ${generationId},
          NOW(),
          NOW()
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `));

      if (mlResult.length === 0) {
        // Partial unique index conflict — concurrent worker already staged this business.
        // Write duplicate receipt and consume intent atomically.
        await tx.execute(sql`
          INSERT INTO master_lead_staging_receipts
            (cro03_generation_id, canonical_business_id, master_lead_id, disposition, suppression_reason)
          VALUES
            (${generationId}::uuid, ${canonicalBusinessId}, NULL, 'duplicate', 'existing_pipeline_master_lead_active')
          ON CONFLICT (cro03_generation_id, canonical_business_id) DO NOTHING
        `);
        await tx.execute(sql`
          UPDATE master_lead_staging_intents
             SET status = 'consumed', consumed_at = NOW(), updated_at = NOW()
           WHERE id = ${intentId}::uuid
        `);
        return; // transaction commits both writes atomically
      }

      masterLeadId = String(mlResult[0].id);

      // 5b: Write staging receipt in same transaction
      await tx.execute(sql`
        INSERT INTO master_lead_staging_receipts
          (cro03_generation_id, canonical_business_id, master_lead_id, disposition, suppression_reason)
        VALUES
          (${generationId}::uuid, ${canonicalBusinessId}, ${masterLeadId}::uuid, 'staged', NULL)
        ON CONFLICT (cro03_generation_id, canonical_business_id) DO NOTHING
      `);

      // 5c: Mark intent consumed in same transaction
      await tx.execute(sql`
        UPDATE master_lead_staging_intents
           SET status = 'consumed', consumed_at = NOW(), updated_at = NOW()
         WHERE id = ${intentId}::uuid
      `);
    });
    // Inner transaction completed — rethrow any errors to the outer catch
  } catch (txErr: any) {
    // Rethrow so the outer catch handles terminal failure accounting
    throw txErr;
  }

  // If the conflict path ran, masterLeadId is null — log duplicate and return
  if (!masterLeadId) {
    await writeAuditLog(canonicalBusinessId, generationId, "duplicate", "existing_pipeline_master_lead_active");
    await reconcileGenerationBatch(generationId!);
    return;
  }

  // Step 8: Reconcile generation batch totals (non-critical, fire-and-forget)
  await reconcileGenerationBatch(generationId!);

  // Step 9: Audit log (non-critical — staging is already committed)
  await writeAuditLog(canonicalBusinessId, generationId!, "staged", readinessReason, masterLeadId);

  console.log(JSON.stringify({
    event: "master_lead_staged",
    intentId,
    masterLeadId,
    canonicalBusinessId,
    generationId,
    fitTier,
    readinessReason,
    ts: new Date().toISOString(),
  }));

  } catch (outerErr: any) {
    // Outer catch: covers ALL transient failures — business fetch, dedup checks, INSERT transaction.
    //
    // On terminal BullMQ attempt: mark intent failed + write a failed receipt.
    // On intermediate attempts: restore intent to 'pending' BEFORE rethrowing so the
    // next BullMQ attempt can reclaim it.  Without the restore, the intent stays
    // 'processing' and subsequent claims silently skip it (UPDATE WHERE status='pending'
    // returns 0 rows) — making the retry a no-op and permanently losing the record.
    if (isTerminalAttempt) {
      const reason = String(outerErr?.message ?? "STAGING_FAILED").slice(0, 500);
      const receiptCtx = (generationId && canonicalBusinessId)
        ? { generationId, canonicalBusinessId }
        : null;
      await markIntentFailed(intentId, reason, receiptCtx).catch(console.error);
    } else {
      // Restore to 'pending' so the next BullMQ attempt can reclaim.
      await db.execute(sql`
        UPDATE master_lead_staging_intents
           SET status = 'pending', updated_at = NOW()
         WHERE id = ${intentId}::uuid AND status = 'processing'
      `).catch(console.error);
    }
    throw outerErr;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function computeEmailTokenHash(email: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

async function markIntentConsumed(intentId: string): Promise<void> {
  // Accept both 'pending' and 'processing' — the caller may be on the idempotency-
  // exit path which runs before the atomic claim transition.
  await db.execute(sql`
    UPDATE master_lead_staging_intents
       SET status = 'consumed', consumed_at = NOW(), updated_at = NOW()
     WHERE id = ${intentId}::uuid
       AND status IN ('pending', 'processing')
  `);
}

async function markIntentFailed(
  intentId: string,
  reason: string,
  receipt?: { generationId: string; canonicalBusinessId: number } | null,
): Promise<void> {
  // Atomically: mark intent failed + write a failed staging receipt (if we have enough
  // context). The receipt is required for generation reconciliation (failed_count).
  // Accept 'processing' (normal terminal path) or 'pending' (provenance failure before claim).
  // Only write a failed receipt if the status transition actually affected a row —
  // if the intent was already consumed/failed by a concurrent worker, skip the receipt.
  let stateTransitionSucceeded = false;
  await db.transaction(async (tx) => {
    const updated = rows<any>(await tx.execute(sql`
      UPDATE master_lead_staging_intents
         SET status = 'failed', failure_reason = ${reason}, updated_at = NOW()
       WHERE id = ${intentId}::uuid AND status IN ('pending', 'processing')
      RETURNING id
    `));
    stateTransitionSucceeded = updated.length > 0;
    if (stateTransitionSucceeded && receipt) {
      await tx.execute(sql`
        INSERT INTO master_lead_staging_receipts
          (cro03_generation_id, canonical_business_id, master_lead_id, disposition, suppression_reason)
        VALUES
          (${receipt.generationId}::uuid, ${receipt.canonicalBusinessId}, NULL, 'failed', ${reason.slice(0, 500)})
        ON CONFLICT (cro03_generation_id, canonical_business_id) DO NOTHING
      `);
    }
  });
  // Reconcile generation totals after writing the failed receipt
  if (stateTransitionSucceeded && receipt) {
    await reconcileGenerationBatch(receipt.generationId);
  }
}

async function writeReceipt(
  generationId: string,
  canonicalBusinessId: number,
  masterLeadId: string | null,
  disposition: Disposition,
  suppressionReason: string | null,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO master_lead_staging_receipts
      (cro03_generation_id, canonical_business_id, master_lead_id, disposition, suppression_reason)
    VALUES
      (${generationId}::uuid, ${canonicalBusinessId}, ${masterLeadId ?? null}::uuid, ${disposition}, ${suppressionReason ?? null})
    ON CONFLICT (cro03_generation_id, canonical_business_id) DO NOTHING
  `);
}

async function writeAuditLog(
  canonicalBusinessId: number,
  generationId: string,
  disposition: string,
  readinessReason: string | null,
  masterLeadId?: string | null,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO audit_logs (user_id, action, entity_type, entity_key, details, actor_type, actor_id)
    VALUES (
      'system',
      'master_lead_staged',
      'master_lead',
      ${masterLeadId ?? String(canonicalBusinessId)},
      ${JSON.stringify(sanitizeAuditPayload({ canonicalBusinessId, cro03GenerationId: generationId, disposition, readinessReason, masterLeadId }))}::jsonb,
      'system',
      'master-lead-stager'
    )
  `);
}

export async function reconcileGenerationBatch(generationId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO master_lead_generation_batches
      (cro03_generation_id, total_submitted, staged_count, duplicate_count, suppressed_count, failed_count, reconciled_at)
    SELECT
      ${generationId}::uuid,
      COUNT(*)::int,
      COUNT(*) FILTER (WHERE disposition = 'staged')::int,
      COUNT(*) FILTER (WHERE disposition = 'duplicate')::int,
      COUNT(*) FILTER (WHERE disposition = 'suppressed')::int,
      COUNT(*) FILTER (WHERE disposition = 'failed')::int,
      NOW()
    FROM master_lead_staging_receipts
    WHERE cro03_generation_id = ${generationId}::uuid
    ON CONFLICT (cro03_generation_id) DO UPDATE
      SET total_submitted  = EXCLUDED.total_submitted,
          staged_count     = EXCLUDED.staged_count,
          duplicate_count  = EXCLUDED.duplicate_count,
          suppressed_count = EXCLUDED.suppressed_count,
          failed_count     = EXCLUDED.failed_count,
          reconciled_at    = EXCLUDED.reconciled_at,
          updated_at       = NOW()
  `);

  // Audit log for reconciliation
  const countsResult = rows<any>(await db.execute(sql`
    SELECT total_submitted, staged_count, duplicate_count, suppressed_count, failed_count
    FROM master_lead_generation_batches
    WHERE cro03_generation_id = ${generationId}::uuid
  `));

  if (countsResult.length > 0) {
    const c = countsResult[0];
    await db.execute(sql`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_key, details, actor_type, actor_id)
      VALUES (
        'system',
        'master_lead_generation_reconciled',
        'generation',
        ${generationId},
        ${JSON.stringify(sanitizeAuditPayload({
          cro03GenerationId: generationId,
          totalSubmitted: Number(c.total_submitted),
          stagedCount: Number(c.staged_count),
          duplicateCount: Number(c.duplicate_count),
          suppressedCount: Number(c.suppressed_count),
          failedCount: Number(c.failed_count),
        }))}::jsonb,
        'system',
        'master-lead-stager'
      )
    `);
  }
}

// ── Pending-intent recovery sweep ─────────────────────────────────────────────

/**
 * Re-enqueues any committed pending intents that have not been consumed.
 * Call on worker startup and periodically (e.g., every 10 min) to handle
 * queue-outage windows where the BullMQ job was never delivered.
 *
 * Safety: the stager worker's idempotency guards (receipt check + intent
 * status check) make re-enqueueing safe — duplicate jobs are no-ops.
 */
export async function recoverPendingIntents(opts?: { olderThanMinutes?: number; limit?: number }): Promise<{ recovered: number }> {
  const ageMinutes = opts?.olderThanMinutes ?? 5;
  const staleProcessingMinutes = 15; // processing rows older than this are presumed crashed
  const limit = Math.min(opts?.limit ?? 100, 500);

  // First: restore stale 'processing' rows to 'pending'.
  // A row stays 'processing' only if the worker crashed mid-flight (no rollback path
  // exists since each step is committed individually). Treat any 'processing' row
  // older than staleProcessingMinutes as crashed and make it reclaimable again.
  await db.execute(sql`
    UPDATE master_lead_staging_intents
       SET status = 'pending', updated_at = NOW()
     WHERE status = 'processing'
       AND updated_at < NOW() - (${staleProcessingMinutes} || ' minutes')::interval
  `);

  // Then select all recoverable pending rows (including those just restored).
  const pendingRows = rows<any>(await db.execute(sql`
    SELECT id
    FROM master_lead_staging_intents
    WHERE status = 'pending'
      AND created_at < NOW() - (${ageMinutes} || ' minutes')::interval
    ORDER BY created_at ASC
    LIMIT ${limit}
  `));

  if (pendingRows.length === 0) return { recovered: 0 };

  // Lazy import queue manager to avoid circular deps at module load time
  let enqueued = 0;
  try {
    const { requireQueueManagerReady } = await import("../services/queue-manager");
    const { QUEUE_NAMES } = await import("../services/queue-names");
    const qm = requireQueueManagerReady();
    const queue = qm.getQueue(QUEUE_NAMES.MASTER_LEAD_STAGER);
    if (!queue) {
      console.warn("[MasterLeadStager:recover] MASTER_LEAD_STAGER queue not available — will retry on next sweep");
      return { recovered: 0 };
    }
    for (const row of pendingRows) {
      try {
        await queue.add("stage-intent", { intentId: String(row.id) }, {
          jobId: `mi07-recovery-${row.id}`,
          removeOnComplete: true,
          removeOnFail: false,
        });
        enqueued++;
      } catch {
        // BullMQ deduplicates by jobId; a conflict means it's already queued — safe to ignore
      }
    }
  } catch (err) {
    console.warn("[MasterLeadStager:recover] Queue not available, will retry on next sweep:", err);
  }

  if (enqueued > 0) {
    console.log(`[MasterLeadStager:recover] Re-enqueued ${enqueued} pending intents (age>${ageMinutes}min)`);
  }

  return { recovered: enqueued };
}
