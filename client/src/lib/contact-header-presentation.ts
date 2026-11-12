/**
 * Pure presentation rules for the Contact header.
 *
 * A Contact record is a person. Its business is a separate identity whose relationship to the person is a recorded fact
 * (verified, conflicted, rejected, or not established), never an assumption from a company-name field. Consent has three honest
 * states: recorded, denied, and not recorded (unknown). "Not recorded" is never presented as a refusal.
 */
import { taskSelectionHref } from "./crm-destination-state";

export type HeaderContactIdentity = {
  firstName?: string | null; lastName?: string | null; companyName?: string | null; email?: string | null; phone?: string | null;
};

export function personName(contact: HeaderContactIdentity): string | null {
  const name = [contact.firstName, contact.lastName].map(part => (part ?? "").trim()).filter(Boolean).join(" ");
  return name || null;
}

/** The page title is the person when one is recorded; otherwise the best identifier on the record, never a blank. */
export function contactDisplayName(contact: HeaderContactIdentity): string {
  return personName(contact) || contact.companyName?.trim() || contact.email?.trim() || contact.phone?.trim() || "Unnamed Contact";
}

export type BusinessRelationshipState = "verified" | "conflicted" | "rejected" | "legacy_unknown" | "missing" | "none" | "unavailable";
export type BusinessRelationshipFact = { state: BusinessRelationshipState; businessName?: string | null } | undefined;

export type BusinessIdentityView = {
  /** Business name exactly as entered on the person's record, if any. */
  enteredName: string | null;
  /** Business name recorded by the verified link, if any. */
  verifiedName: string | null;
  relationshipLabel: string;
  tone: "verified" | "attention" | "neutral";
};

export function businessIdentity(contact: HeaderContactIdentity, fact: BusinessRelationshipFact): BusinessIdentityView {
  const enteredName = contact.companyName?.trim() || null;
  if (!fact) {
    return { enteredName, verifiedName: null, tone: "neutral",
      relationshipLabel: "Business relationship not yet loaded" };
  }
  switch (fact.state) {
    case "verified":
      return { enteredName, verifiedName: fact.businessName?.trim() || null, tone: "verified", relationshipLabel: "Verified business relationship" };
    case "conflicted":
      return { enteredName, verifiedName: null, tone: "attention", relationshipLabel: `Business link conflicted${fact.businessName ? ` (candidate: ${fact.businessName})` : ""}; needs review` };
    case "rejected":
      return { enteredName, verifiedName: null, tone: "attention", relationshipLabel: "A reviewed business link was rejected" };
    case "unavailable":
      return { enteredName, verifiedName: null, tone: "attention", relationshipLabel: "Business relationship unavailable right now" };
    default:
      return { enteredName, verifiedName: null, tone: "neutral",
        relationshipLabel: enteredName ? "Business name as entered; relationship not verified" : "No business recorded" };
  }
}

export type ConsentChannel = "email" | "sms";
export type ConsentState = "recorded" | "denied" | "not_recorded";
export type ConsentSubject = {
  consentEmail?: boolean | null; consentSms?: boolean | null; doNotContact?: boolean | null; emailStatus?: string | null;
};
const EMAIL_DENIED_STATUSES = new Set(["opted_out", "unsubscribed"]);

export function consentState(contact: ConsentSubject, channel: ConsentChannel): { state: ConsentState; label: string } {
  if (contact.doNotContact) return { state: "denied", label: "Denied (do not contact)" };
  if (channel === "email" && EMAIL_DENIED_STATUSES.has(String(contact.emailStatus ?? "").toLowerCase())) {
    return { state: "denied", label: "Denied (unsubscribed)" };
  }
  const recorded = channel === "email" ? contact.consentEmail : contact.consentSms;
  return recorded ? { state: "recorded", label: "Recorded" } : { state: "not_recorded", label: "Not recorded (unknown, not a refusal)" };
}

export type HeaderNextAction = { text: string; href: string | null };
type HeaderTask = { id: number; title: string };

/**
 * One next action, as a link where a destination exists. The link carries no authority: the destination re-authorizes the exact
 * record, so a stale id lands on an honest unavailable state.
 */
export function headerNextAction(input: {
  nextFollowUp: string | null | undefined;
  activeDealId: number | null | undefined;
  pendingTask: HeaderTask | null | undefined;
  pendingTasksLoaded: boolean;
}): HeaderNextAction {
  const when = input.nextFollowUp ? new Date(input.nextFollowUp) : null;
  if (when) {
    if (Number.isNaN(when.getTime())) return { text: "Follow-up date needs review", href: input.activeDealId ? `/dashboard/pipeline?id=${input.activeDealId}` : null };
    return { text: `Follow up ${when.toLocaleString()}`, href: input.activeDealId ? `/dashboard/pipeline?id=${input.activeDealId}` : null };
  }
  if (input.pendingTask) return { text: `Complete task: ${input.pendingTask.title}`, href: taskSelectionHref(input.pendingTask.id) };
  if (input.nextFollowUp === undefined || !input.pendingTasksLoaded) return { text: "Scheduled action unavailable", href: null };
  return { text: "No next action scheduled", href: null };
}
