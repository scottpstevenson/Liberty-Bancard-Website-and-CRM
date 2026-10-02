import type { Response } from "express";
import type { AuthorizedSendDecision } from "../services/outbound-pause-authority";
import type { GhlCrmDecision } from "../services/ghl-sync-control";

type AuthorizeFn = (opts: { exceptionKey?: string }) => Promise<AuthorizedSendDecision>;
type GhlCrmOperationInput = { method: string; path: string; body?: unknown; locationId?: string };

/**
 * Route-level early disposition for GHL mutations.
 *
 * This is intentionally not the transport safety boundary: the GHL adapters
 * still perform the full authorize/register/recheck/I/O protocol. Routes use
 * this helper to avoid partial local work and to return a typed response when
 * the persisted global pause is already active.
 */
export async function authorizeGhlRouteMutation(
  authorizeOverride?: AuthorizeFn,
): Promise<AuthorizedSendDecision> {
  const authorize = authorizeOverride
    ?? (await import("../services/outbound-pause-authority")).authorize;
  return authorize({});
}

export function sendGhlMutationPaused(
  res: Response,
  decision: AuthorizedSendDecision,
): Response {
  return res.status(503).json({
    error: "Service temporarily paused",
    code: "OUTBOUND_PAUSED",
    reasonCode: decision.reasonCode,
  });
}

export async function requireGhlRouteMutationAllowed(
  res: Response,
  authorizeOverride?: AuthorizeFn,
): Promise<boolean> {
  const decision = await authorizeGhlRouteMutation(authorizeOverride);
  if (decision.allowed) return true;
  sendGhlMutationPaused(res, decision);
  return false;
}

/** Early GHL CRM-only disposition; communication and unknown operations still
 * continue to the established outbound-pause authorization path. */
export async function requireGhlCrmRouteAllowed(
  res: Response,
  operation: GhlCrmOperationInput,
  authorizeOverride?: (operation: GhlCrmOperationInput) => Promise<GhlCrmDecision>,
): Promise<boolean> {
  const authorize = authorizeOverride
    ?? (await import("../services/ghl-sync-control")).authorizeGhlCrmOperation;
  const decision = await authorize(operation);
  if (decision.allowed) return true;
  res.status(503).json({
    error: "GHL CRM operation blocked",
    code: decision.reasonCode,
    capability: decision.capability,
    reason: decision.reason,
  });
  return false;
}
