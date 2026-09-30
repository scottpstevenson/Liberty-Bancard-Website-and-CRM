/**
 * sfp-cost-preview.ts
 *
 * Informational SFP usage estimate for the paid waterfall and pre-cohort
 * classification bridge. Estimates are not authorization, provider limits,
 * or execution prerequisites.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { getCurrentPricingSchedule } from "../mi09-pilot-authority";
import { currentSfpUnitPrice } from "./sfp-provider-operations";
import {
  computeContactLinkReuse,
  hasResolvedBusinessIdentity,
  isResolvedSouthFloridaGeographyOutcome,
} from "./sfp-contact-gap-vector";
import { createHash } from "node:crypto";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export type SfpCostPreviewProvider = "serper" | "outscraper" | "apollo" | "openai_classification";

/**
 * Real per-provider billing units: Serper bills per REQUEST (up to 4 per
 * identity lookup — domain, phone, address, and a corroboration pass, per
 * the existing lookupBusinessIdentity call shape); OpenAI bills per TOKEN
 * (approximated here as a bounded classification-call token estimate, not a
 * flat per-business multiplier); Outscraper/Apollo bill per RESULT/unit
 * returned. This map is the single place that encodes "how many raw billing
 * units does one business cost this provider" so a flat per-business
 * multiplier can never silently creep back in.
 */
const ESTIMATED_UNITS_PER_BUSINESS: Record<SfpCostPreviewProvider, { estimated: number; worstCase: number; unitLabel: string }> = {
  serper: { estimated: 1, worstCase: 4, unitLabel: "requests" },
  outscraper: { estimated: 1, worstCase: 2, unitLabel: "results" },
  apollo: { estimated: 1, worstCase: 1, unitLabel: "units" },
  openai_classification: { estimated: 800, worstCase: 2000, unitLabel: "tokens" },
};

export interface SfpCostPreviewLine {
  provider: SfpCostPreviewProvider;
  controlProviderKey: string;
  gapCountDrivingCall: number;
  estimatedUnits: number;
  worstCaseUnits: number;
  unitLabel: string;
  priceScheduleVersion: string | number | null;
  pricingAvailable: boolean;
  unitAmountMicros: number;
  estimatedCostMicros: number;
  worstCaseCostMicros: number;
}

export interface SfpCostPreview {
  generatedAt: string;
  lines: SfpCostPreviewLine[];
  totalEstimatedCostMicros: number;
  totalWorstCaseCostMicros: number;
}

export interface SfpGapCounts {
  officialDomainGapCount: number; // drives serper
  businessIdentityGapCount: number; // drives outscraper
  decisionMakerGapCount: number; // drives apollo
  ambiguousVerticalGapCount: number; // drives openai_classification
}

const CONTROL_KEY: Record<SfpCostPreviewProvider, string> = {
  serper: "serper", outscraper: "outscraper", apollo: "apollo", openai_classification: "openai",
};

/**
 * Read-only estimates. Pricing is optional and is surfaced as unavailable
 * when the current schedule cannot provide an estimate.
 */
