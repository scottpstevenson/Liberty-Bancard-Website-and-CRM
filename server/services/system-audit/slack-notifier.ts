import type { ProbeResult } from "./probes/ghl-sync";
import { createHash } from "crypto";

function webhookUrl(): string | null {
  return process.env.SLACK_AUDIT_WEBHOOK_URL ?? null;
}

function statusEmoji(status: ProbeResult["status"]): string {
  return status === "ok" ? ":white_check_mark:" : status === "warn" ? ":warning:" : ":x:";
}

function overallEmoji(score: number): string {
  if (score >= 90) return ":white_check_mark:";
  if (score >= 60) return ":warning:";
  return ":rotating_light:";
}

function overallLabel(score: number): string {
  if (score >= 90) return "HEALTHY";
  if (score >= 60) return "DEGRADED";
  return "CRITICAL";
}

export async function sendAuditReport(opts: {
  runId: number;
  probeResults: ProbeResult[];
  overallScore: number;
  narrative: string | null;
}): Promise<{ status: "sent" | "not_configured" | "failed"; error?: string }> {
  const url = webhookUrl();
  if (!url) return { status: "not_configured" };

  try {
    const { runId, probeResults, overallScore, narrative } = opts;
    const emoji = overallEmoji(overallScore);
    const label = overallLabel(overallScore);

    const probeBlocks = probeResults.map(p => ({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${statusEmoji(p.status)} *${p.subsystem}* — ${p.summary}`,
      },
    }));

    const blocks: unknown[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${emoji} Weekly AI System Audit — ${label} (${overallScore}% passing)`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Run #${runId} | ${new Date().toLocaleDateString("en-US", {
              weekday: "long", year: "numeric", month: "long", day: "numeric",
            })} | ${probeResults.filter(p => p.status === "ok").length}/${probeResults.length} probes passing`,
          },
        ],
      },
      { type: "divider" },
      ...probeBlocks,
    ];

    if (narrative) {
      const truncated = narrative.length > 3000 ? narrative.slice(0, 3000) + "…" : narrative;
      blocks.push({ type: "divider" });
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Narrative*\n${truncated}` },
      });
    }

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "View Full Report" },
          url: `${process.env.APP_URL ?? "https://libertybancard.com"}/dashboard/system-audit`,
          action_id: "view_audit_report",
        },
      ],
    });

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { status: "failed", error: `Slack ${response.status}: ${body.slice(0, 200)}` };
    }
    return { status: "sent" };
  } catch (err: any) {
    return { status: "failed", error: err.message };
  }
}

export type CriticalAlertResult = {
  claimStatus: "claimed" | "duplicate" | "unavailable";
  feedStatus: "persisted" | "duplicate" | "failed";
  transportStatus: "sent" | "not_configured" | "skipped_duplicate" | "skipped_test" | "skipped_unclaimed" | "failed";
  incidentFingerprint: string;
  alertId?: number;
  feedCreatedAt?: string;
  retryAt?: string;
  error?: string;
};

export async function sendCriticalAlert(probe: ProbeResult, context?: string): Promise<CriticalAlertResult> {
  const { alertFingerprint } = await import("../alert-feed");
  const alert = {
    severity: "critical" as const,
    subsystem: probe.subsystem ?? "unknown",
    summary: context ?? probe.summary ?? "Critical alert fired",
    details: { probe },
    incidentBucket: new Date().toISOString().slice(0, 13),
  };
  const incidentFingerprint = alertFingerprint(alert);
  let claimStatus: CriticalAlertResult["claimStatus"] = "unavailable";
  let claimKey: string | null = null;
  let redis: ReturnType<typeof import("../queue-connection")["getSharedRedisClientIfReady"]> = null;
  const retryLeaseSeconds = 60;
  const deliveredCooldownSeconds = 60 * 60;
  try {
    const { getBullMqTestPrefix, getSharedRedisClientIfReady } = await import("../queue-connection");
    redis = getSharedRedisClientIfReady();
    if (redis) {
      const namespace = getBullMqTestPrefix() ?? "bull:";
      claimKey = `${namespace}system-alert-transport:${createHash("sha256").update(incidentFingerprint).digest("base64url")}`;
      const claimed = await redis.set(claimKey, "claimed", "EX", retryLeaseSeconds, "NX");
      claimStatus = claimed === "OK" ? "claimed" : "duplicate";
    }
  } catch (err: any) {
    console.error("[SystemAudit] critical alert claim failed:", err?.message ?? "unknown");
  }

  // Feed persistence is independent from rate-claim and Slack availability.
  let feedStatus: CriticalAlertResult["feedStatus"] = "failed";
  let alertId: number | undefined;
  let feedCreatedAt: string | undefined;
  try {
    const { persistAlert } = await import("../alert-feed");
    const stored = await persistAlert(alert);
    feedStatus = stored.created ? "persisted" : "duplicate";
    alertId = stored.alertId;
    feedCreatedAt = stored.createdAt;
  } catch (err: any) {
    console.error("[SystemAudit] critical alert feed failed:", err?.message ?? "unknown");
  }

  const url = webhookUrl();
  const base = { claimStatus, feedStatus, incidentFingerprint, alertId, feedCreatedAt };
  if (process.env.NODE_ENV === "test") return { ...base, transportStatus: "skipped_test" };
  if (claimStatus === "duplicate") return { ...base, transportStatus: "skipped_duplicate" };
  if (claimStatus !== "claimed") return { ...base, transportStatus: "skipped_unclaimed" };
  if (!url) {
    if (redis && claimKey) await redis.del(claimKey).catch(() => 0);
    return { ...base, transportStatus: "not_configured" };
  }

  try {
    const body = {
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `:rotating_light: Critical Alert — ${probe.subsystem}`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${probe.summary}*${context ? `\n_Context: ${context}_` : ""}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Fired at ${new Date().toISOString()} | <${process.env.APP_URL ?? "https://libertybancard.com"}/dashboard/system-audit|View System Audit>`,
            },
          ],
        },
      ],
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const retryAt = new Date(Date.now() + retryLeaseSeconds * 1000).toISOString();
      return { ...base, transportStatus: "failed", retryAt, error: `Slack HTTP ${response.status}` };
    }
    if (redis && claimKey) await redis.expire(claimKey, deliveredCooldownSeconds);
    return { ...base, transportStatus: "sent" };
  } catch (err: any) {
    console.error("[SystemAudit] sendCriticalAlert failed:", err.message);
    return {
      ...base,
      transportStatus: "failed",
      retryAt: new Date(Date.now() + retryLeaseSeconds * 1000).toISOString(),
      error: err?.message ?? "transport_failed",
    };
  }
}
