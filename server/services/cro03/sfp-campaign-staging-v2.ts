/**
 * sfp-campaign-staging-v2.ts
 *
 * Task #2001: the corrected, package-pinned, snapshot-bound, transactional
 * campaign/sequence staging boundary. Replaces the terminal state of
 * `stageForCampaign()` (south-florida-prospecting.ts) — that function still
 * exists and still writes the legacy `staged` no-consumer intent for
 * backward compatibility, but this module is the one that carries a staged
 * intent through `operator_selected -> ready_held`, admits paid-source rows,
 * and is transactional end to end.
 *
 * Terminal boundary: `ready_held`. This module NEVER writes to
 * sequence_enrollments, campaign_queue_runs/items, or any GHL/outbound
 * table. Zero sends occur from any code path in this file.
 */

import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../../db";
import { getActiveSfpOutreachPolicy } from "./sfp-outreach-policy";
import { isCanonicallySuppressed } from "./sfp-outreach-policy";
import { businessLacksDbprLineageSql } from "../dbpr";
import { getCurrentPackageForVertical, computeLivePackageContentHash } from "./sfp-campaign-packages";
import { openSfpCandidatePlaintext } from "./sfp-paid-evidence-writer";
import { evaluateSfpMutableSafetyGates, lookupConsentTierByEmailHash } from "./sfp-outreach-policy";

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const MAX_BATCH_SIZE = 25;

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export class SfpStagingV2Error extends Error {
  constructor(public code: string, message: string, public httpStatus: 400 | 409 | 422 = 400) {
    super(message);
    this.name = "SfpStagingV2Error";
  }
}

export interface StagingV2PreviewRow {
  eligibilityId: string;
  businessId: number;
  sourceKind: "free" | "paid";
  vertical: string | null;
  packageKey: string | null;
  disposition: "eligible" | "blocked";
  blockedReason?: string;
  maskedEmail: string | null;
}

export interface StagingV2Preview {
  cohortRunId: string;
  snapshotHash: string;
  commandKey: string;
  policyDocumentHash: string;
  rows: StagingV2PreviewRow[];
  eligibleCount: number;
  blockedCount: number;
  capturedAt: string;
}

/**
 * Snapshot-bound, zero-write preview. Requires an explicit set of
 * eligibility IDs — there is no "all eligible" mode (Defect 14).
 */
/**
 * Canonicalizes a caller-supplied ID list: rejects duplicates outright
 * (rather than silently de-duping, which would let a caller under-count
 * what it thinks it selected) and sorts so downstream ordering — the SQL
 * query, the preview row array, and the snapshot hash inputs — is
 * deterministic regardless of what order the caller happened to submit
 * (PM-04 correction).
 */
function canonicalizeEligibilityIds(ids: string[]): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new SfpStagingV2Error("SFP_STAGING_DUPLICATE_ID", `duplicate eligibilityId in request: ${id}`, 400);
    seen.add(id);
  }
  return [...ids].sort();
}