export async function buildSfpCostPreview(gapCounts: SfpGapCounts): Promise<SfpCostPreview> {
  let pricing: Awaited<ReturnType<typeof getCurrentPricingSchedule>> | null = null;
  try { pricing = await getCurrentPricingSchedule(); } catch { /* estimates may be unavailable */ }

  const gapByProvider: Record<SfpCostPreviewProvider, number> = {
    serper: gapCounts.officialDomainGapCount,
    outscraper: gapCounts.businessIdentityGapCount,
    apollo: gapCounts.decisionMakerGapCount,
    openai_classification: gapCounts.ambiguousVerticalGapCount,
  };

  const lines: SfpCostPreviewLine[] = [];
  for (const provider of Object.keys(gapByProvider) as SfpCostPreviewProvider[]) {
    const gapCount = gapByProvider[provider];
    const controlProviderKey = CONTROL_KEY[provider];
    const perBiz = ESTIMATED_UNITS_PER_BUSINESS[provider];
    let unitAmountMicros = 0;
    try {
      unitAmountMicros = await currentSfpUnitPrice(provider as any) ?? 0;
    } catch { /* estimates are optional */ }
    const scheduleEntry = (pricing?.priceSchedules as any)?.[controlProviderKey];
    const scheduledAmount = Number(scheduleEntry?.amountMicros);
    const pricingAvailable = Number.isSafeInteger(scheduledAmount) && scheduledAmount >= 0;
    const estimatedUnits = gapCount * perBiz.estimated;
    const worstCaseUnits = gapCount * perBiz.worstCase;
    lines.push({
      provider,
      controlProviderKey,
      gapCountDrivingCall: gapCount,
      estimatedUnits,
      worstCaseUnits,
      unitLabel: perBiz.unitLabel,
      priceScheduleVersion: scheduleEntry?.version ?? scheduleEntry?.effectiveAt ?? null,
      pricingAvailable,
      unitAmountMicros,
      estimatedCostMicros: estimatedUnits * unitAmountMicros,
      worstCaseCostMicros: worstCaseUnits * unitAmountMicros,
    });
  }

  const totalEstimatedCostMicros = lines.reduce((s, l) => s + l.estimatedCostMicros, 0);
  const totalWorstCaseCostMicros = lines.reduce((s, l) => s + l.worstCaseCostMicros, 0);

  return {
    generatedAt: new Date().toISOString(),
    lines,
    totalEstimatedCostMicros,
    totalWorstCaseCostMicros,
  };
}

