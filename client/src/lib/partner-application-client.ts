/**
 * Browser side of the partner application: payload construction, field validation (the same shared schema the server
 * runs) and the typed result of a submission. Kept free of React so it can be tested without a browser.
 *
 * The idempotency key survives a lost response or a reload (per path and mailbox) and is released only when the server
 * gives a definitive answer, so a retry replays the same occurrence instead of creating a second application.
 */
import {
  parsePartnerApplication,
  partnerLink,
  pickPartnerAttribution,
  resolvePartnerAttribution,
  PARTNER_APPLICATION_CONSENT,
  PARTNER_APPLICATION_SCHEMA_VERSION,
  PARTNER_SOURCE_PAGES,
  type PartnerApplicationIssue,
} from "@shared/partner-application";
import type { PartnerPathId } from "@shared/partner-public-content";
import { disclosureForSurface } from "@shared/website-email-disclosures";
import { clearSubmissionKey, getSubmissionKey, isDefinitiveSubmissionOutcome } from "@/lib/submission-key";

export interface PartnerFormValues {
  fullName: string;
  email: string;
  phone: string;
  company: string;
  contactPreference: string;
  background: string;
  region: string;
  // referral
  profession: string;
  professionOther: string;
  referralNetwork: string;
  expectedIntroductions: string;
  // sales agent
  experience: string;
  prospectingApproach: string;
  leadSourceInterest: string;
  // consent
  contactPermission: boolean;
  marketingOptIn: boolean;
}

export const EMPTY_PARTNER_FORM: PartnerFormValues = {
  fullName: "", email: "", phone: "", company: "", contactPreference: "email", background: "", region: "",
  profession: "", professionOther: "", referralNetwork: "", expectedIntroductions: "",
  experience: "", prospectingApproach: "", leadSourceInterest: "",
  contactPermission: false, marketingOptIn: false,
};

/** Fields the form renders for each path, in visual order. Used for the error summary and focus management. */
export const PARTNER_FIELD_ORDER: Record<PartnerPathId, string[]> = {
  referral: ["fullName", "email", "phone", "company", "profession", "professionOther", "referralNetwork", "expectedIntroductions", "region", "contactPreference", "background", "contactPermission"],
  sales_agent: ["fullName", "email", "phone", "company", "region", "experience", "prospectingApproach", "leadSourceInterest", "contactPreference", "background", "contactPermission"],
};

const trimmed = (value: string) => value.trim();
const FIRST_TOUCH_KEY = "lb_partner_first_touch";