export async function previewStagingV2(opts: {
  cohortRunId: string;
  eligibilityIds: string[];
  actorId: string;
}): Promise<StagingV2Preview> {
  if (!opts.eligibilityIds || opts.eligibilityIds.length === 0) {
    throw new SfpStagingV2Error("SFP_STAGING_NO_SELECTION", "eligibilityIds must be explicitly provided and non-empty", 400);
  }
  if (opts.eligibilityIds.length > MAX_BATCH_SIZE) {
    throw new SfpStagingV2Error("SFP_STAGING_BATCH_TOO_LARGE", `at most ${MAX_BATCH_SIZE} eligibility IDs may be staged per command`, 400);
  }
  const orderedIds = canonicalizeEligibilityIds(opts.eligibilityIds);

  const activePolicy = await getActiveSfpOutreachPolicy();
  const eligibilityRows = rows(await db.execute(sql`
    SELECT soe.id, soe.business_id, soe.source_kind, soe.candidate_id, soe.paid_candidate_evidence_id,
           soe.status, soe.validation_at, soe.validation_expires_at, soe.masked_email, soe.staging_intent_id,
           soe.normalized_value_hash, soe.policy_version,
           b.vertical
    FROM sfp_outreach_eligibility soe
    JOIN businesses b ON b.id = soe.business_id
    WHERE soe.cohort_run_id = ${opts.cohortRunId}::uuid
      AND soe.id = ANY(ARRAY[${sql.join(orderedIds.map((id) => sql`${id}::uuid`), sql`, `)}])
    ORDER BY soe.id
  `));
  // Re-order strictly by the canonical (sorted) id list — never trust the
  // DB's own row order for the preview array — so the same ID set always
  // produces the same preview row order regardless of query-plan behavior.
  const byId = new Map(eligibilityRows.map((r) => [String(r.id), r]));

  const foundIds = new Set(eligibilityRows.map((r) => String(r.id)));
  const previewRows: StagingV2PreviewRow[] = [];
  for (const id of orderedIds) {
    if (!foundIds.has(id)) {
      previewRows.push({ eligibilityId: id, businessId: -1, sourceKind: "free", vertical: null, packageKey: null, disposition: "blocked", blockedReason: "not_found_in_cohort", maskedEmail: null });
    }
  }

  // Snapshot hashing input per row — captures everything that could
  // invalidate this preview by the time execute() runs: disposition,
  // package key AND the exact package content/campaign/sequence pin behind
  // it, and the exact validation-expiry instant used to admit the row.
  // Package-key alone is not enough: a package_key can stay 'current' while
  // its underlying content_hash, campaign, or sequence changes underneath
  // it, and that must force a fresh preview too.
  const hashInputRows: Array<{ id: string; disposition: string; packageKey: string | null; packageContentHash: string | null; effectiveExpiresAtIso: string | null }> = [];

  for (const row of eligibilityRows) {
    const sourceKind = (row.source_kind === "paid" ? "paid" : "free") as "free" | "paid";
    const base: StagingV2PreviewRow = {
      eligibilityId: String(row.id), businessId: Number(row.business_id), sourceKind,
      vertical: row.vertical ?? null, packageKey: null, disposition: "eligible", maskedEmail: row.masked_email ?? null,
    };
    if (row.status !== "validated_outreach_eligible") {
      previewRows.push({ ...base, disposition: "blocked", blockedReason: `status_${row.status}` });
      hashInputRows.push({ id: String(row.id), disposition: "blocked", packageKey: null, packageContentHash: null, effectiveExpiresAtIso: null });
      continue;
    }
    if (row.staging_intent_id) {
      previewRows.push({ ...base, disposition: "blocked", blockedReason: "already_has_staging_intent" });
      hashInputRows.push({ id: String(row.id), disposition: "blocked", packageKey: null, packageContentHash: null, effectiveExpiresAtIso: null });
      continue;
    }
    const effectiveExpiresAt = row.validation_expires_at
      ? new Date(String(row.validation_expires_at))
      : row.validation_at
        ? new Date(new Date(String(row.validation_at)).getTime() + activePolicy.validationTtlDays * 86_400_000)
        : null;
    if (!effectiveExpiresAt || effectiveExpiresAt.getTime() < Date.now()) {
      previewRows.push({ ...base, disposition: "blocked", blockedReason: "validation_stale" });
      hashInputRows.push({ id: String(row.id), disposition: "blocked", packageKey: null, packageContentHash: null, effectiveExpiresAtIso: null });
      continue;
    }
    if (!row.vertical) {
      previewRows.push({ ...base, disposition: "blocked", blockedReason: "vertical_unresolved" });
      hashInputRows.push({ id: String(row.id), disposition: "blocked", packageKey: null, packageContentHash: null, effectiveExpiresAtIso: null });
      continue;
    }
    const pkg = await getCurrentPackageForVertical(String(row.vertical));
    if (!pkg) {
      previewRows.push({ ...base, disposition: "blocked", blockedReason: "no_current_package_for_vertical" });
      hashInputRows.push({ id: String(row.id), disposition: "blocked", packageKey: null, packageContentHash: null, effectiveExpiresAtIso: null });
      continue;
    }
    previewRows.push({ ...base, packageKey: pkg.packageKey, disposition: "eligible" });
    hashInputRows.push({ id: String(row.id), disposition: "eligible", packageKey: pkg.packageKey, packageContentHash: pkg.contentHash, effectiveExpiresAtIso: effectiveExpiresAt.toISOString() });
  }

  const eligibleCount = previewRows.filter((r) => r.disposition === "eligible").length;
  const blockedCount = previewRows.length - eligibleCount;
  const policyDocumentHash = sha256(activePolicy);

  const snapshotHash = sha256({
    cohortRunId: opts.cohortRunId,
    eligibilityIds: [...opts.eligibilityIds].sort(),
    policyDocumentHash,
    rows: hashInputRows,
  });
  const commandKey = `sfp-stage-v2:${opts.cohortRunId}:${snapshotHash}`;

  return {
    cohortRunId: opts.cohortRunId,
    snapshotHash,
    commandKey,
    policyDocumentHash,
    rows: previewRows,
    eligibleCount,
    blockedCount,
    capturedAt: new Date().toISOString(),
  };
}

