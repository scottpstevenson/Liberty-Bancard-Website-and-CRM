/**
 * ghl-test-transport.ts — Fail-fast fake GHL transport (C-03, #1626).
 *
 * Implementation baseline SHA: 7bcd11543843cd12b2e49db90fc010319ed49458
 *
 * When the server starts with GHL_TRANSPORT_FAILFAST=true (set by the
 * pre-deploy wrapper for the test server), this module patches the global
 * fetch so that ANY server-side call to the GHL API base URL throws a
 * TestTransportError instead of reaching the real provider.
 *
 * This replaces the old GHL_TEST_MODE flag, which was consumed by zero server
 * files and therefore never prevented real GHL calls. With this transport
 * installed, a real GHL mutation attempted during pre-deploy fails loudly at
 * the fetch boundary — failing the surrounding test assertion instead of
 * silently creating real GHL records.
 */

const GHL_API_HOST = "services.leadconnectorhq.com";

export class TestTransportError extends Error {
  constructor(url: string, method: string) {
    super(
      `TestTransportError: blocked ${method} to GHL API (${url.slice(0, 80)}) — ` +
      `GHL_TRANSPORT_FAILFAST is active; no real GHL calls are permitted in this server.`,
    );
    this.name = "TestTransportError";
  }
}

let _installed = false;

export function isGhlFailFastTransportInstalled(): boolean {
  return _installed;
}

/**
 * Install the fail-fast transport. Idempotent. Call from server startup when
 * process.env.GHL_TRANSPORT_FAILFAST === "true".
 */
export function installGhlFailFastTransport(): void {
  if (_installed) return;
  const realFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: any, init?: any) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input?.url ?? "";
    if (typeof url === "string" && url.includes(GHL_API_HOST)) {
      const method = (init?.method ?? (typeof input === "object" && input?.method) ?? "GET").toUpperCase();
      console.error(`[GHL Test Transport] BLOCKED ${method} ${url.slice(0, 120)}`);
      return Promise.reject(new TestTransportError(url, method));
    }
    return realFetch(input, init);
  }) as typeof fetch;
  _installed = true;
  console.log(
    "[GHL Test Transport] 🔒 Fail-fast GHL transport installed — all calls to " +
    `${GHL_API_HOST} will throw TestTransportError (GHL_TRANSPORT_FAILFAST=true)`,
  );
}
