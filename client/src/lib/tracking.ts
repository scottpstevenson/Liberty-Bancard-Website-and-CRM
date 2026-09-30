declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    fbq?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const runtimeEnv = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env;
const GA_ID = (viteEnv?.VITE_GA4_MEASUREMENT_ID || viteEnv?.VITE_GA_ID || runtimeEnv?.VITE_GA4_MEASUREMENT_ID || runtimeEnv?.VITE_GA_ID) as string | undefined;
const FB_PIXEL_ID = (viteEnv?.VITE_FB_PIXEL_ID || runtimeEnv?.VITE_FB_PIXEL_ID) as string | undefined;

export type TrackingConsentPreferences = { analytics: boolean; marketing: boolean };
export type CookieConsentPreferences = TrackingConsentPreferences & {
  necessary: boolean;
  functional: boolean;
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
  if (!GA_ID || gaScriptInjected || typeof document === "undefined") return;
  gaScriptInjected = true;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);
}

function configureGaIfAllowed() {
  if (!GA_ID || !analyticsConsent || gaConfigured || typeof window === "undefined") return;
  ensureGtag();
  window.gtag!("config", GA_ID, { send_page_view: false });
  gaConfigured = true;
}

function loadAndInitializeMetaPixel() {
  if (!FB_PIXEL_ID || !marketingConsent || metaInitialized || typeof window === "undefined" || typeof document === "undefined") return;
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
  f.fbq!("init", FB_PIXEL_ID);
  f.fbq!("track", "PageView");
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
  if (GA_ID) {
    window.gtag!("js", new Date());
    loadGaScript();
  }
}

initTracking();

export function getStoredCookieConsent(): { level: string | null; preferences: CookieConsentPreferences } {
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
      };
    }
  } catch {
    // Storage may be unavailable (for example, in a privacy-restricted browser).
  }
  return { level, preferences };
}

export function saveCookieConsent(level: string, preferences: CookieConsentPreferences): void {
  try {
    localStorage.setItem(CONSENT_KEY, level);
    localStorage.setItem(CONSENT_PREFS_KEY, JSON.stringify(preferences));
  } catch {
    // Consent is still applied for this page even if persistence is unavailable.
  }
  applyConsentPreferences(preferences);
}

export function applyConsentPreferences(preferences: TrackingConsentPreferences): void {
  analyticsConsent = preferences.analytics;
  marketingConsent = preferences.marketing;
  ensureGtag();
  if (typeof window !== "undefined") {
    window.gtag!("consent", "update", {
      analytics_storage: preferences.analytics ? "granted" : "denied",
      ad_storage: preferences.marketing ? "granted" : "denied",
      ad_user_data: preferences.marketing ? "granted" : "denied",
      ad_personalization: preferences.marketing ? "granted" : "denied",
    });
  }
  configureGaIfAllowed();
  loadAndInitializeMetaPixel();
}

function gtagEvent(...args: any[]) {
  if (analyticsConsent && typeof window !== "undefined" && window.gtag) {
    window.gtag(...args);
  }
}

function fbqEvent(...args: any[]) {
  if (marketingConsent && metaInitialized && typeof window !== "undefined" && window.fbq) {
    window.fbq(...args);
  }
}

export function trackPageView(path?: string) {
  const pagePath = path || window.location.pathname;
  if (GA_ID && analyticsConsent) {
    gtagEvent("config", GA_ID, { page_path: pagePath });
  }
  if (FB_PIXEL_ID && marketingConsent) {
    fbqEvent("track", "PageView");
  }
}

export function trackConversion(type: string, value?: number) {
  if (GA_ID && analyticsConsent) {
    gtagEvent("event", "conversion", {
      send_to: GA_ID,
      event_category: "conversion",
      event_label: type,
      value: value || 0,
    });
  }
  if (FB_PIXEL_ID && marketingConsent) {
    fbqEvent("track", "Lead", {
      content_name: type,
      value: value || 0,
      currency: "USD",
    });
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
    fbqEvent("track", "CompleteRegistration", {
      content_name: "free_analysis_quiz",
    });
  }
}

export function trackFormSubmission(formName: string, value?: number) {
  if (GA_ID) {
    gtagEvent("event", "form_submission", {
      event_category: "conversion",
      event_label: formName,
      value: value || 0,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("track", "Lead", {
      content_name: formName,
      value: value || 0,
      currency: "USD",
    });
  }
}

export function trackCalendarBooking(source?: string) {
  const label = source ? `calendar_booking_${source}` : "calendar_booking";
  if (GA_ID) {
    gtagEvent("event", "calendar_booking", {
      event_category: "conversion",
      event_label: label,
      source: source || "unknown",
      page_path: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("track", "Schedule", {
      content_name: label,
      source: source || "unknown",
    });
  }
}

export function trackStatementUpload() {
  if (GA_ID) {
    gtagEvent("event", "statement_upload", {
      event_category: "conversion",
      event_label: "statement_upload",
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("track", "Lead", {
      content_name: "statement_upload",
    });
  }
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
    gtagEvent("event", "phone_cta_click", {
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
    fbqEvent("track", "CompleteRegistration", {
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
    fbqEvent("track", "Lead", {
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
    fbqEvent("track", "Lead", {
      content_name: "statement_upload_completed",
      page: params?.page,
    });
  }
}

export function trackSavingsCalculatorCompleted(params: {
  estimatedSavingsRange: string;
  monthlyVolumeRange: string;
  vertical?: string;
}) {
  if (GA_ID) {
    gtagEvent("event", "savings_calculator_completed", {
      event_category: "engagement",
      event_label: "savings_calculator_completed",
      estimated_savings_range: params.estimatedSavingsRange,
      monthly_volume_range: params.monthlyVolumeRange,
      vertical: params.vertical,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("trackCustom", "SavingsCalculatorCompleted", {
      estimated_savings_range: params.estimatedSavingsRange,
      monthly_volume_range: params.monthlyVolumeRange,
      vertical: params.vertical,
    });
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
