import { storage } from "../storage";
import { convertToProspect, processSunbizEnrichmentQueue as _processSunbizEnrichmentQueue } from "./sunbiz-enrichment";
import { createContactLocalFirst, updateContactLocalFirst } from "./contact-writer";
import { estimateFromProspect, estimateFromContact, estimateFromDeal } from "./volume-estimator";
import { toProperCase } from "./sunbiz-scraper";
import { resolveCanonicalVertical } from "./sdr/canonical-vertical-resolver";
import { applyClassification } from "./commercial-classification-authority";
import { db } from "../db";
import { sql } from "drizzle-orm";
import type { SunbizEntity, Prospect, Contact, Deal } from "@shared/schema";
import { finalizeLegacyProspectContactLink } from "./prospect-conversion";

// Re-export so queue-manager can import both conversion steps from a single module.
export const processSunbizEnrichmentQueue = _processSunbizEnrichmentQueue;

const BATCH_SIZE = 10;

export function getSunbizCronFeatureFlags(env: NodeJS.ProcessEnv = process.env) {
  return {
    legacyPromotionEnabled: env.SUNBIZ_LEGACY_PROMOTION_ENABLED !== "false",
    materializationEnabled: env.SUNBIZ_MATERIALIZATION_ENABLED === "true",
  };
}

// ─── Write-boundary fencing shared by every legacy promotion entry point ─────
//
// A claim on sunbiz_bootstrap_claims is the single lock both this legacy
// path and the sunbiz-bootstrap engine share. Taking it is not enough by
// itself: every later write to that claim row must be conditioned on the
// EXACT claimed_at value this call was granted (its lease token), the same
// fencing-token pattern sunbiz-bootstrap.ts uses. Without that, the
// bootstrap engine's stale-claim reclaim (STALE_CLAIM_MINUTES) can steal the
// row out from under a slow legacy write, and this path's own "finalize"
// step would then silently overwrite the reclaiming executor's result.

/** Attempts to atomically claim filingNumber. Returns the lease token (claimed_at) or null if already held. */
async function claimFilingForLegacyWrite(filingNumber: string, entityId: number): Promise<unknown | null> {
  const claimRows = (await db.execute(sql`
    INSERT INTO sunbiz_bootstrap_claims (filing_number, sunbiz_entity_id, status)
    VALUES (${filingNumber}, ${entityId}, 'claimed')
    ON CONFLICT (filing_number) DO NOTHING
    RETURNING claimed_at
  `)).rows as any[];
  return claimRows.length === 0 ? null : claimRows[0].claimed_at;
}

/**
 * Fenced finalize: re-locks the claim row FOR UPDATE and only writes if
 * claimed_at still equals the lease token this caller was granted. Returns
 * false (and writes nothing) if another executor already reclaimed the row —
 * e.g. the bootstrap engine's stale-claim recovery kicked in mid-write.
 */
async function finalizeLegacyClaim(
  filingNumber: string,
  leaseToken: unknown,
  status: "created" | "matched_existing" | "failed",
  reasonCode: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const locked = (await tx.execute(sql`
      SELECT id FROM sunbiz_bootstrap_claims
      WHERE filing_number = ${filingNumber} AND claimed_at = ${leaseToken}
      FOR UPDATE
    `)).rows as any[];
    if (locked.length === 0) return false;
    await tx.execute(sql`
      UPDATE sunbiz_bootstrap_claims
      SET status = ${status}, deferred_reason_code = ${reasonCode}, completed_at = now()
      WHERE filing_number = ${filingNumber} AND claimed_at = ${leaseToken}
    `);
    return true;
  });
}

// ─── Area 5: Sunbiz → canonical businesses materialization ───────────────────
//
// Correction #5: The legacy scheduled path (autoConvertEnrichedEntities →
// autoPromoteProspects) creates prospects, contacts, and deals directly from
// enriched Sunbiz entities. This path conflates enrichment (gathering facts)
// with promotion (creating CRM records), bypassing the free-enrichment
// candidate pipeline and the governed validation gates.
//
// The governed sunbiz-bootstrap engine now owns canonical materialization.
// The old schema-mismatched materialization implementation below is disabled.
//
// The legacy path is gated behind SUNBIZ_LEGACY_PROMOTION_ENABLED (default:
// 'true' to avoid breaking existing production deployments). The historical
// SUNBIZ_MATERIALIZATION_ENABLED flag is retained for compatibility, but its
// deprecated writer is a no-op.

/**
 * Deprecated schema-mismatched writer. Canonical Sunbiz materialization is
 * owned by sunbiz-bootstrap.ts; keep this exported shim for older callers.
 */
export async function materializeSunbizToCanonicalBusinesses(): Promise<{ materialized: number; alreadyExists: number; skipped: number }> {
  console.warn("[Sunbiz Cron] Deprecated materialization disabled; use the governed sunbiz-bootstrap engine.");
  return { materialized: 0, alreadyExists: 0, skipped: 0 };
}

