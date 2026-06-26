import { storage } from "../storage";
import { advanceDealStage } from "./deal-stage-service";
import { db } from "../db";
import { calendarEvents } from "@shared/schema";
import { gte, isNotNull } from "drizzle-orm";

const SALES_STAGE_ORDER = [
  "New Lead",
  "Statement Received",
  "Review In Progress",
  "Call Booked",
  "Proposal Sent",
  "Negotiation / Follow-Up",
  "Verbal Commit",
  "Closed Won",
];

export interface StageProgressionResult {
  evaluated: number;
  progressed: number;
  details: Array<{ dealId: number; from: string; to: string; reason: string }>;
}

/**
 * Inspect a deal's existing signals and return the next sales stage it should
 * be advanced to (if any). Pure function — no I/O.
 */
export interface DealSignals {
  hasUpcomingCalendarEvent?: boolean;
}

export function decideNextStage(deal: any, signals: DealSignals = {}): { nextStage: string | null; reason: string } {
  const idx = SALES_STAGE_ORDER.indexOf(deal.stage);
  if (idx < 0 || deal.stage === "Closed Won" || deal.stage === "Closed Lost") {
    return { nextStage: null, reason: "" };
  }

  // Closed Won terminal signals win over everything: boarding approval,
  // go-live date set, or closedAt timestamp.
  if (deal.boardingApprovedAt || deal.goLiveDate || deal.closedAt) {
    const reason = deal.boardingApprovedAt
      ? "Boarding approved (e-sign + underwriting cleared)"
      : deal.goLiveDate
        ? "Go-live date set"
        : "closedAt timestamp present";
    return { nextStage: "Closed Won", reason };
  }

  if (deal.stage === "New Lead") {
    if (signals.hasUpcomingCalendarEvent) {
      return { nextStage: "Call Booked", reason: "Calendar event scheduled" };
    }
    if (deal.statementReceived || deal.lastStatementReviewDate) {
      return { nextStage: "Statement Received", reason: "Statement received" };
    }
  }
  if (deal.stage === "Statement Received") {
    if (signals.hasUpcomingCalendarEvent) {
      return { nextStage: "Call Booked", reason: "Calendar event scheduled" };
    }
    if (deal.recommendedPath || deal.effectiveRate || deal.lastStatementReviewDate) {
      return { nextStage: "Review In Progress", reason: "Statement reviewed" };
    }
  }
  if (deal.stage === "Review In Progress") {
    if (signals.hasUpcomingCalendarEvent) {
      return { nextStage: "Call Booked", reason: "Calendar event scheduled" };
    }
    if (deal.proposalGeneratedAt || deal.proposalEmailSentAt) {
      return { nextStage: "Proposal Sent", reason: "Proposal generated/emailed" };
    }
  }
  if (deal.stage === "Call Booked") {
    if (deal.proposalGeneratedAt || deal.proposalEmailSentAt) {
      return { nextStage: "Proposal Sent", reason: "Proposal sent after call" };
    }
  }
  if (deal.stage === "Proposal Sent") {
    if (deal.appCompleted || deal.boardingSubmittedAt) {
      return { nextStage: "Negotiation / Follow-Up", reason: "Application started/completed" };
    }
  }
  if (deal.stage === "Negotiation / Follow-Up") {
    if (deal.boardingSubmittedAt) {
      return { nextStage: "Verbal Commit", reason: "Boarding submitted" };
    }
  }
  return { nextStage: null, reason: "" };
}

/**
 * Walk every active sales deal and advance stages where signals justify it.
 * Used by both the periodic worker and the one-shot backfill route.
 */
export async function runStageProgressionSweep(opts?: { limit?: number }): Promise<StageProgressionResult> {
  const limit = opts?.limit ?? 1000;
  const dealsResp: any = await storage.getDeals({ limit });
  const allDeals = Array.isArray(dealsResp) ? dealsResp : dealsResp.data;
  const activeSales = allDeals.filter(
    (d: any) => d.pipeline === "sales" && d.stage !== "Closed Won" && d.stage !== "Closed Lost",
  );

  // Pre-index upcoming calendar events by dealId so we can detect "Call Booked"
  // without N+1 queries.
  const upcoming = await db.select()
    .from(calendarEvents)
    .where(gte(calendarEvents.startTime, new Date()));
  const dealsWithUpcomingCall = new Set<number>();
  for (const ev of upcoming) {
    if (ev.dealId && ev.status !== "cancelled") dealsWithUpcomingCall.add(ev.dealId);
  }

  const details: StageProgressionResult["details"] = [];
  let progressed = 0;

  for (const deal of activeSales) {
    const signals: DealSignals = {
      hasUpcomingCalendarEvent: dealsWithUpcomingCall.has(deal.id),
    };
    const { nextStage, reason } = decideNextStage(deal, signals);
    if (!nextStage) continue;
    try {
      await advanceDealStage(deal.id, nextStage, "stage_progression_backfill");
      await storage.createAuditLog({
        action: "deal_auto_progressed",
        entityType: "deal",
        entityId: deal.id,
        details: { from: deal.stage, to: nextStage, reason, source: "stage_progression" },
      });
      details.push({ dealId: deal.id, from: deal.stage, to: nextStage, reason });

      const eventName = nextStage === "Closed Won" ? "closed_won" : "deal_stage_changed";
      import("./analytics-events").then(({ recordAnalyticsEvent }) => {
        recordAnalyticsEvent({
          eventName,
          dealId: deal.id,
          dealStage: nextStage,
          metadata: { from: deal.stage, to: nextStage, reason, source: "stage_progression" },
        });
      }).catch(() => {});
      progressed++;
    } catch (err) {
      console.error(`[StageProgression] Failed to advance deal ${deal.id}:`, err);
    }
  }

  await storage.setSystemSetting("stage_progression_last_run", {
    at: new Date().toISOString(),
    evaluated: activeSales.length,
    progressed,
  });

  return { evaluated: activeSales.length, progressed, details };
}
