/**
 * BT-10 provider health and readiness authority.
 *
 * This module is deliberately narrow: it turns normalized provider evidence
 * into a purpose-aware decision. It never owns consent, identity, provenance,
 * classification, manual field authority, or GHL projections.
 */

import { createHash, randomUUID } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, eligibilitySnapshots, providerObservations, validationIntents } from "@shared/schema";

export const EMAIL_VALIDATION_POLICY_VERSION = 1;
export const EMAIL_VALIDATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type MarketingValidationReason =
  | "positive_current_evidence"
  | "missing_email"
  | "not_validated"
  | "risky_or_catch_all"
  | "invalid"
  | "provider_unavailable"
  | "stale_evidence"
  | "mismatched_email_token"
  | "mismatched_generation"
  | "identity_conflict"
  | "missing_prerequisite";

export type MarketingValidationDecision = {
  allowed: boolean;
  decision: "eligible" | "blocked" | "deferred" | "unavailable";
  reason: MarketingValidationReason;
  emailTokenHash: string | null;
  subjectGeneration: number | null;
  evidenceAt: Date | null;
  commercialResolutionSnapshotId?: string;
};

export type ValidationEvidence = {
  emailStatus?: string | null;
  emailTokenHash?: string | null;
  subjectGeneration?: number | null;
  evidenceGeneration?: number | null;
  verifiedAt?: Date | string | null;
  providerOutcome?: string | null;
};

/** Normalize without retaining raw email in any durable audit or control row. */
export function normalizeEmailToken(email: string | null | undefined): string | null {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  if (normalized.endsWith(".internal") || normalized.startsWith("no-email-")) return null;
  return normalized;
}

export function hashEmailToken(email: string | null | undefined): string | null {
  const token = normalizeEmailToken(email);
  return token ? createHash("sha256").update(token).digest("hex") : null;
}

/**
 * Pure fail-closed decision. Only a current, fresh, explicitly-valid provider
 * observation may authorize marketing. `unknown`, `unverified` / catch-all,
 * config, budget, timeout, transport, parser, and ambiguous billing outcomes
 * are never positive evidence.
 */