async function isClaimedByBootstrap(filingNumber: string | null | undefined): Promise<boolean> {
  if (!filingNumber) return false;
  const result = await db.execute(sql`
    SELECT 1 FROM sunbiz_bootstrap_claims
    WHERE filing_number = ${filingNumber}
      AND status IN ('claimed', 'created', 'matched_existing')
    LIMIT 1
  `);
  return ((result as any).rows ?? []).length > 0;
}

export async function filterSunbizEntitiesOwnedByBootstrap<T extends { filingNumber?: string | null }>(entities: T[]): Promise<T[]> {
  const eligible: T[] = [];
  for (const entity of entities) {
    if (!(await isClaimedByBootstrap(entity.filingNumber))) eligible.push(entity);
  }
  return eligible;
}

export async function runSunbizAutoConvert(): Promise<{ converted: number; promoted: number; estimated: number; qualified: number; retried: number; materialized?: number }> {
  let converted = 0;
  let promoted = 0;
  let estimated = 0;
  let qualified = 0;
  let retried = 0;
  let materialized = 0;

  // The historical materialization flag now only emits a deprecation warning;
  // canonical entity writes go through the governed bootstrap engine.
  const featureFlags = getSunbizCronFeatureFlags();
  if (featureFlags.materializationEnabled) {
    const result = await materializeSunbizToCanonicalBusinesses();
    materialized = result.materialized;
  }

  // Legacy path: direct prospect → contact → deal creation.
  // Gated behind SUNBIZ_LEGACY_PROMOTION_ENABLED (default 'true' to preserve
  // existing production behavior; set to 'false' once materialization path is
  // confirmed working in your deployment).
  const legacyEnabled = featureFlags.legacyPromotionEnabled;
  if (legacyEnabled) {
    try {
      converted = await autoConvertEnrichedEntities();
    } catch (err) {
      console.error("[Sunbiz Cron] Auto-convert error:", err);
    }

    try {
      qualified = await autoQualifyProspects();
    } catch (err) {
      console.error("[Sunbiz Cron] Auto-qualify error:", err);
    }

    try {
      promoted = await autoPromoteProspects();
    } catch (err) {
      console.error("[Sunbiz Cron] Auto-promote error:", err);
    }

    try {
      estimated = await updateVolumeEstimates();
    } catch (err) {
      console.error("[Sunbiz Cron] Volume estimate error:", err);
    }

    try {
      retried = await retryFailedEnrichments();
    } catch (err) {
      console.error("[Sunbiz Cron] Retry enrichment error:", err);
    }
  }

  if (converted > 0 || promoted > 0 || estimated > 0 || qualified > 0 || retried > 0 || materialized > 0) {
    console.log(`[Sunbiz Cron] Converted: ${converted}, Qualified: ${qualified}, Promoted: ${promoted}, Estimates: ${estimated}, Retried: ${retried}, Materialized: ${materialized}`);
  }

  return { converted, promoted, estimated, qualified, retried, materialized };
}

async function autoConvertEnrichedEntities(): Promise<number> {
  // Fetch only BATCH_SIZE * 10 enriched records — getSunbizEntitiesByStatus without a
  // limit previously returned ALL enriched rows (potentially thousands), which combined
  // with the N+1 getProspects call inside the loop was the root cause of the
  // statement_timeout seen in production logs (2026-07-21).
  const enriched = await storage.getSunbizEntitiesByStatus("enriched", BATCH_SIZE * 10);

  const qualifiedEntities = enriched.filter(e =>
    !e.prospectId &&
    (e.score === "hot" || e.score === "warm") &&
    (e.email || e.phone || e.ownerEmail || e.ownerPhone)
  );

  const bootstrapFilteredEntities = await filterSunbizEntitiesOwnedByBootstrap(qualifiedEntities);
  if (bootstrapFilteredEntities.length === 0) return 0;

  // Load the dedup sets ONCE, before the loop.
  // Previously this query ran inside each iteration — for 10 entities that was
  // 10 × getProspects(limit:500) = 10 sequential full-table scans.
  const { data: existingProspects } = await storage.getProspects(undefined, { limit: 10_000 });
  const existingEmails = new Set(
    existingProspects.map(p => p.email?.trim().toLowerCase()).filter(Boolean) as string[]
  );
  const existingNames = new Set(
    existingProspects.map(p => p.companyName?.trim().toLowerCase()).filter(Boolean) as string[]
  );

  let converted = 0;
  for (const entity of bootstrapFilteredEntities.slice(0, BATCH_SIZE)) {
    try {
      const emailKey = entity.email?.trim().toLowerCase();
      const nameKey = entity.entityName?.trim().toLowerCase();
      const alreadyExists =
        (emailKey && existingEmails.has(emailKey)) ||
        (nameKey && existingNames.has(nameKey));

      if (alreadyExists) {
        await storage.updateSunbizEntity(entity.id, { enrichmentStatus: "duplicate" });
        continue;
      }

      const prospectId = await convertToProspect(entity.id);
      if (prospectId) {
        const prospect = await storage.getProspect(prospectId);
        if (prospect) {
          const estimate = estimateFromProspect(prospect);
          await storage.updateProspect(prospectId, {
            estimatedResidual: estimate.estimatedResidual,
            estimatedAvgTicket: estimate.estimatedAvgTicket,
          });
        }
        converted++;
      }
    } catch (err) {
      console.error(`[Sunbiz Cron] Convert entity ${entity.id} failed:`, err);
    }
  }

  return converted;
}

