import http, { type RequestOptions } from "node:http";
import https from "node:https";
import { urlToHttpOptions } from "node:url";

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
  "GHL_API_KEY",
  "SDR_GHL_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_API_KEY",
  "TELNYX_API_KEY",
  "PLIVO_AUTH_ID",
  "PLIVO_AUTH_TOKEN",
  "PROXYCURL_API_KEY",
  "APIFY_API_TOKEN",
  "PAYARC_API_KEY",
  "OCR_API_KEY",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
] as const;

let blockedNetworkAttempts = 0;
let lastBlockedNetworkOrigin: string | null = null;
let fatalOnBlockedAttempt = false;
let fatalExitScheduled = false;
const originalFetch = globalThis.fetch;
const originalHttpRequest = http.request.bind(http);
const originalHttpsRequest = https.request.bind(https);

function isLoopbackUrl(url: URL): boolean {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
}

function recordBlockedAttempt(origin: string, label: string): never {
  blockedNetworkAttempts++;
  lastBlockedNetworkOrigin = origin;
  console.error(`[VG provider deny] blocked external HTTP target: ${origin}`);
  console.error(new Error(label).stack);
  if (fatalOnBlockedAttempt && !fatalExitScheduled) {
    fatalExitScheduled = true;
    process.exitCode = 70;
    setImmediate(() => process.exit(70));
  }
  throw new Error("VG certification provider deny boundary blocked an HTTP request.");
}

function effectiveRequestOptions(
  args: unknown[],
  defaultProtocol: "http:" | "https:",
): RequestOptions {
  const input = args[0];
  const overrides =
    args[1] && typeof args[1] === "object" && typeof args[1] !== "function"
      ? (args[1] as RequestOptions)
      : undefined;
  if (typeof input === "string" || input instanceof URL) {
    return {
      ...urlToHttpOptions(input instanceof URL ? input : new URL(input)),
      ...(overrides ?? {}),
    };
  }
  if (!input || typeof input !== "object") {
    throw new Error("Unparseable HTTP request options");
  }
  return { ...(input as RequestOptions) };
}

function toRequestUrl(options: RequestOptions, defaultProtocol: "http:" | "https:"): URL {
  const protocol = options.protocol ?? defaultProtocol;
  if (options.hostname === undefined && options.host !== undefined) {
    return new URL(`${protocol}//${String(options.host)}${options.path ?? "/"}`);
  }
  const rawHostname = String(options.hostname ?? "localhost");
  const hostname =
    rawHostname.startsWith("[") && rawHostname.endsWith("]")
      ? rawHostname.slice(1, -1)
      : rawHostname;
  const bracketedHostname =
    hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  const port = options.port ? `:${options.port}` : "";
  return new URL(`${protocol}//${bracketedHostname}${port}${options.path ?? "/"}`);
}

function assertLoopbackRequest(args: unknown[], protocol: "http:" | "https:"): void {
  let options: RequestOptions & {
    agent?: unknown;
    createConnection?: unknown;
    lookup?: unknown;
    socketPath?: unknown;
  };
  let url: URL;
  try {
    options = effectiveRequestOptions(args, protocol) as RequestOptions & {
      agent?: unknown;
      createConnection?: unknown;
      lookup?: unknown;
      socketPath?: unknown;
    };
    url = toRequestUrl(options, protocol);
  } catch {
    return recordBlockedAttempt("<unparseable>", "Blocked certification HTTP request origin");
  }
  if (
    (options.agent !== undefined && options.agent !== false) ||
    options.createConnection !== undefined ||
    options.lookup !== undefined ||
    options.socketPath !== undefined
  ) {
    return recordBlockedAttempt(
      "<custom-connection>",
      "Blocked certification custom HTTP connection hook",
    );
  }
  if (!isLoopbackUrl(url)) {
    return recordBlockedAttempt(url.origin, "Blocked certification HTTP request origin");
  }
}

export function applyCertificationProviderDenyBoundary(
  options: { fatal?: boolean } = {},
): {
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
  lastBlockedNetworkOrigin = null;
  fatalOnBlockedAttempt = options.fatal === true;
  fatalExitScheduled = false;
  globalThis.fetch = (async (input, init) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const url = new URL(rawUrl, "http://127.0.0.1");
    if (isLoopbackUrl(url)) {
      return originalFetch(input, init);
    }
    return recordBlockedAttempt(url.origin, "Blocked certification fetch origin");
  }) as typeof fetch;

  http.request = ((...args: Parameters<typeof http.request>) => {
    assertLoopbackRequest(args, "http:");
    return originalHttpRequest(...args);
  }) as typeof http.request;
  http.get = ((...args: Parameters<typeof http.get>) => {
    const request = http.request(...args);
    request.end();
    return request;
  }) as typeof http.get;
  https.request = ((...args: Parameters<typeof https.request>) => {
    assertLoopbackRequest(args, "https:");
    return originalHttpsRequest(...args);
  }) as typeof https.request;
  https.get = ((...args: Parameters<typeof https.get>) => {
    const request = https.request(...args);
    request.end();
    return request;
  }) as typeof https.get;

  return { scrubbedCredentialCount };
}

export function getBlockedCertificationNetworkAttemptCount(): number {
  return blockedNetworkAttempts;
}

export function getLastBlockedCertificationNetworkOrigin(): string | null {
  return lastBlockedNetworkOrigin;
}

export function installCertificationLocalAiConstructorEnvironment(): void {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.VG_PROVIDER_DENY_MODE !== "1" ||
    process.env.AI_INTEGRATIONS_OPENAI_BASE_URL !== "http://127.0.0.1:1/v1"
  ) {
    throw new Error("Certification local AI constructor environment requires the active deny boundary.");
  }
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY =
    "vg-certification-fixed-dummy-key-not-valid-for-any-provider";
}