export function decideMarketingEmailValidation(
  email: string | null | undefined,
  evidence: ValidationEvidence,
  now: Date = new Date(),
  maxAgeMs: number = EMAIL_VALIDATION_MAX_AGE_MS,
): MarketingValidationDecision {
  const tokenHash = hashEmailToken(email);
  const generation = evidence.subjectGeneration ?? null;
  const verifiedAt = evidence.verifiedAt ? new Date(evidence.verifiedAt) : null;
  const status = (evidence.providerOutcome ?? evidence.emailStatus ?? "").toLowerCase();

  if (!tokenHash) {
    return { allowed: false, decision: "blocked", reason: "missing_email", emailTokenHash: null, subjectGeneration: generation, evidenceAt: null };
  }
  if (evidence.emailTokenHash !== tokenHash) {
    return { allowed: false, decision: "deferred", reason: "mismatched_email_token", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
  }
  if (generation === null || evidence.evidenceGeneration !== generation) {
    return { allowed: false, decision: "deferred", reason: "mismatched_generation", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
  }
  if (!verifiedAt || Number.isNaN(verifiedAt.getTime()) || now.getTime() - verifiedAt.getTime() > maxAgeMs) {
    return { allowed: false, decision: "deferred", reason: "stale_evidence", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
  }
  if (status === "valid") {
    return { allowed: true, decision: "eligible", reason: "positive_current_evidence", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
  }
  if (status === "invalid" || status === "unsafe" || status === "bounced" || status === "do_not_mail" || status === "spam_trap" || status === "abuse") {
    return { allowed: false, decision: "blocked", reason: "invalid", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
  }
  if (status === "unverified" || status === "catch_all" || status === "risky") {
    return { allowed: false, decision: "blocked", reason: "risky_or_catch_all", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
  }
  if (["not_configured", "budget_blocked", "circuit_blocked", "rate_limited", "timeout", "transport", "parse_error", "ambiguous_billing"].includes(status)) {
    return { allowed: false, decision: "unavailable", reason: "provider_unavailable", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
  }
  return { allowed: false, decision: "deferred", reason: "not_validated", emailTokenHash: tokenHash, subjectGeneration: generation, evidenceAt: verifiedAt };
}

/**
 * Records exactly one recoverable validation intent for a contact generation.
 * It is transaction-friendly and does no provider or queue I/O.
 */
export async function createValidationIntent(
  tx: any,
  input: {
    contactId: number;
    email: string | null | undefined;
    generation: number;
    purpose?: string;
  },
): Promise<boolean> {
  const tokenHash = hashEmailToken(input.email);
  if (!tokenHash || input.generation < 1) return false;
  const purpose = input.purpose ?? "marketing_outreach";
  await tx.insert(validationIntents).values({
    contactId: input.contactId,
    normalizedEmailTokenHash: tokenHash,
    subjectGeneration: input.generation,
    policyVersion: EMAIL_VALIDATION_POLICY_VERSION,
    purpose,
    state: "pending",
    enqueueState: "deferred",
  }).onConflictDoUpdate({
    target: [
      validationIntents.contactId,
      validationIntents.normalizedEmailTokenHash,
      validationIntents.subjectGeneration,
      validationIntents.purpose,
    ],
    set: { updatedAt: new Date() },
  });
  return true;
}

/**
 * The read path used by marketing callers. Database errors are represented as
 * unavailable, never as a permissive fallback. A legacy status without a
 * matching current observation is deliberately insufficient.
 */
export async function evaluateMarketingEmailEligibility(contactId: number): Promise<MarketingValidationDecision> {
  try {
    const [contact] = await db.select({
      id: contacts.id,
      email: contacts.email,
      emailStatus: contacts.emailStatus,
      emailTokenHash: contacts.emailTokenHash,
      emailMutationGeneration: contacts.emailMutationGeneration,
      emailValidationUpdatedAt: contacts.emailValidationUpdatedAt,
    }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
    if (!contact) {
      return { allowed: false, decision: "blocked", reason: "missing_email", emailTokenHash: null, subjectGeneration: null, evidenceAt: null };
    }
    // CRO-02 observes provider-pre-spend inputs through the shared adapter.
    // BT-10 remains the effective readiness authority in shadow mode.
    const { authorizeCommercialUse } = await import("./commercial-resolution");
    const commercial = await authorizeCommercialUse({
      subjectType: "contact",
      subjectId: contactId,
      effect: "provider_pre_spend",
    });
    const tokenHash = hashEmailToken(contact.email);
    const [observation] = tokenHash
      ? await db.select({
          outcome: providerObservations.outcome,
          emailTokenHash: providerObservations.emailTokenHash,
          subjectGeneration: providerObservations.subjectGeneration,
          observedAt: providerObservations.observedAt,
        }).from(providerObservations).where(and(
          eq(providerObservations.subjectType, "contact"),
          eq(providerObservations.subjectId, contactId),
          eq(providerObservations.emailTokenHash, tokenHash),
          eq(providerObservations.subjectGeneration, contact.emailMutationGeneration),
        )).orderBy(desc(providerObservations.observedAt)).limit(1)
      : [];
    return {
      ...decideMarketingEmailValidation(contact.email, {
      emailStatus: contact.emailStatus,
      emailTokenHash: observation?.emailTokenHash ?? null,
      subjectGeneration: contact.emailMutationGeneration,
      // A provider observation is the sole positive marketing authority.
      // Contacts.emailStatus remains a backwards-compatible delivery projection
      // and cannot authorize current marketing by itself.
      evidenceGeneration: observation?.subjectGeneration,
      verifiedAt: observation?.observedAt,
      providerOutcome: observation?.outcome,
      }),
      ...(commercial.shadowDecision.snapshotId
        ? { commercialResolutionSnapshotId: commercial.shadowDecision.snapshotId }
        : {}),
    };
  } catch {
    return {
      allowed: false,
      decision: "unavailable",
      reason: "provider_unavailable",
      emailTokenHash: null,
      subjectGeneration: null,
      evidenceAt: null,
    };
  }
}

export async function persistMarketingEligibilitySnapshot(
  contactId: number,
  purpose: string,
  decision: MarketingValidationDecision,
): Promise<void> {
  if (decision.subjectGeneration == null) return;
  await db.insert(eligibilitySnapshots).values({
    contactId,
    purpose,
    policyVersion: EMAIL_VALIDATION_POLICY_VERSION,
    subjectGeneration: decision.subjectGeneration,
    decision: decision.decision,
    reasonCodes: [decision.reason],
    evidenceRefs: [],
    commercialResolutionSnapshotId: decision.commercialResolutionSnapshotId,
    expiresAt: decision.evidenceAt
      ? new Date(decision.evidenceAt.getTime() + EMAIL_VALIDATION_MAX_AGE_MS)
      : null,
  });
}

/** Explicit queue ownership: a missing producer means a recoverable deferred intent. */
export async function enqueueValidationIntent(intentId: string): Promise<boolean> {
  try {
    const { getQueueManagerProducers, QUEUE_NAMES } = await import("./queue-manager");
    const manager = getQueueManagerProducers();
    const queue = manager?.getQueue(QUEUE_NAMES.ENRICHMENT);
    if (!queue) {
      await db.update(validationIntents).set({ enqueueState: "unavailable", updatedAt: new Date() })
        .where(eq(validationIntents.id, intentId));
      return false;
    }
    await queue.add("validation-intent", { intentId }, {
      jobId: `validation-intent-${intentId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
    });
    await db.update(validationIntents).set({ enqueueState: "enqueued", updatedAt: new Date() })
      .where(eq(validationIntents.id, intentId));
    return true;
  } catch {
    await db.update(validationIntents).set({ enqueueState: "unavailable", updatedAt: new Date() })
      .where(eq(validationIntents.id, intentId)).catch(() => {});
    return false;
  }
}

/** Best-effort producer handoff after a committed contact mutation. The durable
 * row remains pending/deferred if queue infrastructure is unavailable. */
export async function enqueueCurrentValidationIntent(contactId: number): Promise<boolean> {
  const [intent] = await db.select({ id: validationIntents.id })
    .from(validationIntents)
    .where(and(
      eq(validationIntents.contactId, contactId),
      eq(validationIntents.state, "pending"),
    ))
    .orderBy(desc(validationIntents.createdAt))
    .limit(1);
  return intent ? enqueueValidationIntent(intent.id) : false;
}

/** Queue-owned recovery: replay committed pending intents after a producer,
 * Redis, or process outage. The intent itself is the durable source of truth. */
export async function recoverValidationIntents(limit = 100): Promise<number> {
  const rows = await db.execute(sql`
    SELECT id FROM validation_intents
     WHERE state = 'pending'
       AND next_attempt_at <= NOW()
     ORDER BY created_at
     LIMIT ${limit}
  `);
  let enqueued = 0;
  for (const row of (rows as any).rows ?? []) {
    if (await enqueueValidationIntent(row.id)) enqueued++;
  }
  return enqueued;
}

export type ValidationIntentWorkerDeps = {
  verifyEmail?: (email: string) => Promise<{
    status: string;
    subStatus?: string | null;
    reason?: string;
    outcome?: string;
  }>;
};

/**
 * Execute one validation intent under a durable claim. Provider controls are
 * deliberately checked and reserved before transport; a missing/disabled
 * control leaves the intent deferred and never produces positive evidence.
 */
export async function processValidationIntent(
  intentId: string,
  deps: ValidationIntentWorkerDeps = {},
): Promise<"completed" | "deferred" | "superseded" | "failed" | "not_found"> {
  const claimToken = randomUUID();
  const claim = await db.execute(sql`
    UPDATE validation_intents
       SET state = 'processing', claim_token = ${claimToken}::uuid,
           lease_expires_at = NOW() + INTERVAL '5 minutes',
           attempt_count = attempt_count + 1, updated_at = NOW()
     WHERE id = ${intentId}::uuid
       AND state IN ('pending', 'processing')
       AND (state = 'pending' OR lease_expires_at IS NULL OR lease_expires_at < NOW())
     RETURNING *
  `);
  const intent = (claim as any).rows?.[0];
  if (!intent) return "not_found";

  const contactResult = await db.execute(sql`
    SELECT id, email, email_mutation_generation
      FROM contacts WHERE id = ${intent.contact_id} LIMIT 1
  `);
  const contact = (contactResult as any).rows?.[0];
  if (!contact) {
    await db.execute(sql`
      UPDATE validation_intents
         SET state = 'failed', terminal_code = 'contact_missing',
             completed_at = NOW(), updated_at = NOW()
       WHERE id = ${intentId}::uuid AND claim_token = ${claimToken}::uuid
    `);
    return "failed";
  }
  const tokenHash = hashEmailToken(contact.email);
  if (
    tokenHash !== intent.normalized_email_token_hash ||
    Number(contact.email_mutation_generation) !== Number(intent.subject_generation)
  ) {
    await db.execute(sql`
      UPDATE validation_intents
         SET state = 'superseded', terminal_code = 'subject_changed',
             completed_at = NOW(), updated_at = NOW()
       WHERE id = ${intentId}::uuid AND claim_token = ${claimToken}::uuid
    `);
    return "superseded";
  }

  // A control row is operator-owned. Do not create an enabled row from a
  // secret or from a queue job; enablement and budget are explicit controls.
  const control = await db.execute(sql`
    SELECT provider, enabled, circuit_state, local_budget_units,
           reserved_units, consumed_units
      FROM provider_controls WHERE provider = 'zerobounce' LIMIT 1
  `);
  const c = (control as any).rows?.[0];
  if (!c?.enabled || c.circuit_state !== "closed" || c.local_budget_units == null) {
    await db.execute(sql`
      UPDATE validation_intents
         SET state = 'pending', enqueue_state = 'deferred',
             terminal_code = 'provider_control_unavailable',
             lease_expires_at = NULL, claim_token = NULL, updated_at = NOW()
       WHERE id = ${intentId}::uuid AND claim_token = ${claimToken}::uuid
    `);
    return "deferred";
  }

  const operationKey = `validation-intent:${intentId}`;
  // Once provider I/O was authorized for this idempotency key, never replay it
  // blindly. A prior process may have reached the provider but failed before
  // local commit; that is an ambiguous charge/result and requires reconciliation.
  const existingOperation = await db.execute(sql`
    SELECT id FROM provider_operations
     WHERE provider = 'zerobounce' AND idempotency_key = ${operationKey}
     LIMIT 1
  `);
  if ((existingOperation as any).rows?.[0]) {
    await db.execute(sql`
      UPDATE validation_intents
         SET state = 'blocked', terminal_code = 'ambiguous_billing',
             lease_expires_at = NULL, claim_token = NULL, completed_at = NOW(), updated_at = NOW()
       WHERE id = ${intentId}::uuid AND claim_token = ${claimToken}::uuid
    `);
    return "failed";
  }
  // Reservation and operation ownership commit together. If the budget race is
  // lost, no operation exists and the intent is safely recoverable (not
  // ambiguously billed).
  const allocation = await db.execute(sql`
    WITH reservation AS (
      UPDATE provider_controls
         SET reserved_units = reserved_units + 1, version = version + 1, updated_at = NOW()
       WHERE provider = 'zerobounce' AND enabled = TRUE AND circuit_state = 'closed'
         AND reserved_units + consumed_units < local_budget_units
       RETURNING provider
    )
    INSERT INTO provider_operations
      (provider, operation_type, purpose, idempotency_key, actor_type, actor_id,
       target_fingerprint, state, requested_units, reserved_units, billing_state, started_at)
    SELECT provider, 'email_validation', 'marketing_outreach', ${operationKey},
           'system', 'validation-intent', ${tokenHash}, 'running', 1, 1, 'reserved', NOW()
      FROM reservation
    RETURNING id
  `);
  const operationId = (allocation as any).rows?.[0]?.id;
  if (!operationId) {
    await db.execute(sql`
      UPDATE validation_intents
         SET state = 'pending', enqueue_state = 'deferred',
             terminal_code = 'budget_exhausted', lease_expires_at = NULL,
             claim_token = NULL, updated_at = NOW()
       WHERE id = ${intentId}::uuid AND claim_token = ${claimToken}::uuid
    `);
    return "deferred";
  }
  const attempt = await db.execute(sql`
    INSERT INTO provider_attempts (operation_id, attempt_number, outcome, started_at)
    VALUES (${operationId}::uuid, 1, 'pending', NOW())
    ON CONFLICT (operation_id, attempt_number) DO UPDATE SET started_at = NOW()
    RETURNING id
  `);
  const attemptId = (attempt as any).rows?.[0]?.id;
  const verifyEmail = deps.verifyEmail ?? (await import("./sdr/zerobounce")).verifyEmail;
  let result;
  try {
    result = await verifyEmail(contact.email);
  } catch {
    result = { status: "unknown", reason: "transport", outcome: "unavailable" };
  }
  const positive = result.status === "valid" && !result.reason && result.outcome === "completed";
  const providerCompleted = result.outcome === "completed" && !result.reason;
  const observationOutcome = (() => {
    const candidate = result.reason ?? result.status ?? "unknown";
    // Provider vocabulary is intentionally narrower than the durable evidence
    // vocabulary. These are completed, non-positive results, not transport
    // failures: preserve their fail-closed meaning without violating the
    // constrained observation model.
    if (candidate === "unsafe") return "risky";
    if (candidate === "unverified") return "unknown";
    if (["valid", "invalid", "risky", "unknown", "not_configured", "budget_blocked",
      "circuit_blocked", "rate_limited", "rejected", "timeout", "transport", "parse_error",
      "ambiguous_billing", "no_result", "superseded"].includes(candidate)) return candidate;
    if (candidate === "http_4xx" || candidate === "http_5xx") return "rejected";
    return "unknown";
  })();
  await db.execute(sql`
    INSERT INTO provider_observations
      (provider, operation_id, attempt_id, subject_type, subject_id,
       email_token_hash, subject_generation, outcome, retryable, observed_at)
    VALUES ('zerobounce', ${operationId}::uuid, ${attemptId}::uuid, 'contact',
            ${contact.id}, ${tokenHash}, ${intent.subject_generation},
            ${positive ? "valid" : observationOutcome}, ${!positive}, NOW())
  `);
  await db.execute(sql`
    UPDATE provider_attempts
       SET outcome = ${providerCompleted ? "completed" : "retryable_failed"},
           retryable = ${!providerCompleted}, error_code = ${providerCompleted ? null : (result.reason ?? "non_positive")},
           completed_at = NOW()
     WHERE id = ${attemptId}::uuid
  `);
  await db.execute(sql`
    UPDATE provider_operations
        SET state = ${providerCompleted ? "completed" : "failed"},
            billing_state = ${providerCompleted ? "committed" : "ambiguous"},
           completed_at = NOW(), updated_at = NOW()
     WHERE id = ${operationId}::uuid
  `);
  if (positive) {
    await db.execute(sql`
      UPDATE contacts
         SET email_status = 'valid', email_token_hash = ${tokenHash},
             email_validation_updated_at = NOW()
       WHERE id = ${contact.id}
         AND email_mutation_generation = ${intent.subject_generation}
         AND email_token_hash = ${tokenHash}
    `);
  }
  await db.execute(sql`
    UPDATE provider_controls
        SET reserved_units = ${providerCompleted ? sql`GREATEST(0, reserved_units - 1)` : sql`reserved_units`},
            consumed_units = ${providerCompleted ? sql`consumed_units + 1` : sql`consumed_units`},
            last_completed_at = ${providerCompleted ? sql`NOW()` : sql`last_completed_at`},
            last_outcome = ${providerCompleted ? (positive ? "valid" : "non_positive") : "ambiguous_billing"},
           observed_at = NOW(), version = version + 1, updated_at = NOW()
     WHERE provider = 'zerobounce'
  `);
  await db.execute(sql`
    UPDATE validation_intents
        SET state = ${positive ? "completed" : "blocked"},
           operation_id = ${operationId}::uuid,
            terminal_code = ${positive ? null : (providerCompleted ? (result.reason ?? "non_positive") : "ambiguous_billing")},
           completed_at = NOW(), lease_expires_at = NULL, claim_token = NULL,
           updated_at = NOW()
     WHERE id = ${intentId}::uuid AND claim_token = ${claimToken}::uuid
  `);
  return positive ? "completed" : (providerCompleted ? "failed" : "deferred");
}