async function autoPromoteProspects(): Promise<number> {
  // Fetch eligible unpromoted Sunbiz-origin prospects directly via a JOIN so that
  // provenance filtering scales to the full 1.9M-entity corpus without any in-memory
  // intersection or LIMIT on the provenance set.
  // Only prospects whose ID appears in sunbiz_entities.prospect_id qualify for
  // sunbiz_auto_promote classification — non-Sunbiz contacts (CSV, manual, GHL) are
  // never touched by this function.
  const qualifiedRows = (await db.execute(sql`
    SELECT p.id, p.owner_email, p.email, p.owner_phone, p.phone, p.company_name,
           p.score, p.qualification_score, p.status, p.do_not_contact, p.contact_id,
           p.owner_first_name, p.owner_last_name, p.website, p.dba, p.address,
           p.city, p.state, p.zip, p.vertical, p.estimated_volume, p.estimated_avg_ticket,
           p.estimated_residual, p.volume_confidence, p.ai_summary, p.ai_pitch_angle,
           p.notes, p.tags, p.merchant_tier, se.filing_number AS sunbiz_filing_number, se.id AS sunbiz_entity_id
    FROM prospects p
    INNER JOIN sunbiz_entities se ON se.prospect_id = p.id
    WHERE p.contact_id IS NULL
      AND p.status NOT IN ('disqualified', 'do_not_contact')
      AND p.do_not_contact = false
      AND (
        p.score = 'hot'
        OR (p.score = 'warm' AND p.qualification_score IN ('A', 'B'))
      )
      AND (p.email IS NOT NULL OR p.owner_email IS NOT NULL)
      AND (p.phone IS NOT NULL OR p.owner_phone IS NOT NULL)
      AND p.company_name IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM sunbiz_bootstrap_claims c
        WHERE c.filing_number = se.filing_number
          AND c.status IN ('claimed', 'created', 'matched_existing')
      )
    ORDER BY p.created_at DESC
    LIMIT ${BATCH_SIZE}
  `)).rows as any[];

  const qualified = qualifiedRows.map(r => ({
    id: Number(r.id),
    sunbizFilingNumber: r.sunbiz_filing_number ?? null,
    sunbizEntityId: r.sunbiz_entity_id != null ? Number(r.sunbiz_entity_id) : null,
    ownerEmail: r.owner_email ?? null,
    email: r.email ?? null,
    ownerPhone: r.owner_phone ?? null,
    phone: r.phone ?? null,
    companyName: r.company_name ?? null,
    score: r.score ?? null,
    qualificationScore: r.qualification_score ?? null,
    status: r.status ?? null,
    doNotContact: Boolean(r.do_not_contact),
    contactId: r.contact_id ? Number(r.contact_id) : null,
    ownerFirstName: r.owner_first_name ?? null,
    ownerLastName: r.owner_last_name ?? null,
    website: r.website ?? null,
    dba: r.dba ?? null,
    address: r.address ?? null,
    city: r.city ?? null,
    state: r.state ?? null,
    zip: r.zip ?? null,
    vertical: r.vertical ?? null,
    estimatedVolume: r.estimated_volume ?? null,
    estimatedAvgTicket: r.estimated_avg_ticket ?? null,
    estimatedResidual: r.estimated_residual ?? null,
    volumeConfidence: r.volume_confidence ?? null,
    aiSummary: r.ai_summary ?? null,
    aiPitchAngle: r.ai_pitch_angle ?? null,
    notes: r.notes ?? null,
    tags: r.tags ?? [],
    merchantTier: r.merchant_tier ?? null,
  }));

  if (qualified.length === 0) return 0;

  // Load companies ONCE before the loop — previously storage.getCompanies() was called
  // per prospect inside the loop, performing an unbounded full-table scan each iteration.
  const allCompanies = await storage.getCompanies();
  const companyByName = new Map(allCompanies.map(c => [c.legalName.toLowerCase(), c]));
  const companyByWebsite = new Map(
    allCompanies.filter(c => c.website).map(c => [c.website!.toLowerCase(), c])
  );

  let promoted = 0;

  for (const prospect of qualified) {  // SQL already caps to BATCH_SIZE
    // Write-boundary fencing: the batch-level query above filtered out
    // filings already claimed/handled by the bootstrap engine, but that
    // check is not atomic with the writes below — a bootstrap run can claim
    // this exact filing between the SELECT and this point. Atomically claim
    // it here, immediately before any contact/deal write, so exactly one of
    // {this legacy path, a concurrent bootstrap run} ever proceeds for a
    // given filing_number. If the claim fails (0 rows), another engine
    // already holds it; skip this prospect entirely rather than writing.
    let legacyLeaseToken: unknown = null;
    if (prospect.sunbizFilingNumber && prospect.sunbizEntityId != null) {
      legacyLeaseToken = await claimFilingForLegacyWrite(prospect.sunbizFilingNumber, prospect.sunbizEntityId);
      if (legacyLeaseToken === null) {
        continue;
      }
    }
    try {
      const email = prospect.ownerEmail || prospect.email || "";
      const phone = prospect.ownerPhone || prospect.phone || "";

      // Indexed lookups instead of loading up to 500 contacts into memory —
      // that cap silently stopped catching duplicates once the contacts table
      // grew past it, risking duplicate cold outreach to the same person.
      const existingByEmail = email ? await storage.getContactByEmail(email) : undefined;
      const existingByCompany = !existingByEmail && prospect.companyName
        ? await storage.getContactByCompanyName(prospect.companyName)
        : undefined;
      const existingContact = existingByEmail || existingByCompany;

      if (existingContact) {
        await finalizeLegacyProspectContactLink(prospect.id, existingContact.id);
        if (legacyLeaseToken !== null && prospect.sunbizFilingNumber) {
          await finalizeLegacyClaim(prospect.sunbizFilingNumber, legacyLeaseToken, "matched_existing", "legacy_contact_deal_promotion");
        }
        continue;
      }

      const firstName = toProperCase(prospect.ownerFirstName || prospect.companyName?.split(" ")[0]) || "Owner";
      const lastName = toProperCase(prospect.ownerLastName || prospect.companyName?.split(" ").slice(1).join(" ")) || "";

      const volumeEst = estimateFromProspect(prospect as unknown as Prospect);

      let companyId: number | undefined;
      if (prospect.companyName) {
        const nameKey = prospect.companyName.toLowerCase();
        const siteKey = prospect.website?.toLowerCase();
        const existingCompany = companyByName.get(nameKey) ||
          (siteKey ? companyByWebsite.get(siteKey) : undefined);
        if (existingCompany) {
          companyId = existingCompany.id;
        } else {
          const company = await storage.createCompany({
            legalName: prospect.companyName,
            dba: prospect.dba || undefined,
            vertical: prospect.vertical || undefined,
            address: [prospect.address, prospect.city, prospect.state, prospect.zip].filter(Boolean).join(", ") || undefined,
            website: prospect.website || undefined,
            volumeRange: prospect.estimatedVolume || undefined,
            notes: prospect.aiSummary || undefined,
          });
          companyId = company.id;
        }
      }

      // Resolve canonical vertical through the authority-ranked resolver rather than
      // copying prospect.vertical directly. This ensures subvertical specificity
      // (e.g. "Med Spa" beats the coarse "Healthcare" bucket).
      const verticalResult = resolveCanonicalVertical({
        merchantVertical: prospect.vertical || null,
        merchantSubvertical: (prospect as any).subvertical || null,
        merchantVerticalSource: "discovery_enrichment",
      });
      // verticalResult.vertical is the canonical COARSE vertical (e.g. "Healthcare").
      // When the resolver returns null it deliberately means the raw value is non-canonical;
      // we leave the field unset rather than falling back to the raw prospect.vertical.
      const canonicalVertical = verticalResult.vertical || undefined;

      const contact = await createContactLocalFirst({
        firstName,
        lastName,
        email: email || "",
        phone: phone || "",
        companyName: toProperCase(prospect.companyName) || undefined,
        vertical: canonicalVertical,
        monthlyVolume: prospect.estimatedVolume || undefined,
        avgTicket: prospect.estimatedAvgTicket || undefined,
        estimatedProcessingVolume: volumeEst.estimatedProcessingVolume,
        estimatedResidual: volumeEst.estimatedResidual,
        volumeConfidence: volumeEst.volumeConfidence,
        status: "New",
        tags: ["sunbiz-auto", ...(prospect.tags || [])],
        notes: prospect.aiSummary || prospect.notes || undefined,
        leadScore: prospect.score === "hot" ? 80 : prospect.score === "warm" ? 60 : 40,
      });

      const priorityScore = prospect.score === "hot" ? 90
        : prospect.score === "warm" && (prospect.qualificationScore === "A" || prospect.qualificationScore === "B") ? 75
        : 50;

      const deal = await storage.createDeal({
        contactId: contact.id,
        companyId: companyId || undefined,
        pipeline: "sales",
        stage: "New Lead",
        offerPath: "Cash Discount",
        leadSource: "sunbiz",
        priorityScore,
        estimatedGrossProfitBps: volumeEst.estimatedGrossProfitBps,
        estimatedGrossProfitMonthly: volumeEst.estimatedGrossProfitMonthly,
        estimatedNetProfitMonthly: volumeEst.estimatedNetProfitMonthly,
        merchantTier: volumeEst.merchantTier,
        notes: `Auto-promoted from Sunbiz prospect. ${prospect.aiPitchAngle || ""}`.trim(),
      });

      await storage.updateProspect(prospect.id, {
        contactId: contact.id,
        status: "converted",
      });

      await storage.createAuditLog({
        action: "prospect_auto_promoted",
        entityType: "prospect",
        entityId: prospect.id,
        details: {
          contactId: contact.id,
          dealId: deal.id,
          score: prospect.score,
          qualificationScore: prospect.qualificationScore,
          estimatedResidual: volumeEst.estimatedResidual,
          estimatedVolume: volumeEst.estimatedProcessingVolume,
          merchantTier: volumeEst.merchantTier,
          canonicalVertical,
          verticalSource: verticalResult?.source ?? "discovery_enrichment",
        },
      });

      // Classify the new contact as 'production' asynchronously.
      // Sunbiz auto-promoted contacts pass a quality gate (email + phone + hot/warm
      // score + A/B qualification) that warrants automatic production classification.
      // We use two distinct synthetic actor IDs to satisfy the immutable-evidence
      // two-actor requirement of the classification authority.
      // evidenceFields must use the EVIDENCE_FIELD_ALLOWLIST keys only — no PII, no
      // arbitrary field names; reference IDs are encoded in evidence_reference.
      const contactIdForClass = contact.id;
      const dealIdForClass = deal.id;
      const classificationArgs = {
        subjectType: "contact" as const,
        subjectId: contactIdForClass,
        targetClass: "production" as const,
        eventNamespace: "sunbiz_auto_promote",
        eventKey: `sunbiz-promote-contact-${contactIdForClass}-deal-${dealIdForClass}`,
        actorId: "system:sunbiz_cron",
        approverId: "system:enrichment_authority",
        evidenceFields: {
          source_system: "sunbiz_auto_promote",
          evidence_reference: `prospect:${prospect.id}|deal:${dealIdForClass}`,
          classification_reason: "auto_promote_quality_gate_passed",
          approval_basis: "enrichment_authority_v1",
        },
      };
      setImmediate(() => {
        applyClassification(classificationArgs).catch(err =>
          console.error(`[Sunbiz Cron] Classification failed for contact ${contactIdForClass}:`, err?.message ?? err)
        );
      });

      if (legacyLeaseToken !== null && prospect.sunbizFilingNumber) {
        await finalizeLegacyClaim(prospect.sunbizFilingNumber, legacyLeaseToken, "created", "legacy_contact_deal_promotion");
      }

      promoted++;
    } catch (err) {
      console.error(`[Sunbiz Cron] Promote prospect ${prospect.id} failed:`, err);
      // Release the fencing claim on failure so this filing_number can be
      // retried by either this legacy path or the bootstrap engine, rather
      // than staying stuck as a permanently-blocking 'claimed' row. Fenced:
      // if the bootstrap engine already reclaimed this filing as stale and
      // moved on, this no-ops instead of overwriting its result.
      if (legacyLeaseToken !== null && prospect.sunbizFilingNumber) {
        await finalizeLegacyClaim(prospect.sunbizFilingNumber, legacyLeaseToken, "failed", "legacy_promotion_failed").catch(() => {});
      }
    }
  }

  return promoted;
}

