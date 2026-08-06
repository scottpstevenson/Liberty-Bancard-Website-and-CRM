/**
 * Wave 8 — Canonical Analytics Event Constants
 *
 * Maps spec names to the actual GA4 event strings used in tracking.ts.
 * Import these constants everywhere instead of raw strings.
 */

// ─── Frontend CTA Events ──────────────────────────────────────────────────────
export const PHONE_CTA_CLICK = "phone_cta_click";
export const BOOKING_CTA_CLICK = "booking_cta_click";
export const STATEMENT_UPLOAD_CTA_CLICK = "statement_upload_cta_click";

// ─── Statement Upload Funnel ──────────────────────────────────────────────────
export const STATEMENT_UPLOAD_STARTED = "statement_upload_started";
/** Canonical completion event — tracked as statement_upload_completed in GA4 */
export const STATEMENT_UPLOAD_COMPLETED = "statement_upload_completed";
export const STATEMENT_UPLOAD_FAILED = "statement_upload_failed";

// ─── Form Events ──────────────────────────────────────────────────────────────
export const FORM_STARTED = "form_started";
/** Client-side only (GA4/fbq via sendBeacon) — no server ingestion */
export const FORM_ABANDONED = "form_abandoned";

// ─── Calculator / Tool Events ─────────────────────────────────────────────────
export const SAVINGS_CALCULATOR_COMPLETED = "savings_calculator_completed";

// ─── Thank-You Page Events ────────────────────────────────────────────────────
export const THANK_YOU_PAGE_VIEW = "thank_you_page_view";

// ─── PEWC Consent Events ──────────────────────────────────────────────────────
/** Maps to tracking.ts implementation name "pewc_consent_given" */
export const PEWC_GRANTED_ON_SUBMIT = "pewc_consent_given";
/** Maps to tracking.ts implementation name "pewc_consent_declined" */
export const PEWC_DECLINED_ON_SUBMIT = "pewc_consent_declined";
/** Maps to tracking.ts implementation name "consent_field_interaction" */
export const PEWC_CHECKED = "consent_field_interaction";
export const PEWC_UNCHECKED = "consent_field_interaction";
/** Server-side: fired after successful recordPewcDecision() write */
export const PEWC_CAPTURED = "pewc_captured";

// ─── Server-Side CRM Milestone Events ────────────────────────────────────────
export const FORM_SUBMITTED = "form_submitted";
export const DEAL_CREATED = "deal_created";
export const STATEMENT_RECEIVED = "statement_received";
export const PROPOSAL_GENERATED = "proposal_generated";
export const DEAL_STAGE_CHANGED = "deal_stage_changed";
export const CALL_BOOKED = "call_booked";
export const PROPOSAL_SENT = "proposal_sent";
export const CLOSED_WON = "closed_won";
export const APPOINTMENT_BOOKED = "appointment_booked";
export const OFFER_ROUTE_ASSIGNED = "offer_route_assigned";

// ─── Sequence / Channel Events ────────────────────────────────────────────────
export const SEQUENCE_STEP_SENT = "sequence_step_sent";
export const SEQUENCE_STEP_BLOCKED = "sequence_step_blocked";
export const CHANNEL_ALLOWED = "channel_allowed";
export const CHANNEL_BLOCKED = "channel_blocked";

// ─── All canonical event names (for validation) ───────────────────────────────
export const ALL_CANONICAL_EVENTS = new Set([
  PHONE_CTA_CLICK,
  BOOKING_CTA_CLICK,
  STATEMENT_UPLOAD_CTA_CLICK,
  STATEMENT_UPLOAD_STARTED,
  STATEMENT_UPLOAD_COMPLETED,
  STATEMENT_UPLOAD_FAILED,
  FORM_STARTED,
  FORM_ABANDONED,
  SAVINGS_CALCULATOR_COMPLETED,
  THANK_YOU_PAGE_VIEW,
  PEWC_GRANTED_ON_SUBMIT,
  PEWC_DECLINED_ON_SUBMIT,
  PEWC_CHECKED,
  PEWC_CAPTURED,
  FORM_SUBMITTED,
  DEAL_CREATED,
  STATEMENT_RECEIVED,
  PROPOSAL_GENERATED,
  DEAL_STAGE_CHANGED,
  CALL_BOOKED,
  PROPOSAL_SENT,
  CLOSED_WON,
  APPOINTMENT_BOOKED,
  OFFER_ROUTE_ASSIGNED,
  SEQUENCE_STEP_SENT,
  SEQUENCE_STEP_BLOCKED,
  CHANNEL_ALLOWED,
  CHANNEL_BLOCKED,
]);

// ─── Payload Type ─────────────────────────────────────────────────────────────
export interface AnalyticsEventPayload {
  eventName: string;
  /** Caller-supplied idempotency key — upsert-or-skip on conflict */
  eventId?: string;
  occurredAt?: Date;
  sessionId?: string;
  visitorId?: string;
  bookingTrackingId?: string;
  contactId?: number;
  dealId?: number;
  sequenceId?: number;
  pagePath?: string;
  landingPage?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  gclidPresent?: boolean;
  fbclidPresent?: boolean;
  msclkidPresent?: boolean;
  offerRoute?: string;
  vertical?: string;
  consentTier?: string;
  lifecycleStage?: string;
  sourceCategory?: string;
  formId?: string;
  channel?: string;
  blockReason?: string;
  dealStage?: string;
  metadata?: Record<string, unknown>;
}
