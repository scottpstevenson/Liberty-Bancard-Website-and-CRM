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