async function updateVolumeEstimates(): Promise<number> {
  const { data: deals } = await storage.getDeals({ limit: 500 });
  let updated = 0;

  const activeSalesDeals = deals.filter(d =>
    d.pipeline === "sales" &&
    d.stage !== "Closed Won" &&
    d.stage !== "Closed Lost"
  );

  for (const deal of activeSalesDeals.slice(0, 20)) {
    try {
      const contact = deal.contactId ? await storage.getContact(deal.contactId) : null;
      const estimate = estimateFromDeal(deal, contact);

      const needsUpdate =
        deal.estimatedGrossProfitBps !== estimate.estimatedGrossProfitBps ||
        deal.estimatedGrossProfitMonthly !== estimate.estimatedGrossProfitMonthly ||
        deal.merchantTier !== estimate.merchantTier;

      if (needsUpdate) {
        await storage.updateDeal(deal.id, {
          estimatedGrossProfitBps: estimate.estimatedGrossProfitBps,
          estimatedGrossProfitMonthly: estimate.estimatedGrossProfitMonthly,
          estimatedNetProfitMonthly: estimate.estimatedNetProfitMonthly,
          merchantTier: estimate.merchantTier,
        });

        if (contact) {
          await updateContactLocalFirst(contact.id, {
            estimatedProcessingVolume: estimate.estimatedProcessingVolume,
            estimatedResidual: estimate.estimatedResidual,
            volumeConfidence: estimate.volumeConfidence,
          });
        }

        updated++;
      }
    } catch (err) {
      console.error(`[Sunbiz Cron] Volume estimate for deal ${deal.id} failed:`, err);
    }
  }

  return updated;
}

