/**
 * Per-route SEO defaults — re-exported from the shared module so the
 * server (admin coverage endpoint, scripts/seo-audit.ts) and the SPA
 * read from a single source of truth and never drift.
 */

import {
  SEO_ROUTE_DEFAULTS,
  PUBLIC_ROUTE_PATHS,
  type SeoRouteDefault,
} from "@shared/seo-routes";

export type SEODefault = SeoRouteDefault;

export const SEO_DEFAULTS: Record<string, SeoRouteDefault> = SEO_ROUTE_DEFAULTS;
export const PUBLIC_ROUTES: string[] = PUBLIC_ROUTE_PATHS;
