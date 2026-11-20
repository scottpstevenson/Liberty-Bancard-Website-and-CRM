import { trackConversion as trackAcceptedConversion, hasAnalyticsConsent } from "@/lib/tracking";

/**
 * Fire a server-side phone_call_click analytics event.
 * Call this from onClick on any tel: anchor.
 */
export async function trackPhoneCallClick(params: {
  contactId?: number;
  dealId?: number;
  sourcePage?: string;
}): Promise<void> {
  if (!hasAnalyticsConsent()) return;
  try {
    const sessionId =
      typeof window !== "undefined"
        ? (window.sessionStorage?.getItem("sessionId") ?? undefined)
        : undefined;
    const visitorId =
      typeof window !== "undefined"
        ? (window.localStorage?.getItem("visitorId") ?? undefined)
        : undefined;
    await fetch("/api/analytics/phone-call-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: params.contactId,
        dealId: params.dealId,
        sourcePage: params.sourcePage ?? (typeof window !== "undefined" ? window.location.pathname : undefined),
        sessionId,
        visitorId,
      }),
    });
  } catch {
    // fire-and-forget — never throw
  }
}

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

/** Compatibility adapter: all callers use the same consent and dispatch owner. Arbitrary form values never reach pixels. */
export function trackConversion(name: string, params: ConversionParams = {}): void {
  trackAcceptedConversion(name, typeof params.value === "number" ? params.value : undefined,
    typeof params.receipt === "string" ? params.receipt : undefined);
}
