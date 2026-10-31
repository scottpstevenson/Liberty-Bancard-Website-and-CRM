/**
 * Stage 4C1 premium SFP drafts (pure; no database, network, provider or send).
 * Proves the generated module matches the specification, every draft satisfies the claim/CTA/cadence contract, the
 * checker rejects violations, drafts render through the real SFP launch renderer, and nothing here can write.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OUT_PATH, SPEC_PATH, parse, render } from "./generate-stage4c1-drafts";
import {
  PREMIUM_DRAFT_STATUS, PREMIUM_SFP_DRAFTS, WARM_SERVICE_BASELINE, premiumDraftCatalog, resolveDraftBody, validatePremiumDrafts,
} from "../server/services/cro03/sfp-premium-drafts";
import { resolveSalesBooking } from "../server/services/message-cta-contract";
import { DISPOSITIONS, OUT_DIR, renderArtifacts } from "./generate-stage4c1-inventory";
import { renderSfpLaunchBodyHtml, renderSfpLaunchSubject, sfpLaunchRenderContext } from "../server/services/sfp-launch-render";

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [PD-${String(checks).padStart(2, "0")}] ${message}`); };

const spec = readFileSync(SPEC_PATH, "utf8");
check(readFileSync(OUT_PATH, "utf8") === render(spec), "The committed module equals a fresh generation from the specification (no drift)");
const parsed = parse(spec);
check(parsed.sfp.length === 25 && PREMIUM_SFP_DRAFTS.length === 25, "All 25 Appendix B drafts are present");
check(new Set(PREMIUM_SFP_DRAFTS.map((d) => d.family)).size === 5, "Five vertical families, five touches each");
check(WARM_SERVICE_BASELINE.length === 12, "All 12 Appendix C baseline entries are present");
check(validatePremiumDrafts().length === 0, "Every draft passes cadence, token, CTA-marker, claim and duration checks");
check(PREMIUM_DRAFT_STATUS === "proposed_draft" && premiumDraftCatalog().status === "proposed_draft", "The catalog labels the drafts as proposals, never live copy");

const sample = PREMIUM_SFP_DRAFTS[1];
const bad = (patch: Partial<typeof sample>) => validatePremiumDrafts([{ ...sample, ...patch }]).map((p) => p.problem).join(" | ");
check(/unverified duration/.test(bad({ body: sample.body + " A 10-minute call." })), "A duration claim is rejected");
check(/dollar figure/.test(bad({ body: sample.body + " Save $500." })), "A dollar figure is rejected");
check(/unsupported token/.test(bad({ body: sample.body + " {{estimatedSavings}}" })), "An unsupported token is rejected");
check(/hard-coded URL/.test(bad({ body: sample.body + " https://libertybancard.com/apply" })), "A hard-coded link is rejected");
check(/expected exactly one/.test(bad({ body: sample.body.replace("[secure_statement_upload]", "") })), "A missing CTA marker is rejected");
check(/five-touch/.test(validatePremiumDrafts([sample]).map((p) => p.problem).join("|")), "An incomplete package fails the cadence check");

const available = { salesBooking: resolveSalesBooking({ GHL_DEFAULT_CALENDAR_ID: "AbCdEfGhIjKlMnOpQrSt" }) };
const unavailable = { salesBooking: resolveSalesBooking({}) };
const booking = PREMIUM_SFP_DRAFTS.find((d) => d.cta === "sales_booking")!;
check(resolveDraftBody(booking, available).body?.includes("https://libertybancard.com/book") === true, "A booking draft resolves to the first-party /book adapter");
check(resolveDraftBody(booking, unavailable).body === null && !!resolveDraftBody(booking, unavailable).reason, "A booking draft is unresolved, with a reason, when the calendar is not configured");
const ctx = sfpLaunchRenderContext({ firstName: "Alex", companyName: "Sample Business LLC", email: "alex@sample-business.example" });
let rendered = 0;
for (const d of PREMIUM_SFP_DRAFTS) {
  const r = resolveDraftBody(d, available);
  assert(r.body, `${d.family} touch ${d.touch} resolves`);
  const html = renderSfpLaunchBodyHtml(r.body, ctx);
  assert(html.includes("Sample Business LLC") || !d.body.includes("{{companyName}}"));
  assert(renderSfpLaunchSubject(d.subject, ctx).length > 0);
  rendered++;
}
check(rendered === 25, "All 25 drafts render through the real SFP launch renderer with a resolved CTA");
const src = readFileSync("server/services/cro03/sfp-premium-drafts.ts", "utf8");
check(!/from "\.\.\/\.\.\/db"|storage|\.insert\(|\.update\(|fetch\(/.test(src), "STATIC: the draft module has no database, storage, network or write calls");

// ── Asset inventory / disposition (Appendix A) ───────────────────────────────
const art = renderArtifacts(spec);
check(readFileSync(`${OUT_DIR}/asset-inventory.json`, "utf8") === art.json && readFileSync(`${OUT_DIR}/asset-disposition.md`, "utf8") === art.md, "The committed inventory and disposition equal a fresh generation (no drift)");
const inv = JSON.parse(art.json);
check(inv.totals.campaigns === 23 && inv.totals.sequences === 127 && inv.totals.templates === 8 && inv.totals.workflows === 17, "Inventory totals are 23 campaigns, 127 sequences, 8 templates, 17 workflows");
check(inv.totals.campaignSteps === 80 && inv.totals.sequenceSteps === 517, "Step totals are 80 and 517 (actual steps, per the register)");
const rows = [...inv.campaigns, ...inv.sequences, ...inv.templates, ...inv.workflows];
check(rows.every((r: any) => (DISPOSITIONS as readonly string[]).includes(r.disposition)) && rows.length === 175, "Every one of the 175 assets has a valid disposition class");
check(inv.deletionOrRetirementAuthorized === false && inv.productionRead === false, "The register authorizes no deletion/retirement and records that production was not read");
check(rows.filter((r: any) => r.disposition === "diagnostic_review").every((r: any) => /Trace dependencies/.test(r.fourC1Action)), "Test-labelled rows require a dependency trace before any action");

console.log(`STAGE4C1_PREMIUM_DRAFTS_PASS (${checks} checks)`);
