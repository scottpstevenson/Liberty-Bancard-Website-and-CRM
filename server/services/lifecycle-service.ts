/**
 * LifecycleService — Canonical merchant lifecycle state machine.
 *
 * lifecycle_state is an OBSERVER/DERIVED field on contacts.
 * It is NEVER the source of truth for any domain operation —
 * deal stages, SDR stages, etc. are unchanged.
 *
 * All side-effect wiring must use fire-and-forget with catch.
 */

import { db } from "../db";
import { contacts, contactLifecycleHistory } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import type { ContactLifecycleHistoryRow } from "@shared/schema";

// ---------------------------------------------------------------------------
// State definitions
// ---------------------------------------------------------------------------

export const LIFECYCLE_STATES = [
  "PROSPECT",
  "ENGAGED",
  "APPOINTMENT_SCHEDULED",
  "APPOINTMENT_COMPLETED",
  "STATEMENT_REQUESTED",
  "STATEMENT_RECEIVED",
  "STATEMENT_ANALYZED",
  "PROPOSAL_READY",
  "PROPOSAL_SENT",
  "NEGOTIATION",
  "APPLICATION_STARTED",
  "APPLICATION_COMPLETE",
  "UNDERWRITING",
  "UNDERWRITING_CONDITIONAL",
  "APPROVED",
  "BOARDING",
  "EQUIPMENT_DEPLOYMENT",
  "ACTIVATION_PENDING",
  "FIRST_TRANSACTION",
  "FIRST_FUNDING",
  "ACTIVE_PROCESSING",
  "HEALTHY",
  "AT_RISK",
  "RETENTION",
  "CHURNED",
  "WINBACK",
  "CLOSED_LOST",
] as const;

export type LifecycleState = typeof LIFECYCLE_STATES[number];

const STATE_ORDER: Record<LifecycleState, number> = Object.fromEntries(
  LIFECYCLE_STATES.map((s, i) => [s, i]),
) as Record<LifecycleState, number>;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class LifecycleTransitionError extends Error {
  constructor(
    public readonly contactId: number,
    public readonly fromState: LifecycleState,
    public readonly toState: LifecycleState,
    public readonly reason: string,
  ) {
    super(
      `[Lifecycle] Prohibited transition contact #${contactId}: ${fromState} → ${toState}. ${reason}`,
    );
    this.name = "LifecycleTransitionError";
  }
}

// ---------------------------------------------------------------------------
// Transition guard
// ---------------------------------------------------------------------------

/**
 * Returns true if the transition from → to is permitted.
 *
 * Rules:
 *   - Any state → CLOSED_LOST is always allowed.
 *   - CHURNED → WINBACK is allowed (recovery path).
 *   - AT_RISK → RETENTION is allowed (recovery path).
 *   - Forward movement (to has higher index than from) is always allowed.
 *   - Backward movement is prohibited.
 *   - Same state → same state is an idempotent no-op (handled upstream).
 */
function isTransitionAllowed(from: LifecycleState, to: LifecycleState): boolean {
  if (to === "CLOSED_LOST") return true;
  if (from === "CHURNED" && to === "WINBACK") return true;
  if (from === "AT_RISK" && to === "RETENTION") return true;
  // Forward movement
  return STATE_ORDER[to] > STATE_ORDER[from];
}

// ---------------------------------------------------------------------------
// Transition meta
// ---------------------------------------------------------------------------

