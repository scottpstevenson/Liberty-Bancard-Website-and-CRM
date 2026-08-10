/**
 * NBAService — Next Best Action Engine.
 *
 * Computes a single structured recommendation per contact that answers:
 *   What should happen next, who should do it, through what channel, by when, and why?
 *
 * Architecture:
 * 1. Deterministic rules first (lifecycle state + scoring + compliance)
 * 2. Offer-router input (recommended_next_action from existing scoring)
 * 3. Collision check (active sequence, open SLA task, open NBA in flight)
 * 4. AI explanation (gpt-4o-mini) — falls back gracefully if unavailable
 * 5. UPSERT to contact_nba, move old → nba_recommendation_history
 */

import { db } from "../db";
import { contacts, contactNba, nbaRecommendationHistory, sequenceEnrollments, deals, followUpSequences } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { storage } from "../storage";
import type { LifecycleState } from "./lifecycle-service";
import { recordAiDecision } from "./ai-memory";

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export const NBA_ACTION_TYPES = [
  "CALL_PROSPECT",
  "SEND_EMAIL",
  "SEND_SMS",
  "REQUEST_STATEMENT",
  "REVIEW_STATEMENT",
  "PREPARE_PROPOSAL",
  "SEND_PROPOSAL",
  "FOLLOW_UP_PROPOSAL",
  "FOLLOW_UP_APPLICATION",
  "REVIEW_APPLICATION",
  "FOLLOW_UP_UNDERWRITING",
  "REVIEW_APPROVAL",
  "BOARD_MERCHANT",
  "CHECK_ACTIVATION",
  "CONTACT_AT_RISK_MERCHANT",
  "RETENTION_CALL",
  "WINBACK_OUTREACH",
  "MERCHANT_HEALTH_CHECK",
  "NO_ACTION",
] as const;

export type NbaActionType = typeof NBA_ACTION_TYPES[number];

export const NBA_URGENCY = ["low", "normal", "high", "critical"] as const;
export type NbaUrgency = typeof NBA_URGENCY[number];

export const NBA_STATUS = [
  "OPEN",
  "AUTO_EXECUTED",
  "HUMAN_EXECUTED",
  "DISMISSED",
  "SUPERSEDED",
  "EXPIRED",
  "BLOCKED",
] as const;
export type NbaStatus = typeof NBA_STATUS[number];

export const NBA_RULE_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface NbaRecommendation {
  contactId: number;
  actionType: NbaActionType;
  channel: string | null;
  ownerRole: "agent" | "manager" | "system" | null;
  dueAt: Date | null;
  urgency: NbaUrgency;
  expiresAt: Date | null;
  reasonCode: string;
  explanation: string | null;
  confidence: number | null;
  opportunityValueCents: number | null;
  automationEligible: boolean;
  humanRequired: boolean;
  ruleVersion: string;
  modelVersion: string | null;
  evidence: Record<string, unknown>;
  status: NbaStatus;
}

// ---------------------------------------------------------------------------
// Lifecycle → deterministic action mapping
// ---------------------------------------------------------------------------

