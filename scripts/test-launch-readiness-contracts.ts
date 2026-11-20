import { publicTrackingReadiness } from "../shared/public-tracking-readiness";
import { lintRules } from "../server/services/message-copy-lint";
import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { classifyVertical, CLASSIFIER_VERSION, SFP_TARGET_VERTICALS_V2 } from "../server/services/cro03/sfp-vertical-classifier";
import { TERMS, normalizeDiscoveryRow } from "../server/services/scheduled-discovery/policy";
import { campaignMergeFields, applyCampaignMergeFields, assertCampaignTemplateSupported, leftoverTokens } from "../server/services/campaign-merge-fields";
import { isQueueSelectedByBackgroundProfile, useCanonicalSequenceRunner, getJobCapabilityGroup } from "../server/services/background-profile";

let checks = 0;
const check = (condition: unknown, label: string) => { assert(condition, label); checks++; console.log("PASS " + label); };
check(publicTrackingReadiness({}).ga4 === "missing", "Missing public account IDs remain explicitly missing");
check(publicTrackingReadiness({ VITE_GA_ID: "G-FIXTURE123", VITE_FB_PIXEL_ID: "1234", VITE_GOOGLE_ADS_LEAD_CONVERSION: "AW-123/label" }).googleAdsLead === "configured", "Build readiness validates public IDs without claiming delivery");
check(publicTrackingReadiness({ VITE_GOOGLE_ADS_LEAD_CONVERSION: "G-FIXTURE123" }).googleAdsLead === "invalid", "GA4 ID cannot masquerade as an Ads conversion action");
check(CLASSIFIER_VERSION > 3, "Changed provider category rules invalidate prior classifier evidence");
for (const [vertical, terms] of Object.entries(TERMS)) for (const term of terms) {
  const result = classifyVertical(term, [...SFP_TARGET_VERTICALS_V2], 2);
  check(result.matchedTargetId === vertical, `Returned category ${term} resolves to ${vertical}`);
  const row = { name: "Synthetic Provider Fixture", type: term, city: "Miami", state: "FL", postal_code: "33101", county_fips: "12086", place_id: "fixture-place" };
  const scope = { county_fips: ["12086"], vertical_ids: [vertical], vertical, definition_county_fips: "12086" };
  check(normalizeDiscoveryRow(row, scope).state === "eligible", `Actual artifact mapper admits scoped ${term}`);
  check(normalizeDiscoveryRow({ ...row, type: "unknown category" }, scope).state === "unresolved", "Query vertical cannot manufacture returned evidence");
  check(normalizeDiscoveryRow({ ...row, state: "GA", city: "Atlanta", postal_code: "30301", county_fips: "13089" }, scope).state === "out_of_scope", "Category repair cannot admit out-of-territory businesses");
}
for (const label of ["restaurant", "food truck", "government office"]) check(classifyVertical(label, [...SFP_TARGET_VERTICALS_V2], 2).outcome === "not_target", `${label} remains excluded`);
check(classifyVertical("wellness", [...SFP_TARGET_VERTICALS_V2], 2).outcome === "review_required", "Ambiguous category remains held");
for (const copy of ["Book a 5-minute recap", "Complete the application (5 min)", "Our typical response time is within 4 hours during business hours."]) check(lintRules(copy).length > 0, "Publication flags an unverified duration/SLA: " + copy);
const fields = campaignMergeFields({ ownerFirstName: "Alex", companyName: "Sample Business LLC" });
check(applyCampaignMergeFields("{{firstName}} / {{first_name}} at {{companyName}} / {{company_name}}", fields) === "Alex / Alex at Sample Business LLC / Sample Business LLC", "Camel and snake case share recipient substitution");
check(!leftoverTokens(applyCampaignMergeFields("Hi {{firstName}} at {{companyName}}", fields)).length, "Current package merge fields never remain literal");
assertCampaignTemplateSupported("{{firstName}}", "{{company_name}}");
assert.throws(() => assertCampaignTemplateSupported("{{unknown}}", "body"), /unsupported merge fields/); checks++;
check(applyCampaignMergeFields("{{companyName}}", campaignMergeFields({ companyName: "$& Corporation" })) === "$& Corporation", "Recipient text is literal, not replacement-pattern syntax");
const oldProfile = process.env.BACKGROUND_JOB_PROFILE;
try {
  process.env.BACKGROUND_JOB_PROFILE = "selective:canonical-sequences";
  check(useCanonicalSequenceRunner(true) && useCanonicalSequenceRunner(false), "Narrow worker cannot inherit legacy producer authority from its feature flag");
  check(getJobCapabilityGroup("sequences", "run") === "outreach", "Existing logical governance owner remains stable");
  check(isQueueSelectedByBackgroundProfile("sequences"), "Narrow capability selects the actual sequence consumer");
  for (const queue of ["discovery", "enrollment-recovery", "winback-outreach", "abandoned-statement", "proposal-followup", "website-email", "scheduled-discovery", "ghl-sync"]) check(!isQueueSelectedByBackgroundProfile(queue), `Narrow capability excludes ${queue}`);
} finally { if (oldProfile === undefined) delete process.env.BACKGROUND_JOB_PROFILE; else process.env.BACKGROUND_JOB_PROFILE = oldProfile; }

