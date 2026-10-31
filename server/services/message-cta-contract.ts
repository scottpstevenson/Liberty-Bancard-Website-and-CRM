/**
 * Typed, purpose-aware call-to-action (CTA) and link contract for outbound wording.
 *
 * Pure: no database, clock, network or process.env access (callers pass configuration in). The contract answers four
 * questions one way for previews, publication checks and the send path:
 *   1. Which CTA kinds exist and which message purposes may use them.
 *   2. Where each kind points, and whether that destination is available right now (with a reason when it is not).
 *   3. Whether a final href is safe (parsed after substitution and HTML decoding; no credentials, no scripts, no
 *      protocol-relative or arbitrary hosts).
 *   4. Which retired first-party paths must never be sent, and what replaced them.
 *
 * Nothing here activates, enqueues, sends or books. Sales and account calendars are separate purposes on purpose.
 */

export const CTA_KINDS = [
  "reply", "secure_statement_upload", "sales_booking", "account_booking", "proposal_view",
  "application_resume", "merchant_referral", "partner_portal", "product_information",
] as const;
export type CtaKind = (typeof CTA_KINDS)[number];

export const CTA_PURPOSES = ["sfp_cold", "sales_followup", "merchant_service", "transactional_receipt", "sms"] as const;
export type CtaPurpose = (typeof CTA_PURPOSES)[number];

export const SITE_ORIGIN = "https://libertybancard.com";
/** First-party adapter that delegates to the validated sales-booking resolver at click time. */
export const FIRST_PARTY_BOOK_URL = `${SITE_ORIGIN}/book`;
export const SECURE_UPLOAD_URL = `${SITE_ORIGIN}/upload-statement`;
export const MERCHANT_APPLICATION_URL = `${SITE_ORIGIN}/merchant-application`;

type Destination = "reply_to" | "first_party_path" | "booking_resolver" | "resource_scoped" | "none";

export interface CtaSpec {
  kind: CtaKind;
  label: string;
  destination: Destination;
  /** Fixed first-party URL for `first_party_path` kinds. */
  url?: string;
  purposes: readonly CtaPurpose[];
  /** The kind needs a real, authorized resource (proposal, saved application) before it can be offered. */
  requiresResource: boolean;
  /** Plain statement of what is missing until that authority exists. */
  unavailableReason?: string;
}

export const CTA_CONTRACT: Readonly<Record<CtaKind, CtaSpec>> = {
  reply: { kind: "reply", label: "Reply to this email", destination: "reply_to", purposes: ["sfp_cold", "sales_followup", "merchant_service", "transactional_receipt", "sms"], requiresResource: false },
  secure_statement_upload: { kind: "secure_statement_upload", label: "Request the free statement review", destination: "first_party_path", url: SECURE_UPLOAD_URL, purposes: ["sfp_cold", "sales_followup"], requiresResource: false },
  sales_booking: { kind: "sales_booking", label: "Choose a review call", destination: "booking_resolver", url: FIRST_PARTY_BOOK_URL, purposes: ["sfp_cold", "sales_followup", "sms"], requiresResource: false },
  account_booking: { kind: "account_booking", label: "Choose an account review time", destination: "none", purposes: ["merchant_service"], requiresResource: false, unavailableReason: "No account-purpose booking destination is configured in this contract; it must stay separate from the sales calendar." },
  proposal_view: { kind: "proposal_view", label: "Review the proposal", destination: "resource_scoped", purposes: ["sales_followup"], requiresResource: true, unavailableReason: "Needs a real, authorized proposal link for this deal and audience." },
  application_resume: { kind: "application_resume", label: "Continue your application", destination: "resource_scoped", purposes: ["sales_followup", "merchant_service"], requiresResource: true, unavailableReason: "Needs a real saved application and a scoped continuation link. Use reply-for-help wording until that exists." },
  merchant_referral: { kind: "merchant_referral", label: "Introduce a business", destination: "none", purposes: ["merchant_service"], requiresResource: false, unavailableReason: "No merchant-referral destination exists yet. Use a reply CTA." },
  partner_portal: { kind: "partner_portal", label: "Open the partner portal", destination: "first_party_path", url: `${SITE_ORIGIN}/partner-portal`, purposes: ["merchant_service"], requiresResource: false },
  product_information: { kind: "product_information", label: "See equipment options", destination: "none", purposes: ["sales_followup"], requiresResource: false, unavailableReason: "Needs a verified equipment route that matches an approved recommendation." },
};

