/** SendGrid Event Webhook contract. No network, database, credentials or message bodies. */
import { createPublicKey, verify } from "node:crypto";
export const SENDGRID_RETRY_GRACE_HOURS = 24;
export const FEEDBACK_PROBE_GAP_MS = 10 * 60_000;
export function verifySendGridSignature(
  raw: Buffer,
  signature: string | undefined,
  timestamp: string | undefined,
  publicKey: string,
  now = Date.now(),
) {
  try {
    if (
      !signature ||
      !timestamp ||
      !/^\d{9,12}$/.test(timestamp) ||
      raw.length > 1_048_576
    )
      return false;
    const at = Number(timestamp) * 1000;
    // SendGrid may retry for 24h. Durable event IDs provide replay protection inside that window.
    if (at > now + 60_000 || at < now - 25 * 3600_000) return false;
    const key = publicKey.includes("BEGIN PUBLIC KEY")
      ? createPublicKey(publicKey)
      : createPublicKey({
          key: Buffer.from(publicKey, "base64"),
          format: "der",
          type: "spki",
        });
    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    )
      return false;
    return verify(
      "sha256",
      Buffer.concat([Buffer.from(timestamp), raw]),
      key,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}
export function sendGridKind(event: Record<string, unknown>) {
  switch (event.event) {
    case "delivered":
      return "delivered" as const;
    case "spamreport":
      return "complaint" as const;
    case "unsubscribe":
    case "group_unsubscribe":
      return "explicit_unsubscribe" as const;
    case "open":
      return "open" as const;
    case "click":
      return "click" as const;
    // Blocked/temporary DSNs do not establish a hard bounce.
    case "bounce":
      return event.type === "bounce" && /^5\./.test(String(event.status ?? ""))
        ? ("hard_bounce" as const)
        : null;
    default:
      return null;
  }
}
export function continuousFeedbackCoverage(
  rows: Array<{
    healthy: boolean;
    observed_at: Date | string;
    identity_hash: string;
  }>,
  start: Date,
  end: Date,
  identity: string,
  now: Date,
) {
  if (end > now || end < start || !rows.length) return false;
  const all = [...rows].sort(
    (a, b) => +new Date(a.observed_at) - +new Date(b.observed_at),
  );
  let coveredFrom: number | null = null,
    last: number | null = null;
  for (const r of all) {
    const t = +new Date(r.observed_at);
    if (!r.healthy || r.identity_hash !== identity) {
      coveredFrom = last = null;
      continue;
    }
    if (last === null || t - last > FEEDBACK_PROBE_GAP_MS) coveredFrom = t;
    last = t;
    if (coveredFrom! <= +start && t >= +end) return true;
  }
  return false;
}
