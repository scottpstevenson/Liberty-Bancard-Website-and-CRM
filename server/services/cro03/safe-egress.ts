import dns from "node:dns/promises";
import net from "node:net";
import { domainToASCII } from "node:url";

/**
 * A transport receives the DNS answers validated for this hop and must connect
 * only to one of them.  The production default is deliberately denied: callers
 * must inject an adapter which can pin the connection rather than letting a
 * generic fetch re-resolve DNS after validation.
 */
export type EgressTransport = (
  url: string, init: RequestInit, connection: { hostname: string; pinnedAddresses: readonly string[] },
) => Promise<Response>;

export interface DurableEgressLimiter {
  consume(input: { hostname: string; purpose: string; callSite: string }): Promise<{ allowed: boolean; retryAfterMs?: number }>;
}

export interface RobotsCache {
  get(key: string): Promise<{ body: string; expiresAt: number } | undefined>;
  set(key: string, value: { body: string; expiresAt: number }): Promise<void>;
}

export interface RobotsPolicyHook {
  /** Called after cached/fetched robots.txt is parsed; false denies the request. */
  allows(input: { url: URL; robotsTxt: string; fromCache: boolean; request: SafeEgressRequest }): boolean | Promise<boolean>;
}

export interface SafeEgressRequest {
  url: string;
  purpose: string;
  callSite: string;
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  maxBytes?: number;
  allowedHosts?: readonly string[];
  /** Redirects must remain on this registrable domain when crawling a site. */
  sameRegistrableDomainAs?: string;
  /** Apply robots.txt enforcement through the configured cache and policy hook. */
  respectRobots?: boolean;
}

export interface SafeEgressResponse {
  status: number;
  contentType: string;
  bytes: number;
  body: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const ROBOTS_MAX_BYTES = 64 * 1024;

function canonicalHostname(hostname: string): string {
  const withoutTrailingDot = hostname.trim().replace(/\.+$/, "").toLowerCase();
  const ascii = domainToASCII(withoutTrailingDot);
  if (!ascii || ascii.includes("%") || ascii.includes("..")) throw new Error("CRO03_EGRESS_HOST_DENIED");
  return ascii;
}

function registrableDomain(hostname: string): string {
  const labels = canonicalHostname(hostname).split(".");
  if (labels.length < 2) return labels.join(".");
  const suffix = labels.slice(-2).join(".");
  const twoPartSuffixes = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.nz", "com.br"]);
  return twoPartSuffixes.has(suffix) && labels.length >= 3 ? labels.slice(-3).join(".") : suffix;
}

function mappedIpv4(normalized: string): string | undefined {
  const direct = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (direct) return direct;
  const hex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return undefined;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

function isUnsafeIp(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = mappedIpv4(normalized);
  if (mapped) return isUnsafeIp(mapped);
  if (net.isIPv4(normalized)) {
    const octets = normalized.split(".").map(Number);
    const n = (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
    return (
      (n >>> 24) === 0 || (n >>> 24) === 10 || (n >>> 24) === 127 ||
      (n >>> 20) === ((172 << 4) | 1) || (n >>> 16) === ((192 << 8) | 168) ||
      (n >>> 16) === ((169 << 8) | 254) || n === 0 ||
      (n >= 0xe0000000 && n <= 0xffffffff) ||
      (n >= 0x64400000 && n <= 0x647fffff)
    );
  }
  if (net.isIPv6(normalized)) {
    return normalized === "::" || normalized === "::1" ||
      normalized.startsWith("fc") || normalized.startsWith("fd") ||
      normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
      normalized.startsWith("fea") || normalized.startsWith("feb") ||
      normalized.startsWith("ff");
  }
  return true;
}

export function assertSafeHostname(hostname: string, resolvedAddresses: readonly string[]): void {
  const host = canonicalHostname(hostname);
  if (!host || host === "localhost" || host === "metadata.google.internal" ||
      host.endsWith(".localhost") || host.endsWith(".internal") ||
      host === "169.254.169.254") {
    throw new Error("CRO03_EGRESS_HOST_DENIED");
  }
  if (resolvedAddresses.length === 0 || resolvedAddresses.some(isUnsafeIp)) {
    throw new Error("CRO03_EGRESS_ADDRESS_DENIED");
  }
}

async function readBounded(response: Response, maxBytes: number): Promise<{ body: string; bytes: number }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const body = await response.text();
    if (Buffer.byteLength(body) > maxBytes) throw new Error("CRO03_EGRESS_RESPONSE_TOO_LARGE");
    return { body, bytes: Buffer.byteLength(body) };
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error("CRO03_EGRESS_RESPONSE_TOO_LARGE");
    }
    chunks.push(next.value);
  }
  return { body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"), bytes };
}

export class SafeEgress {
  constructor(
    private readonly transport: EgressTransport = async () => {
      throw new Error("CRO03_EGRESS_TRANSPORT_DENIED");
    },
    private readonly lookup: (hostname: string) => Promise<readonly string[]> =
      async (hostname) => (await dns.lookup(hostname, { all: true })).map((entry) => entry.address),
    private readonly limiter?: DurableEgressLimiter,
    private readonly robotsCache?: RobotsCache,
    private readonly robotsPolicy?: RobotsPolicyHook,
  ) {}

