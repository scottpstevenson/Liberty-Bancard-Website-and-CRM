import { revokeAdsMeasurement, retryAdsMeasurementRevocation } from "./ads-measurement-consent";
import { publicTrackingContext, safeReferrer, safeCampaignValue } from "./tracking-context";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    fbq?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

// Direct properties are required for Vite build-time replacement. The process fallback is for isolated Node tests only.
const runtimeEnv = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env;
const GA_ID = typeof import.meta.env !== "undefined"
  ? import.meta.env.VITE_GA4_MEASUREMENT_ID || import.meta.env.VITE_GA_ID
  : runtimeEnv?.VITE_GA4_MEASUREMENT_ID || runtimeEnv?.VITE_GA_ID;
const configuredGoogleTag = typeof import.meta.env !== "undefined"
  ? import.meta.env.VITE_GOOGLE_TAG_ID
  : runtimeEnv?.VITE_GOOGLE_TAG_ID;
const GOOGLE_TAG_ID = configuredGoogleTag && /^(?:G|GT)-[A-Z0-9]+$/.test(configuredGoogleTag)
  ? configuredGoogleTag
  : GA_ID;
const FB_PIXEL_ID = typeof import.meta.env !== "undefined" ? import.meta.env.VITE_FB_PIXEL_ID : runtimeEnv?.VITE_FB_PIXEL_ID;
const ADS_DESTINATION = typeof import.meta.env !== "undefined" ? import.meta.env.VITE_GOOGLE_ADS_LEAD_CONVERSION : runtimeEnv?.VITE_GOOGLE_ADS_LEAD_CONVERSION;

export type TrackingConsentPreferences = { analytics: boolean; marketing: boolean };
export type CookieConsentPreferences = TrackingConsentPreferences & {
  necessary: boolean;
  functional: boolean;
  adsMeasurement?: boolean;
};

const CONSENT_KEY = "lb_cookie_consent";
const CONSENT_PREFS_KEY = "lb_cookie_prefs";
const DEFAULT_COOKIE_PREFERENCES: CookieConsentPreferences = {
  necessary: true,
  analytics: false,
  marketing: false,
  functional: false,
};

let initialized = false;
let analyticsConsent = false;
let marketingConsent = false;
let gaScriptInjected = false;
let gaConfigured = false;
let metaScriptInjected = false;
let metaInitialized = false;
let adsConfigured = false;
let lastAnalyticsView = "";
let lastMarketingView = "";
let previousPublicLocation = "";
function currentContext() {
  // The verified production destinations must never receive local/dev acceptance traffic.
  if (typeof window !== "undefined" && ["G-L2VK5474GD", "AW-17130296245/cKygCOvUjbwdELWnrug_"].some(id => id === GA_ID || id === ADS_DESTINATION)
    && !["libertybancard.com", "www.libertybancard.com"].includes(window.location.hostname)) return null;
  return typeof window === "undefined" ? null : publicTrackingContext(window.location.pathname, window.location.search, window.location.origin);
}
function metaContextAllowed() {
  if (!currentContext()) return false;
  // Meta reads document URLs itself. Suppress the pixel on token-bearing or arbitrary query routes.
  const params = new URLSearchParams(window.location.search);
  return [...params].every(([key, value]) =>
    (/^utm_(source|medium|campaign|content|term)$/.test(key) && !!safeCampaignValue(value)) ||
    (/^(gclid|fbclid|msclkid)$/.test(key) && /^[a-zA-Z0-9_-]{1,500}$/.test(value)) ||
    (/^(terminal|interest0)$/.test(key) && value === "yes")) &&
    !/@|%40|(?:email|phone|token|secret)=/i.test(document.referrer || "");
}
function cleanProperties(input: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = {};
  const allowed = new Set(["event_category", "event_label", "form_id", "form_name", "audience", "journey_stage", "outcome", "source", "path", "profession", "source_page", "calculator_path", "step", "step_name", "quiz_step_number", "quiz_step_name", "cta_location", "ctaLocation", "ctaLabel", "offer", "competitor", "industry", "city", "content_name", "error_message"]);
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 100) out[key] = value;
    if (typeof value === "string" && /^[a-zA-Z0-9_ /.,'’?!&()-]{1,120}$/.test(value) && !/\d{7,}/.test(value)) out[key] = value;
  }
  return out;
}
function clearTrackingCookies(analytics: boolean, marketing: boolean) {
  if (typeof document === "undefined" || typeof document.cookie !== "string") return;
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0].trim();
    if (!(analytics && /^_ga(?:_|$)|^_gid$|^_gat/.test(name)) && !(marketing && /^_gcl_|^_fbp$|^_fbc$/.test(name))) continue;
    const host = window.location.hostname;
    for (const domain of ["", host, "." + host, ".libertybancard.com"]) document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ""}`;
  }
}

function ensureGtag() {
  if (typeof window === "undefined") return;
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    window.gtag = function () {
      window.dataLayer!.push(arguments);
    };
  }
}

function loadGaScript() {
  const tagId = (GA_ID && GOOGLE_TAG_ID) || (marketingConsent && /^AW-\d+\/[A-Za-z0-9_-]+$/.test(ADS_DESTINATION ?? "") ? ADS_DESTINATION!.split("/")[0] : undefined);
  if (!currentContext() || (!analyticsConsent && !marketingConsent) || !tagId || gaScriptInjected || typeof document === "undefined") return;
  gaScriptInjected = true;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${tagId}`;
  document.head.appendChild(script);
}