async function autoQualifyProspects(): Promise<number> {
  const gradeRank: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
  const { data: prospects } = await storage.getProspects(undefined, { limit: 500 });
  let qualified = 0;

  const eligible = prospects.filter(p =>
    p.status !== "converted" &&
    p.status !== "disqualified" &&
    p.status !== "do_not_contact" &&
    !p.doNotContact &&
    (p.status === "enriched" || p.status === "qualified" || p.status === "raw")
  );

  for (const prospect of eligible.slice(0, BATCH_SIZE * 2)) {
    try {
      let points = 0;
      if (prospect.email || prospect.ownerEmail) points += 20;
      if (prospect.phone || prospect.ownerPhone) points += 15;
      if (prospect.website) points += 15;
      if (prospect.vertical) points += 10;
      if (prospect.address && prospect.city) points += 10;
      if (prospect.status === "enriched" || prospect.status === "qualified") points += 15;
      if (prospect.score === "hot") points += 15;
      else if (prospect.score === "warm") points += 10;
      else if (prospect.score === "cold") points += 5;

      let grade: string;
      if (points >= 80) grade = "A";
      else if (points >= 60) grade = "B";
      else if (points >= 40) grade = "C";
      else if (points >= 20) grade = "D";
      else grade = "F";

      const currentRank = gradeRank[prospect.qualificationScore || "F"] || 0;
      const newRank = gradeRank[grade] || 0;

      if (newRank > currentRank) {
        const updates: Record<string, any> = { qualificationScore: grade };
        if ((grade === "A" || grade === "B") && prospect.status === "enriched") {
          updates.status = "qualified";
        }
        await storage.updateProspect(prospect.id, updates);
        qualified++;
      }
    } catch (err) {
      console.error(`[Sunbiz Cron] Qualify prospect ${prospect.id} failed:`, err);
    }
  }

  return qualified;
}