// Bundle the actual two client entry points with public fixture IDs. Execute in a VM with network-free browser sinks.
const bundle = await build({ stdin: { contents: 'export * from "./client/src/lib/tracking"; export { trackConversion as compatibilityConversion } from "./client/src/lib/analytics";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "cjs", define: { "import.meta.env": JSON.stringify({ VITE_GA4_MEASUREMENT_ID: "G-FIXTURE123", VITE_FB_PIXEL_ID: "123456789", VITE_GOOGLE_ADS_LEAD_CONVERSION: "AW-123456/fixture_label" }) } });
const calls: any[][] = [], pixels: any[][] = [], scripts: any[] = [];
const context: any = { module: { exports: {} }, exports: {}, console, document: { head: { appendChild: (v: any) => scripts.push(v) }, createElement: () => ({}), getElementsByTagName: () => [] }, window: { location: { pathname: "/get-started" }, gtag: (...args: any[]) => calls.push(args), fbq: (...args: any[]) => pixels.push(args), dataLayer: [] } };
vm.runInNewContext(bundle.outputFiles[0].text, context);
const t = context.module.exports;
t.trackConversion("get_started_submission", undefined, "receipt-denied"); t.compatibilityConversion("get_started_submission", { receipt: "receipt-denied" });
check(!calls.some(c => c[0] === "event") && pixels.length === 0, "Default denied consent suppresses both conversion entry points");
t.applyConsentPreferences({ analytics: true, marketing: true });
t.trackFormSubmission("get_started_submission"); t.trackConversion("get_started_submission", 0, "receipt-one"); t.compatibilityConversion("get_started_submission", { receipt: "receipt-one", email: "never-export@example.test" });
check(calls.filter(c => c[0] === "event" && c[1] === "generate_lead").length === 1, "One accepted receipt produces exactly one GA4 lead across compatibility callers");
check(calls.filter(c => c[0] === "event" && c[1] === "conversion").length === 1 && calls.find(c => c[1] === "conversion")[2].send_to === "AW-123456/fixture_label", "Ads conversion uses its explicit destination, never a GA4 measurement ID");
check(pixels.filter(c => c[0] === "track" && c[1] === "Lead").length === 1, "Form diagnostics and compatibility adapter cannot double-count Meta Lead");
check(!JSON.stringify([...calls, ...pixels]).includes("never-export"), "Arbitrary form values do not leak to conversion payloads");
t.trackConversion("support_request", undefined, "support-receipt");
check(calls.filter(c => c[0] === "event" && c[1] === "generate_lead").length === 1 && pixels.filter(c => c[1] === "Lead").length === 1, "Support requests are not paid-acquisition leads");
t.trackEstimateRequest(); t.trackStatementUploadCompleted(); t.trackQuizComplete(); t.trackMerchantApplication();
check(pixels.filter(c => c[0] === "track" && c[1] === "Lead").length === 1, "Form-specific diagnostics never add a second advertising Lead");
const previousEvents = calls.filter(c => c[0] === "event").length, previousPixels = pixels.length;
t.applyConsentPreferences({ analytics: false, marketing: false });
t.trackConversion("get_started_submission", undefined, "receipt-two"); t.compatibilityConversion("get_started_submission", { receipt: "receipt-two" });
check(calls.filter(c => c[0] === "event").length === previousEvents && pixels.length === previousPixels, "Revocation immediately suppresses both conversion entry points");
t.applyConsentPreferences({ analytics: true, marketing: false });
t.trackConversion("get_started_submission", undefined, "receipt-three");
check(calls.filter(c => c[0] === "event" && c[1] === "generate_lead").length === 2 && pixels.length === previousPixels, "Analytics-only consent does not emit ad events");
check(scripts.some(s => String(s.src).includes("G-FIXTURE123")), "Compiled client initializes the configured GA4 tag");
console.log(`LAUNCH_READINESS_CONTRACTS_PASS ${checks}`);