/** Retired first-party paths that return 404 (or an unrelated page). Value is the supported replacement, if any. */
export const RETIRED_FIRST_PARTY_PATHS: Readonly<Record<string, { replacement: string | null; note: string }>> = {
  "/apply": { replacement: MERCHANT_APPLICATION_URL, note: "Use /merchant-application for a new application." },
  "/upload": { replacement: SECURE_UPLOAD_URL, note: "Use the secure /upload-statement form." },
  "/refer": { replacement: null, note: "No merchant-referral page exists; use a reply CTA." },
  "/terminals": { replacement: null, note: "No verified equipment route; do not link." },
  "/partners/portal": { replacement: `${SITE_ORIGIN}/partner-portal`, note: "The authenticated portal entry is /partner-portal." },
};

// ---------------------------------------------------------------------------------------------------------------------
// Sales booking resolver (single validated configuration for the sales purpose)
// ---------------------------------------------------------------------------------------------------------------------

export const BOOKING_WIDGET_HOST = "api.leadconnectorhq.com";
const BOOKING_ID_RE = /^[A-Za-z0-9]{16,32}$/;
const BOOKING_SLUG_RE = /^[A-Za-z0-9_-]{6,40}$/;

export interface BookingConfigInput {
  GHL_CALENDAR_BOOKING_URL?: string | null;
  GHL_DEFAULT_CALENDAR_ID?: string | null;
  GHL_DEFAULT_BOOKING_LINK?: string | null;
}

export type SalesBookingResolution =
  | { available: true; calendarId: string; widgetUrl: string; sources: string[]; durationMinutes: null; note: string }
  | { available: false; reason: "not_configured" | "invalid_configuration" | "sources_disagree"; detail: string; sources: string[] };

function widgetPart(raw: string): { kind: "booking" | "bookings"; value: string } | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.host !== BOOKING_WIDGET_HOST || u.username || u.password) return null;
  const m = /^\/widget\/(bookings?)\/([^/]+)\/?$/.exec(u.pathname);
  return m ? { kind: m[1] as "booking" | "bookings", value: m[2] } : null;
}

/** `/widget/booking/<calendarId>`: the calendar ID. Returns null for any other shape (including a slug URL). */
function idFromWidgetUrl(raw: string): string | null {
  const p = widgetPart(raw);
  return p && p.kind === "booking" && BOOKING_ID_RE.test(p.value) ? p.value : null;
}

/** `/widget/bookings/<slug>`: GoHighLevel's slug address. It names a calendar but cannot be compared with an ID. */
function slugFromWidgetUrl(raw: string): string | null {
  const p = widgetPart(raw);
  return p && p.kind === "bookings" && BOOKING_SLUG_RE.test(p.value) ? p.value : null;
}

/**
 * Resolves the sales booking widget from the configured sources.
 *  - ID sources (GHL_CALENDAR_BOOKING_URL as /widget/booking/<id>, GHL_DEFAULT_CALENDAR_ID) must carry the same ID. The
 *    comparison is case-sensitive because the widget ID is case-sensitive (a lowercase-L / uppercase-I typo is a
 *    different calendar).
 *  - A slug source (/widget/bookings/<slug>) is shape-validated but never compared with an ID: the two identifiers are
 *    different kinds and cannot be proven to name the same calendar. With an ID source the ID address is used and the
 *    slug is reported as unverified; with only a slug source the slug address is used.
 * The ID is never defaulted: missing, malformed or disagreeing configuration is an explicit unavailable state.
 */
