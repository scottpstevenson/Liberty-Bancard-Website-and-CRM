/**
 * shared/confirmation-status-types.ts
 *
 * Shared types and display-label utilities for inbound confirmation status.
 * Imported by both server/services/confirmation-status.ts and all frontend
 * consumers (ContactDetail, OperatorDashboard, ConfirmationFailuresPanel).
 * Must not be duplicated elsewhere.
 */

export type ConfirmationState = "workflow_enrolled" | "sent" | "failed" | "skipped";
export type ConfirmationChannel = "ghl_workflow" | "ghl_direct" | "smtp" | null;

export interface SubmissionStatus {
  submissionId: string;
  state: ConfirmationState;
  provider: string | null;
  channel: ConfirmationChannel;
  formType: string | null;
  timestamp: string;
  safeReason: string | null;
}

export interface ContactConfirmationResult {
  latestStatus: SubmissionStatus | null;
  submissions: SubmissionStatus[];
  hasConfirmationRecord: boolean;
}

export interface ConfirmationMetric {
  rate: number;
  numerator: number;
  denominator: number;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  cohortSemantics: "terminal_event_in_window";
}

export interface FailedSubmission {
  contactId: number;
  submissionId: string;
  formType: string | null;
  timestamp: string;
  safeReason: string | null;
}

/**
 * Shared display label function — single source of truth for confirmation status labels.
 * Used by ContactDetail, OperatorDashboard stat card, and ConfirmationFailuresPanel.
 * NEVER use "Delivered", "Pending", or "Delivery rate" — no delivery webhook exists.
 */
export function labelForConfirmationStatus(
  state: ConfirmationState,
  provider: string | null,
): string {
  switch (state) {
    case "workflow_enrolled":
      return "Workflow Enrolled";
    case "sent":
      if (provider === "smtp") return "Sent — SMTP";
      if (provider === "ghl_direct") return "Sent — GHL Direct";
      return `Sent — ${provider ?? "unknown"}`;
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped (no email)";
    default:
      return String(state);
  }
}

/** Badge variant helper for consistent visual treatment across consumers. */
export function variantForConfirmationStatus(state: ConfirmationState): "default" | "secondary" | "destructive" | "outline" {
  switch (state) {
    case "workflow_enrolled":
      return "default";
    case "sent":
      return "default";
    case "failed":
      return "destructive";
    case "skipped":
      return "secondary";
    default:
      return "outline";
  }
}
