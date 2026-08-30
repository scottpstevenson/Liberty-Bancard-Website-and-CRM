import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import {
  SafeEgress,
  createPinnedHttpsTransport,
  type DurableEgressLimiter,
  type EgressTransport,
  type EgressReceiptObserver,
  type RobotsCache,
  type RobotsPolicyHook,
} from "./safe-egress";
import {
  assertCro03cAuthorityBeforeIo,
  assertCro03cLiveContext,
  type Cro03cLiveProviderContext,
} from "./live-execution";
import { assertProviderActivation } from "../provider-manifest";

const CALLER = "server/services/cro03/live-safe-egress.ts";
const MAX_ADDITIONAL_PAGES = 4;
const DOMAIN_WINDOW_SECONDS = 60;
const DOMAIN_WINDOW_MAX_REQUESTS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface Cro03cLiveCrawlRequest {
  /** The canonical HTTPS root for the approved first-party site. */
  homepageUrl: string;
  /** Explicitly approved pages only; discovery does not expand this list. */
  approvedPageUrls: readonly string[];
  operationId: string;
}

export interface Cro03cLiveCrawlPage {
  url: string;
  status: number;
  contentType: string;
  bytes: number;
  body: string;
}

export interface Cro03cLiveSafeEgressOptions {
  context: Cro03cLiveProviderContext;
  /**
   * This must be backed by durable shared storage. It is deliberately required:
   * a process-local throttle is not an acceptable live-crawl control.
   */
  limiter: DurableEgressLimiter;
  robotsCache?: RobotsCache;
  lookup?: (hostname: string) => Promise<readonly string[]>;
  /** Test seam only. Production deliberately uses createPinnedHttpsTransport. */
  pinnedTransportFactory?: () => EgressTransport;
  /** Durable stage checkpoint, called at the actual pinned transport boundary. */
  beforeTransportInvocation?: () => Promise<void>;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalHostname(hostname: string): string {
  const value = hostname.trim().replace(/\.+$/, "").toLowerCase();
  if (!value || value.includes("%") || value.includes("..")) throw new Error("CRO03C_CRAWL_HOST_INVALID");
  return value;
}

/* Kept consistent with SafeEgress's intentionally conservative public-suffix
 * treatment. This is an allow-boundary, not a general purpose PSL parser. */
function registrableDomain(hostname: string): string {
  const labels = canonicalHostname(hostname).split(".");
  if (labels.length < 2) return labels.join(".");
  const suffix = labels.slice(-2).join(".");
  const twoPartSuffixes = new Set(["co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.nz", "com.br"]);
  return twoPartSuffixes.has(suffix) && labels.length >= 3 ? labels.slice(-3).join(".") : suffix;
}

function canonicalCrawlUrl(value: string, homepage = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CRO03C_CRAWL_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("CRO03C_CRAWL_URL_DENIED");
  }
  url.hostname = canonicalHostname(url.hostname);
  url.hash = "";
  if (homepage && (url.pathname !== "/" || url.search)) throw new Error("CRO03C_CRAWL_HOMEPAGE_INVALID");
  return url;
}

/**
 * A minimal, fail-closed robots policy for the dedicated CRO crawler identity.
 * The longest matching rule wins; an Allow rule wins ties as specified by
 * common robots implementations.
 */
