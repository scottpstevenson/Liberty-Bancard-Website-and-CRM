import type { Response } from "express";
import crypto from "crypto";
const ALLOWED_REASON_CODES = new Set([
  "admin_seed_failed", "audit_write_failed", "auth_probe_failed",
  "consent_evidence_check_failed", "email_collision_privileged_role",
  "email_mismatch", "enrollment_failed", "fallback_delivery_failed",
  "invite_delivery_failed", "no_contact", "no_email", "notification_delivery_failed",
  "notification_write_failed", "password_change_delivery_failed", "password_reset_failed",
  "password_set_failed", "quiet_hours_check_failed", "reset_request_failed",
  "referral_auto_enroll_failed", "referral_contact_create_failed",
  "referral_dnc_blocked", "referral_mutation_paused", "referral_sequence_missing",
  "sequence_check_failed", "session_record_failed", "session_registration_failed",
  "session_validation_failed", "signup_failed", "smtp_error", "smtp_not_configured",
  "transport_unavailable", "trusted_device_delivery_failed", "two_factor_disabled_delivery_failed",
  "two_factor_enabled_delivery_failed", "unexpected_failure", "verification_failed",
  "welcome_delivery_failed",
  "lead_scoring_failed", "smart_routing_failed", "auto_enrollment_failed",
  "workflow_trigger_failed", "proposal_view_alert_failed", "proposal_accept_alert_failed",
  "workflow_enrollment_failed", "outbound_delivery_unavailable", "proposal_mutation_paused",
]);

function coarseErrorClass(err: unknown): "Error" | "TypeError" | "RangeError" | "SyntaxError" | "ReferenceError" | "NonErrorThrown" {
  if (err instanceof TypeError) return "TypeError";
  if (err instanceof RangeError) return "RangeError";
  if (err instanceof SyntaxError) return "SyntaxError";
  if (err instanceof ReferenceError) return "ReferenceError";
  return err instanceof Error ? "Error" : "NonErrorThrown";
}

function safeRouteDetails(res: Response) {
  const req = (res as Response & { req?: { method?: unknown; route?: { path?: unknown } } }).req;
  const route = typeof req?.route?.path === "string" && /^\/[A-Za-z0-9_/:.-]{0,160}$/.test(req.route.path)
    ? req.route.path
    : "unknown_route";
  const method = typeof req?.method === "string" && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(req.method)
    ? req.method.toUpperCase()
    : "UNKNOWN";
  return { route, method, status: 500 };
}

/**
 * Emit a correlation-first operational diagnostic for credential, invite, and
 * delivery paths. Callers provide a strictly allowlisted stable reason code
 * plus opaque IDs or aggregate counts; an error is reduced to a fixed coarse
 * class and no error properties (including message) are read or logged.
 */
export function logOperationalDiagnostic(
  operation: string,
  err: unknown,
  reason: string,
  fields: Record<string, string | number | undefined> = {},
): string {
  const correlationId = crypto.randomUUID();
  const safeFields = Object.fromEntries(
    Object.entries(fields).filter(([key, value]) =>
      /(id|count)$/i.test(key) &&
      ((typeof value === "number" && Number.isFinite(value)) ||
        (typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value))),
    ),
  );
  console.error("Operational diagnostic", {
    correlationId,
    operation: /^[a-z0-9_]{1,80}$/.test(operation) ? operation : "unknown_operation",
    errorClass: coarseErrorClass(err),
    reasonCode: ALLOWED_REASON_CODES.has(reason) ? reason : "unknown_reason",
    route: "background",
    method: "N/A",
    status: 0,
    ...safeFields,
  });
  return correlationId;
}

/**
 * Returns the generic unexpected-error message in every environment. Use this
 * when preserving a specific response shape (e.g. `{ ok: false, error:
 * safeMessage(...) }`) rather than calling serverError(), which uses
 * `{ message: ... }`.
 */
export function safeMessage(msg: string | undefined | null, fallback = "Internal server error"): string {
  void msg;
  void fallback;
  return "Internal server error";
}

/**
 * Sends a sanitized 500 response.
 *
 * - Creates the correlation ID before emitting diagnostics.
 * - Logs only fixed diagnostic fields; it never reads or emits an error
 *   message, stack, or arbitrary error properties.
 * - Returns the generic message in every environment so raw database/provider
 *   details never reach a browser.
 *
 * @param res     Express Response object
 * @param err     The caught error (any)
 * @param context Legacy caller context; intentionally excluded from diagnostics.
 */
export function serverError(res: Response, err: unknown, context?: string): void {
  void context;
  const correlationId = crypto.randomUUID();
  console.error("Internal server error", {
    correlationId,
    errorClass: coarseErrorClass(err),
    reasonCode: "internal_error",
    ...safeRouteDetails(res),
  });
  res.setHeader("X-Correlation-Id", correlationId).status(500).json({
    message: "Internal server error",
    code: "INTERNAL_ERROR",
    correlationId,
  });
}
