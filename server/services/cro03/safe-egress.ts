import dns from "node:dns/promises";
import net from "node:net";

export type EgressTransport = (url: string, init: RequestInit) => Promise<Response>;

export interface SafeEgressRequest {
  url: string;
  purpose: string;
  callSite: string;
  method?: "GET" | "HEAD";
  timeoutMs?: number;
  maxBytes?: number;
  allowedHosts?: readonly string[];
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

function isUnsafeIp(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (net.isIPv4(mapped)) return isUnsafeIp(mapped);
  }
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
  const host = hostname.toLowerCase().replace(/\.$/, "");
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
    private readonly transport: EgressTransport = (url, init) => fetch(url, init),
    private readonly lookup: (hostname: string) => Promise<readonly string[]> =
      async (hostname) => (await dns.lookup(hostname, { all: true })).map((entry) => entry.address),
  ) {}

  async get(request: SafeEgressRequest): Promise<SafeEgressResponse> {
    let current = new URL(request.url);
    if (current.protocol !== "https:" || current.username || current.password || current.port) {
      throw new Error("CRO03_EGRESS_URL_DENIED");
    }
    const allowedHosts = request.allowedHosts;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const addresses = await this.lookup(current.hostname);
      assertSafeHostname(current.hostname, addresses);
      if (allowedHosts && !allowedHosts.map((host) => host.toLowerCase()).includes(current.hostname.toLowerCase())) {
        throw new Error("CRO03_EGRESS_HOST_NOT_ALLOWED");
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      let response: Response;
      try {
        response = await this.transport(current.toString(), {
          method: request.method ?? "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: { Accept: "text/html,application/json,text/plain;q=0.9" },
        });
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
