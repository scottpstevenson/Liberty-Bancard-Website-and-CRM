import type { Response } from "express";
import type { AuthorizedSendDecision } from "../services/outbound-pause-authority";

type AuthorizeFn = (opts: { exceptionKey?: string }) => Promise<AuthorizedSendDecision>;

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
