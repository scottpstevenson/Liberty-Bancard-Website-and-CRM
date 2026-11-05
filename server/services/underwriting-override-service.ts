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
import { dealExclusionReason } from "./deal-production-scope";
import { decisionRevisionSql } from "./underwriting-read-model";

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
  /** True when this exact command id had already committed; nothing was changed by this call. */
  replayed: boolean;
  followOns: string[];
}

/** Follow-ons are recorded as durable effect intents in the override transaction and executed by the effect worker. */
export const OVERRIDE_FOLLOW_ON_EFFECTS = { ghlTask: "underwriting_override_ghl_task", rejectNotification: "underwriting_reject_notification" } as const;
export const overrideTransitionKey = (decisionId: number, action: string) => `underwriting_override:${decisionId}:${action}`;

const camel = (row: Record<string, any>) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]));

export async function applyUnderwritingOverride(params: {
  dealId: number;
  action: "approve" | "reject";
  /** Required, 3–2000 chars: why the reviewer is overriding. */
  reason: string;
  userId: string;
  /** The decision, and the revision of its inputs/rules, that the reviewer actually looked at. */
  expectedDecisionId: number;
  expectedRevision: string;
  /** Client-generated command identity (UUID); the same id replays instead of acting twice. */
  commandId: string;
}): Promise<OverrideResult> {
  const { dealId, action, userId, expectedDecisionId, expectedRevision, commandId } = params;
  const note = typeof params.reason === "string" ? params.reason.trim().slice(0, 2000) : "";
  if (note.length < 3) throw new OverrideError(400, "reason_required", "A reason is required for a manual override");
  const t = TARGET[action];

  let outcome: { decision: any; previous: any; stage: Awaited<ReturnType<typeof advanceDealStageInTx>>; replayed?: boolean; followOns: string[] };
  try {
    outcome = await db.transaction(async (tx) => {
      // Lock order: deal row, then decision row (the same order advanceDealStageInTx uses for the deal).
      const dealRows: any = await tx.execute(sql`SELECT id, stage, archived_at, record_class FROM deals WHERE id = ${dealId} FOR UPDATE`);
      const dealRow = (dealRows.rows ?? dealRows)[0];
      if (!dealRow) throw new OverrideError(404, "deal_not_found", "Deal not found");

      // Command identity: the same command id replays its saved outcome (the deal row lock serializes callers).
      const prior: any = await tx.execute(sql`
        SELECT details FROM audit_logs WHERE entity_type = 'deal' AND entity_id = ${dealId}
          AND action IN ('underwriting_manual_approve','underwriting_manual_reject') AND details->>'commandId' = ${commandId}
        ORDER BY id DESC LIMIT 1`);
      const priorRow = (prior.rows ?? prior)[0];
      if (priorRow) {
        const savedAction = priorRow.details?.action;
        if (savedAction !== action || Number(priorRow.details?.decisionId) !== expectedDecisionId) {
          throw new OverrideError(409, "command_id_reused", "This command id was already used for a different override");
        }
        const savedDecision: any = await tx.execute(sql`SELECT * FROM underwriting_decisions WHERE id = ${expectedDecisionId}`);
        const stageNow: any = await tx.execute(sql`SELECT * FROM deals WHERE id = ${dealId}`);
        return {
          decision: (savedDecision.rows ?? savedDecision)[0], previous: { decision: priorRow.details?.previousDecision },
          stage: { stagedDeal: (stageNow.rows ?? stageNow)[0], applied: false, gateBlocked: false, blockedMissing: [] } as any,
          replayed: true, followOns: [],
        };
      }
      const excluded = dealExclusionReason(dealRow);
      if (excluded) throw new OverrideError(409, "deal_out_of_scope", `This deal is ${excluded.replace("_", " ")} and is not underwriting work; nothing was changed`);

      const latestRows: any = await tx.execute(sql.raw(`
        SELECT latest.*, ${decisionRevisionSql("latest")} AS revision FROM underwriting_decisions latest WHERE latest.deal_id = ${Number(dealId)}
        ORDER BY latest.created_at DESC NULLS LAST, latest.id DESC LIMIT 1 FOR UPDATE`));
      const latest = (latestRows.rows ?? latestRows)[0];
      if (!latest) throw new OverrideError(404, "no_decision", "No underwriting decision found for this deal");
      // The reviewer must be acting on the decision, inputs and rules they saw. Checked before any local change.
      if (Number(latest.id) !== expectedDecisionId || latest.revision !== expectedRevision) {
        throw new OverrideError(409, "stale_review", "The underwriting decision changed after you opened it; reload and review it again. Nothing was changed");
      }
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
          commandId, action, decisionId: latest.id, decisionRevision: latest.revision, previousDecision: latest.decision, overrideNote: note,
          rulesSnapshot: latest.rules_snapshot, stageMoved: stage.applied, toStage: t.stage,
          timestamp: new Date().toISOString(),
        },
      }, tx);

      // Durable follow-ons commit with the override; the effect worker executes them (and defers under a pause).
      const followOns: string[] = [];
      const effects = action === "reject"
        ? [OVERRIDE_FOLLOW_ON_EFFECTS.rejectNotification, OVERRIDE_FOLLOW_ON_EFFECTS.ghlTask]
        : [OVERRIDE_FOLLOW_ON_EFFECTS.ghlTask];
      const transitionKey = overrideTransitionKey(Number(latest.id), action);
      for (const effectType of effects) {
        await tx.execute(sql`
          INSERT INTO deal_stage_effect_intents (deal_id, transition_key, effect_type, idempotency_key)
          VALUES (${dealId}, ${transitionKey}, ${effectType}, ${`${transitionKey}:${effectType}`})
          ON CONFLICT DO NOTHING`);
        followOns.push(effectType);
      }
      return { decision, previous: latest, stage, followOns };
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

  if (outcome.replayed) {
    return { decision: camel(outcome.decision), previousDecision: outcome.previous.decision, stageMoved: false, deal: outcome.stage.stagedDeal, replayed: true, followOns: [] };
  }
  if (outcome.stage.applied && outcome.stage.stagedDeal) {
    await advanceDealStageAfterCommit(outcome.stage.stagedDeal, dealId, t.stage, t.trigger).catch((e: Error) =>
      console.warn("[Underwriting] post-commit stage telemetry (non-critical):", e.message));
  }
  return { decision: camel(outcome.decision), previousDecision: outcome.previous.decision, stageMoved: outcome.stage.applied, deal: outcome.stage.stagedDeal, replayed: false, followOns: outcome.followOns };
}