function configureGaIfAllowed() {
  if (!currentContext() || !GA_ID || !analyticsConsent || gaConfigured || typeof window === "undefined") return;
  ensureGtag();
  // Configure the serving tag once. Explicit send_to still routes events to the approved stream.
  window.gtag!("config", GOOGLE_TAG_ID ?? GA_ID, { send_page_view: false, ...currentContext(), page_referrer: safeReferrer(document.referrer || ""), allow_google_signals: false, allow_ad_personalization_signals: false });
  gaConfigured = true;
}

function loadAndInitializeMetaPixel() {
  if (!metaContextAllowed() || !FB_PIXEL_ID || !marketingConsent || metaInitialized || typeof window === "undefined" || typeof document === "undefined") return;
  const f = window as Window & { _fbq?: (...args: any[]) => void };
  if (!f.fbq) {
    const n: any = (f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    });
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    n.queue = [] as any[];
  }
  if (!metaScriptInjected) {
    metaScriptInjected = true;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    const firstScript = document.getElementsByTagName("script")[0];
    if (firstScript?.parentNode) firstScript.parentNode.insertBefore(script, firstScript);
    else document.head.appendChild(script);
  }
  f.fbq!("set", "autoConfig", false, FB_PIXEL_ID);
  f.fbq!("init", FB_PIXEL_ID);
  metaInitialized = true;
}

function initTracking() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  // Consent Mode's default signal must be queued before any tag loads/configures.
  ensureGtag();
  window.gtag!("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  // Basic consent mode: no vendor script or configuration before an affirmative preference.
  window.gtag!("js", new Date());
}

initTracking();

export function getStoredCookieConsent(): { level: string | null; preferences: CookieConsentPreferences } {
  retryAdsMeasurementRevocation();
  let level: string | null = null;
  let preferences = DEFAULT_COOKIE_PREFERENCES;
  try {
    level = localStorage.getItem(CONSENT_KEY);
    const raw = localStorage.getItem(CONSENT_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<CookieConsentPreferences>;
      preferences = {
        necessary: true,
        analytics: parsed.analytics === true,
        marketing: parsed.marketing === true,
        functional: parsed.functional === true,
        adsMeasurement: typeof parsed.adsMeasurement === "boolean" ? parsed.adsMeasurement : undefined,
      };
    }
  } catch {
    // Storage may be unavailable (for example, in a privacy-restricted browser).
  }
  return { level, preferences };
}