export function resolveSalesBooking(cfg: BookingConfigInput | Readonly<Record<string, string | undefined>>): SalesBookingResolution {
  const ids: Array<{ source: string; id: string | null }> = [];
  const slugs: Array<{ source: string; slug: string | null }> = [];
  const addId = (source: string, value: string | null | undefined, parse: (v: string) => string | null) => {
    if (value && value.trim()) ids.push({ source, id: parse(value) });
  };
  const classifyUrl = (source: string, value: string | null | undefined) => {
    if (!value || !value.trim()) return;
    const slug = slugFromWidgetUrl(value);
    if (slug) slugs.push({ source, slug }); else ids.push({ source, id: idFromWidgetUrl(value) });
  };
  classifyUrl("GHL_CALENDAR_BOOKING_URL", cfg.GHL_CALENDAR_BOOKING_URL);
  addId("GHL_DEFAULT_CALENDAR_ID", cfg.GHL_DEFAULT_CALENDAR_ID, (v) => (BOOKING_ID_RE.test(v.trim()) ? v.trim() : null));
  classifyUrl("GHL_DEFAULT_BOOKING_LINK", cfg.GHL_DEFAULT_BOOKING_LINK);
  const sources = [...ids.map((f) => f.source), ...slugs.map((f) => f.source)];
  if (sources.length === 0) return { available: false, reason: "not_configured", detail: "No sales booking source is configured.", sources };
  const bad = [...ids.filter((f) => f.id === null).map((f) => f.source)];
  if (bad.length) return { available: false, reason: "invalid_configuration", detail: `Invalid booking configuration in: ${bad.join(", ")}.`, sources };
  const distinct = new Set(ids.map((f) => f.id as string));
  if (distinct.size > 1) return { available: false, reason: "sources_disagree", detail: `Booking sources name different calendars: ${ids.map((i) => i.source).join(", ")}.`, sources };
  if (distinct.size === 1) {
    const calendarId = ids[0].id as string;
    return {
      available: true, calendarId, widgetUrl: `https://${BOOKING_WIDGET_HOST}/widget/booking/${calendarId}`, sources, durationMinutes: null,
      note: slugs.length ? "Duration is not known to this resolver; wording must not state one. A slug source is configured but cannot be compared with the ID." : "Duration is not known to this resolver; wording must not state one.",
    };
  }
  const slug = slugs[0].slug as string;
  return {
    available: true, calendarId: slug, widgetUrl: `https://${BOOKING_WIDGET_HOST}/widget/bookings/${slug}`, sources, durationMinutes: null,
    note: "Only a slug address is configured. Duration is not known to this resolver; wording must not state one.",
  };
}

export interface CtaResolution {
  kind: CtaKind; label: string; available: boolean; url: string | null; reasonUnavailable: string | null;
  source: Destination;
}

export interface CtaContext { salesBooking: SalesBookingResolution; resourceUrls?: Partial<Record<CtaKind, string | null | undefined>> }

