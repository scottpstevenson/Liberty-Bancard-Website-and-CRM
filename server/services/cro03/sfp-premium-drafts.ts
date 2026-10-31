/**
 * Premium SFP draft packs and the warm/service writing baseline, as typed READ-ONLY proposals.
 *
 * These are adopted only as editable drafts: nothing here is published, enrolled, activated or sent, and no function in
 * this module writes anywhere. Operators work on a draft through the versioned workspace; publication is a separate,
 * explicit command. Wording is generated from the specification (scripts/generate-stage4c1-drafts.ts) and checked for
 * drift by test-stage4c1-premium-drafts.ts.
 */
import { PREMIUM_SFP_DRAFTS, WARM_SERVICE_BASELINE, type PremiumSfpDraft } from "./sfp-premium-drafts.generated";
import { findDurationClaims, findUnsafeLinks, resolveCta, type CtaContext } from "../message-cta-contract";

export { PREMIUM_SFP_DRAFTS, WARM_SERVICE_BASELINE };
export type { PremiumSfpDraft };

export const PREMIUM_DRAFT_STATUS = "proposed_draft" as const;
/** Day offsets of the five-touch SFP cadence. */
export const SFP_FIVE_TOUCH_DAYS = [0, 3, 7, 12, 18] as const;
const ALLOWED_TOKENS = new Set(["firstName", "companyName"]);
const MARKER_RE = /\[(secure_statement_upload|sales_booking)\]/g;
/** Claims no draft may make: figures, guarantees, or an affirmative savings statement. */
const CLAIM_RES: Array<[RegExp, string]> = [
  [/\$\s?\d/, "dollar figure"], [/\d\s?%/, "percentage"], [/guarantee/i, "guarantee wording"],
  [/\b(will|can|could) (save|reduce|lower|cut)\b/i, "savings promise"], [/\bsavings of\b/i, "savings figure"],
  [/\b(we (spoke|talked)|as discussed|our conversation)\b/i, "invented conversation"],
];

export interface DraftProblem { family: string; touch: number | null; problem: string }

export function validatePremiumDrafts(drafts: readonly PremiumSfpDraft[] = PREMIUM_SFP_DRAFTS): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const add = (d: { family: string; touch: number | null }, problem: string) => problems.push({ family: d.family, touch: d.touch, problem });
  const families = Array.from(new Set(drafts.map((d) => d.family)));
  for (const family of families) {
    const set = drafts.filter((d) => d.family === family).sort((a, b) => a.touch - b.touch);
    if (set.length !== SFP_FIVE_TOUCH_DAYS.length || set.some((d, i) => d.touch !== i + 1 || d.day !== SFP_FIVE_TOUCH_DAYS[i])) {
      add({ family, touch: null }, `cadence is not the five-touch ${SFP_FIVE_TOUCH_DAYS.join("/")} day schedule`);
    }
  }
  for (const d of drafts) {
    const where = { family: d.family, touch: d.touch };
    const text = `${d.subject}\n${d.body}`;
    for (const m of text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) if (!ALLOWED_TOKENS.has(m[1])) add(where, `unsupported token {{${m[1]}}}`);
    const markers = Array.from(d.body.matchAll(MARKER_RE)).map((m) => m[1]);
    if (d.cta === "reply") { if (markers.length) add(where, "reply draft carries a link marker"); }
    else if (markers.length !== 1 || markers[0] !== d.cta) add(where, `expected exactly one [${d.cta}] marker`);
    if (/\[[a-z_]+\]/i.test(d.body.replace(MARKER_RE, ""))) add(where, "unresolved bracket marker");
    if (/https?:\/\//i.test(text)) add(where, "hard-coded URL; links come only from the CTA contract");
    if (findDurationClaims(text).length) add(where, "unverified duration claim");
    for (const [re, label] of CLAIM_RES) if (re.test(text)) add(where, `unsupported claim: ${label}`);
    if (!/^Hi \{\{firstName\}\},|^Hello,/.test(d.body)) add(where, "greeting is neither first-name nor neutral");
  }
  return problems;
}

/**
 * Replaces the CTA marker with its resolved URL. Returns null (never a guessed link) when the destination is not
 * available now, so a caller cannot build wording around a dead or unvalidated link.
 */
export function resolveDraftBody(d: PremiumSfpDraft, ctx: CtaContext): { body: string | null; reason: string | null } {
  if (d.cta === "reply") return { body: d.body, reason: null };
  const r = resolveCta(d.cta, "sfp_cold", ctx);
  if (!r.available || !r.url) return { body: null, reason: r.reasonUnavailable ?? "CTA unavailable" };
  const body = d.body.replace(MARKER_RE, r.url);
  const unsafe = findUnsafeLinks(body, { allowedHosts: ["libertybancard.com"] });
  return unsafe.length ? { body: null, reason: `unsafe link: ${unsafe[0].link}` } : { body, reason: null };
}

export function premiumDraftCatalog(ctx?: CtaContext) {
  const families = Array.from(new Set(PREMIUM_SFP_DRAFTS.map((d) => d.family)));
  return {
    status: PREMIUM_DRAFT_STATUS,
    note: "Proposed wording only. Nothing here is published, enrolled or sent; editing happens in a versioned draft and publication is a separate command.",
    families: families.map((family) => ({
      family, vertical: PREMIUM_SFP_DRAFTS.find((d) => d.family === family)!.vertical,
      touches: PREMIUM_SFP_DRAFTS.filter((d) => d.family === family).map((d) => {
        // With a context, each touch also carries its CTA-resolved body (or the reason it cannot be resolved).
        const r = ctx ? resolveDraftBody(d, ctx) : null;
        return { ...d, resolvedBody: r?.body ?? null, unresolvedReason: r?.reason ?? null };
      }),
    })),
    baseline: WARM_SERVICE_BASELINE,
    problems: validatePremiumDrafts(),
  };
}
