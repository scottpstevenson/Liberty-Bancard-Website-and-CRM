/**
 * S5-08 — Atomic manual underwriting override.
 *
 * The decision override, the deal-stage move, its effect intents and the audit row commit in ONE transaction
 * (deal row locked first, then the latest decision row). A stage move that is illegal for the deal's current
 * stage/pipeline, a go-live gate refusal, or a concurrent override rolls everything back — the decision is never
 * left "overridden" while the deal did not move. Optional follow-ons (internal notification, GHL task) run after
 * commit and are best-effort; they never decide the outcome.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { auditChange } from "./audit-change";
import {
  advanceDealStageInTx, advanceDealStageAfterCommit,
  DealStageConflictError, DealStageIllegalTransitionError,
} from "./deal-stage-service";
import { GoLiveGateError } from "./go-live-gate";

export class OverrideError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "OverrideError";
  }
}

const TARGET: Record<"approve" | "reject", { stage: string; trigger: string; reason: string; audit: string }> = {
  approve: { stage: "Proposal Sent", trigger: "underwriting_manual_approve", reason: "Manual underwriting approval", audit: "underwriting_manual_approve" },
  reject: { stage: "Review In Progress", trigger: "underwriting_manual_reject", reason: "Manual underwriting rejection", audit: "underwriting_manual_reject" },
};

export interface OverrideResult {
  decision: any;
  previousDecision: string;
  stageMoved: boolean;
  deal: any;
}

const camel = (row: Record<string, any>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));

export async function applyUnderwritingOverride(params: {
  dealId: number;
  action: "approve" | "reject";
  note?: string | null;
  userId: string;
}): Promise<OverrideResult> {
  const { dealId, action, userId } = params;
  const note = typeof params.note === "string" ? params.note.slice(0, 2000) : null;
  const t = TARGET[action];

  let outcome: { decision: any; previous: any; stage: Awaited<ReturnType<typeof advanceDealStageInTx>> };
  try {
    outcome = await db.transaction(async (tx) => {
      // Lock order: deal row, then decision row (the same order advanceDealStageInTx uses for the deal).
      const dealRows: any = await tx.execute(sql`SELECT id FROM deals WHERE id = ${dealId} FOR UPDATE`);
      if (!((dealRows.rows ?? dealRows)[0])) throw new OverrideError(404, "deal_not_found", "Deal not found");

      const latestRows: any = await tx.execute(sql`
        SELECT * FROM underwriting_decisions WHERE deal_id = ${dealId}
        ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1 FOR UPDATE`);
      const latest = (latestRows.rows ?? latestRows)[0];
      if (!latest) throw new OverrideError(404, "no_decision", "No underwriting decision found for this deal");
      if (latest.override_action) {
        throw new OverrideError(409, "already_overridden", "The latest underwriting decision has already been overridden");
      }

      const upd: any = await tx.execute(sql`
        UPDATE underwriting_decisions
        SET override_action = ${action}, overridden_by = ${userId}, overridden_at = now(), override_note = ${note}
        WHERE id = ${latest.id} AND override_action IS NULL
        RETURNING *`);
      const decision = (upd.rows ?? upd)[0];
      if (!decision) throw new OverrideError(409, "already_overridden", "The decision was overridden concurrently");

      const stage = await advanceDealStageInTx(tx, dealId, t.stage, t.trigger, { reason: t.reason, actor: userId });
      if (stage.gateBlocked) throw new GoLiveGateError(dealId, t.stage, stage.blockedMissing, t.trigger);
      if (!stage.stagedDeal) throw new OverrideError(404, "deal_not_found", "Deal not found");

      await auditChange({
        userId, actorType: "user", actorId: userId, action: t.audit, entityType: "deal", entityId: dealId,
        details: {
          decisionId: latest.id, previousDecision: latest.decision, overrideNote: note,
          rulesSnapshot: latest.rules_snapshot, stageMoved: stage.applied, toStage: t.stage,
          timestamp: new Date().toISOString(),
        },
      }, tx);
      return { decision, previous: latest, stage };
    });
  } catch (err) {
    if (err instanceof OverrideError) throw err;
    if (err instanceof DealStageIllegalTransitionError) {
      throw new OverrideError(409, "illegal_stage_transition", `The deal cannot move from "${err.from}" to "${err.to}"; nothing was changed`);
    }
    if (err instanceof DealStageConflictError) {
      throw new OverrideError(409, "stage_conflict", "The deal's stage changed concurrently; nothing was changed");
    }
    if (err instanceof GoLiveGateError) {
      throw new OverrideError(409, "go_live_gate", "The deal is blocked by the go-live gate; nothing was changed");
    }
    throw err;
  }

  if (outcome.stage.applied && outcome.stage.stagedDeal) {
    await advanceDealStageAfterCommit(outcome.stage.stagedDeal, dealId, t.stage, t.trigger).catch((e: Error) =>
      console.warn("[Underwriting] post-commit stage telemetry (non-critical):", e.message));
  }
  return { decision: camel(outcome.decision), previousDecision: outcome.previous.decision, stageMoved: outcome.stage.applied, deal: outcome.stage.stagedDeal };
}
