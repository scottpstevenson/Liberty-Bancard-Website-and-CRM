declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    fbq?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

const GA_ID = (import.meta.env.VITE_GA4_MEASUREMENT_ID || import.meta.env.VITE_GA_ID) as string | undefined;
const FB_PIXEL_ID = import.meta.env.VITE_FB_PIXEL_ID as string | undefined;

let initialized = false;

function initTracking() {
  if (initialized) return;
  initialized = true;

  if (GA_ID) {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(script);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer!.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID, { send_page_view: false });
  }

  if (FB_PIXEL_ID) {
    const f = window as any;
    if (!f.fbq) {
      const n: any = (f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      });
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = true;
      n.version = "2.0";
      n.queue = [] as any[];
      const t = document.createElement("script");
      t.async = true;
      t.src = "https://connect.facebook.net/en_US/fbevents.js";
      const s = document.getElementsByTagName("script")[0];
      s.parentNode!.insertBefore(t, s);
    }
    window.fbq!("init", FB_PIXEL_ID);
  }
}

initTracking();

function gtagEvent(...args: any[]) {
  if (window.gtag) {
    window.gtag(...args);
  }
}

function fbqEvent(...args: any[]) {
  if (window.fbq) {
    window.fbq(...args);
  }
}

export function trackPageView(path?: string) {
  const pagePath = path || window.location.pathname;
  if (GA_ID) {
    gtagEvent("config", GA_ID, { page_path: pagePath });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("track", "PageView");
  }
}

export function trackConversion(type: string, value?: number) {
  if (GA_ID) {
    gtagEvent("event", "conversion", {
      send_to: GA_ID,
      event_category: "conversion",
      event_label: type,
      value: value || 0,
    });
  }
  if (FB_PIXEL_ID) {
    fbqEvent("track", "Lead", {
      content_name: type,
      value: value || 0,
      currency: "USD",
    });
  }
}

export function trackQuizStart() {
  if (GA_ID) {
    gtagEvent("event", "quiz_start", {
      event_category: "engagement",
      event_label: "free_analysis_quiz",
    });
  }
  if (FB_PIXEL_ID) {
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
