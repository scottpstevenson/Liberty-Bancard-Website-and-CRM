/**
 * Payarc read transport + host/credential-environment binding (Task #1777).
 * Pure of database access. Only the two documented REPORTING hosts are allowed;
 * the Payarc Connect terminal host and every other host are refused.
 *
 * Why a custom transport: the batch-report page documents its date filters in a GET request
 * body. WHATWG fetch cannot send a GET body, so body placement uses node:https. Query-only
 * reads use the global fetch (looked up per call so tests can stub it).
 */
import https from "node:https";
import type { PayarcEnvironment, PayarcKeyClass } from "./payarc-report-types";

export const PAYARC_REPORTING_BASES: Record<PayarcEnvironment, string> = {
  sandbox: "https://testapi.payarc.net/v1",
  production: "https://api.payarc.net/v1",
};

export const PAYARC_KEY_ENV_VARS: Record<PayarcKeyClass, { key: string; environment: string }> = {
  partner: { key: "PAYARC_API_KEY", environment: "PAYARC_PARTNER_KEY_ENVIRONMENT" },
  merchant: { key: "PAYARC_MERCHANT_API_KEY", environment: "PAYARC_MERCHANT_KEY_ENVIRONMENT" },
};

/** Classify a base URL as one of the documented reporting bases; null for anything else. */
export function classifyReportingBase(baseUrl: string): PayarcEnvironment | null {
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash) return null;
  const path = u.pathname.replace(/\/+$/, "");
  if (path !== "/v1") return null;
  if (u.hostname === "testapi.payarc.net") return "sandbox";
  if (u.hostname === "api.payarc.net") return "production";
  return null;
}

export type EnvironmentBinding =
  | { status: "declared_match"; declared: PayarcEnvironment }
  | { status: "undeclared" }
  | { status: "mismatch"; declared: PayarcEnvironment; host: PayarcEnvironment }
  | { status: "invalid_declaration" };

/** Compare a credential's declared environment (non-secret env var) with the host environment. */
export function bindCredentialEnvironment(
  keyClass: PayarcKeyClass,
  hostEnvironment: PayarcEnvironment,
  env: NodeJS.ProcessEnv,
): EnvironmentBinding {
  const raw = (env[PAYARC_KEY_ENV_VARS[keyClass].environment] ?? "").trim().toLowerCase();
  if (raw === "") return { status: "undeclared" };
  if (raw !== "sandbox" && raw !== "production") return { status: "invalid_declaration" };
  return raw === hostEnvironment
    ? { status: "declared_match", declared: raw }
    : { status: "mismatch", declared: raw, host: hostEnvironment };
}

export interface ReadTransportRequest {
  url: string;
  headers: Record<string, string>;
  /** When set, sent as a JSON body on a GET request. */
  jsonBody?: unknown;
  timeoutMs: number;
  maxBytes: number;
}

export interface ReadTransportResponse {
  status: number;
  text: string;
  /** Lower-cased header names. */
  headers: Record<string, string | undefined>;
}

export type ReadTransport = (req: ReadTransportRequest) => Promise<ReadTransportResponse>;

export class ResponseTooLargeError extends Error {
  constructor() {
    super("response exceeded the byte ceiling");
    this.name = "ResponseTooLargeError";
  }
}

async function fetchTransport(req: ReadTransportRequest): Promise<ReadTransportResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  try {
    const resp = await fetch(req.url, { method: "GET", headers: req.headers, signal: controller.signal });
    const headers: Record<string, string | undefined> = {};
    resp.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    let text = "";
    if (resp.body) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > req.maxBytes) {
          await reader.cancel();
          throw new ResponseTooLargeError();
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } else {
      text = await resp.text();
      if (Buffer.byteLength(text) > req.maxBytes) throw new ResponseTooLargeError();
    }
    return { status: resp.status, text, headers };
  } finally {
    clearTimeout(timer);
  }
}

function httpsBodyTransport(req: ReadTransportRequest): Promise<ReadTransportResponse> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(req.jsonBody));
    const r = https.request(
      req.url,
      {
        method: "GET",
        headers: { ...req.headers, "Content-Type": "application/json", "Content-Length": String(payload.length) },
        timeout: req.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (c: Buffer) => {
          bytes += c.length;
          if (bytes > req.maxBytes) {
            res.destroy();
            reject(new ResponseTooLargeError());
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const headers: Record<string, string | undefined> = {};
          for (const [k, v] of Object.entries(res.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(",") : v;
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8"), headers });
        });
        res.on("error", reject);
      },
    );
    r.on("timeout", () => r.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    r.on("error", reject);
    r.end(payload);
  });
}

/** Default transport: GET body via node:https, otherwise fetch. */
export const defaultReadTransport: ReadTransport = (req) =>
  req.jsonBody !== undefined ? httpsBodyTransport(req) : fetchTransport(req);

function backoffMs(env: NodeJS.ProcessEnv): number {
  const v = parseInt(env.PAYARC_RATE_LIMIT_BACKOFF_MS ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 2_000;
}

/**
 * Same rule as the transactional adapter: pause when X-RateLimit-Remaining is <=1, absent, or
 * unparseable. Applied after every response so a bounded multi-page read cannot exhaust limits.
 */
export async function rateLimitPause(
  headers: Record<string, string | undefined>,
  env: NodeJS.ProcessEnv,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  const remaining = parseInt(headers["x-ratelimit-remaining"] ?? "", 10);
  if (Number.isNaN(remaining) || remaining <= 1) await sleep(backoffMs(env));
}
