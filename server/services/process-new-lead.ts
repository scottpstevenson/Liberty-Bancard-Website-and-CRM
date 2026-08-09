/**
 * processNewLead — Guaranteed lead-pipeline orchestrator.
 *
 * Every intake source (public forms, CSV, manual CRM, GHL webhook, SDR) calls
 * processNewLead(contactId) after contact creation. This function runs the full
 * pipeline in strict order with explicit error handling and audit logging at
 * each step, so a failure in one stage never silently blocks downstream stages.
 *
 * Pipeline order:
 *   1. Lead scoring    — scoreContact() → leadScore + component scores
 *   2. Smart routing   — routeContact() → sequence enrollment
 *   3. Lifecycle       — advance to ENGAGED (idempotent if already past)
 *   4. NBA             — NBAService.computeNBA() → persisted recommendation
 *   5. Lead SLA timer  — write next_sla_due_at for high-score leads
 *
 * Tune via env vars:
 *   LEAD_SLA_SCORE_THRESHOLD  (default 40) — minimum leadScore for SLA tracking
 *   LEAD_SLA_MINUTES          (default 60) — minutes before escalation
 */

import { db } from "../db";
import { contacts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { scoreContact } from "./lead-scoring";
import { routeContact } from "./smart-router";
import { LifecycleService } from "./lifecycle-service";
import { NBAService } from "./nba-service";

// Configurable thresholds (tune without redeploy via env vars)
export const LEAD_SLA_SCORE_THRESHOLD = parseInt(
  process.env.LEAD_SLA_SCORE_THRESHOLD ?? "40",
  10,
);
export const LEAD_SLA_MINUTES = parseInt(
  process.env.LEAD_SLA_MINUTES ?? "60",
  10,
);

export interface ProcessNewLeadResult {
  contactId: number;
  score: number | null;
  lifecycleState: string | null;
  nbaActionType: string | null;
  nextSlaDueAt: Date | null;
  errors: string[];
  durationMs: number;
}

/**
 * Orchestrates the full lead pipeline for a newly created (or re-submitted)
 * contact. Safe to call multiple times — all stages are idempotent.
 *
 * Never throws: returns ProcessNewLeadResult with an errors[] array so callers
 * can fire-and-forget without swallowing pipeline failures.
 */
export async function processNewLead(
  contactId: number,
  opts: {
    source?: string;
    trigger?: string;
  } = {},
): Promise<ProcessNewLeadResult> {
  const t0 = Date.now();
  const source = opts.source ?? "intake";
  const trigger = opts.trigger ?? "process_new_lead";

  const result: ProcessNewLeadResult = {
    contactId,
    score: null,
    lifecycleState: null,
    nbaActionType: null,
    nextSlaDueAt: null,
    errors: [],
    durationMs: 0,
  };

  // ── Step 1: Lead scoring ──────────────────────────────────────────────────
  try {
    const breakdown = await scoreContact(contactId);
    result.score = breakdown?.total ?? null;
    await storage.createAuditLog({
      action: "lead_pipeline_scored",
      entityType: "contact",
      entityId: contactId,
      actorType: "system",
      details: { source, score: result.score },
    });
  } catch (err: any) {
    const msg = `score failed: ${err?.message}`;
    console.error(`[processNewLead] #${contactId} ${msg}`);
    result.errors.push(msg);
  }

  // ── Step 2: Smart routing (sequence enrollment) ───────────────────────────
  try {
    await routeContact(contactId);
    await storage.createAuditLog({
      action: "lead_pipeline_routed",
      entityType: "contact",
      entityId: contactId,
      actorType: "system",
      details: { source },
    });
  } catch (err: any) {
    const msg = `route failed: ${err?.message}`;
    console.error(`[processNewLead] #${contactId} ${msg}`);
    result.errors.push(msg);
  }

  // ── Step 3: Lifecycle advancement → ENGAGED ───────────────────────────────
  // Idempotent: LifecycleService.transition() is a no-op when already at or
  // past the target state. LifecycleTransitionError is expected for re-submits.
  try {
    result.lifecycleState = await LifecycleService.transition(contactId, "ENGAGED", {
      trigger,
      source,
      actorType: "system",
      reason: "New lead intake pipeline",
    });
  } catch (err: any) {
    // Backwards-transition errors are expected for re-submits — not a true failure.
    const isExpected =
      err?.constructor?.name === "LifecycleTransitionError" ||
      (err?.message ?? "").includes("Backwards transition");
    if (!isExpected) {
      const msg = `lifecycle failed: ${err?.message}`;
      console.error(`[processNewLead] #${contactId} ${msg}`);
      result.errors.push(msg);
    }
    // Read current state so result reflects reality
    try {
      result.lifecycleState = await LifecycleService.getCurrentState(contactId);
    } catch { /* ignore */ }
  }

  // ── Step 4: NBA computation ───────────────────────────────────────────────
  try {
    const nba = await NBAService.computeNBA(contactId);
    result.nbaActionType = nba.actionType;
    await storage.createAuditLog({
      action: "lead_pipeline_nba_computed",
      entityType: "contact",
      entityId: contactId,
      actorType: "system",
      details: { source, actionType: nba.actionType, urgency: nba.urgency },
    });
  } catch (err: any) {
    const msg = `NBA failed: ${err?.message}`;
    console.error(`[processNewLead] #${contactId} ${msg}`);
    result.errors.push(msg);
  }

  // ── Step 5: Lead SLA timer ────────────────────────────────────────────────
  // Only set for leads that clear the score threshold and don't already have
  // a timer set. Does not overwrite an existing (earlier) timer.
  const score = result.score ?? 0;
  if (score >= LEAD_SLA_SCORE_THRESHOLD) {
    try {
      const [existing] = await db
        .select({ nextSlaDueAt: contacts.nextSlaDueAt })
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1);

      if (!existing?.nextSlaDueAt) {
        const nextSlaDueAt = new Date(Date.now() + LEAD_SLA_MINUTES * 60 * 1000);
        await db
          .update(contacts)
          .set({ nextSlaDueAt })
          .where(eq(contacts.id, contactId));
        result.nextSlaDueAt = nextSlaDueAt;
        await storage.createAuditLog({
          action: "lead_sla_timer_set",
          entityType: "contact",
          entityId: contactId,
          actorType: "system",
          details: {
            source,
            score,
            nextSlaDueAt: nextSlaDueAt.toISOString(),
            slaMins: LEAD_SLA_MINUTES,
          },
        });
      } else {
        result.nextSlaDueAt = existing.nextSlaDueAt;
      }
    } catch (err: any) {
      const msg = `SLA timer failed: ${err?.message}`;
      console.error(`[processNewLead] #${contactId} ${msg}`);
      result.errors.push(msg);
    }
  }

  result.durationMs = Date.now() - t0;

  console.log(
    `[processNewLead] #${contactId} complete in ${result.durationMs}ms` +
    ` — score=${result.score ?? "n/a"}` +
    ` lifecycle=${result.lifecycleState ?? "n/a"}` +
    ` nba=${result.nbaActionType ?? "n/a"}` +
    ` slaDue=${result.nextSlaDueAt?.toISOString() ?? "none"}` +
    (result.errors.length ? ` ERRORS(${result.errors.length}): ${result.errors[0]}` : ""),
  );

  return result;
}
