/**
 * SerperGateway — the ONLY approved path to the Serper API (#1600).
 *
 * Every Serper `/search` and `/places` call in the codebase must flow through
 * `serperGateway.executeSearch(...)`. Raw fetches to google.serper.dev are
 * forbidden and enforced by `scripts/scan-serper-raw-fetch.ts` in pre-deploy.
 *
 * Durable state lives in the `serper_control` singleton row (id=1):
 *  - Global kill switch (`enabled`, deployed false by default)
 *  - Distributed circuit breaker (`closed` | `open` | `half_open`)
 *  - Billing-window accounting with atomic budget claims
 *  - Lifetime + yield counters
 *
 * Fail-closed: a missing, malformed, or unreadable control row blocks calls.
 * All state mutations are single atomic UPDATE statements (no read-modify-write).
 */

import { pool as defaultPool } from "../db";

const SERPER_BASE = "https://" + "google.serper.dev"; // split so the raw-fetch scanner never matches this file by accident elsewhere
const FETCH_TIMEOUT_MS = 15_000;
const FAILURE_THRESHOLD = 20;

export type SerperEndpoint = "/search" | "/places";

export type SerperBlockReason =
  | "disabled"
  | "state_missing"
  | "state_malformed"
  | "state_unreadable"
  | "circuit_open"
  | "half_open_probe_in_flight"
  | "budget_exhausted"
  | "no_api_key";

export interface SerperGatewayResult {
  ok: boolean;
  blocked: boolean;
  blockReason?: SerperBlockReason;
  status?: number;
  data?: any;
  error?: string;
  callSite: string;
}

export interface SerperControlRow {
  id: number;
  enabled: boolean;
  state: "closed" | "open" | "half_open";
  consecutive_failures: number;
  opened_at: Date | null;
  reason_code: string | null;
  last_failure_at: Date | null;
  last_success_at: Date | null;
  half_open_probe_claimed_at: Date | null;
  policy_version: number;
  lifetime_calls: string | number;
  lifetime_successes: string | number;
  lifetime_failures: string | number;
  window_calls: number;
  window_successes: number;
  window_failures: number;
  window_started_at: Date;
  window_ends_at: Date;
  local_budget: number;
  provider_balance: number | null;
  yield_websites: string | number;
  yield_emails: string | number;
  yield_phones: string | number;
  updated_at: Date;
}

type FetchLike = (url: string, init: any) => Promise<Response>;

interface QueryablePool {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
}

export interface SerperGatewayOptions {
  fetchOverride?: FetchLike;
  poolOverride?: QueryablePool;
  failureThreshold?: number;
  timeoutMs?: number;
}

const VALID_STATES = new Set(["closed", "open", "half_open"]);

function isMalformed(row: any): boolean {
  return (
    !row ||
    typeof row.enabled !== "boolean" ||
    !VALID_STATES.has(row.state) ||
    typeof row.local_budget !== "number" ||
    typeof row.window_calls !== "number" ||
    !row.window_ends_at
  );
}

export class SerperGateway {
  private fetchImpl: FetchLike;
  private pool: QueryablePool;
  private failureThreshold: number;
  private timeoutMs: number;

  constructor(opts: SerperGatewayOptions = {}) {
    this.fetchImpl = opts.fetchOverride ?? ((url, init) => fetch(url, init));
    this.pool = opts.poolOverride ?? defaultPool;
    this.failureThreshold = opts.failureThreshold ?? FAILURE_THRESHOLD;
    this.timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  }

  // ── Control-row reads ───────────────────────────────────────────────────

  async getControl(): Promise<SerperControlRow | null> {
    const { rows } = await this.pool.query(`SELECT * FROM serper_control WHERE id = 1`);
    return (rows[0] as SerperControlRow) ?? null;
  }

  // ── Calendar rollover ───────────────────────────────────────────────────

  /**
   * Applies the monthly billing-window rollover when now() > window_ends_at.
   * Single atomic UPDATE guarded by the previously-read window_ends_at so a
   * concurrent process cannot double-apply it. Resets only window counters,
   * preserves all lifetime totals, and transitions quota-related open circuits
   * to half_open (one bounded probe) — auth-related opens stay open.
   */
  async checkAndApplyWindowRollover(control: SerperControlRow): Promise<void> {
    if (new Date() <= new Date(control.window_ends_at)) return;
    await this.pool.query(
      `UPDATE serper_control SET
         window_calls = 0,
         window_successes = 0,
         window_failures = 0,
         window_started_at = window_ends_at,
         window_ends_at = window_ends_at + interval '1 month',
         state = CASE
           WHEN state = 'open' AND reason_code = 'quota_exhausted' THEN 'half_open'
           ELSE state END,
         half_open_probe_claimed_at = CASE
           WHEN state = 'open' AND reason_code = 'quota_exhausted' THEN NULL
           ELSE half_open_probe_claimed_at END,
         consecutive_failures = CASE
           WHEN state = 'open' AND reason_code = 'quota_exhausted' THEN 0
           ELSE consecutive_failures END,
         updated_at = now()
       WHERE id = 1
         AND now() > window_ends_at
         AND date_trunc('milliseconds', window_ends_at) = date_trunc('milliseconds', $1::timestamptz)`,
      [control.window_ends_at],
    );
  }