  private async robotsAllowed(current: URL, request: SafeEgressRequest, addresses: readonly string[]): Promise<void> {
    if (!request.respectRobots || !this.robotsPolicy) return;
    const key = `cro03:robots:${canonicalHostname(current.hostname)}`;
    let cached = await this.robotsCache?.get(key);
    let fromCache = Boolean(cached && cached.expiresAt > Date.now());
    if (!cached || !fromCache) {
      const robotsUrl = new URL("/robots.txt", current.origin);
      const response = await this.transport(robotsUrl.toString(), {
        method: "GET", redirect: "manual", headers: { Accept: "text/plain" },
      }, { hostname: canonicalHostname(current.hostname), pinnedAddresses: addresses });
      const body = response.ok ? (await readBounded(response, ROBOTS_MAX_BYTES)).body : "";
      cached = { body, expiresAt: Date.now() + 60 * 60 * 1000 };
      await this.robotsCache?.set(key, cached);
      fromCache = false;
    }
    if (!await this.robotsPolicy.allows({ url: current, robotsTxt: cached.body, fromCache, request })) {
      throw new Error("CRO03_EGRESS_ROBOTS_DENIED");
    }
  }

  async get(request: SafeEgressRequest): Promise<SafeEgressResponse> {
    let current = new URL(request.url);
    if (current.protocol !== "https:" || current.username || current.password || current.port) {
      throw new Error("CRO03_EGRESS_URL_DENIED");
    }
    const allowedHosts = request.allowedHosts;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const hostname = canonicalHostname(current.hostname);
      const addresses = await this.lookup(hostname);
      assertSafeHostname(hostname, addresses);
      if (allowedHosts && !allowedHosts.map(canonicalHostname).includes(hostname)) {
        throw new Error("CRO03_EGRESS_HOST_NOT_ALLOWED");
      }
      if (request.sameRegistrableDomainAs &&
          registrableDomain(hostname) !== registrableDomain(request.sameRegistrableDomainAs)) {
        throw new Error("CRO03_EGRESS_REGISTRABLE_DOMAIN_DENIED");
      }
      if (this.limiter) {
        const allowance = await this.limiter.consume({ hostname, purpose: request.purpose, callSite: request.callSite });
        if (!allowance.allowed) throw new Error("CRO03_EGRESS_RATE_LIMITED");
      }
      await this.robotsAllowed(current, request, addresses);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      let response: Response;
      try {
        response = await this.transport(current.toString(), {
          method: request.method ?? "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: { Accept: "text/html,application/json,text/plain;q=0.9" },
        }, { hostname, pinnedAddresses: Object.freeze([...addresses]) });
      } finally {
        clearTimeout(timeout);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (hop === MAX_REDIRECTS) throw new Error("CRO03_EGRESS_REDIRECT_LIMIT");
        const location = response.headers.get("location");
        if (!location) throw new Error("CRO03_EGRESS_REDIRECT_INVALID");
        current = new URL(location, current);
        continue;
      }
      const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      if (contentType && !["text/html", "application/json", "text/plain", "application/xhtml+xml"].includes(contentType)) {
        throw new Error("CRO03_EGRESS_CONTENT_TYPE_DENIED");
      }
      const bounded = await readBounded(response, request.maxBytes ?? DEFAULT_MAX_BYTES);
      return { status: response.status, contentType, ...bounded };
    }
    throw new Error("CRO03_EGRESS_REDIRECT_LIMIT");
  }
}

export const safeEgress = new SafeEgress();
