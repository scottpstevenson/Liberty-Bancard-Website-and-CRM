/**
 * Admin alerting for exhausted paid-provider credits (#2046).
 *
 * Outscraper, ZeroBounce, and Apollo have all silently run out of credits in
 * production before — each provider keeps returning HTTP 401/402/403/429 (or
 * an equivalent "insufficient credits" body) and every call site quietly
 * treats that as "no result" or a retryable transport failure. Nobody found
 * out until someone manually queried provider_observations.
 *
 * This module gives every paid-provider adapter a single, cheap call to
 * report whether the last attempt looked like an auth/billing failure. A
 * short run of consecutive billing-like failures for the same provider trips
 * an admin alert (Slack + email), mirroring the GHL sync circuit-breaker
 * alert and the Serper gateway's own circuit alert. The alert is
 * durably cooled down (1 hour) via a conditional UPSERT on system_settings,
 * the same atomic-claim pattern serper-gateway.ts uses, so restarts don't
 * cause duplicate alerts and a slow SMTP outage doesn't eat the cooldown
 * window without ever delivering an alert.
 *
 * Any success, or any failure that does not look billing/auth-related,
 * resets the consecutive counter for that provider.
 */
import { pool } from "../db";

export type PaidCreditProvider = "outscraper" | "apollo" | "zerobounce";

const CONSECUTIVE_FAILURE_THRESHOLD = 3;
const ALERT_COOLDOWN_INTERVAL = "1 hour";

const PROVIDER_LABEL: Record<PaidCreditProvider, string> = {
  outscraper: "Outscraper",
  apollo: "Apollo",
  zerobounce: "ZeroBounce",
};

function counterKey(provider: PaidCreditProvider): string {
  return `provider_credit_consecutive_failures:${provider}`;
}
function alertCooldownKey(provider: PaidCreditProvider): string {
  return `provider_credit_alert_at:${provider}`;
}

/**
 * Heuristic classification of a paid-provider failure as "looks like
 * exhausted credits / a billing or auth problem" rather than a generic
 * transient/transport failure. Deliberately conservative (only clearly
 * billing/auth-shaped signals count) so that ordinary rate limiting or
 * flaky network errors don't trip the alert.
 */
export function looksLikeBillingOrAuthFailure(input: {
  httpStatus?: number | null;
  message?: string | null;
}): boolean {
  const status = input.httpStatus ?? null;
  if (status === 401 || status === 402 || status === 403 || status === 429) return true;
  const text = String(input.message ?? "").toLowerCase();
  if (!text) return false;
  return /\b(401|402|403|429)\b/.test(text)
    || /insufficient[ _-]?credit|out of credit|no credits? (remaining|left)|credit(s)? exhausted/.test(text)
    || /quota exceeded|billing|payment required|unauthorized|forbidden|invalid api key|subscription (expired|inactive)/.test(text);
}