const cro03cRobotsPolicy: RobotsPolicyHook = {
  allows({ url, robotsTxt }) {
    const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
    let group: { agents: string[]; rules: Array<{ allow: boolean; path: string }> } | undefined;
    for (const rawLine of robotsTxt.split(/\r?\n/)) {
      const line = rawLine.replace(/\s*#.*/, "").trim();
      const match = /^([^:]+)\s*:\s*(.*)$/i.exec(line);
      if (!match) continue;
      const field = match[1].toLowerCase();
      const value = match[2].trim();
      if (field === "user-agent") {
        if (!group || group.rules.length > 0) {
          group = { agents: [], rules: [] };
          groups.push(group);
        }
        group.agents.push(value.toLowerCase());
      } else if ((field === "allow" || field === "disallow") && group) {
        if (value) group.rules.push({ allow: field === "allow", path: value });
      }
    }
    const named = groups.filter((item) => item.agents.includes("cro03c") || item.agents.includes("cro-03c"));
    const applicable = named.length ? named : groups.filter((item) => item.agents.includes("*"));
    const path = `${url.pathname}${url.search}`;
    let winner: { allow: boolean; length: number } | undefined;
    for (const item of applicable) for (const rule of item.rules) {
      const escaped = rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      const expression = `^${escaped.replace(/\\\$$/, "$")}`;
      if (new RegExp(expression).test(path) && (!winner || rule.path.length > winner.length ||
          (rule.path.length === winner.length && rule.allow))) {
        winner = { allow: rule.allow, length: rule.path.length };
      }
    }
    return winner?.allow ?? true;
  },
};

class HopReceiptWriter {
  private hopNumber = 0;

  constructor(private readonly operationId: string) {}

  async record(input: {
    url: string;
    hostname: string;
    pinnedAddresses: readonly string[];
    status?: number;
    redirectTarget?: string;
    bytes?: number;
  }): Promise<void> {
    const hopNumber = this.hopNumber++;
    if (hopNumber > 99) throw new Error("CRO03C_CRAWL_HOP_RECEIPT_LIMIT");
    await db.execute(sql`
      INSERT INTO cro03c_request_hop_receipts
        (stage_operation_id,hop_number,request_hash,hostname,pinned_address_hash,response_status,redirect_target_hash,bytes)
      VALUES (${this.operationId}::uuid,${hopNumber},${hash(input.url)},${hash(input.hostname)},
              ${hash([...input.pinnedAddresses].sort().join(","))},${input.status ?? null},
              ${input.redirectTarget ? hash(input.redirectTarget) : null},${input.bytes ?? 0})
    `);
  }
}

/** Shared, atomic per-domain budget. The database is the rate-limit authority,
 * so concurrent workers and restarts cannot reset it. */
export class Cro03cDomainRequestLimiter implements DurableEgressLimiter {
  async consume(input: { hostname: string; purpose: string; callSite: string }): Promise<{ allowed: boolean; retryAfterMs?: number }> {
    if (input.purpose !== "cro03c_live_crawl" || input.callSite !== CALLER) {
      throw new Error("CRO03C_CRAWL_LIMITER_CONTEXT_DENIED");
    }
    const hostnameHash = hash(canonicalHostname(input.hostname));
    const result: any = await db.execute(sql`
      WITH window AS (
        SELECT date_trunc('minute', NOW()) AS started_at
      ), consumed AS (
        INSERT INTO cro03c_domain_request_limits(hostname_hash,window_started_at,request_count,updated_at)
        SELECT ${hostnameHash},started_at,1,NOW() FROM window
        ON CONFLICT (hostname_hash,window_started_at) DO UPDATE
          SET request_count=cro03c_domain_request_limits.request_count+1,updated_at=NOW()
          WHERE cro03c_domain_request_limits.request_count < ${DOMAIN_WINDOW_MAX_REQUESTS}
        RETURNING request_count
      )
      SELECT request_count FROM consumed
    `);
    const row = (result.rows ?? result)?.[0];
    return row ? { allowed: true } : { allowed: false, retryAfterMs: DOMAIN_WINDOW_SECONDS * 1000 };
  }
}

export const createCro03cDomainRequestLimiter = (): DurableEgressLimiter => new Cro03cDomainRequestLimiter();

export class Cro03cLiveSafeEgress {
  private readonly egress: SafeEgress;
  private readonly receipts: HopReceiptWriter;

  private constructor(private readonly options: Cro03cLiveSafeEgressOptions, private readonly operationId: string) {
    this.receipts = new HopReceiptWriter(operationId);
    const pinnedTransport = options.pinnedTransportFactory?.() ?? createPinnedHttpsTransport();
    const transport: EgressTransport = async (url, init, connection) => {
      // This is intentionally inside the transport: SafeEgress invokes it for
      // robots and every redirect, so no network request can bypass re-checking.
      await assertCro03cAuthorityBeforeIo(this.options.context);
      const allowance = await this.options.limiter.consume({
        hostname: connection.hostname, purpose: "cro03c_live_crawl", callSite: CALLER,
      });
      if (!allowance.allowed) throw new Error("CRO03C_CRAWL_RATE_LIMITED");
      try {
         // This is deliberately after every deny-only control and immediately
         // before the pinned adapter. The callback is idempotent for redirect
         // hops, but its first successful write makes all later uncertainty
         // dispatched/ambiguous rather than safely replayable.
         await this.options.beforeTransportInvocation?.();
        return await pinnedTransport(url, init, connection);
      } catch (error) {
        await this.receipts.record({ url, hostname: connection.hostname, pinnedAddresses: connection.pinnedAddresses });
        throw error;
      }
    };
    const receiptObserver: EgressReceiptObserver = async (receipt) => {
      await this.receipts.record(receipt);
    };
    this.egress = new SafeEgress(
      transport, options.lookup, undefined, options.robotsCache, cro03cRobotsPolicy, receiptObserver,
    );
  }

  static async create(options: Cro03cLiveSafeEgressOptions, operationId: string): Promise<Cro03cLiveSafeEgress> {
    assertCro03cLiveContext(options.context);
    if (options.context.caller !== CALLER || options.context.provider !== "first_party_web") {
      throw new Error("CRO03C_CRAWL_CONTEXT_DENIED");
    }
    assertProviderActivation({
      sourceId: "first_party_web", caller: CALLER,
    });
    if (!UUID.test(operationId)) throw new Error("CRO03C_CRAWL_OPERATION_INVALID");
    const operationResult: any = await db.execute(sql`
      SELECT 1 FROM cro03c_stage_operations
       WHERE id=${operationId}::uuid AND generation_id=${options.context.generationId}::uuid
         AND stage_key=${options.context.stageKey} AND provider='first_party_web'
    `);
    const operation = (operationResult.rows ?? operationResult)?.[0];
    if (!operation) throw new Error("CRO03C_CRAWL_OPERATION_UNAUTHORIZED");
    return new Cro03cLiveSafeEgress(options, operationId);
  }

  async crawl(request: Cro03cLiveCrawlRequest): Promise<Cro03cLiveCrawlPage[]> {
    if (request.operationId !== this.operationId || !UUID.test(request.operationId)) {
      throw new Error("CRO03C_CRAWL_OPERATION_MISMATCH");
    }
    if (!Object.isFrozen(request) || !Object.isFrozen(request.approvedPageUrls) ||
        !Object.isFrozen(request.homepageUrl)) {
      throw new Error("CRO03C_CRAWL_INPUT_NOT_FROZEN");
    }
    if (request.approvedPageUrls.length > MAX_ADDITIONAL_PAGES) {
      throw new Error("CRO03C_CRAWL_PAGE_LIMIT");
    }
    const homepage = canonicalCrawlUrl(request.homepageUrl, true);
    const domain = registrableDomain(homepage.hostname);
    const additional = request.approvedPageUrls.map((value) => canonicalCrawlUrl(value));
    const canonicalAdditional = [...new Map(additional.map((url) => [url.toString(), url])).values()]
      .filter((url) => url.toString() !== homepage.toString());
    if (canonicalAdditional.length > MAX_ADDITIONAL_PAGES) throw new Error("CRO03C_CRAWL_PAGE_LIMIT");
    if (canonicalAdditional.some((url) => registrableDomain(url.hostname) !== domain)) {
      throw new Error("CRO03C_CRAWL_DOMAIN_DENIED");
    }
    const pages = [homepage, ...canonicalAdditional];
    const results: Cro03cLiveCrawlPage[] = [];
    for (const page of pages) {
      const response = await this.egress.get({
        url: page.toString(), purpose: "cro03c_live_crawl", callSite: CALLER,
        sameRegistrableDomainAs: homepage.hostname, respectRobots: true,
        timeoutMs: 10_000, maxBytes: 512 * 1024,
      });
      results.push({ url: page.toString(), ...response });
    }
    return results;
  }
}

export const createCro03cLiveSafeEgress = Cro03cLiveSafeEgress.create;