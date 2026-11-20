import { adsMeasurementKey } from "./ads-measurement-consent";
import { publicTrackingContext, safeCampaignValue } from "./tracking-context";

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
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  adsMeasurementConsent?: boolean;
  adsMeasurementVersion?: string;
  adsMeasurementKey?: string;
  gclidPresent?: boolean;
  fbclidPresent?: boolean;
  msclkidPresent?: boolean;
}

function consent() {
  try { const p = JSON.parse(localStorage.getItem("lb_cookie_prefs") || "{}"); return { analytics: p.analytics === true, marketing: p.marketing === true, adsMeasurement: p.adsMeasurement === true }; }
  catch { return { analytics: false, marketing: false, adsMeasurement: false }; }
}
function read(key: string) { try { return sessionStorage.getItem(key); } catch { return null; } }
function write(key: string, value: string) { try { sessionStorage.setItem(key, value); } catch { /* Storage restrictions never break intake. */ } }
function remove(key: string) { try { sessionStorage.removeItem(key); } catch { /* Best effort. */ } }
const FIRST_TOUCH_KEY = "lb_first_utm_params";

export function captureUTMParams(): void {
  const allowed = consent();
  if (!allowed.analytics && !allowed.marketing) { clearUTMParams(); return; }
  if (!publicTrackingContext(window.location.pathname)) return;
  const params = new URLSearchParams(window.location.search);
  const touch: UTMParams = {};
  for (const [query, field] of [["utm_source", "utmSource"], ["utm_medium", "utmMedium"], ["utm_campaign", "utmCampaign"], ["utm_content", "utmContent"], ["utm_term", "utmTerm"]] as const) {
    const value = safeCampaignValue(params.get(query)); if (value) touch[field] = value;
  }
  if (Object.keys(touch).length) {
    write(UTM_STORAGE_KEY, JSON.stringify(touch));
    if (!read(FIRST_TOUCH_KEY)) write(FIRST_TOUCH_KEY, JSON.stringify(touch));
  }
  if (!read(LANDING_PAGE_KEY)) write(LANDING_PAGE_KEY, window.location.pathname);
  if (!allowed.marketing) { remove(CLICK_IDS_KEY); return; }
  const ids:Record<string,string|boolean>={};
  for(const key of ['gclid','gbraid','wbraid']){const value=params.get(key);if(value&&/^[A-Za-z0-9_-]{1,500}$/.test(value))ids[key]=value;}
  if(Object.keys(ids).length || params.has('fbclid') || params.has('msclkid'))write(CLICK_IDS_KEY,JSON.stringify({...ids,gclidPresent:!!ids.gclid,fbclidPresent:params.has('fbclid'),msclkidPresent:params.has('msclkid')}));
}

export function getStoredUTMParams(): UTMParams {
  captureUTMParams();
  const allowed = consent();
  if (!allowed.analytics && !allowed.marketing) return {};
  try {
    const params: UTMParams = {};
    const stored = JSON.parse(read(UTM_STORAGE_KEY) || "{}");
    for (const field of ["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm"] as const) { const value = safeCampaignValue(stored[field]); if (value) params[field] = value; }
    const landing = read(LANDING_PAGE_KEY); if (landing && publicTrackingContext(landing)) params.landingPage = landing;
    if (allowed.marketing) {
      const ids = JSON.parse(read(CLICK_IDS_KEY) || "{}");
      for(const key of ["gclid","gbraid","wbraid"] as const)if(typeof ids[key]==="string"&&/^[A-Za-z0-9_-]{1,500}$/.test(ids[key]))params[key]=ids[key];
      if (ids.gclidPresent === true) params.gclidPresent = true;
      if (ids.fbclidPresent === true) params.fbclidPresent = true;
      if (ids.msclkidPresent === true) params.msclkidPresent = true;
    }
    if(allowed.marketing && allowed.adsMeasurement && (params.gclid||params.gbraid||params.wbraid)){const key=adsMeasurementKey();if(key){params.adsMeasurementConsent=true;params.adsMeasurementVersion="ads-measurement-v1";params.adsMeasurementKey=key;}}
    return params;
  } catch { return {}; }
}

export function getFirstTouchUTMParams(): UTMParams {
  if (!consent().analytics && !consent().marketing) return {};
  try { const raw = JSON.parse(read(FIRST_TOUCH_KEY) || "{}"); return Object.fromEntries(Object.entries(raw).filter(([, value]) => safeCampaignValue(value))); } catch { return {}; }
}

export function clearUTMParams(): void {
  for (const key of [UTM_STORAGE_KEY, FIRST_TOUCH_KEY, LANDING_PAGE_KEY, CLICK_IDS_KEY]) remove(key);
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
    if (utm.gclid) url.searchParams.set("gclid", utm.gclid);
    if (utm.landingPage) url.searchParams.set("landing_page", utm.landingPage);
    if (context.ctaLocation) url.searchParams.set("cta_loc", context.ctaLocation);

    return url.toString();
  } catch {
    return baseUrl;
  }
}
