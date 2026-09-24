/**
 * sfp-outreach-policy.ts
 *
 * Task #2000: central, versioned SFP outreach eligibility policy authority.
 * Policy documents are immutable (DB trigger-enforced); the singleton
 * control row names the one active document. Every eligibility decision
 * pins the policy document id + hash it was evaluated under.
 *
 * This module never decides "send" or "enroll" — it only decides whether a
 * validated candidate is eligible for Task #2001 staging review. The
 * persisted status value stays `validated_outreach_eligible`.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { businessHasDbprLineageSql } from "../dbpr";

const rows = (r: any): any[] => r?.rows ?? r ?? [];

export interface SfpActivePolicy {
  id: string;
  version: number;
  documentHash: string;
  validationTtlDays: number;
  acceptedOutcomes: string[];
  retryableOutcomes: string[];
  roleInboxPolicy: { role_inbox_eligible_for_cold_b2b: boolean; named_or_unclassified_requires_review: boolean };
  consentTierPolicy: Record<string, "eligible_for_staging_review" | "ineligible">;
  reasonCodes: string[];
}

let _cachedActivePolicy: SfpActivePolicy | null = null;

/** Reads the singleton active policy pointer. Never writes/seeds — that is migration-owned. */
export async function getActiveSfpOutreachPolicy(opts: { bypassCache?: boolean } = {}): Promise<SfpActivePolicy> {
  if (_cachedActivePolicy && !opts.bypassCache) return _cachedActivePolicy;
  const row = rows(await db.execute(sql`
    SELECT d.id, d.version, d.document_hash, d.validation_ttl_days,
           d.accepted_outcomes, d.retryable_outcomes, d.role_inbox_policy,
           d.consent_tier_policy, d.reason_codes
      FROM sfp_outreach_policy_control c
      JOIN sfp_outreach_policy_documents d ON d.id = c.active_policy_id
     WHERE c.singleton = TRUE
     LIMIT 1
  `))[0];
  if (!row) throw new Error("SFP_OUTREACH_POLICY_NOT_CONFIGURED");
  const policy: SfpActivePolicy = {
    id: String(row.id),
    version: Number(row.version),
    documentHash: String(row.document_hash),
    validationTtlDays: Number(row.validation_ttl_days),
    acceptedOutcomes: row.accepted_outcomes,
    retryableOutcomes: row.retryable_outcomes,
    roleInboxPolicy: row.role_inbox_policy,
    consentTierPolicy: row.consent_tier_policy,
    reasonCodes: row.reason_codes,
  };
  _cachedActivePolicy = policy;
  return policy;
}

/** Test-only cache reset; production code never needs this (policy activation is a one-time migration seed for v1). */
export function _resetSfpOutreachPolicyCacheForTests(): void {
  _cachedActivePolicy = null;
}

export type SfpEligibilityGateResult =
  | { eligible: true; reasonCode: string }
  | { eligible: false; reasonCode: string; status: "validated_existing_relationship" | "validated_suppressed" | "validated_policy_ineligible" };

/**
 * Mutable safety gates that must be re-evaluated on EVERY execution,
 * including freshness-reuse hits that skip the provider call. Never a
 * network call — pure DB reads against canonical authorities.
 */
export async function evaluateSfpMutableSafetyGates(input: {
  businessId: number;
  consentTier: string | null;
  policy: SfpActivePolicy;
}): Promise<SfpEligibilityGateResult> {
  // 1. Canonical DBPR lineage exclusion.
  const dbprRow = rows(await db.execute(sql`
    SELECT ${businessHasDbprLineageSql(sql`${input.businessId}::int`)} AS excluded
  `))[0];
  if (dbprRow?.excluded === true) {
    return { eligible: false, reasonCode: "policy_dbpr_excluded", status: "validated_policy_ineligible" };
  }

  // 2. Existing-customer / relationship exclusion — the same sdr_merchants
  // existing_customer_flag authority roi-cohort-selector.ts uses for
  // cohort-time exclusion (getSfpBusinessHardExclusionReasons). Re-checked
  // here because a business can become an existing customer AFTER cohort
  // freeze but before (or between) validation executions.
  const relationshipRow = rows(await db.execute(sql`
    SELECT EXISTS(
      SELECT 1 FROM sdr_merchants sm
       WHERE sm.business_id = ${input.businessId} AND sm.existing_customer_flag = TRUE
    ) AS existing_customer
  `))[0];
  if (relationshipRow?.existing_customer === true) {
    return { eligible: false, reasonCode: "policy_existing_relationship", status: "validated_existing_relationship" };
  }

  // 3. Consent-tier semantics from the active policy document.
  const tier = input.consentTier ?? "cold_no_consent";
  const tierPolicy = input.policy.consentTierPolicy[tier] ?? "ineligible";
  if (tierPolicy === "ineligible") {
    return { eligible: false, reasonCode: "policy_consent_ineligible", status: "validated_policy_ineligible" };
  }

  return { eligible: true, reasonCode: "policy_gates_passed" };
}

/**
 * Canonical suppression/bounce check (unchanged predicate from the prior
 * revision, kept as its own gate so it composes with the other policy gates
 * rather than being the only check performed).
 */
export async function isCanonicallySuppressed(emailTokenHashes: string[]): Promise<boolean> {
  if (emailTokenHashes.length === 0) return false;
  const row = rows(await db.execute(sql`
    SELECT EXISTS(
      SELECT 1
      FROM contacts c
      WHERE c.email_token_hash = ANY(ARRAY[${sql.join(emailTokenHashes.map((h) => sql`${h}`), sql`, `)}])
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
  return row?.suppressed === true;
}

/**
 * Looks up the contact's consent tier by normalized email hash, if a
 * contact row exists for it. Returns null (treated as cold_no_consent by
 * the policy's consent-tier map) when no contact record exists yet — SFP
 * candidates are pre-CRM business contacts, so an absent contact row is
 * the common case, not an error.
 */
export async function lookupConsentTierByEmailHash(emailTokenHash: string): Promise<string | null> {
  const row = rows(await db.execute(sql`
    SELECT consent_tier FROM contacts WHERE email_token_hash = ${emailTokenHash} LIMIT 1
  `))[0];
  return row?.consent_tier ?? null;
}

/**
 * Freshness reuse: finds a still-fresh provider_observations row for this
 * business + normalized email hash within the active policy's TTL. A hit
 * means the provider is not called again; a miss (or expiry) requires a
 * new reservation. Every mutable safety gate is re-run regardless of hit/miss.
 */
export async function findFreshProviderObservation(input: {
  businessId: number;
  emailTokenHash: string;
  ttlDays: number;
}): Promise<{ operationId: string; outcome: string; observedAt: string } | null> {
  const row = rows(await db.execute(sql`
    SELECT operation_id, outcome, observed_at
      FROM provider_observations
     WHERE subject_type = 'business'
       AND subject_id = ${input.businessId}
       AND email_token_hash = ${input.emailTokenHash}
       AND provider = 'zerobounce'
       AND observed_at > NOW() - (${input.ttlDays}::text || ' days')::interval
     ORDER BY observed_at DESC
     LIMIT 1
  `))[0];
  if (!row || !row.operation_id) return null;
  return { operationId: String(row.operation_id), outcome: String(row.outcome), observedAt: String(row.observed_at) };
}