/** Actual frozen-cohort state used by both preview and the execution fence. */
export async function getSfpCohortGapSnapshot(cohortRunId: string): Promise<{
  gapCounts: SfpGapCounts;
  snapshotHash: string;
  businessIds: number[];
}> {
  const members = rows(await db.execute(sql`
    SELECT m.business_id,b.website_domain,b.main_phone,b.street_address,b.city,
           d.classifier_outcome,d.geography_outcome,d.suppression_subjects
      FROM sfp_cohort_members m
      JOIN businesses b ON b.id=m.business_id
      LEFT JOIN sfp_cohort_decisions d
        ON d.cohort_run_id=m.cohort_run_id AND d.business_id=m.business_id
     WHERE m.cohort_run_id=${cohortRunId}::uuid
     ORDER BY m.business_id
  `));
  const businessIds = members.map((m: any) => Number(m.business_id));
  const reuse = await computeContactLinkReuse(businessIds);
  const evidenceRows = rows(await db.execute(sql`
    SELECT business_id,id,'free'::text AS source,NULL::text AS provider,
           NULL::text AS person_name_evidence,NULL::text AS person_title_evidence
      FROM free_discovery_candidates
       WHERE business_id=ANY(ARRAY[${sql.join(businessIds.map((id) => sql`${id}`), sql`, `)}]::integer[])
         AND field IN ('email','phone') AND disposition IN ('staged','validation_admitted','accepted')
         AND NOT EXISTS (SELECT 1 FROM sfp_identity_quarantines q
                          WHERE q.business_id=free_discovery_candidates.business_id AND q.cleared_at IS NULL)
      UNION ALL
      SELECT business_id,id,'paid'::text AS source,provider,
             person_name_evidence,person_title_evidence
        FROM sfp_paid_candidate_evidence
       WHERE business_id=ANY(ARRAY[${sql.join(businessIds.map((id) => sql`${id}`), sql`, `)}]::integer[])
         AND field IN ('email','phone') AND disposition IN ('staged','accepted')
         AND NOT EXISTS (SELECT 1 FROM sfp_identity_quarantines q
                          WHERE q.business_id=sfp_paid_candidate_evidence.business_id AND q.cleared_at IS NULL)
         AND NOT EXISTS (SELECT 1 FROM sfp_discredited_paid_evidence d
                          WHERE d.evidence_id=sfp_paid_candidate_evidence.id)
  `));
  const evidenceById = new Map<number, any[]>();
  for (const evidence of evidenceRows) {
    const list = evidenceById.get(Number(evidence.business_id)) ?? [];
    list.push({
      id: String(evidence.id),
      source: String(evidence.source),
      provider: evidence.provider == null ? null : String(evidence.provider),
      personNameEvidence: evidence.person_name_evidence ?? null,
      personTitleEvidence: evidence.person_title_evidence ?? null,
    });
    evidenceById.set(Number(evidence.business_id), list);
  }
  const suppressionRows = rows(await db.execute(sql`
    SELECT business_id,id,email,unsubscribe_status,bounce_status,COALESCE(opted_out_email,FALSE) AS opted_out_email,
           opt_out_status,complaint_status,do_not_auto_contact,suppression_reason
      FROM contacts WHERE business_id=ANY(ARRAY[${sql.join(businessIds.map((id) => sql`${id}`), sql`, `)}]::integer[])
       AND (COALESCE(opted_out_email,FALSE)=TRUE OR unsubscribe_status='unsubscribed'
         OR bounce_status IN ('hard','blocked') OR opt_out_status='opted_out'
         OR complaint_status='reported' OR do_not_auto_contact=TRUE OR suppression_reason IS NOT NULL)
  `));
  const suppressionsById = new Map<number, any[]>();
  for (const contact of suppressionRows) {
    const list = suppressionsById.get(Number(contact.business_id)) ?? [];
    list.push({
      subjectHash: sha256(String(contact.email ?? contact.id).trim().toLowerCase()),
      reason: contact.bounce_status ? `bounce_${contact.bounce_status}`
        : String(contact.unsubscribe_status ?? contact.opt_out_status ?? contact.suppression_reason ?? "suppressed"),
    });
    suppressionsById.set(Number(contact.business_id), list);
  }
  const gaps = members.map((m: any) => {
    const link = reuse.get(Number(m.business_id)) ?? { hasVerifiedContact: false, hasVerifiedNamedDecisionMaker: false, verifiedLinks: [], skipReason: null };
    return {
      id: Number(m.business_id),
      domain: m.website_domain ?? null,
      identity: hasResolvedBusinessIdentity({
        mainPhone: m.main_phone,
        streetAddress: m.street_address,
        city: m.city,
      }),
      named: Boolean(link.hasVerifiedNamedDecisionMaker || evidenceById.get(Number(m.business_id))?.some((evidence) =>
        evidence.provider === "apollo" && evidence.personNameEvidence && evidence.personTitleEvidence)),
      contact: Boolean(evidenceById.has(Number(m.business_id)) || link.hasVerifiedContact),
      contactEvidence: evidenceById.get(Number(m.business_id)) ?? [],
      verifiedLinks: link.verifiedLinks.map((verified) => ({
        decisionId: verified.decisionId, contactNamePresent: Boolean(verified.contactName),
        contactTitlePresent: Boolean(verified.contactTitle), emailPresent: Boolean(verified.contactEmail),
      })),
      subjectSuppressions: suppressionsById.get(Number(m.business_id)) ?? [],
      classifier: String(m.classifier_outcome ?? ""),
      geography: isResolvedSouthFloridaGeographyOutcome(m.geography_outcome),
      suppressions: m.suppression_subjects ?? [],
    };
  });
  const gapCounts: SfpGapCounts = {
    officialDomainGapCount: gaps.filter((g) => !g.domain).length,
    businessIdentityGapCount: gaps.filter((g) => !g.identity).length,
    decisionMakerGapCount: gaps.filter((g) => !g.named).length,
    ambiguousVerticalGapCount: 0,
  };
  return { gapCounts, snapshotHash: sha256(gaps), businessIds };
}

export async function buildSfpCohortCostPreview(cohortRunId: string): Promise<SfpCostPreview & {
  cohortRunId: string;
  snapshotHash: string;
  selectedBusinessCount: number;
}> {
  const snapshot = await getSfpCohortGapSnapshot(cohortRunId);
  return {
    ...await buildSfpCostPreview(snapshot.gapCounts),
    cohortRunId,
    snapshotHash: snapshot.snapshotHash,
    selectedBusinessCount: snapshot.businessIds.length,
  };
}