/** Resolves one CTA for a purpose. A kind used outside its purposes is unavailable (never silently reused). */
export function resolveCta(kind: CtaKind, purpose: CtaPurpose, ctx: CtaContext): CtaResolution {
  const spec = CTA_CONTRACT[kind];
  const base = { kind, label: spec.label, source: spec.destination } as const;
  if (!spec.purposes.includes(purpose)) {
    return { ...base, available: false, url: null, reasonUnavailable: `${kind} is not permitted for ${purpose} wording.` };
  }
  switch (spec.destination) {
    case "reply_to": return { ...base, available: true, url: null, reasonUnavailable: null };
    case "first_party_path": return { ...base, available: true, url: spec.url!, reasonUnavailable: null };
    case "booking_resolver":
      return ctx.salesBooking.available
        ? { ...base, available: true, url: spec.url!, reasonUnavailable: null }
        : { ...base, available: false, url: null, reasonUnavailable: ctx.salesBooking.detail };
    case "resource_scoped": {
      const url = ctx.resourceUrls?.[kind];
      if (url) {
        const check = validateHref(url, { allowedHosts: [new URL(SITE_ORIGIN).host] });
        if (check.ok) return { ...base, available: true, url: check.href, reasonUnavailable: null };
        return { ...base, available: false, url: null, reasonUnavailable: `Resource link rejected: ${check.reason}.` };
      }
      return { ...base, available: false, url: null, reasonUnavailable: spec.unavailableReason ?? "Needs an authorized resource." };
    }
    default: return { ...base, available: false, url: null, reasonUnavailable: spec.unavailableReason ?? "No destination." };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Final href validation
// ---------------------------------------------------------------------------------------------------------------------

export type HrefCheck = { ok: true; href: string } | { ok: false; reason: string };

const decodeEntities = (s: string) => s
  .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0?39;/g, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");

/** Parses a final href after substitution and HTML decoding. Cases: schemes, credentials, hosts, retired paths. */
export function validateHref(raw: string, opts: { allowedHosts: readonly string[] }): HrefCheck {
  const decoded = decodeEntities(raw.trim());
  if (!decoded) return { ok: false, reason: "empty link" };
  if (decoded.startsWith("//")) return { ok: false, reason: "protocol-relative link" };
  if (/\{\{|\}\}|\[[A-Za-z_ ]+\]/.test(decoded)) return { ok: false, reason: "unresolved substitution in link" };
  let u: URL;
  try { u = new URL(decoded); } catch { return { ok: false, reason: "malformed link" }; }
  if (u.protocol !== "https:") return { ok: false, reason: `scheme ${u.protocol.replace(":", "")} is not allowed` };
  if (u.username || u.password) return { ok: false, reason: "credentials in link" };
  if (!opts.allowedHosts.includes(u.host)) return { ok: false, reason: `host ${u.host} is not allowed` };
  const retired = RETIRED_FIRST_PARTY_PATHS[u.pathname.replace(/\/+$/, "") || "/"];
  if (retired && u.host === new URL(SITE_ORIGIN).host) return { ok: false, reason: `retired path ${u.pathname}: ${retired.note}` };
  return { ok: true, href: u.toString() };
}

/** Trims syntactic trailing punctuation from a URL found in prose without touching legitimate path or query content. */
export function trimUrlPunctuation(url: string): string {
  let out = url;
  while (/[.,;:!?'")\]]$/.test(out)) {
    if (out.endsWith(")") && (out.match(/\(/g)?.length ?? 0) >= (out.match(/\)/g)?.length ?? 0)) break;
    out = out.slice(0, -1);
  }
  return out;
}

export interface LinkFinding { link: string; reason: string }

/** Every http(s)/href link in an html or plain-text body, validated against the host allowlist and retired paths. */
export function findUnsafeLinks(text: string, opts: { allowedHosts: readonly string[] }): LinkFinding[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/href\s*=\s*"([^"]*)"/gi)) found.add(m[1]);
  for (const m of text.matchAll(/(?<![="'A-Za-z:/.])(?:https?:\/\/|\/\/)[^\s<>"]+/gi)) found.add(trimUrlPunctuation(m[0]));
  const out: LinkFinding[] = [];
  for (const link of found) {
    if (/^(tel:|mailto:)/i.test(link)) continue;
    const r = validateHref(link, opts);
    if (!r.ok) out.push({ link, reason: r.reason });
  }
  return out;
}

/** Scheduling-duration claims that cannot be verified (the booking calendars are not 10 minutes). */
export function findDurationClaims(text: string): string[] {
  return [...text.matchAll(/\b(?:ten|10)[\s-]*(?:min(?:ute)?s?)\b/gi)].map((m) => m[0]);
}
