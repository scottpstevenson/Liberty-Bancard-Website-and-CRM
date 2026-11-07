/**
 * Website email-marketing consent writer. One canonical event per occurrence, written through the consent authority.
 *
 * The browser sends a boolean and the disclosure id it rendered. Everything else (wording, hash, timestamp, address,
 * contact id, evidence ids) is resolved on the server from the registry and the claimed inbound request. An unchecked
 * or omitted box writes nothing: it is not a grant and not a withdrawal.
 */
import { applyConsentCommand } from "./consent-authority";
import { WEBSITE_EMAIL_CONSENT_NAMESPACE, websiteEmailConsentEventKey } from "./website-email-lane-store";
import {
  resolveEmailConsentSubmission,
  websiteDisclosureText,
  type EmailConsentSubmission,
} from "./website-email-contracts";

/** What the public response may say. None of these claim that any email has been or will be sent. */
export type WebsiteEmailConsentState = "recorded" | "not_recorded" | "unavailable";

export interface WebsiteEmailConsentBody {
  emailMarketingOptIn?: unknown;
  emailDisclosureId?: unknown;
}

/** Pre-write validation: callers return 400 BEFORE touching contacts when the submission is malformed. */
export function validateWebsiteEmailConsent(surface: string, body: WebsiteEmailConsentBody): EmailConsentSubmission {
  return resolveEmailConsentSubmission(surface, body);
}

export interface RecordWebsiteEmailConsentInput {
  surface: string;
  requestId: string | undefined;
  contactId: number;
  submission: EmailConsentSubmission;
  ipAddress: string;
  userAgent: string;
}

export interface RecordWebsiteEmailConsentDeps {
  apply: typeof applyConsentCommand;
}

/**
 * Returns null when nothing was submitted (the response then carries no email-consent field at all). Otherwise returns
 * the truthful state. A throw inside the authority is reported as `unavailable`; it is never swallowed into "recorded".
 */
export async function recordWebsiteEmailConsent(
  input: RecordWebsiteEmailConsentInput,
  deps: RecordWebsiteEmailConsentDeps = { apply: applyConsentCommand },
): Promise<WebsiteEmailConsentState | null> {
  if (input.submission.kind !== "granted") return null;
  // Without a claimed inbound occurrence there is no stable event key, so no grant can be recorded honestly.
  if (!input.requestId) return "unavailable";
  const { disclosure, disclosureHash } = input.submission;
  try {
    const result = await deps.apply({
      subject: { type: "contact", id: input.contactId },
      kind: "opt_in",
      channel: "email",
      purpose: "outreach",
      eventNamespace: WEBSITE_EMAIL_CONSENT_NAMESPACE,
      eventKey: websiteEmailConsentEventKey(input.requestId),
      source: `website_${input.surface}`,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      evidence: {
        requestId: input.requestId,
        surface: input.surface,
        disclosureId: disclosure.id,
        disclosureVersion: disclosure.version,
        disclosureHash,
        disclosureText: websiteDisclosureText(disclosure),
        emailMarketing: true,
      },
      details: { formType: input.surface, requestId: input.requestId },
    });
    // A decision trace (blocked by a newer restriction or global DNC) is a real answer, not a grant.
    return result.recordKind === "canonical_fact" ? "recorded" : "not_recorded";
  } catch {
    return "unavailable";
  }
}