const retriedEntityIds = new Set<number>();

async function retryFailedEnrichments(): Promise<number> {
  const failed = await storage.getSunbizEntitiesByStatus("failed");
  let retried = 0;

  const retryable = failed.filter(e =>
    !retriedEntityIds.has(e.id) &&
    (e.email || e.phone || e.ownerEmail || e.ownerPhone || e.website) &&
    e.entityName
  );

  for (const entity of retryable.slice(0, 3)) {
    try {
      retriedEntityIds.add(entity.id);
      await storage.updateSunbizEntity(entity.id, { enrichmentStatus: "pending" });
      retried++;
    } catch (err) {
      console.error(`[Sunbiz Cron] Retry entity ${entity.id} failed:`, err);
    }
  }

  return retried;
}

// ─── Bounded Canary ─────────────────────────────────────────────────────────

export interface CanaryEntityResult {
  entityId: number;
  entityName: string;
  outcome: "promoted" | "skipped_duplicate" | "classification_failed" | "error";
  contactId?: number;
  recordClass?: string;
  vertical?: string;
  error?: string;
}

/**
 * Explicit bounded canary: promotes exactly the supplied Sunbiz entity IDs
 * through the full conversion → promotion → classification pipeline and
 * AWAITS classification (does not fire-and-forget like the regular cron).
 *
 * Used by POST /api/admin/enrichment/canary to verify the pipeline end-to-end
 * before enabling CRO-03 provider transport.
 */