function lifecycleToAction(
  state: LifecycleState,
  opts: {
    offerRouterAction?: string | null;
    hasDeal: boolean;
    daysSinceLastContact: number | null;
  },
): { actionType: NbaActionType; reasonCode: string; urgency: NbaUrgency; ownerRole: "agent" | "manager" | "system"; channel: string | null; humanRequired: boolean; automationEligible: boolean } {
  switch (state) {
    case "PROSPECT":
      return {
        actionType: "CALL_PROSPECT",
        reasonCode: "new_prospect_cold_outreach",
        urgency: "normal",
        ownerRole: "system",
        channel: "email",
        humanRequired: false,
        automationEligible: true,
      };

    case "ENGAGED":
      if (opts.daysSinceLastContact !== null && opts.daysSinceLastContact > 3) {
        return {
          actionType: "CALL_PROSPECT",
          reasonCode: "engaged_follow_up_stale",
          urgency: "high",
          ownerRole: "agent",
          channel: "manual_call",
          humanRequired: true,
          automationEligible: false,
        };
      }
      return {
        actionType: "SEND_EMAIL",
        reasonCode: "engaged_nurture",
        urgency: "normal",
        ownerRole: "system",
        channel: "email",
        humanRequired: false,
        automationEligible: true,
      };

    case "APPOINTMENT_SCHEDULED":
      return {
        actionType: "NO_ACTION",
        reasonCode: "appointment_pending",
        urgency: "low",
        ownerRole: "system",
        channel: null,
        humanRequired: false,
        automationEligible: false,
      };

    case "APPOINTMENT_COMPLETED":
      return {
        actionType: "REQUEST_STATEMENT",
        reasonCode: "post_appointment_statement_request",
        urgency: "high",
        ownerRole: "agent",
        channel: "email",
        humanRequired: false,
        automationEligible: true,
      };

    case "STATEMENT_REQUESTED":
      return {
        actionType: "REQUEST_STATEMENT",
        reasonCode: "statement_follow_up",
        urgency: "high",
        ownerRole: "system",
        channel: "email",
        humanRequired: false,
        automationEligible: true,
      };

    case "STATEMENT_RECEIVED":
      return {
        actionType: "REVIEW_STATEMENT",
        reasonCode: "statement_awaiting_analysis",
        urgency: "high",
        ownerRole: "manager",
        channel: null,
        humanRequired: true,
        automationEligible: false,
      };

    case "STATEMENT_ANALYZED":
      return {
        actionType: "PREPARE_PROPOSAL",
        reasonCode: "statement_analyzed_proposal_ready",
        urgency: "high",
        ownerRole: "agent",
        channel: null,
        humanRequired: true,
        automationEligible: false,
      };

    case "PROPOSAL_READY":
      return {
        actionType: "SEND_PROPOSAL",
        reasonCode: "proposal_ready_send_now",
        urgency: "critical",
        ownerRole: "agent",
        channel: "email",
        humanRequired: false,
        automationEligible: true,
      };

    case "PROPOSAL_SENT":
      return {
        actionType: "FOLLOW_UP_PROPOSAL",
        reasonCode: "proposal_follow_up_pending",
        urgency: "high",
        ownerRole: "system",
        channel: "email",
        humanRequired: false,
        automationEligible: true,
      };

    case "NEGOTIATION":
      return {
        actionType: "FOLLOW_UP_PROPOSAL",
        reasonCode: "negotiation_in_progress",
        urgency: "high",
        ownerRole: "agent",
        channel: "manual_call",
        humanRequired: true,
        automationEligible: false,
      };

    case "APPLICATION_STARTED":
      return {
        actionType: "FOLLOW_UP_APPLICATION",
        reasonCode: "application_incomplete",
        urgency: "high",
        ownerRole: "agent",
        channel: "email",
        humanRequired: false,
        automationEligible: true,
      };

    case "APPLICATION_COMPLETE":
      return {
        actionType: "REVIEW_APPLICATION",
        reasonCode: "application_submitted_review",
        urgency: "high",
        ownerRole: "manager",
        channel: null,
        humanRequired: true,
        automationEligible: false,
      };

    case "UNDERWRITING":
    case "UNDERWRITING_CONDITIONAL":
      return {
        actionType: "FOLLOW_UP_UNDERWRITING",
        reasonCode: "underwriting_in_progress",
        urgency: "normal",
        ownerRole: "manager",
        channel: null,
        humanRequired: true,
        automationEligible: false,
      };

    case "APPROVED":
      return {
        actionType: "REVIEW_APPROVAL",
        reasonCode: "merchant_approved_board",
        urgency: "critical",
        ownerRole: "manager",
        channel: null,
        humanRequired: true,
        automationEligible: false,
      };

    case "BOARDING":
    case "EQUIPMENT_DEPLOYMENT":
      return {
        actionType: "BOARD_MERCHANT",
        reasonCode: "boarding_in_progress",
        urgency: "normal",
        ownerRole: "manager",
        channel: null,
        humanRequired: true,
        automationEligible: false,
      };

    case "ACTIVATION_PENDING":
      return {
        actionType: "CHECK_ACTIVATION",
        reasonCode: "activation_pending",
        urgency: "high",
        ownerRole: "manager",
        channel: null,
        humanRequired: true,
        automationEligible: false,
      };

    case "FIRST_TRANSACTION":
    case "FIRST_FUNDING":
      return {
        actionType: "NO_ACTION",
        reasonCode: "early_processing_monitor",
        urgency: "low",
        ownerRole: "system",
        channel: null,
        humanRequired: false,
        automationEligible: false,
      };

    case "ACTIVE_PROCESSING":
    case "HEALTHY":
      return {
        actionType: "MERCHANT_HEALTH_CHECK",
        reasonCode: "routine_health_monitor",
        urgency: "low",
        ownerRole: "system",
        channel: null,
        humanRequired: false,
        automationEligible: false,
      };

    case "AT_RISK":
      return {
        actionType: "CONTACT_AT_RISK_MERCHANT",
        reasonCode: "merchant_at_risk_signal",
        urgency: "critical",
        ownerRole: "manager",
        channel: "manual_call",
        humanRequired: true,
        automationEligible: false,
      };

    case "RETENTION":
      return {
        actionType: "RETENTION_CALL",
        reasonCode: "retention_sequence",
        urgency: "high",
        ownerRole: "agent",
        channel: "manual_call",
        humanRequired: true,
        automationEligible: false,
      };

    case "CHURNED":
      return {
        actionType: "WINBACK_OUTREACH",
        reasonCode: "churned_winback_candidate",
        urgency: "low",
        ownerRole: "system",
        channel: "email",
        humanRequired: false,
        automationEligible: true,
      };

    case "WINBACK":
      return {
        actionType: "WINBACK_OUTREACH",
        reasonCode: "winback_in_progress",
        urgency: "normal",
        ownerRole: "agent",
        channel: "manual_call",
        humanRequired: true,
        automationEligible: false,
      };

    case "CLOSED_LOST":
      return {
        actionType: "NO_ACTION",
        reasonCode: "closed_lost_no_action",
        urgency: "low",
        ownerRole: "system",
        channel: null,
        humanRequired: false,
        automationEligible: false,
      };

    default:
      return {
        actionType: "NO_ACTION",
        reasonCode: "unknown_lifecycle_state",
        urgency: "low",
        ownerRole: "system",
        channel: null,
        humanRequired: false,
        automationEligible: false,
      };
  }
}