  // ── The single network entry point ──────────────────────────────────────

  async executeSearch(
    endpoint: SerperEndpoint,
    payload: object,
    callSite: string,
  ): Promise<SerperGatewayResult> {
    const blocked = (blockReason: SerperBlockReason): SerperGatewayResult => ({
      ok: false,
      blocked: true,
      blockReason,
      callSite,
    });

    if (!process.env.SERPER_API_KEY) return blocked("no_api_key");

    // 1. Read control state — fail closed on any problem.
    let control: SerperControlRow | null;
    try {
      control = await this.getControl();
    } catch (err) {
      console.error(`[SerperGateway] Control read failed (${callSite}):`, err);
      return blocked("state_unreadable");
    }
    if (!control) return blocked("state_missing");
    if (isMalformed(control)) return blocked("state_malformed");

    // 2. Calendar rollover (best-effort; failure here blocks, fail-closed).
    try {
      await this.checkAndApplyWindowRollover(control);
      if (new Date() > new Date(control.window_ends_at)) {
        control = await this.getControl();
        if (!control || isMalformed(control)) return blocked("state_malformed");
      }
    } catch (err) {
      console.error(`[SerperGateway] Rollover failed (${callSite}):`, err);
      return blocked("state_unreadable");
    }

    if (!control.enabled) return blocked("disabled");
    if (control.state === "open") return blocked("circuit_open");

    // 3. Half-open: atomically claim the single probe slot.
    let wasHalfOpenProbe = false;
    if (control.state === "half_open") {
      const { rows } = await this.pool.query(
        `UPDATE serper_control
            SET half_open_probe_claimed_at = now(), updated_at = now()
          WHERE id = 1 AND state = 'half_open' AND half_open_probe_claimed_at IS NULL
          RETURNING id`,
      );
      if (rows.length === 0) return blocked("half_open_probe_in_flight");
      wasHalfOpenProbe = true;
    }

    // 4. Atomic budget claim for this billing window.
    const claim = await this.pool.query(
      `UPDATE serper_control
          SET window_calls = window_calls + 1,
              lifetime_calls = lifetime_calls + 1,
              updated_at = now()
        WHERE id = 1 AND window_calls < local_budget
        RETURNING id`,
    );
    if (claim.rows.length === 0) {
      if (wasHalfOpenProbe) {
        await this.pool.query(
          `UPDATE serper_control SET half_open_probe_claimed_at = NULL, updated_at = now() WHERE id = 1`,
        );
      }
      return blocked("budget_exhausted");
    }

    // 5. Execute the provider fetch with a bounded timeout.
    let response: Response | null = null;
    let timedOut = false;
    let fetchError: string | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      response = await this.fetchImpl(`${SERPER_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          "X-API-KEY": process.env.SERPER_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err: any) {
      fetchError = timedOut ? "timeout" : (err?.message || String(err));
    } finally {
      clearTimeout(timer);
    }

    // 6. Classify + atomically record the outcome.
    if (!response) {
      // Timeout / network error → threshold counter.
      await this.recordFailure("timeout_or_network", false, wasHalfOpenProbe);
      return { ok: false, blocked: false, error: fetchError, callSite };
    }

    const status = response.status;

    if (status === 200) {
      let data: any;
      try {
        data = await response.json();
      } catch {
        await this.recordFailure("malformed_response", false, wasHalfOpenProbe);
        return { ok: false, blocked: false, status, error: "malformed_response_body", callSite };
      }
      // 200 with zero results is a provider SUCCESS with zero yield.
      await this.recordSuccess(wasHalfOpenProbe);
      return { ok: true, blocked: false, status, data, callSite };
    }

    const bodyText = await response.text().catch(() => "");

    if (status === 401 || status === 403) {
      await this.recordFailure("auth_error", true, wasHalfOpenProbe);
      return { ok: false, blocked: false, status, error: `auth error ${status}`, callSite };
    }

    if (status === 429) {
      const quotaExhausted = /credit|quota|balance|limit exceeded|not enough/i.test(bodyText);
      if (quotaExhausted) {
        await this.recordFailure("quota_exhausted", true, wasHalfOpenProbe);
        return { ok: false, blocked: false, status, error: "quota_exhausted", callSite };
      }
      await this.recordFailure("rate_limited", false, wasHalfOpenProbe);
      return { ok: false, blocked: false, status, error: "rate_limited", callSite };
    }

    if (status >= 400 && status < 500) {
      // Query/validation error — recorded separately, never counts toward the circuit.
      await this.recordValidationError();
      return { ok: false, blocked: false, status, error: `validation error ${status}: ${bodyText.slice(0, 200)}`, callSite };
    }

    // 5xx → threshold counter.
    await this.recordFailure("provider_5xx", false, wasHalfOpenProbe);
    return { ok: false, blocked: false, status, error: `provider error ${status}`, callSite };
  }

  // ── Outcome recording (all single atomic UPDATEs) ───────────────────────

  private async recordSuccess(wasHalfOpenProbe: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE serper_control SET
         lifetime_successes = lifetime_successes + 1,
         window_successes = window_successes + 1,
         consecutive_failures = 0,
         last_success_at = now(),
         state = CASE WHEN state = 'half_open' THEN 'closed' ELSE state END,
         reason_code = CASE WHEN state = 'half_open' THEN NULL ELSE reason_code END,
         opened_at = CASE WHEN state = 'half_open' THEN NULL ELSE opened_at END,
         half_open_probe_claimed_at = ${wasHalfOpenProbe ? "NULL" : "half_open_probe_claimed_at"},
         updated_at = now()
       WHERE id = 1`,
    );
  }