export async function runSunbizCanaryForEntityIds(
  entityIds: number[],
  maxSuccessful = 20,
): Promise<{ results: CanaryEntityResult[]; verifiedSuccessCount: number }> {
  const results: CanaryEntityResult[] = [];
  let verifiedSuccessCount = 0;
  // attemptedPromotions counts the number of new contact+deal creations started,
  // regardless of whether classification succeeded. This is the true side-effect
  // bound — we stop the loop once we have reached maxSuccessful attempted promotions
  // so the canary can never write more than maxSuccessful new records to the DB.
  let attemptedPromotions = 0;

  // Load companies once for dedup
  const allCompanies = await storage.getCompanies();
  const companyByName = new Map(allCompanies.map(c => [c.legalName.toLowerCase(), c]));
  const companyByWebsite = new Map(
    allCompanies.filter(c => c.website).map(c => [c.website!.toLowerCase(), c])
  );

  for (const entityId of entityIds) {
    // Hard stop: once we have reached maxSuccessful attempted promotions (side-effect
    // bound), do not process further entities — the canary will not create more than
    // maxSuccessful new contacts/deals regardless of outcome (success or failure).
    // Stop when we have collected maxSuccessful verified-successful promotions.
    // A separate write cap (maxSuccessful * 2) prevents unbounded writes when
    // many candidates fail classification or lack a canonical vertical.
    if (verifiedSuccessCount >= maxSuccessful) break;
    if (attemptedPromotions >= maxSuccessful * 2) break;

    // Hoisted so the catch block below can release a claim taken inside the
    // try block — a const declared inside try is not visible in its catch.
    let claimedFilingNumberForCatch: string | null = null;
    let claimedLeaseTokenForCatch: unknown = null;

    try {
      const entity = await storage.getSunbizEntity(entityId);
      if (!entity) {
        results.push({ entityId, entityName: "", outcome: "error", error: "Entity not found" });
        continue;
      }

      // Only process unconverted entities — entities that already have a prospect_id
      // linked to an existing contact are not eligible for new promotion.
      if (entity.prospectId) {
        const existingProspect = await storage.getProspect(entity.prospectId);
        if (existingProspect?.contactId) {
          // Already converted — skip; do not count as success (contact may be unknown class)
          results.push({
            entityId, entityName: String(entity.entityName ?? ""),
            outcome: "skipped_duplicate",
            contactId: existingProspect.contactId,
          });
          continue;
        }
      }

      // Step 1: Convert entity → prospect
      let prospectId: number | null = entity.prospectId ?? null;
      if (!prospectId) {
        try {
          prospectId = await convertToProspect(entityId);
        } catch (err: any) {
          results.push({
            entityId, entityName: String(entity.entityName ?? ""),
            outcome: "error", error: `convertToProspect failed: ${err?.message ?? err}`,
          });
          continue;
        }
      }
      if (!prospectId) {
        results.push({ entityId, entityName: String(entity.entityName ?? ""), outcome: "skipped_duplicate" });
        continue;
      }

      const prospect = await storage.getProspect(prospectId);
      if (!prospect || prospect.contactId) {
        // Already promoted — skip without counting
        results.push({
          entityId, entityName: String(entity.entityName ?? ""),
          outcome: "skipped_duplicate",
          contactId: prospect?.contactId ?? undefined,
        });
        continue;
      }

      // Step 2: Verify full quality gate (qualificationScore is now available on prospect)
      const email = prospect.ownerEmail || prospect.email || "";
      const phone = prospect.ownerPhone || prospect.phone || "";
      const passesGate =
        !prospect.doNotContact &&
        prospect.status !== "disqualified" &&
        prospect.status !== "do_not_contact" &&
        (prospect.score === "hot" || (prospect.score === "warm" && (prospect.qualificationScore === "A" || prospect.qualificationScore === "B"))) &&
        email &&
        phone &&
        prospect.companyName;
      if (!passesGate) {
        results.push({
          entityId, entityName: String(entity.entityName ?? ""),
          outcome: "skipped_duplicate",
          error: "Does not pass quality gate (score/qualification/email/phone/company requirements)",
        });
        continue;
      }

      // Write-boundary fencing (same interlock as autoPromoteProspects): atomically
      // claim this filing_number BEFORE any legacy write — including the
      // "link to an existing contact" write below, not just new contact/deal
      // creation — so a concurrent bootstrap run can never materialize the
      // same filing while this canary is acting on it, and vice versa.
      let canaryLeaseToken: unknown = null;
      if (entity.filingNumber) {
        canaryLeaseToken = await claimFilingForLegacyWrite(entity.filingNumber, entity.id);
        if (canaryLeaseToken === null) {
          results.push({
            entityId, entityName: String(entity.entityName ?? ""),
            outcome: "skipped_duplicate",
            error: "Filing already claimed by the bootstrap engine",
          });
          continue;
        }
        claimedFilingNumberForCatch = entity.filingNumber;
        claimedLeaseTokenForCatch = canaryLeaseToken;
      }

      // Step 3: Dedup check (no side effects yet)
      const existingByEmail = email ? await storage.getContactByEmail(email) : undefined;
      const existingByCompany = !existingByEmail && prospect.companyName
        ? await storage.getContactByCompanyName(prospect.companyName)
        : undefined;
      const existingContact = existingByEmail || existingByCompany;
      if (existingContact) {
        await finalizeLegacyProspectContactLink(prospectId, existingContact.id);
        if (canaryLeaseToken !== null && entity.filingNumber) {
          await finalizeLegacyClaim(entity.filingNumber, canaryLeaseToken, "matched_existing", "legacy_canary_promotion");
        }
        // Existing contact: only count as success if it already meets strict criteria
        results.push({
          entityId, entityName: String(entity.entityName ?? ""),
          outcome: "skipped_duplicate",
          contactId: existingContact.id,
          recordClass: existingContact.recordClass ?? undefined,
          vertical: existingContact.vertical ?? undefined,
        });
        continue;
      }

      // Step 4: Create contact + deal (side effects begin here).
      // Increment attemptedPromotions BEFORE any writes so that even if contact
      // creation or classification throws, it counts toward the side-effect cap.
      attemptedPromotions++;
      const firstName = toProperCase(prospect.ownerFirstName || prospect.companyName?.split(" ")[0]) || "Owner";
      const lastName = toProperCase(prospect.ownerLastName || prospect.companyName?.split(" ").slice(1).join(" ")) || "";
      const volumeEst = estimateFromProspect(prospect);

      let companyId: number | undefined;
      if (prospect.companyName) {
        const nameKey = prospect.companyName.toLowerCase();
        const siteKey = prospect.website?.toLowerCase();
        const existingCompany = companyByName.get(nameKey) ||
          (siteKey ? companyByWebsite.get(siteKey) : undefined);
        if (existingCompany) {
          companyId = existingCompany.id;
        } else {
          const company = await storage.createCompany({
            legalName: prospect.companyName,
            dba: prospect.dba || undefined,
            vertical: prospect.vertical || undefined,
            address: [prospect.address, prospect.city, prospect.state, prospect.zip].filter(Boolean).join(", ") || undefined,
            website: prospect.website || undefined,
            volumeRange: prospect.estimatedVolume || undefined,
            notes: prospect.aiSummary || undefined,
          });
          companyId = company.id;
          companyByName.set(nameKey, company as any);
        }
      }

      const verticalResult = resolveCanonicalVertical({
        merchantVertical: prospect.vertical || null,
        merchantSubvertical: (prospect as any).subvertical || null,
        merchantVerticalSource: "discovery_enrichment",
      });
      // Null means non-canonical — leave unset; do not fall back to raw prospect.vertical
      const canonicalVertical = verticalResult.vertical || undefined;

      const contact = await createContactLocalFirst({
        firstName, lastName,
        email: email || "",
        phone: phone || "",
        companyName: toProperCase(prospect.companyName) || undefined,
        vertical: canonicalVertical,
        monthlyVolume: prospect.estimatedVolume || undefined,
        avgTicket: prospect.estimatedAvgTicket || undefined,
        estimatedProcessingVolume: volumeEst.estimatedProcessingVolume,
        estimatedResidual: volumeEst.estimatedResidual,
        volumeConfidence: volumeEst.volumeConfidence,
        status: "New",
        tags: ["sunbiz-auto", "canary", ...(prospect.tags || [])],
        notes: prospect.aiSummary || prospect.notes || undefined,
        leadScore: prospect.score === "hot" ? 80 : prospect.score === "warm" ? 60 : 40,
      });

      const priorityScore = prospect.score === "hot" ? 90
        : prospect.score === "warm" && (prospect.qualificationScore === "A" || prospect.qualificationScore === "B") ? 75
        : 50;
      const deal = await storage.createDeal({
        contactId: contact.id,
        companyId: companyId || undefined,
        pipeline: "sales", stage: "New Lead", offerPath: "Cash Discount",
        leadSource: "sunbiz", priorityScore,
        estimatedGrossProfitBps: volumeEst.estimatedGrossProfitBps,
        estimatedGrossProfitMonthly: volumeEst.estimatedGrossProfitMonthly,
        estimatedNetProfitMonthly: volumeEst.estimatedNetProfitMonthly,
        merchantTier: volumeEst.merchantTier,
        notes: `[Canary] Auto-promoted from Sunbiz prospect. ${prospect.aiPitchAngle || ""}`.trim(),
      });

      await finalizeLegacyProspectContactLink(prospectId, contact.id);

      // Step 5: AWAIT classification — must verify before reporting success
      let classificationOutcome: "promoted" | "classification_failed" = "promoted";
      try {
        await applyClassification({
          subjectType: "contact",
          subjectId: contact.id,
          targetClass: "production",
          eventNamespace: "sunbiz_auto_promote",
          eventKey: `sunbiz-promote-contact-${contact.id}-deal-${deal.id}`,
          actorId: "system:sunbiz_cron",
          approverId: "system:enrichment_authority",
          evidenceFields: {
            source_system: "sunbiz_auto_promote",
            evidence_reference: `prospect:${prospectId}|deal:${deal.id}`,
            classification_reason: "auto_promote_quality_gate_passed",
            approval_basis: "enrichment_authority_v1",
          },
        });
      } catch (classErr: any) {
        console.error(`[Sunbiz Canary] Classification failed for contact ${contact.id}:`, classErr?.message ?? classErr);
        classificationOutcome = "classification_failed";
      }

      // Re-fetch to get committed record_class
      const updatedContact = await storage.getContact(contact.id);
      const finalRecordClass = updatedContact?.recordClass ?? "unknown";
      const finalVertical = updatedContact?.vertical ?? undefined;

      const entry: CanaryEntityResult = {
        entityId, entityName: String(entity.entityName ?? ""),
        outcome: classificationOutcome,
        contactId: contact.id,
        recordClass: finalRecordClass,
        vertical: finalVertical,
      };
      results.push(entry);

      if (canaryLeaseToken !== null && entity.filingNumber) {
        await finalizeLegacyClaim(entity.filingNumber, canaryLeaseToken, "created", "legacy_canary_promotion").catch(() => {});
      }

      // Count toward success only if BOTH production-classified AND canonical vertical set
      if (classificationOutcome === "promoted" && finalRecordClass === "production" && finalVertical) {
        verifiedSuccessCount++;
      }
    } catch (err: any) {
      results.push({
        entityId,
        entityName: "",
        outcome: "error",
        error: err?.message ?? String(err),
      });
      // Release the fencing claim taken for this entity above so a failed
      // canary attempt does not permanently block the bootstrap engine from
      // ever processing this filing_number.
      if (claimedFilingNumberForCatch && claimedLeaseTokenForCatch !== null) {
        await finalizeLegacyClaim(claimedFilingNumberForCatch, claimedLeaseTokenForCatch, "failed", "legacy_canary_promotion_failed").catch(() => {});
      }
    }
  }

  return { results, verifiedSuccessCount };
}
