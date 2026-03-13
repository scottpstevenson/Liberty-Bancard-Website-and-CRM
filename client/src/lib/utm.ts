const UTM_STORAGE_KEY = "lb_utm_params";
const LANDING_PAGE_KEY = "lb_landing_page";

export interface UTMParams {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  landingPage?: string;
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
}

export function getStoredUTMParams(): UTMParams {
  try {
    const stored = sessionStorage.getItem(UTM_STORAGE_KEY);
    const landingPage = sessionStorage.getItem(LANDING_PAGE_KEY);
    const params: UTMParams = stored ? JSON.parse(stored) : {};
    if (landingPage) params.landingPage = landingPage;
    return params;
  } catch {
    return {};
  }
}

export function clearUTMParams(): void {
  sessionStorage.removeItem(UTM_STORAGE_KEY);
  sessionStorage.removeItem(LANDING_PAGE_KEY);
}
