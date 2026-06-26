const UTM_STORAGE_KEY = "lb_utm_params";
const LANDING_PAGE_KEY = "lb_landing_page";
const CLICK_IDS_KEY = "lb_click_ids";
const BOOKING_TRACKING_ID_KEY = "lb_booking_tracking_id";

export interface UTMParams {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  landingPage?: string;
  gclidPresent?: boolean;
  fbclidPresent?: boolean;
  msclkidPresent?: boolean;
}

export function captureUTMParams(): void {
  const params = new URLSearchParams(window.location.search);
  const utmSource = params.get("utm_source");
  const utmMedium = params.get("utm_medium");
  const utmCampaign = params.get("utm_campaign");
  const utmContent = params.get("utm_content");
  const utmTerm = params.get("utm_term");

  if (utmSource || utmMedium || utmCampaign || utmContent || utmTerm) {
    const utmData: UTMParams = {};
    if (utmSource) utmData.utmSource = utmSource;
    if (utmMedium) utmData.utmMedium = utmMedium;
    if (utmCampaign) utmData.utmCampaign = utmCampaign;
    if (utmContent) utmData.utmContent = utmContent;
    if (utmTerm) utmData.utmTerm = utmTerm;
    sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(utmData));
  }

  if (!sessionStorage.getItem(LANDING_PAGE_KEY)) {
    sessionStorage.setItem(LANDING_PAGE_KEY, window.location.pathname + window.location.search);
  }

  const gclidPresent = params.has("gclid");
  const fbclidPresent = params.has("fbclid");
  const msclkidPresent = params.has("msclkid");
  if (gclidPresent || fbclidPresent || msclkidPresent) {
    sessionStorage.setItem(
      CLICK_IDS_KEY,
      JSON.stringify({ gclidPresent, fbclidPresent, msclkidPresent })
    );
  }
}

export function getStoredUTMParams(): UTMParams {
  try {
    const stored = sessionStorage.getItem(UTM_STORAGE_KEY);
    const landingPage = sessionStorage.getItem(LANDING_PAGE_KEY);
    const clickIds = sessionStorage.getItem(CLICK_IDS_KEY);
    const params: UTMParams = stored ? JSON.parse(stored) : {};
    if (landingPage) params.landingPage = landingPage;
    if (clickIds) {
      const ids = JSON.parse(clickIds);
      if (ids.gclidPresent) params.gclidPresent = true;
      if (ids.fbclidPresent) params.fbclidPresent = true;
      if (ids.msclkidPresent) params.msclkidPresent = true;
    }
    return params;
  } catch {
    return {};
  }
}

export function clearUTMParams(): void {
  sessionStorage.removeItem(UTM_STORAGE_KEY);
  sessionStorage.removeItem(LANDING_PAGE_KEY);
  sessionStorage.removeItem(CLICK_IDS_KEY);
}

/**
 * Returns or generates a stable bookingTrackingId for this session.
 * Stored in sessionStorage so it persists across page navigations but
 * resets on new sessions.
 */
export function getOrCreateBookingTrackingId(): string {
  try {
    const existing = sessionStorage.getItem(BOOKING_TRACKING_ID_KEY);
    if (existing) return existing;
    const id = `btk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(BOOKING_TRACKING_ID_KEY, id);
    return id;
  } catch {
    return `btk_${Date.now()}`;
  }
}

export interface BookingUrlContext {
  ctaLocation?: string;
}

/**
 * Builds an attributed booking URL by appending safe tracking params
 * (bookingTrackingId + UTM) to the base GHL booking URL.
 * Never includes raw PII (phone, email, contactId).
 */
export function buildAttributedBookingUrl(baseUrl: string, context: BookingUrlContext = {}): string {
  try {
    const url = new URL(baseUrl);
    const utm = getStoredUTMParams();
    const bookingTrackingId = getOrCreateBookingTrackingId();

    url.searchParams.set("btk", bookingTrackingId);
    if (utm.utmSource) url.searchParams.set("utm_source", utm.utmSource);
    if (utm.utmMedium) url.searchParams.set("utm_medium", utm.utmMedium);
    if (utm.utmCampaign) url.searchParams.set("utm_campaign", utm.utmCampaign);
    if (utm.utmContent) url.searchParams.set("utm_content", utm.utmContent);
    if (utm.utmTerm) url.searchParams.set("utm_term", utm.utmTerm);
    if (context.ctaLocation) url.searchParams.set("cta_loc", context.ctaLocation);

    return url.toString();
  } catch {
    return baseUrl;
  }
}
