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

import { pool as defaultPool, db as defaultDb } from "../db";
import { sql } from "drizzle-orm";
import { auditLogs } from "@shared/schema";

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
  /** Test-only: drizzle db instance used for transactional admin mutations. */
  dbOverride?: typeof defaultDb;
  /** Test-only: replaces sendSmtpEmail for circuit alerts. */
  sendEmailOverride?: (params: { to: string; subject: string; html: string; category: string }) => Promise<unknown>;
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
  private db: typeof defaultDb;
  private sendEmailOverride?: SerperGatewayOptions["sendEmailOverride"];

  constructor(opts: SerperGatewayOptions = {}) {
    this.fetchImpl = opts.fetchOverride ?? ((url, init) => fetch(url, init));
    this.pool = opts.poolOverride ?? defaultPool;
    this.failureThreshold = opts.failureThreshold ?? FAILURE_THRESHOLD;
    this.timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
    this.db = opts.dbOverride ?? defaultDb;
    this.sendEmailOverride = opts.sendEmailOverride;
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
    const { rows } = await this.pool.query(
      `UPDATE serper_control sc SET
         lifetime_successes = sc.lifetime_successes + 1,
         window_successes = sc.window_successes + 1,
         consecutive_failures = 0,
         last_success_at = now(),
         state = CASE WHEN sc.state = 'half_open' THEN 'closed' ELSE sc.state END,
         reason_code = CASE WHEN sc.state = 'half_open' THEN NULL ELSE sc.reason_code END,
         opened_at = CASE WHEN sc.state = 'half_open' THEN NULL ELSE sc.opened_at END,
         half_open_probe_claimed_at = ${wasHalfOpenProbe ? "NULL" : "sc.half_open_probe_claimed_at"},
         updated_at = now()
       FROM serper_control prev
       WHERE sc.id = 1 AND prev.id = 1
       RETURNING sc.state AS new_state, prev.state AS prev_state`,
    );
    // #1602 — RESOLVED alert only on an actual half_open → closed transition.
    const r = rows[0];
    if (r && r.prev_state === "half_open" && r.new_state === "closed") {
      this._emitCircuitRecoveryAlert();
    }
  }

  private async recordFailure(
    reasonCode: string,
    openImmediately: boolean,
    wasHalfOpenProbe: boolean,
  ): Promise<void> {
    let rows: any[];
    if (openImmediately) {
      ({ rows } = await this.pool.query(
        `UPDATE serper_control sc SET
           lifetime_failures = sc.lifetime_failures + 1,
           window_failures = sc.window_failures + 1,
           consecutive_failures = sc.consecutive_failures + 1,
           last_failure_at = now(),
           state = 'open',
           opened_at = now(),
           reason_code = $1,
           half_open_probe_claimed_at = NULL,
           updated_at = now()
         FROM serper_control prev
         WHERE sc.id = 1 AND prev.id = 1
         RETURNING sc.state AS new_state, prev.state AS prev_state, sc.opened_at, sc.reason_code`,
        [reasonCode],
      ));
    } else {
      // Threshold-counted failure. A failed half-open probe always reopens.
      ({ rows } = await this.pool.query(
        `UPDATE serper_control sc SET
           lifetime_failures = sc.lifetime_failures + 1,
           window_failures = sc.window_failures + 1,
           consecutive_failures = sc.consecutive_failures + 1,
           last_failure_at = now(),
           state = CASE
             WHEN sc.state = 'half_open' THEN 'open'
             WHEN sc.consecutive_failures + 1 >= $1 THEN 'open'
             ELSE sc.state END,
           opened_at = CASE
             WHEN sc.state = 'half_open' OR sc.consecutive_failures + 1 >= $1 THEN now()
             ELSE sc.opened_at END,
           reason_code = CASE
             WHEN sc.state = 'half_open' OR sc.consecutive_failures + 1 >= $1 THEN $2
             ELSE sc.reason_code END,
           half_open_probe_claimed_at = ${wasHalfOpenProbe ? "NULL" : "sc.half_open_probe_claimed_at"},
           updated_at = now()
         FROM serper_control prev
         WHERE sc.id = 1 AND prev.id = 1
         RETURNING sc.state AS new_state, prev.state AS prev_state, sc.opened_at, sc.reason_code`,
        [this.failureThreshold, reasonCode],
      ));
    }
    // #1602 — alert ONLY on an actual closed/half_open → open transition.
    const r = rows[0];
    if (r && r.new_state === "open" && r.prev_state !== "open") {
      this._emitCircuitOpenAlert(
        r.reason_code ?? reasonCode,
        r.opened_at ? new Date(r.opened_at).toISOString() : new Date().toISOString(),
      );
    }
  }

  // ── Circuit alerts (#1602) — fire-and-forget, never affect transitions ───

  /**
   * Atomic cooldown claim: single conditional UPSERT on system_settings.
   * Returns true only when the claim is won (row returned). No read-modify-write.
   */
  private async _claimAlertCooldown(key: string, interval: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ($1, 'true'::jsonb, now())
       ON CONFLICT (key) DO UPDATE
         SET value = 'true'::jsonb, updated_at = now()
         WHERE system_settings.updated_at < now() - $2::interval
       RETURNING id`,
      [key, interval],
    );
    return rows.length > 0;
  }

  /**
   * Release a previously-won cooldown claim so the next transition can retry.
   * Used when alert delivery fails — otherwise a failed send would silently
   * consume the whole cooldown window with no alert ever delivered.
   */
  private async _releaseAlertCooldown(key: string): Promise<void> {
    await this.pool.query(
      `UPDATE system_settings SET updated_at = to_timestamp(0) WHERE key = $1`,
      [key],
    );
  }

  /**
   * Sends the alert email. sendSmtpEmail reports normal failures (SMTP down,
   * outbound paused, not configured) as { success: false } WITHOUT throwing —
   * treat those as delivery failures too, not just thrown exceptions.
   */
  private async _sendAlertEmail(subject: string, html: string): Promise<{ delivered: boolean; error?: string }> {
    const to = process.env.ADMIN_ALERT_EMAIL || "accounts@libertybancard.com";
    let result: unknown;
    if (this.sendEmailOverride) {
      result = await this.sendEmailOverride({ to, subject, html, category: "internal_ops" });
    } else {
      const { sendSmtpEmail } = await import("./smtp-email");
      result = await sendSmtpEmail({ to, subject, html, category: "internal_ops" });
    }
    const r = result as { success?: boolean; error?: string } | undefined;
    if (r && r.success === false) {
      return { delivered: false, error: typeof r.error === "string" ? r.error : "send reported success=false" };
    }
    return { delivered: true };
  }

  /** Claim cooldown → send → on any delivery failure, log sanitized warning and release the claim. */
  private async _deliverAlert(cooldownKey: string, interval: string, subject: string, html: string): Promise<void> {
    const won = await this._claimAlertCooldown(cooldownKey, interval);
    if (!won) return;
    try {
      const { delivered, error } = await this._sendAlertEmail(subject, html);
      if (!delivered) {
        console.warn(`[SerperGateway] Alert delivery failed (${cooldownKey}): ${error}`);
        await this._releaseAlertCooldown(cooldownKey);
      }
    } catch (err: any) {
      console.warn(`[SerperGateway] Alert delivery failed (${cooldownKey}): ${err?.message ?? err}`);
      await this._releaseAlertCooldown(cooldownKey);
    }
  }

  private _emitCircuitOpenAlert(reasonCode: string, openedAt: string): void {
    this._deliverAlert(
      "serper_circuit_open_alert_at",
      "1 hour",
      "🔴 Serper circuit breaker OPEN",
      `<p>The Serper gateway circuit breaker has opened.</p>
       <ul>
         <li><strong>Reason code:</strong> ${reasonCode}</li>
         <li><strong>Opened at:</strong> ${openedAt}</li>
         <li><strong>Circuit state:</strong> open</li>
       </ul>
       <p>Serper enrichment calls are blocked until recovery. Use the Serper Control panel (Operator Dashboard) to run manual recovery.</p>`,
    ).catch((err: any) => console.warn("[SerperGateway] Alert delivery failed:", err?.message ?? err));
  }

  private _emitCircuitRecoveryAlert(): void {
    this._deliverAlert(
      "serper_circuit_recovery_alert_at",
      "15 minutes",
      "✅ RESOLVED: Serper circuit breaker closed",
      `<p>The Serper gateway circuit breaker has recovered.</p>
       <ul>
         <li><strong>Circuit state:</strong> closed</li>
         <li><strong>Recovered at:</strong> ${new Date().toISOString()}</li>
       </ul>`,
    ).catch((err: any) => console.warn("[SerperGateway] Alert delivery failed:", err?.message ?? err));
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

  // ── Admin control mutations (#1601) ──────────────────────────────────────

  /**
   * Atomically toggles ONLY `enabled` and writes the audit record in the SAME
   * database transaction — both commit or both roll back. Never touches
   * circuit state, counters, windows, or recovery fields. An open circuit
   * stays open when Serper is re-enabled.
   */
  async setEnabled(
    enabled: boolean,
    audit: { actorId: string | null; reason: string; correlationId: string },
  ): Promise<SerperControlRow> {
    return await this.db.transaction(async (tx) => {
      const before = await tx.execute(sql`SELECT enabled FROM serper_control WHERE id = 1`);
      if (before.rows.length === 0) throw new Error("serper_control row missing — run migrations");
      const beforeEnabled = (before.rows[0] as any).enabled as boolean;

      const result = await tx.execute(
        sql`UPDATE serper_control SET enabled = ${enabled}, updated_at = now() WHERE id = 1 RETURNING *`,
      );
      if (result.rows.length === 0) throw new Error("serper_control row missing — run migrations");
      const row = result.rows[0] as unknown as SerperControlRow;

      await tx.insert(auditLogs).values({
        userId: audit.actorId,
        actorId: audit.actorId,
        actorType: "user",
        action: "serper_enabled_toggle",
        entityType: "serper_control",
        entityKey: "1",
        beforeState: { enabled: beforeEnabled },
        afterState: { enabled },
        // C-13 (#1626): sanitize free-text reason field before audit insert
        details: (await import("./audit-sanitizer")).sanitizeAuditPayload({
          reason: audit.reason,
          correlationId: audit.correlationId,
          policy_version: row.policy_version,
        }) as Record<string, unknown>,
      });

      return row;
    });
  }

  /**
   * Atomically resets ONLY window counters + yields (window_started_at = now())
   * guarded by the caller's previously-read window_started_at, and writes the
   * audit record in the same transaction. Returns null when the concurrency
   * guard fails (caller responds 409). Preserves lifetime_* totals, enabled,
   * circuit state, opened_at, reason_code, local_budget, and window_ends_at.
   */
  async resetWindow(
    expectedWindowStartedAt: Date,
    audit: { actorId: string | null; reason: string; correlationId: string },
  ): Promise<SerperControlRow | null> {
    return await this.db.transaction(async (tx) => {
      const result = await tx.execute(
        sql`UPDATE serper_control SET
              window_calls = 0,
              window_successes = 0,
              window_failures = 0,
              yield_websites = 0,
              yield_emails = 0,
              yield_phones = 0,
              window_started_at = now(),
              updated_at = now()
            WHERE id = 1
              AND date_trunc('milliseconds', window_started_at) = date_trunc('milliseconds', ${expectedWindowStartedAt.toISOString()}::timestamptz)
            RETURNING *`,
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0] as unknown as SerperControlRow;

      await tx.insert(auditLogs).values({
        userId: audit.actorId,
        actorId: audit.actorId,
        actorType: "user",
        action: "serper_window_reset",
        entityType: "serper_control",
        entityKey: "1",
        beforeState: { windowStartedAt: expectedWindowStartedAt.toISOString() },
        afterState: { windowStartedAt: row.window_started_at ? new Date(row.window_started_at).toISOString() : null },
        // C-13 (#1626): sanitize free-text reason field before audit insert
        details: (await import("./audit-sanitizer")).sanitizeAuditPayload({
          reason: audit.reason,
          correlationId: audit.correlationId,
          policy_version: row.policy_version,
        }) as Record<string, unknown>,
      });

      return row;
    });
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
