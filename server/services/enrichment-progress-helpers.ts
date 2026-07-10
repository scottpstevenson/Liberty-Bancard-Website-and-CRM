export function sanitizeEnrichmentError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  let safe: string;
  if (
    lower.includes("connect") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("econnreset") ||
    lower.includes("tls") ||
    lower.includes("ssl") ||
    lower.includes("socket") ||
    lower.includes("network") ||
    lower.includes("authentication") ||
    lower.includes("password") ||
    lower.includes("credentials") ||
    lower.includes("unauthorized") ||
    lower.includes("403") ||
    lower.includes("401")
  ) {
    safe = "Database connection failed";
  } else if (
    lower.includes("provider") ||
    lower.includes("openai") ||
    lower.includes("serper") ||
    lower.includes("apify") ||
    lower.includes("apollo") ||
    lower.includes("fetch") ||
    lower.includes("request") ||
    lower.includes("timeout") ||
    lower.includes("rate limit") ||
    lower.includes("429")
  ) {
    safe = "Provider request failed";
  } else if (
    lower.includes("getsunbizentities") ||
    lower.includes("initialization") ||
    lower.includes("entities")
  ) {
    safe = "Enrichment initialization failed";
  } else {
    safe = "Unexpected batch failure";
  }

  // Strip control characters (newlines, tabs, chars < 0x20)
  // eslint-disable-next-line no-control-regex
  safe = safe.replace(/[\r\n\t\x00-\x1F]/g, "");

  // Cap at 120 characters
  return safe.slice(0, 120);
}

export function buildSafeEnrichmentFailureProgress(
  current: Record<string, unknown> | null,
  err: unknown,
  now: string
): Record<string, unknown> {
  return {
    ...(current ?? {}),
    status: "failed",
    failedAt: now,
    error: sanitizeEnrichmentError(err),
    interruptedAt: undefined,
    interruptionReason: undefined,
  };
}

export function isEnrichmentRunning(status: string | undefined): boolean {
  return status === "running";
}