export interface TransitionMeta {
  trigger: string;
  actorType?: string;
  actorId?: string;
  source?: string;
  reason?: string;
  automationKey?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const LifecycleService = {
  /**
   * Transition a contact to a new lifecycle state.
   *
   * - Idempotent: if current === toState, returns current state without writing.
   * - Throws LifecycleTransitionError if the transition is prohibited.
   * - Atomically updates contacts.lifecycle_state and inserts a history row.
   *
   * @returns The new (or unchanged) lifecycle state.
   */
  async transition(
    contactId: number,
    toState: LifecycleState,
    meta: TransitionMeta,
  ): Promise<LifecycleState> {
    // Fetch current state
    const [row] = await db
      .select({ lifecycleState: contacts.lifecycleState })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    if (!row) {
      throw new Error(`[Lifecycle] Contact #${contactId} not found`);
    }

    const fromState = (row.lifecycleState ?? "PROSPECT") as LifecycleState;

    // Idempotent no-op
    if (fromState === toState) {
      return fromState;
    }

    // Guard
    if (!isTransitionAllowed(fromState, toState)) {
      throw new LifecycleTransitionError(contactId, fromState, toState, "Backwards transition prohibited");
    }

    // Atomic update + history insert in a transaction
    await db.transaction(async (tx) => {
      await tx
        .update(contacts)
        .set({
          lifecycleState: toState,
          lifecycleStateUpdatedAt: new Date(),
        })
        .where(eq(contacts.id, contactId));

      await tx.insert(contactLifecycleHistory).values({
        contactId,
        fromState,
        toState,
        transitionedAt: new Date(),
        trigger: meta.trigger,
        actorType: meta.actorType ?? "system",
        actorId: meta.actorId ?? null,
        source: meta.source ?? null,
        reason: meta.reason ?? null,
        automationKey: meta.automationKey ?? null,
        metadata: meta.metadata ?? null,
      });
    });

    console.log(
      `[Lifecycle] Contact #${contactId}: ${fromState} → ${toState} (trigger: ${meta.trigger})`,
    );

    // Fire-and-forget NBA invalidation so new lifecycle state drives a fresh recommendation.
    import("./nba-service")
      .then(({ NBAService }) => NBAService.invalidateNBA(contactId))
      .catch(err => console.warn(`[Lifecycle] NBA invalidation failed for #${contactId}:`, err?.message));

    return toState;
  },

  /**
   * Returns the current lifecycle state for a contact.
   */
  async getCurrentState(contactId: number): Promise<LifecycleState> {
    const [row] = await db
      .select({ lifecycleState: contacts.lifecycleState })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    if (!row) {
      throw new Error(`[Lifecycle] Contact #${contactId} not found`);
    }

    return (row.lifecycleState ?? "PROSPECT") as LifecycleState;
  },

  /**
   * Returns lifecycle transition history for a contact, newest first.
   */
  async getHistory(
    contactId: number,
    limit = 50,
  ): Promise<ContactLifecycleHistoryRow[]> {
    return db
      .select()
      .from(contactLifecycleHistory)
      .where(eq(contactLifecycleHistory.contactId, contactId))
      .orderBy(desc(contactLifecycleHistory.transitionedAt))
      .limit(limit);
  },
};

// ---------------------------------------------------------------------------
// Stage → LifecycleState mapping helpers
// ---------------------------------------------------------------------------

/**
 * Maps a sales/onboarding deal stage to the corresponding lifecycle state.
 * Returns null if no mapping is known for the given stage.
 */
export function dealStageToLifecycleState(
  stage: string,
  pipeline: string,
): LifecycleState | null {
  // ── Sales pipeline ────────────────────────────────────────────────────────
  const salesMap: Record<string, LifecycleState> = {
    "New Lead": "ENGAGED",
    "Contacted": "ENGAGED",
    "Call Booked": "APPOINTMENT_SCHEDULED",
    "Appointment Set": "APPOINTMENT_SCHEDULED",
    "Meeting Scheduled": "APPOINTMENT_SCHEDULED",
    "Meeting Completed": "APPOINTMENT_COMPLETED",
    "Appointment Completed": "APPOINTMENT_COMPLETED",
    "Review In Progress": "STATEMENT_REQUESTED",
    "Statement Requested": "STATEMENT_REQUESTED",
    "Statement Received": "STATEMENT_RECEIVED",
    "Statement Analysis": "STATEMENT_ANALYZED",
    "Proposal Ready": "PROPOSAL_READY",
    "Proposal Sent": "PROPOSAL_SENT",
    "Proposal Viewed": "PROPOSAL_SENT",
    "Negotiation / Follow-Up": "NEGOTIATION",
    "Verbal Commit": "NEGOTIATION",
    "Application Started": "APPLICATION_STARTED",
    "Application Submitted": "APPLICATION_COMPLETE",
    "Closed Won": "APPLICATION_COMPLETE",
    "Closed Lost": "CLOSED_LOST",
    "Nurture / Not Now": "ENGAGED",
  };

  // ── Onboarding pipeline ───────────────────────────────────────────────────
  const onboardingMap: Record<string, LifecycleState> = {
    "Application Submitted": "APPLICATION_COMPLETE",
    "Underwriting": "UNDERWRITING",
    "Underwriting Submitted": "UNDERWRITING",
    "Conditional Approval": "UNDERWRITING_CONDITIONAL",
    "Approved": "APPROVED",
    "Boarding": "BOARDING",
    "Equipment Ordered": "EQUIPMENT_DEPLOYMENT",
    "Equipment Deployed": "EQUIPMENT_DEPLOYMENT",
    "Go-Live Scheduled": "ACTIVATION_PENDING",
    "Activation Pending": "ACTIVATION_PENDING",
    "Active": "ACTIVE_PROCESSING",
    "First Transaction": "FIRST_TRANSACTION",
    "First Funding": "FIRST_FUNDING",
    "Closed Lost": "CLOSED_LOST",
  };

  const map = pipeline === "onboarding" ? onboardingMap : salesMap;
  return map[stage] ?? null;
}

/**
 * Maps a merchant_applications.status to a lifecycle state.
 */
export function applicationStatusToLifecycleState(
  status: string,
): LifecycleState | null {
  const map: Record<string, LifecycleState> = {
    draft: "APPLICATION_STARTED",
    in_progress: "APPLICATION_STARTED",
    submitted: "APPLICATION_COMPLETE",
    approved: "APPROVED",
    declined: "CLOSED_LOST",
    withdrawn: "CLOSED_LOST",
  };
  return map[status] ?? null;
}

/**
 * Maps merchant_profiles.accountStatus to a lifecycle state.
 */
export function accountStatusToLifecycleState(
  accountStatus: string,
): LifecycleState | null {
  const map: Record<string, LifecycleState> = {
    pending: "BOARDING",
    active: "ACTIVE_PROCESSING",
    suspended: "AT_RISK",
    terminated: "CHURNED",
    closed: "CHURNED",
  };
  return map[accountStatus] ?? null;
}
