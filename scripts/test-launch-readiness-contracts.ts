import { libertyProductionTracking, LIBERTY_TRACKING } from "../shared/liberty-tracking-config";
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
check(libertyProductionTracking({}).VITE_GOOGLE_TAG_ID === LIBERTY_TRACKING.VITE_GOOGLE_TAG_ID, "The Liberty measurement destination uses its serving tag ID");
check(libertyProductionTracking({ VITE_GA4_MEASUREMENT_ID: "G-OTHER123" }).VITE_GOOGLE_TAG_ID === "G-OTHER123", "Changing the destination does not inherit Liberty's serving tag");
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
const bundle = await build({ stdin: { contents: 'export * from "./client/src/lib/tracking"; export * from "./client/src/lib/utm"; export { trackConversion as compatibilityConversion } from "./client/src/lib/analytics";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "cjs", define: { "import.meta.env": JSON.stringify({ VITE_GA4_MEASUREMENT_ID: "G-FIXTURE123", VITE_GOOGLE_TAG_ID: "G-LOADER123", VITE_FB_PIXEL_ID: "123456789", VITE_GOOGLE_ADS_LEAD_CONVERSION: "AW-123456/fixture_label" }) } });
const calls: any[][] = [], pixels: any[][] = [], scripts: any[] = [];
const context: any = { URL, URLSearchParams, module: { exports: {} }, exports: {}, console, document: { head: { appendChild: (v: any) => scripts.push(v) }, createElement: () => ({}), getElementsByTagName: () => [] }, window: { location: { pathname: "/get-started" }, gtag: (...args: any[]) => calls.push(args), fbq: (...args: any[]) => pixels.push(args), dataLayer: [] } };
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
const pixelEvents = () => pixels.filter(c => c[0] !== "consent").length;
const previousEvents = calls.filter(c => c[0] === "event").length, previousPixels = pixelEvents();
t.applyConsentPreferences({ analytics: false, marketing: false });
t.trackConversion("get_started_submission", undefined, "receipt-two"); t.compatibilityConversion("get_started_submission", { receipt: "receipt-two" });
check(calls.filter(c => c[0] === "event").length === previousEvents && pixelEvents() === previousPixels, "Revocation immediately suppresses both conversion entry points");
t.applyConsentPreferences({ analytics: true, marketing: false });
t.trackConversion("get_started_submission", undefined, "receipt-three");
check(calls.filter(c => c[0] === "event" && c[1] === "generate_lead").length === 2 && pixelEvents() === previousPixels, "Analytics-only consent does not emit ad events");
check(scripts.some(s => String(s.src).endsWith("/gtag/js?id=G-LOADER123")) && !scripts.some(s => String(s.src).endsWith("/gtag/js?id=G-FIXTURE123")), "Compiled client loads the serving tag without requesting a script for the destination");
console.log(`LAUNCH_READINESS_CONTRACTS_PASS ${checks}`);

// Route/consent acceptance uses the compiled production owner, without vendor network access.
{
  const vendor: any[][] = [], meta: any[][] = [], loaded: any[] = [];
  const storage = new Map<string, string>();
  const store = { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) };
  const browser: any = { URL, URLSearchParams, crypto: globalThis.crypto, console, module: { exports: {} }, exports: {}, localStorage: store, sessionStorage: store,
    window: { location: { pathname: '/upload-statement', origin: 'https://libertybancard.com', hostname: 'libertybancard.com', search: '?utm_source=google&utm_campaign=statement-review&email=private@example.test&token=secret#x' }, gtag: (...v: any[]) => vendor.push(v), fbq: (...v: any[]) => meta.push(v), dataLayer: [] },
    document: { cookie: '', referrer: 'https://www.google.com/search?q=private@example.test', head: { appendChild: (v: any) => loaded.push(v) }, createElement: () => ({}), getElementsByTagName: () => [] } };
  vm.runInNewContext(bundle.outputFiles[0].text, browser);
  const api = browser.module.exports;
  check(loaded.length === 0, 'Default denied loads no third-party script');
  api.trackPageView('/upload-statement');
  check(!vendor.some(v => v[0] === 'event'), 'Denied initial route records no page view');
  api.applyConsentPreferences({ analytics: true, marketing: false });
  check(loaded.length === 1 && vendor.filter(v => v[1] === 'page_view').length === 1, 'Consent grant initializes one loader and one current-page view');
  check(vendor.some(v => v[0] === 'config' && v[1] === 'G-LOADER123' && v[2].send_page_view === false)
    && !vendor.some(v => v[0] === 'config' && v[1] === 'G-FIXTURE123')
    && browser.window['ga-disable-G-LOADER123'] === true, 'Only the serving tag is configured, with its separate GA stream disabled');
  check(vendor.find(v => v[1] === 'page_view')[2].send_to === 'G-FIXTURE123', 'The manual page view targets only the approved measurement destination');
  api.trackPageView('/upload-statement'); api.trackPageView('/upload-statement');
  check(vendor.filter(v => v[1] === 'page_view').length === 1, 'Repeated router renders never duplicate a page view');
  let payload = vendor.find(v => v[1] === 'page_view')[2];
  check(payload.page_location === 'https://libertybancard.com/upload-statement?utm_source=google&utm_campaign=statement-review', 'Page location retains allowed attribution and strips private query/hash');
  check(payload.page_referrer === 'https://www.google.com/', 'Referrer retains acquisition origin without search text or PII');
  browser.window.location.pathname = '/about-contact'; browser.window.location.search = '';
  api.trackPageView('/about-contact');
  browser.window.location.pathname = '/upload-statement'; api.trackPageView('/upload-statement');
  check(vendor.filter(v => v[1] === 'page_view').length === 3, 'Navigate and back produce one view each');
  browser.window.location.pathname = '/industries/auto-repair-payment-processing'; api.trackPageView();
  browser.window.location.pathname = '/industries/retail-payment-processing'; api.trackPageView();
  check(vendor.filter(v => v[1] === 'page_view').length === 5 && vendor.at(-1)[2].page_path === '/industries/retail-payment-processing', 'Known public landing pages retain separate approved URLs and page views');

  const beforePrivate = vendor.filter(v => v[0] === 'event').length;
  browser.window.location.pathname = '/dashboard/contacts/42';
  api.trackPageView('/dashboard/contacts/42'); api.trackConversion('get_started_submission', undefined, 'private-receipt'); api.trackBookingCtaClick({ ctaLocation: 'private' });
  check(vendor.filter(v => v[0] === 'event').length === beforePrivate && browser.window['ga-disable-G-FIXTURE123'] === true, 'Private CRM route disables collection and suppresses every public event owner');
  check(!JSON.stringify(vendor).includes('/dashboard/contacts') && !JSON.stringify(vendor).includes('private@example.test'), 'No private path or visitor contact value reaches vendor commands');
  browser.window.location.pathname = '/upload-statement'; api.trackPageView();
  api.applyConsentPreferences({ analytics: true, marketing: true });
  const beforeLead = vendor.filter(v => v[1] === 'generate_lead').length;
  api.trackConversion('statement_upload', 9999, 'saved-receipt'); api.compatibilityConversion('statement_upload', { receipt: 'saved-receipt' });
  check(vendor.filter(v => v[1] === 'generate_lead').length === beforeLead + 1, 'One saved statement receipt yields one lead across both callers');
  check(vendor.filter(v => v[1] === 'generate_lead' || v[1] === 'conversion').every(v => !('value' in v[2]) && !('currency' in v[2])), 'Lead and advertising conversions carry no invented revenue');
  api.trackCalendarBooking('footer');
  check(vendor.some(v => v[1] === 'booking_cta_click') && !vendor.some(v => v[1] === 'appointment_booked' || v[1] === 'calendar_booking') && !meta.some(v => v[1] === 'Schedule'), 'Opening scheduler records intent, never a confirmed appointment');
  browser.window.location.search = '?utm_source=google&utm_campaign=review&gclid=test-click-123&email=never-store@example.test';
  api.saveCookieConsent('custom', { necessary: true, functional: false, analytics: true, marketing: true });
  api.captureUTMParams();
  let attribution = api.getStoredUTMParams();
  check(attribution.gclid === 'test-click-123' && attribution.utmCampaign === 'review' && attribution.landingPage === '/upload-statement', 'Consented auto-tagged arrival retains click ID, campaign and sanitized landing path');
  check(!JSON.stringify([...storage.values()]).includes('never-store'), 'Attribution storage never retains arbitrary query fields');
  check(!api.getStoredUTMParams().adsMeasurementConsent, 'An existing marketing preference never silently grants offline CRM sharing');
  api.saveCookieConsent('custom', { necessary: true, functional: false, analytics: true, marketing: true, adsMeasurement: true });
  const offlineAttribution=api.getStoredUTMParams();
  check(offlineAttribution.adsMeasurementConsent===true && offlineAttribution.adsMeasurementVersion==='ads-measurement-v1' && /^[a-f0-9]{64}$/.test(offlineAttribution.adsMeasurementKey), 'Explicit offline measurement choice supplies a separate versioned consent and unguessable revocation capability');
  api.saveCookieConsent('custom', { necessary: true, functional: false, analytics: true, marketing: true, adsMeasurement: false });
  check(!api.getStoredUTMParams().adsMeasurementConsent && !storage.has('lb_ads_measurement_key'), 'Offline measurement withdrawal stops new sharing while preserving independent analytics preferences');
  api.saveCookieConsent('custom', { necessary:true,functional:false,analytics:true,marketing:true,adsMeasurement:true });
  const nextMeasurementKey=api.getStoredUTMParams().adsMeasurementKey;
  api.saveCookieConsent('custom', { necessary:true,functional:false,analytics:true,marketing:true,adsMeasurement:false });
  check(nextMeasurementKey!==offlineAttribution.adsMeasurementKey && JSON.parse(storage.get('lb_ads_measurement_revoke')??'[]').includes(offlineAttribution.adsMeasurementKey) && JSON.parse(storage.get('lb_ads_measurement_revoke')??'[]').includes(nextMeasurementKey), 'Rapid consent changes retain every outstanding revocation and issue a fresh capability for a new grant');
  check(!JSON.stringify(vendor).includes(nextMeasurementKey) && !JSON.stringify(meta).includes(nextMeasurementKey), 'First-party revocation capabilities never enter vendor commands');


  browser.window.location.search = '?utm_source=meta&utm_campaign=retargeting';
  api.captureUTMParams();
  check(api.getFirstTouchUTMParams().utmSource === 'google' && api.getStoredUTMParams().utmSource === 'meta', 'First and latest campaign touches stay distinct');
  api.saveCookieConsent('custom', { necessary: true, functional: false, analytics: true, marketing: false });
  check(!api.getStoredUTMParams().gclid && !storage.has('lb_click_ids'), 'Advertising withdrawal removes retained advertising click IDs');
  browser.window.location.search = '?utm_source=private@example.test&utm_campaign=1234567890';
  api.clearUTMParams(); api.captureUTMParams();
  check(!api.getStoredUTMParams().utmSource && !api.getStoredUTMParams().utmCampaign, 'Email-like and phone-like campaign labels cannot enter attribution');
  browser.window.location.search = '?utm_source=google&utm_medium=cpc&utm_campaign=gads_123456789012&utm_content=ad_987654321012';
  api.captureUTMParams();
  check(api.getStoredUTMParams().utmCampaign === 'gads_123456789012' && api.getStoredUTMParams().utmContent === 'ad_987654321012', 'Google ValueTrack campaign and creative identifiers survive attribution validation');
  api.saveCookieConsent('essential', { necessary: true, functional: false, analytics: false, marketing: false });
  check(Object.keys(api.getStoredUTMParams()).length === 0, 'Rejecting measurement clears campaign persistence');
  api.applyConsentPreferences({ analytics: false, marketing: false });
  const revoked = vendor.filter(v => v[0] === 'event').length;
  api.trackPageView(); api.trackConversion('statement_upload', undefined, 'revoked'); api.trackFormAbandoned('upload_statement');
  check(vendor.filter(v => v[0] === 'event').length === revoked, 'Withdrawal immediately suppresses views, conversions and abandonment diagnostics');
  check(vendor.filter(v => v[0] === 'consent').every(v => v[2].ad_user_data === 'denied' && v[2].ad_personalization === 'denied'), 'No measurement preference enables contact-data uploading or personalization');
}
console.log(`MEASUREMENT_ROUTE_ACCEPTANCE_PASS total=${checks}`);