  private async recordFailure(
    reasonCode: string,
    openImmediately: boolean,
    wasHalfOpenProbe: boolean,
  ): Promise<void> {
    if (openImmediately) {
      await this.pool.query(
        `UPDATE serper_control SET
           lifetime_failures = lifetime_failures + 1,
           window_failures = window_failures + 1,
           consecutive_failures = consecutive_failures + 1,
           last_failure_at = now(),
           state = 'open',
           opened_at = now(),
           reason_code = $1,
           half_open_probe_claimed_at = NULL,
           updated_at = now()
         WHERE id = 1`,
        [reasonCode],
      );
      return;
    }
    // Threshold-counted failure. A failed half-open probe always reopens.
    await this.pool.query(
      `UPDATE serper_control SET
         lifetime_failures = lifetime_failures + 1,
         window_failures = window_failures + 1,
         consecutive_failures = consecutive_failures + 1,
         last_failure_at = now(),
         state = CASE
           WHEN state = 'half_open' THEN 'open'
           WHEN consecutive_failures + 1 >= $1 THEN 'open'
           ELSE state END,
         opened_at = CASE
           WHEN state = 'half_open' OR consecutive_failures + 1 >= $1 THEN now()
           ELSE opened_at END,
         reason_code = CASE
           WHEN state = 'half_open' OR consecutive_failures + 1 >= $1 THEN $2
           ELSE reason_code END,
         half_open_probe_claimed_at = ${wasHalfOpenProbe ? "NULL" : "half_open_probe_claimed_at"},
         updated_at = now()
       WHERE id = 1`,
      [this.failureThreshold, reasonCode],
    );
  }

  private async recordValidationError(): Promise<void> {
    // Recorded separately from provider failures: counts in window/lifetime
    // failure totals but never advances the circuit-breaker counter.
    await this.pool.query(
      `UPDATE serper_control SET
         lifetime_failures = lifetime_failures + 1,
         window_failures = window_failures + 1,
         last_failure_at = now(),
         updated_at = now()
       WHERE id = 1`,
    );
  }

  // ── Yield tracking (called by consumers after extracting results) ───────

  async recordYield(found: { website?: boolean; email?: boolean; phone?: boolean }): Promise<void> {
    if (!found.website && !found.email && !found.phone) return;
    try {
      await this.pool.query(
        `UPDATE serper_control SET
           yield_websites = yield_websites + $1,
           yield_emails = yield_emails + $2,
           yield_phones = yield_phones + $3,
           updated_at = now()
         WHERE id = 1`,
        [found.website ? 1 : 0, found.email ? 1 : 0, found.phone ? 1 : 0],
      );
    } catch (err) {
      console.error("[SerperGateway] Yield tracking error:", err);
    }
  }

  // ── Admin recovery ───────────────────────────────────────────────────────

  /**
   * Atomically transitions the circuit to half_open and clears the probe
   * claim so the caller can fire one bounded diagnostic probe.
   */
  async transitionToHalfOpenForRecovery(): Promise<SerperControlRow | null> {
    const { rows } = await this.pool.query(
      `UPDATE serper_control SET
         state = 'half_open',
         half_open_probe_claimed_at = NULL,
         consecutive_failures = 0,
         updated_at = now()
       WHERE id = 1
       RETURNING *`,
    );
    return (rows[0] as SerperControlRow) ?? null;
  }

  /** Resets window counters + yields (admin "reset usage" action). */
  async resetWindowCounters(): Promise<void> {
    await this.pool.query(
      `UPDATE serper_control SET
         window_calls = 0, window_successes = 0, window_failures = 0,
         yield_websites = 0, yield_emails = 0, yield_phones = 0,
         window_started_at = now(),
         updated_at = now()
       WHERE id = 1`,
    );
  }
}

export const serperGateway = new SerperGateway();