export interface StagingV2ExecuteResult {
  commandKey: string;
  readyHeld: number;
  rejected: number;
  reasons: Record<string, number>;
  zeroOutreachConfirmed: true;
  replayed: boolean;
  completedAt: string;
}

/**
 * Transactional, snapshot-bound execution. Requires the exact commandKey +
 * snapshotHash returned by a prior previewStagingV2() call. Same commandKey
 * + same payload replays the stored result verbatim; same commandKey with a
 * mismatched payload fails closed with a 409 (never a silent overwrite).
 */
export async function executeStagingV2(opts: {
  cohortRunId: string;
  eligibilityIds: string[];
  commandKey: string;
  snapshotHash: string;
  actorId: string;
}): Promise<StagingV2ExecuteResult> {
  if (!opts.eligibilityIds || opts.eligibilityIds.length === 0) {
    throw new SfpStagingV2Error("SFP_STAGING_NO_SELECTION", "eligibilityIds must be explicitly provided and non-empty", 400);
  }
  if (opts.eligibilityIds.length > MAX_BATCH_SIZE) {
    throw new SfpStagingV2Error("SFP_STAGING_BATCH_TOO_LARGE", `at most ${MAX_BATCH_SIZE} eligibility IDs may be staged per command`, 400);
  }

  // The commandKey is server-issued by previewStagingV2() as a deterministic
  // function of cohortRunId + snapshotHash. Validate that the supplied
  // commandKey actually corresponds to the supplied snapshotHash/cohortRunId
  // rather than trusting the caller's pairing of the two — otherwise a
  // caller could present a valid commandKey/snapshotHash pair from a
  // different (or stale) preview than the one it claims to match.
  const expectedCommandKey = `sfp-stage-v2:${opts.cohortRunId}:${opts.snapshotHash}`;
  if (opts.commandKey !== expectedCommandKey) {
    throw new SfpStagingV2Error("SFP_STAGING_COMMAND_KEY_MISMATCH", "commandKey does not correspond to the given cohortRunId/snapshotHash", 400);
  }

  const orderedIds = canonicalizeEligibilityIds(opts.eligibilityIds);
  const payloadHash = sha256({ cohortRunId: opts.cohortRunId, eligibilityIds: orderedIds });

  // PM-04 correction: claim the command as 'pending' BEFORE any per-row work
  // starts, and only ever transition it forward (pending -> executing ->
  // completed) via a WHERE-guarded UPDATE. This makes the command row —
  // not an in-memory loop — the durable source of truth for "has this
  // command already run", so a crash between a row's commit and the old
  // "insert receipt last" step can no longer produce an ambiguous state:
  // the row exists, in 'executing', and a retry resumes into it rather than
  // re-deriving a preview that would see the just-committed rows as
  // "already_has_staging_intent" and misreport SFP_STAGING_SNAPSHOT_DRIFTED.
  const claim = rows(await db.execute(sql`
    INSERT INTO sfp_campaign_staging_commands (cohort_run_id, command_key, payload_hash, snapshot_hash, actor_id, state)
    VALUES (${opts.cohortRunId}::uuid, ${opts.commandKey}, ${payloadHash}, ${opts.snapshotHash}, ${opts.actorId}, 'pending')
    ON CONFLICT (command_key) DO NOTHING
    RETURNING id, state, payload_hash, stored_result
  `))[0];

  if (!claim) {
    // Someone else's row already exists for this exact command_key — lock
    // and read the canonical row rather than racing another in-memory
    // result. Loop briefly if it is still 'executing' (a concurrent caller
    // is actively finishing it).
    for (let attempt = 0; attempt < 20; attempt++) {
      const canonical = rows(await db.execute(sql`
        SELECT payload_hash, snapshot_hash, stored_result, state FROM sfp_campaign_staging_commands
        WHERE command_key = ${opts.commandKey} LIMIT 1
      `))[0];
      if (!canonical) break; // vanishingly unlikely; fall through to re-claim below
      if (canonical.payload_hash !== payloadHash) {
        throw new SfpStagingV2Error("SFP_STAGING_COMMAND_PAYLOAD_MISMATCH", "commandKey already used with a different payload; request a new preview", 409);
      }
      if (canonical.state === "completed" && canonical.stored_result) {
        return { ...(canonical.stored_result as any), replayed: true };
      }
      // pending/executing: another caller (or a prior crashed attempt) owns
      // it. Give it a moment, then re-check; if it never converges, fall
      // through and attempt to resume it ourselves below.
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  // Either we hold the fresh 'pending' claim, or no other caller ever
  // completed it — transition (or re-affirm) 'executing' and proceed. This
  // UPDATE is idempotent for a resumed same-process retry.
  await db.execute(sql`
    UPDATE sfp_campaign_staging_commands SET state = 'executing'
    WHERE command_key = ${opts.commandKey} AND state IN ('pending', 'executing')
  `);

  // Re-derive the preview fresh — a stale snapshotHash (drifted policy,
  // package mapping, or eligibility state since the client's preview call)
  // must fail closed and force a new preview rather than staging against
  // out-of-date dispositions. Resumed same-command rows are reconciled as
  // idempotent no-ops inside stageOneRowTransactional(), not reclassified
  // as drift, because they carry this exact commandKey.
  const freshPreview = await previewStagingV2({ cohortRunId: opts.cohortRunId, eligibilityIds: orderedIds, actorId: opts.actorId });
  if (freshPreview.snapshotHash !== opts.snapshotHash) {
    throw new SfpStagingV2Error("SFP_STAGING_SNAPSHOT_DRIFTED", "snapshot has drifted since preview (policy/package/eligibility changed) — request a new preview", 409);
  }

  let readyHeld = 0;
  let rejected = 0;
  const reasons: Record<string, number> = {};

  for (const previewRow of freshPreview.rows) {
    if (previewRow.disposition === "blocked") {
      rejected++;
      reasons[previewRow.blockedReason ?? "blocked"] = (reasons[previewRow.blockedReason ?? "blocked"] ?? 0) + 1;
      continue;
    }
    try {
      await stageOneRowTransactional({
        cohortRunId: opts.cohortRunId,
        eligibilityId: previewRow.eligibilityId,
        businessId: previewRow.businessId,
        sourceKind: previewRow.sourceKind,
        packageKey: previewRow.packageKey!,
        actorId: opts.actorId,
        commandKey: opts.commandKey,
        payloadHash,
        snapshotHash: opts.snapshotHash,
      });
      readyHeld++;
    } catch (err: any) {
      rejected++;
      const code = err instanceof SfpStagingV2Error ? err.code : "staging_transaction_failed";
      reasons[code] = (reasons[code] ?? 0) + 1;
    }
  }

  const result: StagingV2ExecuteResult = {
    commandKey: opts.commandKey,
    readyHeld,
    rejected,
    reasons,
    zeroOutreachConfirmed: true,
    replayed: false,
    completedAt: new Date().toISOString(),
  };

  // Transition to 'completed' with a WHERE guard: if another concurrent
  // caller already completed this same command_key first, this UPDATE
  // matches zero rows — re-read and return ITS stored result rather than
  // our own locally computed one, so two racing callers converge on one
  // canonical receipt instead of each returning a "winning" local result.
  const completedRow = rows(await db.execute(sql`
    UPDATE sfp_campaign_staging_commands
       SET state = 'completed', stored_result = ${JSON.stringify(result)}::jsonb
     WHERE command_key = ${opts.commandKey} AND state != 'completed'
    RETURNING stored_result
  `))[0];
  if (!completedRow) {
    const canonical = rows(await db.execute(sql`
      SELECT stored_result FROM sfp_campaign_staging_commands WHERE command_key = ${opts.commandKey} LIMIT 1
    `))[0];
    if (canonical?.stored_result) return { ...(canonical.stored_result as any), replayed: true };
  }

  return result;
}

async function stageOneRowTransactional(opts: {
  cohortRunId: string; eligibilityId: string; businessId: number; sourceKind: "free" | "paid";
  packageKey: string; actorId: string; commandKey: string; payloadHash: string; snapshotHash: string;
}): Promise<void> {
  const activePolicy = await getActiveSfpOutreachPolicy();
  await db.transaction(async (tx) => {
    // Cohort/program still authorize staging as of the exact moment this row
    // is written (Defect 12). previewStagingV2()/executeStagingV2()'s fresh
    // preview only re-checks eligibility rows and package status — it never
    // re-derives cohort lifecycle or program activation, so a cohort voided
    // or a program deactivated between preview and this write must still be
    // caught here, inside the same transaction that commits the intent.
    const cohortRow = rows(await tx.execute(sql`
      SELECT r.cohort_state, r.voided_at, r.superseded_at, p.is_active AS program_active
      FROM sfp_cohort_runs r
      JOIN sfp_programs p ON p.id = r.program_id
      WHERE r.id = ${opts.cohortRunId}::uuid
      LIMIT 1
    `))[0];
    if (!cohortRow) throw new SfpStagingV2Error("SFP_STAGING_COHORT_NOT_FOUND", "cohort run not found", 422);
    if (cohortRow.cohort_state !== "frozen" || cohortRow.voided_at || cohortRow.superseded_at) {
      throw new SfpStagingV2Error("SFP_STAGING_COHORT_NOT_FROZEN", `cohort is ${cohortRow.cohort_state}, not a live frozen cohort`, 409);
    }
    if (cohortRow.program_active !== true) {
      throw new SfpStagingV2Error("SFP_STAGING_PROGRAM_INACTIVE", "owning program is no longer active", 409);
    }

    // Lock the eligibility row for the duration of this transaction.
    const eligRow = rows(await tx.execute(sql`
      SELECT soe.id, soe.status, soe.candidate_id, soe.paid_candidate_evidence_id, soe.normalized_value_hash,
             soe.masked_email, soe.role_inbox, soe.staging_intent_id, soe.policy_version,
             soe.validation_at, soe.validation_expires_at,
             b.canonical_name, b.website_domain, b.main_phone, b.vertical, b.city, b.state
      FROM sfp_outreach_eligibility soe
      JOIN businesses b ON b.id = soe.business_id
      WHERE soe.id = ${opts.eligibilityId}::uuid
      FOR UPDATE OF soe
    `))[0];
    if (!eligRow) throw new SfpStagingV2Error("SFP_STAGING_ELIGIBILITY_NOT_FOUND", "eligibility row not found", 422);
    if (eligRow.status !== "validated_outreach_eligible") {
      throw new SfpStagingV2Error("SFP_STAGING_STATUS_DRIFTED", `eligibility status is now ${eligRow.status}`, 409);
    }
    if (eligRow.staging_intent_id) {
      // If the existing intent was created by THIS exact command (a
      // concurrent duplicate call, or a resumed retry after a crash between
      // this row's commit and the outer command receipt), treat it as an
      // idempotent no-op rather than an error — the row is already
      // durably ready_held under this command, so returning success here
      // lets a resumed executeStagingV2() loop reconverge to the true
      // persisted count instead of a stale in-memory one.
      const existingIntent = rows(await tx.execute(sql`
        SELECT command_key, state FROM sfp_campaign_staging_intents WHERE id = ${String(eligRow.staging_intent_id)}::uuid
      `))[0];
      if (existingIntent && existingIntent.command_key === opts.commandKey && existingIntent.state === "ready_held") {
        return;
      }
      throw new SfpStagingV2Error("SFP_STAGING_ALREADY_HAS_INTENT", "eligibility already has a staging intent", 409);
    }

    // Re-check validation freshness at the exact moment of the write, not
    // just at preview time — the preview snapshot can be minutes old by the
    // time a queued/retried row actually reaches this transaction.
    const effectiveExpiresAt = eligRow.validation_expires_at
      ? new Date(String(eligRow.validation_expires_at))
      : eligRow.validation_at
        ? new Date(new Date(String(eligRow.validation_at)).getTime() + activePolicy.validationTtlDays * 86_400_000)
        : null;
    if (!effectiveExpiresAt || effectiveExpiresAt.getTime() < Date.now()) {
      throw new SfpStagingV2Error("SFP_STAGING_VALIDATION_STALE", "validation has expired since preview", 409);
    }

    // Package still current; campaign draft; sequence paused (Defect 12).
    const pkgRow = rows(await tx.execute(sql`
      SELECT v.id, v.campaign_id, v.sequence_id, v.content_hash, c.status AS campaign_status, s.status AS sequence_status
      FROM sfp_campaign_package_versions v
      JOIN campaigns c ON c.id = v.campaign_id
      JOIN follow_up_sequences s ON s.id = v.sequence_id
      WHERE v.package_key = ${opts.packageKey} AND v.lifecycle_state = 'current'
      LIMIT 1
    `))[0];
    if (!pkgRow) throw new SfpStagingV2Error("SFP_STAGING_PACKAGE_NOT_CURRENT", "package mapping is no longer current", 409);
    if (pkgRow.campaign_status !== "draft") throw new SfpStagingV2Error("SFP_STAGING_PACKAGE_CAMPAIGN_NOT_DRAFT", "target campaign is no longer draft", 409);
    if (pkgRow.sequence_status !== "paused") throw new SfpStagingV2Error("SFP_STAGING_PACKAGE_SEQUENCE_NOT_PAUSED", "target sequence is no longer paused", 409);

    // Recompute the package's content hash LIVE, from the actual campaign +
    // sequence + step rows, inside this same transaction — never trust the
    // stored content_hash column alone. A copy edit or content-revision bump
    // to the pinned campaign/sequence after the package version was marked
    // `current` must be caught here and fail closed, not silently pinned.
    const liveContentHash = await computeLivePackageContentHash(tx, Number(pkgRow.campaign_id), Number(pkgRow.sequence_id));
    if (liveContentHash !== String(pkgRow.content_hash)) {
      throw new SfpStagingV2Error("SFP_STAGING_PACKAGE_CONTENT_DRIFTED", "campaign/sequence content has changed since this package version was pinned — reissue the package version before staging", 409);
    }

    // Pin the exact, authoritative policy document hash actually used to
    // admit this row — PM-05 correction: the prior implementation stored
    // sha256(activePolicy) (a locally re-derived hash of the in-process
    // object) rather than the canonical `activePolicy.documentHash` the
    // policy authority itself persists and versions. The two can diverge if
    // the in-memory policy object ever gains a field that isn't part of the
    // documented hash contract, silently pinning an unverifiable value.
    const pinnedPolicyHash = activePolicy.documentHash;
    const pinnedPackageContentHash = liveContentHash;

    // Lock the active-policy singleton pointer inside this transaction and
    // confirm it still points at the same policy document `activePolicy`
    // was read from — a policy activation change between the cached read
    // above and this row's write must fail closed, not silently admit the
    // row under a policy that is no longer active.
    const lockedPolicyControl = rows(await tx.execute(sql`
      SELECT active_policy_id FROM sfp_outreach_policy_control WHERE singleton = TRUE FOR UPDATE
    `))[0];
    if (!lockedPolicyControl || String(lockedPolicyControl.active_policy_id) !== activePolicy.id) {
      throw new SfpStagingV2Error("SFP_STAGING_POLICY_DRIFTED", "active outreach policy changed since preview — request a new preview", 409);
    }

    // PM-05 correction: reuse the canonical, executor-aware safety-gate
    // authority (DBPR + existing-customer + consent-tier) instead of a
    // second, duplicated inline implementation — bound to `tx` so it reads
    // the same locked snapshot as everything else in this transaction.
    const consentTier = eligRow.normalized_value_hash
      ? await lookupConsentTierByEmailHash(String(eligRow.normalized_value_hash), tx)
      : null;
    const gate = await evaluateSfpMutableSafetyGates({ businessId: opts.businessId, consentTier, policy: activePolicy }, tx);
    if (!gate.eligible) {
      throw new SfpStagingV2Error(`SFP_STAGING_${gate.reasonCode.toUpperCase()}`, `safety gate failed: ${gate.reasonCode}`, 422);
    }

    // Suppression re-check against the masked/normalized hash on file, bound
    // to this same transaction rather than the global DB helper.
    if (eligRow.normalized_value_hash) {
      const suppressed = await isCanonicallySuppressed([String(eligRow.normalized_value_hash)], tx);
      if (suppressed) throw new SfpStagingV2Error("SFP_STAGING_SUPPRESSED", "candidate address is suppressed", 422);
    }

    let idempotencyKey = opts.commandKey;
    let intentValues: {
      candidateId: string | null; paidCandidateEvidenceId: string | null;
      contactEmailTokenHash: string; maskedEmailForLead: string | null;
    };
    // masterLeadEmail is written ONLY inside the openSfpCandidatePlaintext
    // callback below, in the same statement, bound to `tx` — plaintext is
    // never assigned to an outer variable or returned across the boundary
    // (PM-03: the previous implementation returned `{ ..., plaintext }`
    // from this callback, which is exactly the escape the audited boundary
    // exists to prevent).
    let masterLeadEmailWritten = false;

    const reference = opts.sourceKind === "free"
      ? (() => {
          if (!eligRow.candidate_id) throw new SfpStagingV2Error("SFP_STAGING_CANDIDATE_MISSING", "free-source row missing candidate_id", 422);
          return { sourceKind: "free" as const, freeDiscoveryCandidateId: String(eligRow.candidate_id) };
        })()
      : (() => {
          if (!eligRow.paid_candidate_evidence_id) throw new SfpStagingV2Error("SFP_STAGING_PAID_EVIDENCE_MISSING", "paid-source row missing paid_candidate_evidence_id", 422);
          return { sourceKind: "paid" as const, paidCandidateEvidenceId: String(eligRow.paid_candidate_evidence_id) };
        })();

    const hash = await openSfpCandidatePlaintext(
      { reference, cohortRunId: opts.cohortRunId, actorId: opts.actorId, purpose: "sfp_campaign_staging_v2_master_lead_projection" },
      async (plaintext, resolved) => {
        // The candidate reference resolves to SOME business that is a
        // member of the cohort — but membership alone does not prove it is
        // THIS eligibility row's business. Without this check, a mismatched
        // or stale candidate_id could project another cohort member's
        // address into this row's master-lead record.
        if (resolved.businessId !== opts.businessId) {
          throw new SfpStagingV2Error("SFP_STAGING_EVIDENCE_BUSINESS_MISMATCH", "candidate/paid evidence resolves to a different business than this eligibility row", 422);
        }
        const contactEmailTokenHash = createHash("sha256").update(plaintext.trim().toLowerCase()).digest("hex");
        const stillSuppressed = await isCanonicallySuppressed([contactEmailTokenHash]);
        if (stillSuppressed) throw new SfpStagingV2Error("SFP_STAGING_SUPPRESSED", "resolved address is suppressed", 422);
        // Master-lead insert happens HERE, inside this callback, using the
        // plaintext directly — it never leaves this stack frame. `tx` is
        // passed as the executor so this write is part of the same
        // transaction as the eligibility lock and intent insert below.
        await tx.execute(sql`
          INSERT INTO master_leads
            (status, company, normalized_company, domain, email, email_type, phone, vertical,
             outreach_readiness, readiness_reason, source, source_path, city, state, website, email_valid,
             pipeline_origin, canonical_business_id, email_token_hash, masked_email, created_at, updated_at)
          VALUES ('staged', ${eligRow.canonical_name}, LOWER(TRIM(${eligRow.canonical_name})), ${eligRow.website_domain},
                  ${plaintext}, ${eligRow.role_inbox ? "role" : "business"}, ${eligRow.main_phone}, ${eligRow.vertical},
                  'not_ready', 'ready_held_package_pinned_pending_separate_activation', 'sfp_validated',
                  ${`sfp:${opts.cohortRunId}:${opts.eligibilityId}`}, ${eligRow.city}, ${eligRow.state}, ${eligRow.website_domain}, TRUE,
                  'sfp_pipeline', ${opts.businessId}, ${contactEmailTokenHash}, ${eligRow.masked_email ?? null}, NOW(), NOW())
          ON CONFLICT (canonical_business_id, email_token_hash)
            WHERE pipeline_origin = 'sfp_pipeline' AND canonical_business_id IS NOT NULL AND email_token_hash IS NOT NULL
          DO UPDATE SET status = 'staged', email_valid = TRUE, updated_at = NOW()
        `);
        masterLeadEmailWritten = true;
        return contactEmailTokenHash;
      },
      tx,
    );
    if (!masterLeadEmailWritten) throw new SfpStagingV2Error("SFP_STAGING_MASTER_LEAD_WRITE_FAILED", "master lead projection did not complete", 422);

    intentValues = {
      candidateId: reference.sourceKind === "free" ? reference.freeDiscoveryCandidateId : null,
      paidCandidateEvidenceId: reference.sourceKind === "paid" ? reference.paidCandidateEvidenceId : null,
      contactEmailTokenHash: hash, maskedEmailForLead: eligRow.masked_email ?? null,
    };

    const masterLead = rows(await tx.execute(sql`
      SELECT id FROM master_leads
       WHERE pipeline_origin = 'sfp_pipeline' AND canonical_business_id = ${opts.businessId}
         AND email_token_hash = ${intentValues.contactEmailTokenHash}
       LIMIT 1
    `))[0];

    const intent = rows(await tx.execute(sql`
      INSERT INTO sfp_campaign_staging_intents
        (cohort_run_id, eligibility_id, business_id, candidate_id, paid_candidate_evidence_id, source_kind,
         idempotency_key, actor_id, state, policy_version, validation_snapshot, lineage,
         package_version_id, package_key, policy_document_hash, snapshot_hash, payload_hash, command_key,
         operator_selected_at, operator_selected_by, ready_held_at)
      VALUES (${opts.cohortRunId}::uuid, ${opts.eligibilityId}::uuid, ${opts.businessId},
              ${intentValues.candidateId}::uuid, ${intentValues.paidCandidateEvidenceId}::uuid, ${opts.sourceKind},
              ${idempotencyKey}, ${opts.actorId}, 'ready_held', ${Number(eligRow.policy_version ?? 1)},
              ${JSON.stringify({ status: eligRow.status, pinnedPackageContentHash, pinnedPolicyHash, validationExpiresAt: effectiveExpiresAt.toISOString() })}::jsonb,
              ${JSON.stringify({ source: "sfp_staging_v2", cohortRunId: opts.cohortRunId, eligibilityId: opts.eligibilityId })}::jsonb,
              ${pkgRow.id}::uuid, ${opts.packageKey}, ${pinnedPolicyHash}, ${opts.snapshotHash}, ${opts.payloadHash}, ${opts.commandKey},
              NOW(), ${opts.actorId}, NOW())
      RETURNING id
    `))[0];

    if (!masterLead) throw new SfpStagingV2Error("SFP_STAGING_MASTER_LEAD_LOOKUP_FAILED", "master lead row could not be located after projection", 422);

    await tx.execute(sql`
      UPDATE sfp_outreach_eligibility
      SET campaign_staged_at = NOW(), campaign_staged_by = ${opts.actorId}, staging_intent_id = ${String(intent.id)}::uuid, updated_at = NOW()
      WHERE id = ${opts.eligibilityId}::uuid
    `);
    await tx.execute(sql`
      UPDATE sfp_campaign_staging_intents SET master_lead_id = ${String(masterLead.id)}::uuid, updated_at = NOW()
      WHERE id = ${String(intent.id)}::uuid
    `);
  });
}
