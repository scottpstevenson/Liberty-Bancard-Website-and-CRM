import { isLocalOutboxWorkerSelected } from "./background-profile";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { requireConfirmedActivationSnapshot } from "./processors/registry";
import {
  requestPayarcSignature,
  validatePayarcSignature,
} from "./processors/payarc.adapter";
import { checkProcessorBaseUrl } from "./processors/processor-base-url";
import { evaluateBoardingReadiness } from "./boarding-readiness";
const rows = (r: any): any[] => r.rows ?? r;
/** No MID/PII/bearer links in the general case projection. */
export async function readPayarcLifecycle(dealId: number) {
  const [c] = rows(
    await db.execute(
      sql`SELECT contract_version,environment,merchant_code,phase,observation,signature_state,signature_attempts,signature_sent_at,next_poll_at,last_polled_at,last_error FROM payarc_cases WHERE deal_id=${dealId}`,
    ),
  );
  return c
    ? {
        ...c,
        workerSelected: isLocalOutboxWorkerSelected(),
        signatureWorkerEnabled: process.env.PAYARC_SIGNATURE_ENABLED === "true",
        statusWorkerEnabled: process.env.PAYARC_STATUS_SYNC_ENABLED === "true",
      }
    : null;
}
/** One signature dispatch per durable step. A surviving dispatch marker is uncertain, never auto-retried. */
export async function dispatchPayarcSignature(dealId: number) {
  if (process.env.PAYARC_SIGNATURE_ENABLED !== "true")
    return { state: "disabled" };
  const snapshot = await requireConfirmedActivationSnapshot(
    "payarc",
    "request_signature",
  );
  if (snapshot.processorProgram !== "traditional")
    return { state: "program_mismatch" };
  const base = checkProcessorBaseUrl("payarc", snapshot.authorizedBaseUrl);
  if (!base.ok) return { state: "invalid_base" };
  const token = randomUUID();
  const c = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM deals WHERE id=${dealId} FOR UPDATE`);
    await tx.execute(
      sql`SELECT a.id FROM merchant_applications a JOIN payarc_cases c ON c.application_id=a.id WHERE c.deal_id=${dealId} FOR UPDATE OF a`,
    );
    const verdict = await evaluateBoardingReadiness(
      dealId,
      { includeFieldCompleteness: false },
      tx,
    );
    if (!verdict.ready) return null;
    const [claimed] = rows(
      await tx.execute(sql`UPDATE payarc_cases c SET signature_state='attempting',signature_attempts=signature_attempts+1,signature_lease=${token}::uuid,signature_started_at=now(),updated_at=now()
   WHERE deal_id=${dealId} AND signature_state='pending' AND signature_attempts<5 AND environment=${base.environment}
   AND EXISTS(SELECT 1 FROM deals d JOIN merchant_applications a ON a.id=c.application_id JOIN payarc_preparations p ON p.application_id=a.id
   WHERE d.id=c.deal_id AND d.processor_application_id=c.merchant_code AND d.archived_at IS NULL AND a.deal_id=d.id AND p.application_revision=a.updated_at::text)
   RETURNING merchant_code,signature_attempts,application_id,payload_fingerprint`),
    );
    return claimed;
  });
  if (!c) return { state: "not_claimed" };
  const { readPayarcPreparation } = await import("./payarc-preparation");
  const { fingerprint } = await import("./merchant-protected-data");
  let failureCode: string | null = null;
  try {
    const payload = await readPayarcPreparation(c.application_id);
    if (
      fingerprint("payarc-payload-v1:" + JSON.stringify(payload)) !==
      c.payload_fingerprint
    )
      failureCode = "SIGNATURE_PAYLOAD_CHANGED";
  } catch {
    failureCode = "SIGNATURE_PREPARATION_STALE";
  }
  const validation = failureCode
    ? { ok: false, retryable: false, httpStatus: undefined }
    : await validatePayarcSignature(c.merchant_code, base.baseUrl);
  if (validation.ok) {
    try {
      const current = await requireConfirmedActivationSnapshot(
        "payarc",
        "request_signature",
      );
      const currentBase = checkProcessorBaseUrl(
        "payarc",
        current.authorizedBaseUrl,
      );
      if (
        current.processorProgram !== "traditional" ||
        !currentBase.ok ||
        currentBase.baseUrl !== base.baseUrl
      )
        failureCode = "SIGNATURE_AUTHORITY_CHANGED";
    } catch {
      failureCode = "SIGNATURE_AUTHORITY_CHANGED";
    }
  }
  if (validation.ok && !failureCode) {
    // Validation is read-only but may take time. Recheck the actual application, review
    // and lease after it returns, before sending the provider email.
    const stillReviewed = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM deals WHERE id=${dealId} FOR UPDATE`);
      await tx.execute(
        sql`SELECT id FROM merchant_applications WHERE id=${c.application_id} FOR UPDATE`,
      );
      const [owned] = rows(
        await tx.execute(
          sql`SELECT deal_id FROM payarc_cases WHERE deal_id=${dealId} AND signature_lease=${token}::uuid AND signature_state='attempting' FOR UPDATE`,
        ),
      );
      if (!owned) return false;
      const verdict = await evaluateBoardingReadiness(
        dealId,
        { includeFieldCompleteness: false },
        tx,
      );
      if (!verdict.ready) return false;
      try {
        const payload = await readPayarcPreparation(c.application_id, tx);
        return (
          fingerprint("payarc-payload-v1:" + JSON.stringify(payload)) ===
          c.payload_fingerprint
        );
      } catch {
        return false;
      }
    });
    if (!stillReviewed) failureCode = "SIGNATURE_REVIEW_CHANGED";
  }
  const result =
    validation.ok && !failureCode
      ? await requestPayarcSignature(c.merchant_code, base.baseUrl)
      : {
          ...validation,
          ok: false,
          retryable: failureCode ? false : validation.retryable,
          ambiguous: false,
        };
  const state = result.ok
    ? "sent"
    : result.ambiguous
      ? "uncertain"
      : result.retryable && c.signature_attempts < 5
        ? "pending"
        : "failed";
  await db.execute(sql`UPDATE payarc_cases SET signature_state=${state},signature_sent_at=CASE WHEN ${result.ok} THEN now() ELSE signature_sent_at END,
 phase=CASE WHEN ${result.ok} THEN 'awaiting_signature' WHEN ${result.ambiguous} THEN 'reconciliation_required' ELSE phase END,
 last_error=${result.ok ? null : (failureCode ?? (result.ambiguous ? "SIGNATURE_OUTCOME_UNCERTAIN" : `${validation.ok ? "SIGNATURE" : "SIGNATURE_VALIDATION"}_HTTP_${result.httpStatus ?? "REFUSED"}`))},signature_lease=NULL,next_poll_at=now()+interval '5 minutes',updated_at=now()
 WHERE deal_id=${dealId} AND signature_lease=${token}::uuid AND signature_state='attempting'`);
  if (state === "uncertain" || state === "failed") {
    const { storage } = await import("../storage");
    const deal = await storage.getDeal(dealId);
    await storage.createAuthorityTask({
      dealId,
      contactId: deal?.contactId ?? undefined,
      assignedTo: deal?.owner ?? undefined,
      title:
        validation.ok && !failureCode
          ? "Review Payarc signature delivery"
          : "Correct Payarc signature validation",
      description:
        validation.ok && !failureCode
          ? "Reconcile the existing Payarc application delivery receipt before resending. Do not create another lead."
          : "Payarc signature validation did not pass. Review the existing application and correct it before requesting signature delivery. No signature request was sent by this attempt.",
      priority: "high",
      source: "payarc-lifecycle",
      automationKey: `payarc-signature:${dealId}:${failureCode ?? (validation.ok ? "delivery" : "validation")}`,
    });
  }
  return { state };
}
let busy = false;
export async function reconcilePayarcCases(
  refresh: (id: number) => Promise<{ outcome: string }>,
) {
  if (busy) return;
  busy = true;
  try {
    // A crash after send may have committed at Payarc. Preserve uncertainty indefinitely until reconciled.
    await db.execute(
      sql`UPDATE payarc_cases SET signature_state='uncertain',phase='reconciliation_required',last_error='SIGNATURE_DISPATCH_INTERRUPTED',signature_lease=NULL WHERE signature_state='attempting' AND signature_started_at<now()-interval '10 minutes'`,
    );
    if (process.env.PAYARC_SIGNATURE_ENABLED === "true") {
      try {
        await dispatchPayarcCorrections();
      } catch {
        /* denied update authority leaves commands pending */
      }
      const pending = rows(
        await db.execute(
          sql`SELECT deal_id FROM payarc_cases WHERE signature_state='pending' AND next_poll_at<=now() ORDER BY next_poll_at LIMIT 5`,
        ),
      );
      for (const c of pending)
        try {
          await dispatchPayarcSignature(c.deal_id);
        } catch {
          /* per-operation activation denial does not release a dispatch */
        }
    }
    if (process.env.PAYARC_STATUS_SYNC_ENABLED !== "true") return;
    for (let n = 0; n < 5; n++) {
      const token = randomUUID();
      const [c] = rows(
        await db.execute(sql`UPDATE payarc_cases SET poll_lease=${token}::uuid,poll_lease_expires_at=now()+interval '2 minutes',next_poll_at=now()+interval '5 minutes'
    WHERE deal_id=(SELECT deal_id FROM payarc_cases WHERE next_poll_at<=now() AND (poll_lease_expires_at IS NULL OR poll_lease_expires_at<now())
    AND phase NOT IN ('declined','closed') ORDER BY next_poll_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING deal_id`),
      );
      if (!c) break;
      try {
        const result = await refresh(c.deal_id);
        await db.execute(
          sql`UPDATE payarc_cases SET poll_lease=NULL,poll_lease_expires_at=NULL,last_error=${result.outcome === "success" ? null : "STATUS_REFRESH_NOT_APPLIED"},updated_at=now() WHERE deal_id=${c.deal_id} AND poll_lease=${token}::uuid`,
        );
      } catch {
        await db.execute(
          sql`UPDATE payarc_cases SET poll_lease=NULL,poll_lease_expires_at=NULL,last_error='STATUS_REFRESH_FAILED' WHERE deal_id=${c.deal_id} AND poll_lease=${token}::uuid`,
        );
      }
    }
  } finally {
    busy = false;
  }
}
let workerStarted = false;
export function startPayarcLifecycleWorker(
  refresh: (id: number) => Promise<{ outcome: string }>,
) {
  if (
    process.env.PAYARC_SIGNATURE_ENABLED !== "true" &&
    process.env.PAYARC_STATUS_SYNC_ENABLED !== "true"
  )
    return;
  if (workerStarted) return;
  workerStarted = true;
  const timer = setInterval(() => {
    void reconcilePayarcCases(refresh).catch(() =>
      console.error("[PayarcLifecycle] reconciliation failed"),
    );
  }, 60_000);
  timer.unref();
}

