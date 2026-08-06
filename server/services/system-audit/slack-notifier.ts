import type { ProbeResult } from "./probes/ghl-sync";

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

export async function sendCriticalAlert(probe: ProbeResult, context?: string): Promise<void> {
  // Always persist to the admin alert feed regardless of Slack config
  try {
    const { persistAlert } = await import("../alert-feed");
    await persistAlert({
      severity: "critical",
      subsystem: probe.subsystem ?? "unknown",
      summary: context ?? probe.summary ?? "Critical alert fired",
      details: { probe },
    });
  } catch (_) {}

  const url = webhookUrl();
  if (!url) return;

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

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    console.error("[SystemAudit] sendCriticalAlert failed:", err.message);
  }
}
