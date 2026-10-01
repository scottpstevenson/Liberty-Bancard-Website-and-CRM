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
import { lockSfpContactAddress, normalizeSfpContactAddress } from "./sfp-contact-address-lock";
import { lockSfpBusinessSafetySentinel, lockSfpEligibilityProjectionKey } from "./sfp-eligibility-locks";

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

/**
 * Applies the singleton-enforcing CHECK constraint out-of-band, on startup,
 * instead of declaring it in shared/schema.ts. Replit Publish diffs
 * schema.ts against production with drizzle-kit push; once this table's
 * CHECK constraint exists in dev, drizzle-kit introspects its Postgres
 * definition (which pg_get_constraintdef already renders as
 * "CHECK (singleton)") and re-wraps that text in another "CHECK (...)" when
 * generating a fresh CREATE TABLE for production, producing invalid SQL
 * ("CHECK (CHECK (singleton))"). Declaring the constraint here instead lets
 * Publish create the plain table, and this function adds the real
 * constraint afterward. Idempotent: checks pg_constraint before adding, and
 * tolerates a concurrent duplicate_object race.
 */
export async function ensureSfpOutreachPolicyControlCheckConstraint(): Promise<void> {
  const existing = rows(await db.execute(sql`
    SELECT 1 FROM pg_constraint WHERE conname = 'sfp_outreach_policy_control_singleton_check'
  `))[0];
  if (existing) return;
  try {
    await db.execute(sql`
      ALTER TABLE sfp_outreach_policy_control
        ADD CONSTRAINT sfp_outreach_policy_control_singleton_check CHECK (singleton)
    `);
  } catch (err: any) {
    // 42710 = duplicate_object (constraint added concurrently by another
    // instance); 42P01 = undefined_table (table not yet created by Publish
    // on this boot — safe to skip, a later boot will converge it).
    if (err?.code !== "42710" && err?.code !== "42P01") throw err;
  }
}

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

