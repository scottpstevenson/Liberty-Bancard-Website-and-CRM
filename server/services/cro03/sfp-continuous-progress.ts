/**
 * Provider-independent orchestration helpers. No database, credentials, or
 * transport imports: availability is not identity or permission to send.
 */
export interface SfpProviderReadinessResult {
  ready: boolean;
  reason: string | null;
}

type DiscoveryProvider = "outscraper" | "apollo";

export async function readIndependentSfpDiscoveryReadiness(
  read: (provider: DiscoveryProvider) => Promise<SfpProviderReadinessResult>,
): Promise<Record<DiscoveryProvider, SfpProviderReadinessResult>> {
  const check = async (provider: DiscoveryProvider): Promise<SfpProviderReadinessResult> => {
    try {
      return await read(provider);
    } catch {
      // A failing optional provider may stop only itself. Never expose the
      // exception text, which can contain credentials or provider payloads.
      return { ready: false, reason: `provider_readiness_unavailable:${provider}` };
    }
  };
  const [outscraper, apollo] = await Promise.all([check("outscraper"), check("apollo")]);
  return { outscraper, apollo };
}

export function sfpUnavailableHttpReason(provider: DiscoveryProvider, status: unknown): string | null {
  const code = Number(status);
  return [401, 402, 403].includes(code)
    ? `provider_unavailable:${provider}:http_${code}`
    : null;
}

export function hasSfpValidationProgress(result: {
  addressesValidated: number;
  providerRequests: number;
  eligibilityRowsCreated: number;
}): boolean {
  // A completed DNS/rejection/receipt-reuse decision advances selection even
  // without a paid request. Let the next preview find the remaining work.
  return result.addressesValidated > 0 ||
    result.providerRequests > 0 ||
    result.eligibilityRowsCreated > 0;
}