/** Explicit reviewed correction, never a bulk retry or a replacement lead. */
export async function queuePayarcCorrection(
  dealId: number,
  key: string,
  actor: string,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM deals WHERE id=${dealId} FOR UPDATE`);
    const [existing] = rows(
      await tx.execute(
        sql`SELECT deal_id,state FROM payarc_correction_commands WHERE id=${key}::uuid`,
      ),
    );
    if (existing) {
      if (existing.deal_id !== dealId)
        throw Error("PAYARC_COMMAND_IDENTITY_CONFLICT");
      return { state: existing.state, replayed: true };
    }
    const [c] = rows(
      await tx.execute(sql`SELECT c.phase,c.signature_state,p.application_revision FROM payarc_cases c JOIN merchant_applications a ON a.id=c.application_id JOIN payarc_preparations p ON p.application_id=a.id JOIN deals d ON d.id=c.deal_id
    WHERE c.deal_id=${dealId} AND a.deal_id=d.id AND d.archived_at IS NULL AND p.application_revision=a.updated_at::text FOR UPDATE OF c,a`),
    );
    if (
      !c ||
      ![
        "lead_created",
        "awaiting_signature",
        "documents_needed",
        "declined",
      ].includes(c.phase) ||
      c.signature_state === "attempting" ||
      c.signature_state === "uncertain"
    )
      throw Error("PAYARC_CORRECTION_NOT_ALLOWED");
    const verdict = await evaluateBoardingReadiness(
      dealId,
      { includeFieldCompleteness: false },
      tx,
    );
    if (!verdict.ready) throw Error("PAYARC_REVIEW_REQUIRED");
    await tx.execute(
      sql`INSERT INTO payarc_correction_commands(id,deal_id,application_revision,created_by) VALUES(${key}::uuid,${dealId},${c.application_revision},${actor})`,
    );
    return { state: "pending", replayed: false };
  });
}
export async function dispatchPayarcCorrections() {
  if (process.env.PAYARC_SIGNATURE_ENABLED !== "true") return;
  await db.execute(
    sql`UPDATE payarc_correction_commands SET state='uncertain',settled_at=now() WHERE state='attempting' AND started_at<now()-interval '10 minutes'`,
  );
  const snapshot = await requireConfirmedActivationSnapshot(
    "payarc",
    "update_merchant",
  );
  const base = checkProcessorBaseUrl("payarc", snapshot.authorizedBaseUrl);
  if (!base.ok || snapshot.processorProgram !== "traditional") return;
  const result = await db.transaction(async (tx) => {
    const [c] = rows(
      await tx.execute(
        sql`SELECT x.id,x.deal_id,x.application_revision,c.merchant_code,c.application_id,c.environment,c.owner_fingerprint FROM payarc_correction_commands x JOIN payarc_cases c ON c.deal_id=x.deal_id WHERE x.state='pending' AND c.environment=${base.environment} ORDER BY x.created_at FOR UPDATE OF x SKIP LOCKED LIMIT 1`,
      ),
    );
    if (!c) return null;
    await tx.execute(
      sql`SELECT id FROM deals WHERE id=${c.deal_id} FOR UPDATE`,
    );
    const [a] = rows(
      await tx.execute(
        sql`SELECT a.updated_at::text AS revision,p.payload_ciphertext FROM merchant_applications a JOIN payarc_preparations p ON p.application_id=a.id WHERE a.id=${c.application_id} AND a.deal_id=${c.deal_id} AND p.application_revision=a.updated_at::text FOR UPDATE OF a`,
      ),
    );
    const verdict = await evaluateBoardingReadiness(
      c.deal_id,
      { includeFieldCompleteness: false },
      tx,
    );
    if (!a || a.revision !== c.application_revision || !verdict.ready) {
      await tx.execute(
        sql`UPDATE payarc_correction_commands SET state='failed',settled_at=now() WHERE id=${c.id}::uuid`,
      );
      return null;
    }
    const { readPayarcPreparation } = await import("./payarc-preparation");
    const payload = await readPayarcPreparation(c.application_id, tx);
    await tx.execute(
      sql`UPDATE payarc_correction_commands SET state='attempting',started_at=now() WHERE id=${c.id}::uuid`,
    );
    return { ...c, payload };
  });
  if (!result) return;
  const { updatePayarcTraditionalLead } = await import(
    "./processors/payarc.adapter"
  );
  const payload = result.payload;
  const { fingerprint } = await import("./merchant-protected-data");
  if (
    fingerprint("payarc-owners-v1:" + JSON.stringify(payload.Owners)) !==
    result.owner_fingerprint
  ) {
    await db.execute(
      sql`UPDATE payarc_correction_commands SET state='failed',settled_at=now() WHERE id=${result.id}::uuid AND state='attempting'`,
    );
    await db.execute(
      sql`UPDATE payarc_cases SET last_error='PAYARC_OWNER_CORRECTION_CONTRACT_REQUIRED' WHERE deal_id=${result.deal_id}`,
    );
    return;
  }
  const sent = await updatePayarcTraditionalLead(
    result.merchant_code,
    payload,
    base.baseUrl,
  );
  await db.transaction(async (tx) => {
    const settled = rows(
      await tx.execute(
        sql`UPDATE payarc_correction_commands SET state=${sent.ok ? "updated" : sent.ambiguous ? "uncertain" : "failed"},settled_at=now() WHERE id=${result.id}::uuid AND state='attempting' RETURNING id`,
      ),
    );
    if (sent.ok && settled.length)
      await tx.execute(
        sql`UPDATE payarc_cases SET signature_state='pending',signature_attempts=0,payload_fingerprint=${fingerprint("payarc-payload-v1:" + JSON.stringify(payload))},phase='lead_created',next_poll_at=now(),last_error=NULL,updated_at=now() WHERE deal_id=${result.deal_id} AND merchant_code=${result.merchant_code}`,
      );
  });
}