// ---------------------------------------------------------------------------
// Due date calculation
// ---------------------------------------------------------------------------

function computeDueAt(urgency: NbaUrgency): Date {
  const now = new Date();
  switch (urgency) {
    case "critical": return new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2h
    case "high":     return new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h
    case "normal":   return new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3d
    case "low":      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7d
  }
}

// ---------------------------------------------------------------------------
// AI explanation (optional, graceful fallback)
// ---------------------------------------------------------------------------

async function generateExplanation(
  actionType: NbaActionType,
  reasonCode: string,
  lifecycleState: string,
  contactName: string | null,
): Promise<{ explanation: string; modelVersion: string } | null> {
  try {
    const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    const openaiBase = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    if (!openaiKey) return null;

    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey: openaiKey, baseURL: openaiBase || undefined });

    const prompt = `You are a merchant services sales assistant. Write a concise (1-2 sentence) explanation for a sales rep of why the recommended next action is "${actionType}" for contact "${contactName ?? "this contact"}" who is currently in lifecycle stage "${lifecycleState}". Reason code: ${reasonCode}. Be direct and practical.`;

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 120,
      temperature: 0.3,
    });

    const text = resp.choices[0]?.message?.content?.trim();
    if (!text) return null;

    return { explanation: text, modelVersion: resp.model };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// NBA Service
// ---------------------------------------------------------------------------

