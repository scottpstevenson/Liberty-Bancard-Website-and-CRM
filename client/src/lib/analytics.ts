import { getStoredUTMParams } from "@/lib/utm";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    fbq?: (...args: any[]) => void;
    dataLayer?: any[];
  }
}

export interface ConversionParams {
  value?: number;
  currency?: string;
  [key: string]: unknown;
}

/**
 * Centralized conversion-event helper. Fires a GA4 `generate_lead` event with
 * the form name and any captured UTM parameters from sessionStorage. Also
 * forwards to the legacy GA `conversion` event and Facebook Pixel `Lead` for
 * back-compat with existing GA goals.
 */
export function trackConversion(name: string, params: ConversionParams = {}): void {
  const utm = getStoredUTMParams();
  const value = typeof params.value === "number" ? params.value : 0;
  const currency = (params.currency as string) || "USD";

  const payload: Record<string, unknown> = {
    form_name: name,
    event_label: name,
    event_category: "conversion",
    value,
    currency,
    utm_source: utm.utmSource,
    utm_medium: utm.utmMedium,
    utm_campaign: utm.utmCampaign,
    utm_content: utm.utmContent,
    utm_term: utm.utmTerm,
    landing_page: utm.landingPage,
    ...params,
  };

  // Strip undefined values so GA4 DebugView doesn't show empty params
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  try {
    if (typeof window !== "undefined" && window.gtag) {
      window.gtag("event", "generate_lead", payload);
      // Back-compat: also fire the legacy "conversion" event used by older GA goals
      window.gtag("event", "conversion", payload);
    }
  } catch {}

  try {
    if (typeof window !== "undefined" && window.fbq) {
      window.fbq("track", "Lead", {
        content_name: name,
        value,
        currency,
      });
    }
  } catch {}
}