/** Pin the active control/document pair before graph, cohort, or source locks. */
export async function lockCurrentSfpOutreachPolicy(
  executor: { execute: (query: any) => Promise<any> },
  expected?: Pick<SfpActivePolicy, "id" | "version" | "documentHash">,
): Promise<SfpActivePolicy> {
  const row = rows(await executor.execute(sql`
    SELECT d.id,d.version,d.document_hash,d.validation_ttl_days,d.accepted_outcomes,
           d.retryable_outcomes,d.role_inbox_policy,d.consent_tier_policy,d.reason_codes
      FROM sfp_outreach_policy_control c
      JOIN sfp_outreach_policy_documents d ON d.id=c.active_policy_id
     WHERE c.singleton=TRUE
     FOR SHARE OF c,d
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
  if (expected && (policy.id !== expected.id || policy.version !== expected.version ||
      policy.documentHash !== expected.documentHash)) {
    throw new Error("SFP_OUTREACH_POLICY_CHANGED");
  }
  return policy;
}

/** Test-only cache reset; production code never needs this (policy activation is a one-time migration seed for v1). */
export function _resetSfpOutreachPolicyCacheForTests(): void {
  _cachedActivePolicy = null;
}

export type SfpEligibilityGateResult =
  | { eligible: true; reasonCode: string }
  | { eligible: false; reasonCode: string; status: "validated_existing_relationship" | "validated_suppressed" | "validated_policy_ineligible" };

export interface SfpEmailPolicyDecision {
  status: "eligible_for_staging_review" | "eligibility_review_required" | "ineligible";
  reasonCode: string;
}

/**
 * Named addresses remain people, not role inboxes. This policy decision is
 * deliberately separate from ZeroBounce validity and from send authority:
 * when the active document requires review, a valid named address stays held
 * for an explicit eligibility review instead of being relabeled as a role.
 */
export function evaluateSfpEmailTypePolicy(input: {
  namedContact: boolean;
  roleInbox: boolean;
  policy: SfpActivePolicy;
}): SfpEmailPolicyDecision {
  if (input.namedContact) {
    return input.policy.roleInboxPolicy?.named_or_unclassified_requires_review !== false
      ? { status: "eligibility_review_required", reasonCode: "named_email_requires_eligibility_review" }
      : { status: "eligible_for_staging_review", reasonCode: "named_email_policy_eligible_for_review" };
  }
  if (input.roleInbox && input.policy.roleInboxPolicy?.role_inbox_eligible_for_cold_b2b !== false) {
    return { status: "eligible_for_staging_review", reasonCode: "role_inbox_policy_eligible_for_review" };
  }
  return { status: "eligibility_review_required", reasonCode: "unclassified_email_requires_eligibility_review" };
}

/**
 * Mutable safety gates that must be re-evaluated on EVERY execution,
 * including freshness-reuse hits that skip the provider call. Never a
 * network call — pure DB reads against canonical authorities.
 */
export async function evaluateSfpMutableSafetyGates(input: {
  businessId: number;
  consentTier: string | null;
  policy: SfpActivePolicy;
  emailAddress?: string | null;
}, executor: { execute: (q: any) => Promise<any> } = db): Promise<SfpEligibilityGateResult> {
  // Shared absence-safe business sentinel covers both current and future
  // DBPR/source and merchant/customer rows. Child rows are read without tuple
  // locks so writers can wait at the sentinel without a row-lock inversion.
  await lockSfpBusinessSafetySentinel(executor, input.businessId);
  if (input.emailAddress) await lockSfpContactAddress(executor, input.emailAddress);
  await executor.execute(sql`SELECT id FROM businesses WHERE id=${input.businessId} FOR SHARE`);

  if (input.emailAddress && await isCanonicallySuppressed([], executor, [input.emailAddress])) {
    return { eligible: false, reasonCode: "policy_canonical_suppression", status: "validated_suppressed" };
  }
  // 1. Canonical DBPR lineage exclusion.
  const dbprRow = rows(await executor.execute(sql`
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
  const relationshipRow = rows(await executor.execute(sql`
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
export async function isCanonicallySuppressed(
  emailTokenHashes: string[],
  executor: { execute: (q: any) => Promise<any> } = db,
  normalizedEmails: string[] = [],
): Promise<boolean> {
  const addresses = [...new Set(normalizedEmails
    .map((value) => normalizeSfpContactAddress(value))
    .filter((value): value is string => Boolean(value)))].sort();
  for (const address of addresses) await lockSfpContactAddress(executor, address);
  if (emailTokenHashes.length === 0 && addresses.length === 0) return false;
  const hashPredicate = emailTokenHashes.length
    ? sql`c.email_token_hash = ANY(ARRAY[${sql.join(emailTokenHashes.map((hash) => sql`${hash}`), sql`, `)}])`
    : sql`FALSE`;
  const addressPredicate = addresses.length
    ? sql`lower(btrim(cs.normalized_email)) = ANY(ARRAY[${sql.join(addresses.map((address) => sql`${address}`), sql`, `)}])`
    : sql`FALSE`;
  const row = rows(await executor.execute(sql`
    SELECT EXISTS(
      SELECT 1
      FROM contacts c
      WHERE ${hashPredicate}
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
    ) OR EXISTS (
      SELECT 1
        FROM consent_subjects cs
        LEFT JOIN consent_subject_global_suppressions gs
          ON gs.subject_id=cs.id AND gs.is_suppressed=TRUE
        LEFT JOIN consent_subject_channel_states es
          ON es.subject_id=cs.id AND es.channel='email'
         AND es.permission_state IN ('withdrawn','suppressed')
       WHERE ${addressPredicate}
         AND (gs.subject_id IS NOT NULL OR es.id IS NOT NULL)
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
export async function lookupConsentTierByEmailHash(
  emailTokenHash: string,
  executor: { execute: (q: any) => Promise<any> } = db,
  lockForShare = false,
): Promise<string | null> {
  // Contact changes are serialized by the normalized-address advisory lock;
  // never tuple-lock a contact after acquiring that address lock.
  void lockForShare;
  const row = rows(await executor.execute(sql`
    SELECT consent_tier FROM contacts
     WHERE email_token_hash = ${emailTokenHash}
     ORDER BY id LIMIT 1
  `))[0];
  return row?.consent_tier ?? null;
}

/** Retain every matching mutable contact/suppression fact through eligibility writes. */
export async function lockSfpContactRowsForShare(
  emailTokenHashes: string[],
  executor: { execute: (q: any) => Promise<any> } = db,
): Promise<void> {
  if (emailTokenHashes.length === 0) return;
  await executor.execute(sql`
    SELECT id FROM contacts
     WHERE email_token_hash = ANY(ARRAY[${sql.join(emailTokenHashes.map((hash) => sql`${hash}`), sql`, `)}])
     ORDER BY id
     FOR SHARE
  `);
}

/**
 * Freshness reuse: finds a still-fresh provider_observations row for this
 * business + normalized email hash within the active policy's TTL. A hit
 * means the provider is not called again; only completed valid/invalid
 * outcomes are reusable. Transport failures and uncertain results must not
 * suppress a retry after its normal cooldown. A miss (or expiry) requires a
 * new reservation. Every mutable safety gate is re-run regardless of hit/miss.
 */
export async function findFreshProviderObservation(input: {
  businessId: number;
  emailTokenHash: string;
  ttlDays: number;
}, executor: { execute: (q: any) => Promise<any> } = db): Promise<{ operationId: string; outcome: string; observedAt: string; expiresAt: string | null } | null> {
  const row = rows(await executor.execute(sql`
    WITH fence_clock AS MATERIALIZED (SELECT clock_timestamp() AS at)
    SELECT po.operation_id, po.outcome, po.observed_at, po.expires_at
      FROM provider_observations po
      JOIN fence_clock fc ON TRUE
      JOIN provider_operations op ON op.id=po.operation_id
     WHERE po.subject_type = 'business'
       AND po.subject_id = ${input.businessId}
       AND po.email_token_hash = ${input.emailTokenHash}
       AND po.provider = 'zerobounce'
       AND po.retryable = FALSE
       AND po.outcome IN ('valid', 'invalid')
       AND op.state='completed'
       AND po.observed_at > fc.at - (${input.ttlDays}::text || ' days')::interval
        AND po.observed_at <= fc.at
        AND LEAST(
          COALESCE(po.expires_at,
                   po.observed_at + (${input.ttlDays}::text || ' days')::interval),
          po.observed_at + (${input.ttlDays}::text || ' days')::interval
        ) > fc.at
     ORDER BY po.observed_at DESC
     LIMIT 1
      FOR SHARE OF po,op
  `))[0];
  if (!row || !row.operation_id) return null;
  return {
    operationId: String(row.operation_id), outcome: String(row.outcome), observedAt: String(row.observed_at),
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
  };
}

/** Returns the receipt's original expiry bounded by the current policy TTL. */
export function effectiveSfpProviderObservationExpiry(
  observedAt: string | Date,
  explicitExpiresAt: string | Date | null,
  ttlDays: number,
): Date | null {
  const observed = observedAt instanceof Date ? observedAt.getTime() : new Date(observedAt).getTime();
  if (!Number.isFinite(observed) || !Number.isFinite(ttlDays) || ttlDays <= 0) return null;
  const policyExpiry = observed + ttlDays * 86_400_000;
  const explicitExpiry = explicitExpiresAt == null
    ? policyExpiry
    : explicitExpiresAt instanceof Date ? explicitExpiresAt.getTime() : new Date(explicitExpiresAt).getTime();
  if (!Number.isFinite(explicitExpiry)) return null;
  return new Date(Math.min(explicitExpiry, policyExpiry));
}

/** Pure receipt freshness check suitable for the final database-clock fence. */
export function isSfpProviderObservationFreshAt(
  observedAt: string | Date,
  explicitExpiresAt: string | Date | null,
  ttlDays: number,
  now: string | Date,
): boolean {
  const observed = observedAt instanceof Date ? observedAt.getTime() : new Date(observedAt).getTime();
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const expires = effectiveSfpProviderObservationExpiry(observedAt, explicitExpiresAt, ttlDays)?.getTime();
  return Number.isFinite(observed) && Number.isFinite(current) && expires !== undefined &&
    observed <= current && expires > current;
}