export function saveCookieConsent(level: string, preferences: CookieConsentPreferences): void {
  if(!preferences.marketing || !preferences.adsMeasurement)revokeAdsMeasurement();
  else retryAdsMeasurementRevocation();
  try {
    localStorage.setItem(CONSENT_KEY, level);
    localStorage.setItem(CONSENT_PREFS_KEY, JSON.stringify({ ...preferences, adsMeasurement: preferences.adsMeasurement === true }));
  } catch {
    // Consent is still applied for this page even if persistence is unavailable.
  }
  applyConsentPreferences(preferences);
}

export function applyConsentPreferences(preferences: TrackingConsentPreferences): void {
  const revokedAnalytics = analyticsConsent && !preferences.analytics;
  const revokedMarketing = marketingConsent && !preferences.marketing;
  analyticsConsent = preferences.analytics === true;
  marketingConsent = preferences.marketing === true;
  const active = !!currentContext();
  ensureGtag();
  if (typeof window !== "undefined") {
    if (GA_ID) (window as any)[`ga-disable-${GA_ID}`] = !active || !analyticsConsent;
    // The serving tag ID can also name a separate GA4 stream. Only the selected stream may collect.
    if (GA_ID && GOOGLE_TAG_ID && GOOGLE_TAG_ID !== GA_ID) (window as any)[`ga-disable-${GOOGLE_TAG_ID}`] = true;
    window.gtag!("consent", "update", {
      analytics_storage: active && analyticsConsent ? "granted" : "denied",
      ad_storage: active && marketingConsent ? "granted" : "denied",
      // Measurement does not require personalization or uploading visitor-provided contact data.
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    if (metaInitialized) window.fbq?.("consent", active && marketingConsent && metaContextAllowed() ? "grant" : "revoke");
  }
  clearTrackingCookies(revokedAnalytics, revokedMarketing);
  if (!analyticsConsent) lastAnalyticsView = "";
  if (!marketingConsent) lastMarketingView = "";
  if (active && (analyticsConsent || marketingConsent)) loadGaScript();
  configureGaIfAllowed();
  if (active && marketingConsent && /^AW-\d+\/[A-Za-z0-9_-]+$/.test(ADS_DESTINATION ?? "")) {
    if (!adsConfigured && typeof window !== "undefined") {
      window.gtag?.("config", ADS_DESTINATION!.split("/")[0], { send_page_view: false, ...currentContext(), page_referrer: safeReferrer(document.referrer || ""), allow_ad_personalization_signals: false });
      adsConfigured = true;
    }
  }
  loadAndInitializeMetaPixel();
  emitPageView();
  if (typeof window !== "undefined" && typeof CustomEvent !== "undefined") window.dispatchEvent?.(new CustomEvent("lb:consent-changed"));
}

function emitPageView() {
  const context = currentContext();
  if (!context) { lastAnalyticsView = ""; lastMarketingView = ""; return; }
  const key = context.page_location;
  if (GA_ID && analyticsConsent && lastAnalyticsView !== key) {
    window.gtag?.("set", { ...context, page_referrer: previousPublicLocation || safeReferrer(document.referrer || "") });
    window.gtag?.("event", "page_view", { send_to: GA_ID, ...context, page_referrer: previousPublicLocation || safeReferrer(document.referrer || "") });
    lastAnalyticsView = key;
  }
  if (FB_PIXEL_ID && marketingConsent && metaInitialized && lastMarketingView !== key) {
    fbqEvent("track", "PageView");
    lastMarketingView = key;
  }
  if ((GA_ID && analyticsConsent) || (FB_PIXEL_ID && marketingConsent)) previousPublicLocation = context.page_location;
}

function gtagEvent(...args: any[]) {
  const context = currentContext();
  if (analyticsConsent && context && typeof window !== "undefined" && window.gtag) {
    window.gtag("event", args[1], { ...cleanProperties(args[2]), ...context, send_to: GA_ID });
  }
}

function fbqEvent(...args: any[]) {
  if (marketingConsent && metaContextAllowed() && metaInitialized && typeof window !== "undefined" && window.fbq) {
    window.fbq(args[0], args[1], cleanProperties(args[2]));
  }
}

/** Router is the only page-view owner. Re-renders are idempotent; back/forward after another route emits a new view. */
export function trackPageView(_path?: string) {
  applyConsentPreferences({ analytics: analyticsConsent, marketing: marketingConsent });
}

/** One conversion owner. The receipt is used locally for replay suppression, never included in event payloads. */
const conversionOccurrences = new Set<string>();
const LEAD_FORMS = new Set(["general_inquiry_submission", "terminal_inquiry_submission", "get_started_submission", "free_analysis_quiz", "estimate_request", "statement_upload", "merchant_application"]);
export function trackConversion(type: string, value?: number, receipt?: string): void {
  if (typeof window === "undefined" || !currentContext() || (!analyticsConsent && !marketingConsent)) return;
  const occurrence = receipt ? `${type}:${receipt}` : null;
  if (occurrence && conversionOccurrences.has(occurrence)) return;
  if (occurrence) {
    conversionOccurrences.add(occurrence);
    // Intake already persists its once-per-receipt claim; this is a bounded second line of defense for callers.
    if (conversionOccurrences.size > 1000) conversionOccurrences.delete(conversionOccurrences.values().next().value!);
  }
  const isLead = LEAD_FORMS.has(type);
  if (GA_ID && analyticsConsent) gtagEvent("event", isLead ? "generate_lead" : "form_submission", {
    form_name: type, event_category: "conversion", journey_stage: "lead", outcome: "accepted",
  });
  // A GA4 G- measurement ID is not a Google Ads conversion destination.
  if (isLead && marketingConsent && /^AW-\d+\/[A-Za-z0-9_-]+$/.test(ADS_DESTINATION ?? "")) {
    ensureGtag();
    window.gtag?.("event", "conversion", { send_to: ADS_DESTINATION, ...currentContext(), page_referrer: safeReferrer(document.referrer || "") });
  }
  if (isLead && FB_PIXEL_ID && marketingConsent) fbqEvent("track", "Lead", { content_name: type });
}

export function hasAnalyticsConsent(): boolean { return analyticsConsent && !!currentContext(); }
export function hasMarketingConsent(): boolean { return marketingConsent && !!currentContext(); }

/**
 * Partner-program funnel events. Consent-gated like every other analytics event, sent to GA only (never the ad pixel),
 * and limited to an allowlist of event names and property keys with bounded plain values. No name, email, phone,
 * company, free text, merchant data, idempotency key or compensation figure is ever a property.
 */
export const PARTNER_ANALYTICS_EVENTS = ["partner_path_selected", "partner_application_started", "partner_application_submitted", "partner_calculator_used"] as const;
export type PartnerAnalyticsEvent = (typeof PARTNER_ANALYTICS_EVENTS)[number];
export const PARTNER_ANALYTICS_PROPS = ["path", "profession", "source_page", "calculator_path"] as const;
const PARTNER_PROP_VALUE = /^[a-z0-9_/\-]{1,60}$/;

export function partnerAnalyticsPayload(event: string, props: Record<string, unknown> = {}): { event: PartnerAnalyticsEvent; props: Record<string, string> } | null {
  if (!(PARTNER_ANALYTICS_EVENTS as readonly string[]).includes(event)) return null;
  const out: Record<string, string> = {};
  for (const key of PARTNER_ANALYTICS_PROPS) {
    const value = props[key];
    // A slug never carries many digits; a phone-like or id-like value is dropped even when it matches the slug shape.
    if (typeof value === "string" && PARTNER_PROP_VALUE.test(value) && (value.match(/\d/g) ?? []).length < 5) out[key] = value;
  }
  return { event: event as PartnerAnalyticsEvent, props: out };
}

export function trackPartnerEvent(event: PartnerAnalyticsEvent, props: Record<string, unknown> = {}) {
  const payload = partnerAnalyticsPayload(event, props);
  if (!payload) return;
  if (GA_ID && analyticsConsent) {
    gtagEvent("event", payload.event, { event_category: "partner_program", ...payload.props });
  }
}

export function trackQuizStart() {
  if (GA_ID && analyticsConsent) {
    gtagEvent("event", "quiz_start", {
      event_category: "engagement",
      event_label: "free_analysis_quiz",
    });
  }
  if (FB_PIXEL_ID && marketingConsent) {
    fbqEvent("trackCustom", "QuizStart");
  }
}

export function trackQuizStep(stepNumber: number, stepName: string) {
  if (GA_ID) {
    gtagEvent("event", "quiz_step", {
      event_category: "engagement",
      event_label: stepName,
      value: stepNumber,
      quiz_step_number: stepNumber,
      quiz_step_name: stepName,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "QuizStep", {
      step: stepNumber,
      step_name: stepName,
    });
  }
}

export function trackQuizComplete() {
  if (GA_ID) {
    gtagEvent("event", "quiz_complete", {
      event_category: "conversion",
      event_label: "free_analysis_quiz",
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "QuizCompleted", {
      content_name: "free_analysis_quiz",
    });
  }
}

export function trackFormSubmission(formName: string, value?: number) {
  if (GA_ID) gtagEvent("event", "form_submission", { event_category: "engagement", event_label: formName, value: value ?? 0 });
}

/** Compatibility name: callers open a scheduler; only its verified server webhook can establish a booking. */
export function trackCalendarBooking(source?: string) {
  trackBookingCtaClick({ ctaLocation: source });
}

export function trackStatementUpload() {
  trackStatementUploadCompleted();
}

export function trackStatementUploadStarted(params?: { page?: string; ctaLocation?: string }) {
  if (GA_ID) {
    gtagEvent("event", "statement_upload_started", {
      event_category: "engagement",
      event_label: "statement_upload_started",
      page: params?.page,
      cta_location: params?.ctaLocation,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "StatementUploadStarted", {
      page: params?.page,
      cta_location: params?.ctaLocation,
    });
  }
}

export function trackStatementUploadFailed(params?: { page?: string; errorMessage?: string }) {
  if (GA_ID) {
    gtagEvent("event", "statement_upload_failed", {
      event_category: "engagement",
      event_label: "statement_upload_failed",
      page: params?.page,
      error_message: params?.errorMessage,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "StatementUploadFailed", {
      page: params?.page,
      error_message: params?.errorMessage,
    });
  }
}

export interface CtaTrackParams {
  page?: string;
  ctaLabel?: string;
  ctaLocation?: string;
  offer?: string;
  competitor?: string;
  industry?: string;
  city?: string;
}

export function trackPhoneCtaClick(params?: CtaTrackParams) {
  if (GA_ID) {
    gtagEvent("event", "phone_click", {
      event_category: "engagement",
      event_label: "phone_cta_click",
      ...params,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "PhoneCtaClick", params);
  }
}

export function trackBookingCtaClick(params?: CtaTrackParams) {
  if (GA_ID) {
    gtagEvent("event", "booking_cta_click", {
      event_category: "conversion",
      event_label: "booking_cta_click",
      ...params,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "BookingCtaClick", params);
  }
}

export function trackStatementUploadCtaClick(params?: CtaTrackParams) {
  if (GA_ID) {
    gtagEvent("event", "statement_upload_cta_click", {
      event_category: "conversion",
      event_label: "statement_upload_cta_click",
      ...params,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "StatementUploadCtaClick", params);
  }
}

export function trackFreeTerminalEligibilityClick(params?: CtaTrackParams) {
  if (GA_ID) {
    gtagEvent("event", "free_terminal_eligibility_click", {
      event_category: "conversion",
      event_label: "free_terminal_eligibility_click",
      ...params,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "FreeTerminalEligibilityClick", params);
  }
}

export function trackCashDiscountReviewClick(params?: CtaTrackParams) {
  if (GA_ID) {
    gtagEvent("event", "cash_discount_review_click", {
      event_category: "conversion",
      event_label: "cash_discount_review_click",
      ...params,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "CashDiscountReviewClick", params);
  }
}

export function trackSurchargeReviewClick(params?: CtaTrackParams) {
  if (GA_ID) {
    gtagEvent("event", "surcharge_review_click", {
      event_category: "conversion",
      event_label: "surcharge_review_click",
      ...params,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "SurchargeReviewClick", params);
  }
}

export function trackEquipmentOrder(value?: number) {
  if (GA_ID) {
    gtagEvent("event", "purchase", {
      event_category: "conversion",
      event_label: "equipment_order",
      value: value || 0,
      currency: "USD",
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("track", "Purchase", {
      content_name: "equipment_order",
      value: value || 0,
      currency: "USD",
    });
  }
}

export function trackMerchantApplication() {
  if (GA_ID) {
    gtagEvent("event", "merchant_application", {
      event_category: "conversion",
      event_label: "merchant_application",
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "MerchantApplicationRecorded", {
      content_name: "merchant_application",
    });
  }
}

export function trackAffiliateSignup() {
  if (GA_ID) {
    gtagEvent("event", "affiliate_signup", {
      event_category: "conversion",
      event_label: "affiliate_signup",
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("track", "CompleteRegistration", {
      content_name: "affiliate_signup",
    });
  }
}

export function trackEstimateRequest() {
  if (GA_ID) {
    gtagEvent("event", "estimate_request", {
      event_category: "conversion",
      event_label: "estimate_request",
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "EstimateRequestRecorded", {
      content_name: "estimate_request",
    });
  }
}

export function trackPewcConsentGiven(formType: string) {
  if (GA_ID) {
    gtagEvent("event", "pewc_consent_given", {
      event_category: "consent",
      event_label: formType,
    });
  }
}

export function trackPewcConsentDeclined(formType: string) {
  if (GA_ID) {
    gtagEvent("event", "pewc_consent_declined", {
      event_category: "consent",
      event_label: formType,
    });
  }
}

export function trackFormViewWithConsent(formType: string) {
  if (GA_ID) {
    gtagEvent("event", "form_view_with_consent", {
      event_category: "consent",
      event_label: formType,
    });
  }
}

export function trackConsentFieldInteraction(formType: string) {
  if (GA_ID) {
    gtagEvent("event", "consent_field_interaction", {
      event_category: "consent",
      event_label: formType,
    });
  }
}

export function trackStatementUploadCompleted(params?: { page?: string; ctaLocation?: string }) {
  if (GA_ID) {
    gtagEvent("event", "statement_upload_completed", {
      event_category: "conversion",
      event_label: "statement_upload_completed",
      page: params?.page,
      cta_location: params?.ctaLocation,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "StatementUploadCompleted", {
      content_name: "statement_upload_completed",
      page: params?.page,
    });
  }
}

/** Completion is recorded without any amount, volume, rate or industry. */
export function trackSavingsCalculatorCompleted() {
  if (GA_ID) {
    gtagEvent("event", "savings_calculator_completed", {
      event_category: "engagement",
      event_label: "savings_calculator_completed",
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "SavingsCalculatorCompleted", {});
  }
}

export function trackThankYouPageView(formId: string) {
  if (GA_ID) {
    gtagEvent("event", "thank_you_page_view", {
      event_category: "conversion",
      event_label: formId,
      form_id: formId,
      page_path: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "ThankYouPageView", { form_id: formId });
  }
}

/** No form values or private record paths; the shared sinks enforce consent and public-route scope. */
export function trackFormAbandoned(formId: string) {
  if (!/^[a-z0-9_-]{1,64}$/.test(formId)) return;
  if (GA_ID) gtagEvent("event", "form_abandoned", { form_id: formId, event_category: "engagement" });
  if (FB_PIXEL_ID) fbqEvent("trackCustom", "FormAbandoned", { form_id: formId });
}
