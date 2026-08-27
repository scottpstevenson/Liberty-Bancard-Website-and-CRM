const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export async function assertCertificationServerReady(
  rawBaseUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl);
  } catch {
    throw new Error("Server-required suites require a valid loopback BASE_URL.");
  }
  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    !LOOPBACK_HOSTNAMES.has(baseUrl.hostname) ||
    baseUrl.username ||
    baseUrl.password
  ) {
    throw new Error("Server-required suites require a credential-free loopback BASE_URL.");
  }
  const healthUrl = new URL("/api/health", baseUrl);
  try {
    const response = await fetchImpl(healthUrl, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`health endpoint returned HTTP ${response.status}`);
  } catch (error) {
    throw new Error(
      `Server-required suites cannot run because ${healthUrl.origin}/api/health is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}