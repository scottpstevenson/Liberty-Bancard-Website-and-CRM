/** Public build settings only. No account credentials or identifiers are included in the readiness receipt. */
export function publicTrackingReadiness(env: Record<string, string | undefined>) {
  const ga = env.VITE_GA4_MEASUREMENT_ID || env.VITE_GA_ID;
  const pixel = env.VITE_FB_PIXEL_ID;
  const ads = env.VITE_GOOGLE_ADS_LEAD_CONVERSION;
  const setting = (value: string | undefined, pattern: RegExp) => !value ? "missing" : pattern.test(value) ? "configured" : "invalid";
  return {
    version: 1 as const,
    ga4: setting(ga, /^G-[A-Z0-9]+$/),
    metaPixel: setting(pixel, /^\d+$/),
    googleAdsLead: setting(ads, /^AW-\d+\/[A-Za-z0-9_-]+$/),
    acceptance: "Configuration only; consented provider receipt and account conversion mapping remain unverified",
  };
}
