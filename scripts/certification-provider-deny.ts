const PROVIDER_CREDENTIAL_KEYS = [
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "APOLLO_API_KEY",
  "SERPER_API_KEY",
  "OUTSCRAPER_API_KEY",
  "ZEROBOUNCE_API_KEY",
  "ZEROBOUNCE_APi_KEY",
  "GHL_PRIVATE_INTEGRATION_TOKEN",
  "GHL_WEBHOOK_SECRET",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
] as const;

let blockedNetworkAttempts = 0;

export function applyCertificationProviderDenyBoundary(): {
  scrubbedCredentialCount: number;
} {
  if (process.env.NODE_ENV !== "test" || process.env.VG_PROVIDER_DENY_MODE !== "1") {
    throw new Error(
      "VG provider deny boundary refused: NODE_ENV=test and VG_PROVIDER_DENY_MODE=1 are required.",
    );
  }

  let scrubbedCredentialCount = 0;
  for (const key of PROVIDER_CREDENTIAL_KEYS) {
    if (process.env[key]) scrubbedCredentialCount++;
    delete process.env[key];
  }

  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = "http://127.0.0.1:1/v1";
  process.env.SERPER_GATEWAY_ENABLED = "false";
  process.env.SUNBIZ_ENRICHMENT_ENABLED = "false";
  process.env.GHL_TRANSPORT_FAILFAST = "true";

  blockedNetworkAttempts = 0;
  globalThis.fetch = (async () => {
    blockedNetworkAttempts++;
    throw new Error("VG certification provider deny boundary blocked an HTTP request.");
  }) as typeof fetch;

  return { scrubbedCredentialCount };
}

export function getBlockedCertificationNetworkAttemptCount(): number {
  return blockedNetworkAttempts;
}