async function claimAlertCooldown(key: string): Promise<boolean> {
  const { rows } = await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, 'true'::jsonb, now())
     ON CONFLICT (key) DO UPDATE
       SET value = 'true'::jsonb, updated_at = now()
       WHERE system_settings.updated_at < now() - $2::interval
     RETURNING id`,
    [key, ALERT_COOLDOWN_INTERVAL],
  );
  return rows.length > 0;
}

async function releaseAlertCooldown(key: string): Promise<void> {
  await pool.query(`UPDATE system_settings SET updated_at = to_timestamp(0) WHERE key = $1`, [key]).catch(() => {});
}

async function sendAlert(provider: PaidCreditProvider, failureCount: number, lastReason: string): Promise<void> {
  const label = PROVIDER_LABEL[provider];
  const timestamp = new Date().toISOString();

  // Claim the cooldown BEFORE notifying anyone, on both channels. Otherwise
  // every failure past the threshold re-fires Slack (with a changing count
  // in the summary/details, defeating downstream dedup) even while the
  // email side is correctly cooled down.
  const cooldownKey = alertCooldownKey(provider);
  const won = await claimAlertCooldown(cooldownKey);
  if (!won) return;

  // Keep a stable incident identity across the whole cooldown window: always
  // report the threshold count, not the current (still-growing) streak, so
  // the alert fingerprint doesn't change on every subsequent failure.
  import("./system-audit/slack-notifier").then(({ sendCriticalAlert }) => {
    sendCriticalAlert({
      subsystem: `paid-provider-credit:${provider}`,
      status: "error",
      summary: `${label} looks out of credits — reached ${CONSECUTIVE_FAILURE_THRESHOLD} consecutive auth/billing-type failures.`,
      details: { provider, consecutiveFailures: CONSECUTIVE_FAILURE_THRESHOLD, lastReason, threshold: CONSECUTIVE_FAILURE_THRESHOLD },
    }).catch(() => {});
  }).catch(() => {});

  try {
    const { sendSmtpEmail, isSmtpConfigured } = await import("./smtp-email");
    if (!isSmtpConfigured()) {
      await releaseAlertCooldown(cooldownKey);
      return;
    }
    const adminEmail = process.env.ADMIN_ALERT_EMAIL || "accounts@libertybancard.com";
    const subject = `🚨 ${label} appears out of credits`;
    const html = `
      <h2 style="color:#c0392b;">${label} paid provider — possible exhausted credits</h2>
      <p>Detected at <strong>${timestamp}</strong>.</p>
      <p><strong>${CONSECUTIVE_FAILURE_THRESHOLD} consecutive</strong> auth/billing-type failures reached the alert threshold.</p>
      <p><strong>Last failure reason:</strong> ${lastReason}</p>
      <hr/>
      <p><strong>Recommended actions:</strong></p>
      <ul>
        <li>Check the ${label} account balance/billing dashboard.</li>
        <li>Confirm the ${label} API key is still valid.</li>
        <li>${label} calls will keep failing (or quietly returning no results) until this is resolved.</li>
      </ul>
      <p style="color:#7f8c8d;font-size:12px;">This alert has a 1-hour cooldown to prevent spam.</p>
    `;
    const result = await sendSmtpEmail({ to: adminEmail, subject, html, category: "internal_ops" });
    if (result && (result as { success?: boolean }).success === false) {
      await releaseAlertCooldown(cooldownKey);
    }
  } catch {
    await releaseAlertCooldown(cooldownKey);
  }
}

/**
 * Report the outcome of a single paid-provider call. Call this from every
 * adapter transport right after the HTTP response/exception is known.
 *
 * - `failure: true` with a billing/auth-shaped signal increments a durable
 *   per-provider consecutive-failure counter; hitting the threshold fires
 *   the (cooled-down) alert.
 * - Anything else (success, or a non-billing-shaped failure) resets the
 *   counter so a one-off blip doesn't accumulate toward the threshold.
 */
export async function recordPaidProviderCreditSignal(
  provider: PaidCreditProvider,
  input: { httpStatus?: number | null; message?: string | null; failure: boolean },
): Promise<void> {
  const billingLike = input.failure && looksLikeBillingOrAuthFailure(input);
  const key = counterKey(provider);
  try {
    if (billingLike) {
      const reason = input.httpStatus ? `HTTP ${input.httpStatus}` : String(input.message ?? "billing/auth failure").slice(0, 200);
      const { rows } = await pool.query(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ($1, jsonb_build_object('count', 1, 'reason', $2::text), now())
         ON CONFLICT (key) DO UPDATE
           SET value = jsonb_build_object(
                 'count', COALESCE((system_settings.value->>'count')::int, 0) + 1,
                 'reason', $2::text
               ),
               updated_at = now()
         RETURNING (value->>'count')::int AS count`,
        [key, reason],
      );
      const count = rows[0]?.count ?? 1;
      if (count >= CONSECUTIVE_FAILURE_THRESHOLD) {
        await sendAlert(provider, count, reason);
      }
    } else {
      // Cheap reset — only writes when there's actually a non-zero streak to clear.
      await pool.query(
        `UPDATE system_settings SET value = jsonb_build_object('count', 0), updated_at = now()
           WHERE key = $1 AND COALESCE((value->>'count')::int, 0) > 0`,
        [key],
      );
    }
  } catch (err) {
    console.warn(`[provider-credit-alert] Failed to record signal for ${provider}:`, (err as Error)?.message ?? err);
  }
}
