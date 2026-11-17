/**
 * Routes for the six partnership documents (/partners, /partners/referrals, /partners/sales-agents, /partners/cpa,
 * /partners/bookkeeper, /partners/insurance).
 *
 * The wording of these documents depends on the published referral-policy projection (administrator-approved and
 * revocable, server/services/partner-public-policy.ts), so each request reads the projection and the response is sent
 * `Cache-Control: no-cache`: a browser or CDN may store it but must revalidate, so an approval or a revocation shows on the
 * next request and never after a cache lifetime. The same document goes to browsers and crawlers, and query strings (UTM
 * tags, `ref`, `profession`) never change it.
 *
 * The policy reader is injectable so tests can mount these routes without a database. The default reader is loaded on
 * first use; it never throws and collapses to the written-agreement projection.
 */
import type { Express } from "express";
import { getPartnerPageHtml } from "../ssr/partners";
import { PARTNER_SSR_ROUTES } from "@shared/partner-page-seo";
import { DEFAULT_REFERRAL_POLICY, type PartnerReferralPolicy } from "@shared/partner-public-content";

export type PartnerPolicyReader = () => Promise<PartnerReferralPolicy>;

export const PARTNER_PAGE_CACHE_CONTROL = "no-cache";

async function defaultPolicyReader(): Promise<PartnerReferralPolicy> {
  const { getPublishedReferralPolicy } = await import("../services/partner-public-policy");
  return getPublishedReferralPolicy();
}

export function registerPartnerPageRoutes(app: Express, readPolicy: PartnerPolicyReader = defaultPolicyReader): void {
  for (const route of PARTNER_SSR_ROUTES) {
    app.get(route, async (_req, res, next) => {
      try {
        // A reader that throws must not publish a number: fall back to the written-agreement projection.
        const policy = await readPolicy().catch(() => DEFAULT_REFERRAL_POLICY);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", PARTNER_PAGE_CACHE_CONTROL);
        res.send(getPartnerPageHtml(route, policy));
      } catch (error) {
        next(error);
      }
    });
  }
}