/** The session's first allowlisted attribution set seen on a partner route (empty when none, or when storage is unavailable). */
export function readPartnerFirstTouch(): ReturnType<typeof pickPartnerAttribution> {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(FIRST_TOUCH_KEY);
    return raw ? pickPartnerAttribution(JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Remembers the first allowlisted set a session arrives with on a partner page. First write wins for the whole session;
 * a later page with different values becomes the CURRENT touch (see resolvePartnerAttribution) but never replaces this.
 */
export function capturePartnerFirstTouch(pathname: string, search: string): void {
  try {
    if (typeof sessionStorage === "undefined" || !(PARTNER_SOURCE_PAGES as readonly string[]).includes(pathname)) return;
    if (Object.keys(readPartnerFirstTouch()).length > 0) return;
    const seen = pickPartnerAttribution(new URLSearchParams(search));
    if (Object.keys(seen).length > 0) sessionStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(seen));
  } catch {
    // Storage can be blocked; attribution then relies on the current URL only.
  }
}

/** The attribution to carry or store right now: current touch if present, else the session's first touch. */
export function currentPartnerAttribution(search?: string): ReturnType<typeof pickPartnerAttribution> {
  const current = search ?? (typeof window === "undefined" ? "" : window.location.search);
  return resolvePartnerAttribution(new URLSearchParams(current), readPartnerFirstTouch());
}

/**
 * A same-origin partner route that keeps only the allowlisted ref and UTM values (current touch, else the session's first
 * touch), so a campaign link survives hub -> journey -> application. Nothing outside the allowlist (tokens, URLs, other
 * parameters) is carried.
 */
export function partnerRouteWithAttribution(route: string, hash?: string): string {
  return partnerLink(route, { attribution: currentPartnerAttribution(), hash });
}

const present = <T extends string>(key: string, value: T): Record<string, T> => (trimmed(value) ? { [key]: value } : {});

/** The request body for a path. Only that path's fields are sent, so a hidden field from the other path can never be stored. */
export function buildPartnerPayload(
  path: PartnerPathId,
  values: PartnerFormValues,
  context: { sourcePage?: string; search?: string; firstTouch?: Record<string, unknown> } = {},
): Record<string, unknown> {
  const disclosure = disclosureForSurface("partner_application");
  const marketing = values.marketingOptIn && disclosure ? { marketingOptIn: true, emailDisclosureId: disclosure.id } : {};
  const sourcePage = context.sourcePage && (PARTNER_SOURCE_PAGES as readonly string[]).includes(context.sourcePage) ? { sourcePage: context.sourcePage } : {};
  const attribution = resolvePartnerAttribution(new URLSearchParams(context.search ?? ""), context.firstTouch ?? null);
  const common = {
    schemaVersion: PARTNER_APPLICATION_SCHEMA_VERSION,
    path,
    fullName: values.fullName,
    email: values.email,
    ...present("company", values.company),
    ...present("background", values.background),
    ...present("phone", values.phone),
    contactPreference: values.contactPreference || "email",
    contactPermission: values.contactPermission === true,
    consentVersion: PARTNER_APPLICATION_CONSENT.version,
    ...marketing,
    ...sourcePage,
    ...(Object.keys(attribution).length > 0 ? { attribution } : {}),
  };
  if (path === "referral") {
    return {
      ...common,
      profession: values.profession,
      ...(values.profession === "other" ? present("professionOther", values.professionOther) : {}),
      referralNetwork: values.referralNetwork,
      ...present("expectedIntroductions", values.expectedIntroductions),
      ...present("region", values.region),
    };
  }
  return {
    ...common,
    region: values.region,
    experience: values.experience,
    prospectingApproach: values.prospectingApproach,
    leadSourceInterest: values.leadSourceInterest,
  };
}

/** Field errors from the same schema the server uses; a field the form does not render is surfaced on the form. */
export function validatePartnerPayload(path: PartnerPathId, payload: Record<string, unknown>): Record<string, string> {
  const parsed = parsePartnerApplication(payload, path);
  if (parsed.ok) return {};
  return issuesToErrors(path, parsed.issues);
}

export function issuesToErrors(path: PartnerPathId, issues: readonly PartnerApplicationIssue[]): Record<string, string> {
  const rendered = new Set(PARTNER_FIELD_ORDER[path]);
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.field === "marketingOptIn" || issue.field === "emailDisclosureId" || issue.field === "consentVersion" ? "form" : issue.field;
    const target = rendered.has(key) ? key : "form";
    if (!errors[target]) errors[target] = issue.message;
  }
  return errors;
}

export type PartnerSubmitOutcome =
  | { kind: "saved"; receipt: string | null }
  | { kind: "invalid"; errors: Record<string, string> }
  | { kind: "not_accepted" }
  | { kind: "rate_limited" }
  | { kind: "recoverable" };

export const PARTNER_SUBMIT_SCOPE = "partner_apply";
const scopeFor = (path: PartnerPathId) => `${PARTNER_SUBMIT_SCOPE}:${path}`;

export interface PartnerSubmitDeps {
  fetchImpl?: typeof fetch;
}

/** Sends one application. Never throws: every failure is a typed outcome the form can show. */
export async function submitPartnerApplication(
  path: PartnerPathId,
  payload: Record<string, unknown>,
  deps: PartnerSubmitDeps = {},
): Promise<PartnerSubmitOutcome> {
  const identity = String(payload.email ?? "");
  const scope = scopeFor(path);
  const key = getSubmissionKey(scope, identity);
  const doFetch = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch("/api/partner-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(payload),
    });
  } catch {
    // The request may or may not have arrived. The key is kept so a retry cannot duplicate it.
    return { kind: "recoverable" };
  }
  const body = (await response.json().catch(() => null)) as Record<string, any> | null;
  if (isDefinitiveSubmissionOutcome(response.status, body)) clearSubmissionKey(scope, identity);
  if (response.ok && body?.success === true) {
    return { kind: "saved", receipt: typeof body.requestReceipt === "string" ? body.requestReceipt : typeof body.receipt?.requestReceipt === "string" ? body.receipt.requestReceipt : null };
  }
  if (response.status === 429) return { kind: "rate_limited" };
  if (response.status === 400 && Array.isArray(body?.issues)) {
    return { kind: "invalid", errors: issuesToErrors(path, body!.issues as PartnerApplicationIssue[]) };
  }
  if (response.status === 409 && body?.code === "APPLICATION_NOT_ACCEPTED") return { kind: "not_accepted" };
  return { kind: "recoverable" };
}

/** The short reference a person can quote: the first eight characters of the saved receipt. */
export function partnerReference(receipt: string | null): string | null {
  if (!receipt) return null;
  const ref = receipt.replace(/-/g, "").slice(0, 8).toUpperCase();
  return ref || null;
}
