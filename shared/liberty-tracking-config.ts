/** Verified in Liberty-owned Google accounts on 2026-11-20. Public identifiers, never credentials. */
// Issued to scott@libertybancard.com for https://libertybancard.com/; publishing and ownership verification remain separate actions.
export const LIBERTY_SEARCH_VERIFICATION = "r7jm3naEUw-XnkDHINBO6eKGojhHkQKZZxaLwCVb-6I";
export const LIBERTY_TRACKING = {
  VITE_GA4_MEASUREMENT_ID: "G-L2VK5474GD",
  VITE_GOOGLE_TAG_ID: "G-9TJF9ZMH3B",
  VITE_GOOGLE_ADS_LEAD_CONVERSION: "AW-17130296245/cKygCOvUjbwdELWnrug_",
} as const;

/** Explicit environment settings (including empty values to disable) retain precedence. */
export function libertyProductionTracking(
  env: Record<string, string | undefined>,
) {
  const measurementId = env.VITE_GA4_MEASUREMENT_ID ?? env.VITE_GA_ID ?? LIBERTY_TRACKING.VITE_GA4_MEASUREMENT_ID;
  return {
    ...env,
    VITE_GA4_MEASUREMENT_ID: measurementId,
    // Liberty's destination ID no longer serves a standalone Google tag script.
    VITE_GOOGLE_TAG_ID: env.VITE_GOOGLE_TAG_ID ??
      (measurementId === LIBERTY_TRACKING.VITE_GA4_MEASUREMENT_ID ? LIBERTY_TRACKING.VITE_GOOGLE_TAG_ID : measurementId),
    VITE_GOOGLE_ADS_LEAD_CONVERSION:
      env.VITE_GOOGLE_ADS_LEAD_CONVERSION ??
      LIBERTY_TRACKING.VITE_GOOGLE_ADS_LEAD_CONVERSION,
  };
}
