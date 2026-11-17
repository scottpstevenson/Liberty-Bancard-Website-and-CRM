import { useQuery } from "@tanstack/react-query";
import { DEFAULT_REFERRAL_POLICY, parseReferralPolicy, type PartnerReferralPolicy } from "@shared/partner-public-content";

export const PARTNER_POLICY_QUERY_KEY = ["/api/public/partner-policy"] as const;

async function fetchPartnerPolicy(): Promise<PartnerReferralPolicy> {
  const response = await fetch("/api/public/partner-policy", { headers: { Accept: "application/json" } });
  // Unavailable is never read as approved: any failure is the written-agreement default.
  if (!response.ok) return DEFAULT_REFERRAL_POLICY;
  const body = await response.json().catch(() => null);
  return parseReferralPolicy(body?.referral);
}

/**
 * Published referral compensation policy. While loading, on error and when nothing is approved the result is the
 * release-safe "written agreement" state, so a public page never shows a referral percentage it was not told to show.
 */
export function usePartnerReferralPolicy(): { policy: PartnerReferralPolicy; settled: boolean } {
  const query = useQuery({
    queryKey: PARTNER_POLICY_QUERY_KEY,
    queryFn: fetchPartnerPolicy,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return { policy: query.data ?? DEFAULT_REFERRAL_POLICY, settled: query.isSuccess || query.isError };
}