export const NBAService = {

  /**
   * Compute and persist the Next Best Action for a contact.
   * UPSERT: moves the previous recommendation to history first.
   */
  async computeNBA(contactId: number): Promise<NbaRecommendation> {
    // ── 1. Load contact ──────────────────────────────────────────────────────
    const contact = await storage.getContact(contactId);
    if (!contact) {
      throw new Error(`[NBA] Contact #${contactId} not found`);
    }

    const lifecycleState = (contact.lifecycleState ?? "PROSPECT") as LifecycleState;

    // ── 2. Check global pause ────────────────────────────────────────────────
    const paused = await storage.getSystemSetting("outboundGlobalPaused");
    if (paused === "true" || paused === true) {
      return NBAService._persistNBA({
        contactId,
        actionType: "NO_ACTION",
        channel: null,
        ownerRole: "system",
        dueAt: null,
        urgency: "low",
        expiresAt: null,
        reasonCode: "global_pause_active",
        explanation: "Outbound communications are globally paused.",
        confidence: 100,
        opportunityValueCents: null,
        automationEligible: false,
        humanRequired: false,
        ruleVersion: NBA_RULE_VERSION,
        modelVersion: null,
        evidence: { lifecycleState, globalPaused: true },
        status: "BLOCKED",
      });
    }

    // ── 3. Check DNC ─────────────────────────────────────────────────────────
    if (contact.doNotContact) {
      return NBAService._persistNBA({
        contactId,
        actionType: "NO_ACTION",
        channel: null,
        ownerRole: "system",
        dueAt: null,
        urgency: "low",
        expiresAt: null,
        reasonCode: "do_not_contact",
        explanation: "Contact is on the do-not-contact list.",
        confidence: 100,
        opportunityValueCents: null,
        automationEligible: false,
        humanRequired: false,
        ruleVersion: NBA_RULE_VERSION,
        modelVersion: null,
        evidence: { lifecycleState, doNotContact: true },
        status: "BLOCKED",
      });
    }

    // ── 4. Check active sequence enrollment (collision guard) ────────────────
    let activeSequenceName: string | null = null;
    try {
      const [activeEnrollment] = await db
        .select({ id: sequenceEnrollments.id, sequenceId: sequenceEnrollments.sequenceId })
        .from(sequenceEnrollments)
        .where(
          and(
            eq(sequenceEnrollments.contactId, contactId),
            eq(sequenceEnrollments.status, "active"),
          )
        )
        .limit(1);

      if (activeEnrollment?.sequenceId) {
        const [seq] = await db
          .select({ name: followUpSequences.name })
          .from(followUpSequences)
          .where(eq(followUpSequences.id, activeEnrollment.sequenceId))
          .limit(1);
        activeSequenceName = seq?.name ?? `sequence #${activeEnrollment.sequenceId}`;
      }
    } catch { /* non-fatal */ }

    // ── 5. Compute days since last contact ───────────────────────────────────
    let daysSinceLastContact: number | null = null;
    try {
      const logs = await storage.getAuditLogs({
        entityType: "contact",
        entityId: contactId,
        limit: 10,
      });
      const lastOutbound = logs.find(l =>
        ["email_sent", "sms_sent", "sequence_step_executed"].includes((l as any).action ?? ""),
      );
      if (lastOutbound?.createdAt) {
        daysSinceLastContact = Math.floor(
          (Date.now() - new Date(lastOutbound.createdAt).getTime()) / (1000 * 60 * 60 * 24),
        );
      }
    } catch { /* non-fatal */ }

    // ── 6. Deterministic action from lifecycle ───────────────────────────────
    const deterministic = lifecycleToAction(lifecycleState, {
      offerRouterAction: contact.recommendedNextAction ?? null,
      hasDeal: false,
      daysSinceLastContact,
    });

    // ── 7. Adjust if active sequence covers this action ──────────────────────
    if (activeSequenceName && deterministic.automationEligible) {
      return NBAService._persistNBA({
        contactId,
        actionType: deterministic.actionType,
        channel: deterministic.channel,
        ownerRole: deterministic.ownerRole,
        dueAt: null,
        urgency: "low",
        expiresAt: null,
        reasonCode: "sequence_already_active",
        explanation: `Active sequence "${activeSequenceName}" is handling outreach.`,
        confidence: 90,
        opportunityValueCents: null,
        automationEligible: false,
        humanRequired: false,
        ruleVersion: NBA_RULE_VERSION,
        modelVersion: null,
        evidence: { lifecycleState, activeSequenceName },
        status: "BLOCKED",
      });
    }

    // ── 8. Opportunity value (from deal if present) ──────────────────────────
    let opportunityValueCents: number | null = null;
    try {
      const [deal] = await db
        .select({ estMonthly: deals.estimatedGrossProfitMonthly })
        .from(deals)
        .where(eq(deals.contactId, contactId))
        .limit(1);
      if (deal?.estMonthly) {
        // estimatedGrossProfitMonthly is a text field formatted as "$1,234" or "1234"
        const numericStr = String(deal.estMonthly).replace(/[^0-9.]/g, "");
        const parsed = parseFloat(numericStr);
        if (!isNaN(parsed)) {
          opportunityValueCents = Math.round(parsed * 100);
        }
      }
    } catch { /* non-fatal */ }

    // ── 9. AI explanation ────────────────────────────────────────────────────
    const contactName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null;
    const aiResult = await generateExplanation(
      deterministic.actionType,
      deterministic.reasonCode,
      lifecycleState,
      contactName,
    );

    // ── 10. Build and persist ────────────────────────────────────────────────
    const dueAt = computeDueAt(deterministic.urgency);
    const expiresAt = new Date(dueAt.getTime() + 7 * 24 * 60 * 60 * 1000); // expires 7d after due

    return NBAService._persistNBA({
      contactId,
      actionType: deterministic.actionType,
      channel: deterministic.channel,
      ownerRole: deterministic.ownerRole,
      dueAt,
      urgency: deterministic.urgency,
      expiresAt,
      reasonCode: deterministic.reasonCode,
      explanation: aiResult?.explanation ?? null,
      confidence: aiResult ? 80 : 65,
      opportunityValueCents,
      automationEligible: deterministic.automationEligible,
      humanRequired: deterministic.humanRequired,
      ruleVersion: NBA_RULE_VERSION,
      modelVersion: aiResult?.modelVersion ?? null,
      evidence: {
        lifecycleState,
        offerRouterAction: contact.recommendedNextAction ?? null,
        daysSinceLastContact,
        activeSequenceName,
      },
      status: "OPEN",
    });
  },

  /**
   * Invalidate (recompute) NBA for a contact. Safe to call fire-and-forget.
   */
  async invalidateNBA(contactId: number): Promise<void> {
    try {
      await NBAService.computeNBA(contactId);
    } catch (err: any) {
      console.warn(`[NBA] invalidateNBA #${contactId} failed:`, err?.message);
    }
  },

  /**
   * Mark a recommendation as executed (human or auto).
   */
  async executeNBA(
    contactId: number,
    outcome: "AUTO_EXECUTED" | "HUMAN_EXECUTED",
  ): Promise<void> {
    await db
      .update(contactNba)
      .set({ status: outcome, executedAt: new Date(), updatedAt: new Date() })
      .where(eq(contactNba.contactId, contactId));
  },

  /**
   * Dismiss the current NBA for a contact.
   */
  async dismissNBA(
    contactId: number,
    dismissedBy: string | number,
  ): Promise<void> {
    await db
      .update(contactNba)
      .set({ status: "DISMISSED", dismissedAt: new Date(), dismissedBy: String(dismissedBy), updatedAt: new Date() })
      .where(eq(contactNba.contactId, contactId));
  },

  /**
   * Get current NBA for a contact.
   */
  async getNBA(contactId: number) {
    const [row] = await db
      .select()
      .from(contactNba)
      .where(eq(contactNba.contactId, contactId))
      .limit(1);
    return row ?? null;
  },

  /**
   * Priority view: top open NBAs for managers.
   * Sorted by urgency (critical first) then due_at.
   */
  async getPriorityQueue(opts: {
    limit?: number;
    offset?: number;
    filter?: "highest_value" | "overdue" | "human_required" | "at_risk" | null;
  } = {}) {
    const { sql } = await import("drizzle-orm");
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;

    const urgencyOrder = sql`CASE urgency WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`;
    const now = new Date();

    let query = db
      .select({
        nba: contactNba,
        contactId: contacts.id,
        contactEmail: contacts.email,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
        lifecycleState: contacts.lifecycleState,
      })
      .from(contactNba)
      .innerJoin(contacts, eq(contactNba.contactId, contacts.id))
      .where(eq(contactNba.status, "OPEN"))
      .orderBy(urgencyOrder, contactNba.dueAt)
      .limit(limit)
      .offset(offset);

    // Can't add .where() dynamically with Drizzle's typed query builder —
    // use raw queries for filtered variants
    if (opts.filter === "overdue") {
      return db.execute(
        sql`SELECT n.*, c.email, c.first_name, c.last_name, c.lifecycle_state
            FROM contact_nba n
            JOIN contacts c ON c.id = n.contact_id
            WHERE n.status = 'OPEN'
              AND n.due_at < ${now}
            ORDER BY n.due_at ASC
            LIMIT ${limit} OFFSET ${offset}`,
      ).then(r => r.rows);
    }

    if (opts.filter === "human_required") {
      return db.execute(
        sql`SELECT n.*, c.email, c.first_name, c.last_name, c.lifecycle_state
            FROM contact_nba n
            JOIN contacts c ON c.id = n.contact_id
            WHERE n.status = 'OPEN' AND n.human_required = true
            ORDER BY ${urgencyOrder}, n.due_at ASC
            LIMIT ${limit} OFFSET ${offset}`,
      ).then(r => r.rows);
    }

    if (opts.filter === "highest_value") {
      return db.execute(
        sql`SELECT n.*, c.email, c.first_name, c.last_name, c.lifecycle_state
            FROM contact_nba n
            JOIN contacts c ON c.id = n.contact_id
            WHERE n.status = 'OPEN' AND n.opportunity_value_cents IS NOT NULL
            ORDER BY n.opportunity_value_cents DESC, ${urgencyOrder}
            LIMIT ${limit} OFFSET ${offset}`,
      ).then(r => r.rows);
    }

    if (opts.filter === "at_risk") {
      return db.execute(
        sql`SELECT n.*, c.email, c.first_name, c.last_name, c.lifecycle_state
            FROM contact_nba n
            JOIN contacts c ON c.id = n.contact_id
            WHERE n.status = 'OPEN'
              AND n.action_type IN ('CONTACT_AT_RISK_MERCHANT', 'RETENTION_CALL')
            ORDER BY ${urgencyOrder}, n.due_at ASC
            LIMIT ${limit} OFFSET ${offset}`,
      ).then(r => r.rows);
    }

    return query;
  },

  // ── Internal: upsert NBA, move old row to history ──────────────────────────
  async _persistNBA(rec: NbaRecommendation): Promise<NbaRecommendation> {
    // Move existing row to history
    const [existing] = await db
      .select()
      .from(contactNba)
      .where(eq(contactNba.contactId, rec.contactId))
      .limit(1);

    if (existing) {
      // Use raw SQL insert to safely handle nullable date columns without TS null complaints
      await db.execute(sql`
        INSERT INTO nba_recommendation_history
          (contact_id, action_type, channel, owner_role, due_at, urgency, expires_at,
           reason_code, explanation, confidence, rule_version, model_version, evidence,
           opportunity_value_cents, automation_eligible, human_required, status,
           generated_at, executed_at, dismissed_at, dismissed_by, superseded_reason)
        VALUES
          (${existing.contactId}, ${existing.actionType}, ${existing.channel}, ${existing.ownerRole},
           ${existing.dueAt}, ${existing.urgency}, ${existing.expiresAt},
           ${existing.reasonCode}, ${existing.explanation}, ${existing.confidence},
           ${existing.ruleVersion}, ${existing.modelVersion}, ${existing.evidence ?? null},
           ${existing.opportunityValueCents}, ${existing.automationEligible}, ${existing.humanRequired},
           ${existing.status}, ${existing.generatedAt}, ${existing.executedAt},
           ${existing.dismissedAt}, ${existing.dismissedBy}, ${'recomputed'})
      `);
    }

    // Upsert new recommendation
    await db
      .insert(contactNba)
      .values({
        contactId: rec.contactId,
        actionType: rec.actionType,
        channel: rec.channel,
        ownerRole: rec.ownerRole,
        dueAt: rec.dueAt,
        urgency: rec.urgency,
        expiresAt: rec.expiresAt,
        reasonCode: rec.reasonCode,
        explanation: rec.explanation,
        confidence: rec.confidence,
        opportunityValueCents: rec.opportunityValueCents,
        automationEligible: rec.automationEligible,
        humanRequired: rec.humanRequired,
        status: rec.status,
        ruleVersion: rec.ruleVersion,
        modelVersion: rec.modelVersion,
        evidence: rec.evidence,
        generatedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: contactNba.contactId,
        set: {
          actionType: rec.actionType,
          channel: rec.channel,
          ownerRole: rec.ownerRole,
          dueAt: rec.dueAt,
          urgency: rec.urgency,
          expiresAt: rec.expiresAt,
          reasonCode: rec.reasonCode,
          explanation: rec.explanation,
          confidence: rec.confidence,
          opportunityValueCents: rec.opportunityValueCents,
          automationEligible: rec.automationEligible,
          humanRequired: rec.humanRequired,
          status: rec.status,
          ruleVersion: rec.ruleVersion,
          modelVersion: rec.modelVersion,
          evidence: rec.evidence,
          generatedAt: new Date(),
          updatedAt: new Date(),
        },
      });

    // Fire-and-forget: record NBA decision for AI Learning Center
    recordAiDecision({
      contactId: rec.contactId,
      decisionType: "nba",
      inputSummary: { reasonCode: rec.reasonCode, urgency: rec.urgency, ruleVersion: rec.ruleVersion },
      decisionOutput: { actionType: rec.actionType, channel: rec.channel, ownerRole: rec.ownerRole, automationEligible: rec.automationEligible, humanRequired: rec.humanRequired },
      confidence: rec.confidence ?? null,
      model: rec.modelVersion ?? null,
      outcome: "pending",
    }).catch(() => {});

    return rec;
  },
};
