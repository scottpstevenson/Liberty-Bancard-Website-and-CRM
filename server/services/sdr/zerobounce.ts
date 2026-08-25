export interface ZeroBounceResult {
  status: "valid" | "invalid" | "unsafe" | "unverified" | "unknown";
  provider: "zerobounce";
  verifiedAt: string;
  subStatus?: string | null;
  skipped?: boolean;
  /** Normalized only; never expose URLs, tokens, provider bodies, or raw errors. */
  reason?: "not_configured" | "http_4xx" | "http_5xx" | "timeout" | "transport" | "parse_error";
  outcome?: "completed" | "unavailable";
}

export type ZeroBounceFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function verifyEmail(
  email: string,
  opts: { fetchImpl?: ZeroBounceFetch; timeoutMs?: number } = {},
): Promise<ZeroBounceResult> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) {
    return {
      status: "unknown",
      provider: "zerobounce",
      verifiedAt: new Date().toISOString(),
      skipped: true,
      reason: "not_configured",
      outcome: "unavailable",
    };
  }

  try {
    const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}`;
    const fetchImpl = opts.fetchImpl ?? fetch;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
    if (!res.ok) {
      return {
        status: "unknown",
        provider: "zerobounce",
        verifiedAt: new Date().toISOString(),
        reason: res.status >= 500 ? "http_5xx" : "http_4xx",
        outcome: "unavailable",
      };
    }
    let data: { status: string; sub_status?: string };
    try {
      data = (await res.json()) as { status: string; sub_status?: string };
    } catch {
      return {
        status: "unknown",
        provider: "zerobounce",
        verifiedAt: new Date().toISOString(),
        reason: "parse_error",
        outcome: "unavailable",
      };
    }
    const raw = (data.status || "").toLowerCase();
    const subStatus = data.sub_status || null;

    let mapped: ZeroBounceResult["status"];
    if (raw === "valid") {
      mapped = "valid";
    } else if (["invalid", "abuse", "spamtrap", "do_not_mail"].includes(raw)) {
      mapped = "unsafe";
    } else if (["catch-all", "unknown"].includes(raw)) {
      mapped = "unverified";
    } else {
      mapped = "unknown";
    }

    return {
      status: mapped,
      provider: "zerobounce",
      verifiedAt: new Date().toISOString(),
      subStatus,
      outcome: "completed",
    };
  } catch (err: any) {
    return {
      status: "unknown",
      provider: "zerobounce",
      verifiedAt: new Date().toISOString(),
      reason: err?.name === "TimeoutError" || err?.name === "AbortError" ? "timeout" : "transport",
      outcome: "unavailable",
    };
  }
}
