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

/** Raw validation response used by the business-validation adapter. */
export interface ZeroBounceRawResponse {
  status: string;
  sub_status?: string;
  error?: string;
}

/**
 * Shared low-level ZeroBounce transport. Keeping provider URL construction in
 * this adapter prevents feature services from silently becoming alternate
 * paid-provider clients.
 */
export async function validateEmailRaw(
  email: string,
  apiKey: string,
  fetchImpl: ZeroBounceFetch = fetch,
): Promise<ZeroBounceRawResponse> {
  const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}&ip_address=`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  const { recordPaidProviderCreditSignal } = await import("../provider-credit-alert");
  if (!res.ok) {
    await recordPaidProviderCreditSignal("zerobounce", { httpStatus: res.status, failure: true });
    throw new Error(`ZB_HTTP_${res.status}`);
  }
  const parsed = await res.json() as ZeroBounceRawResponse;
  // ZeroBounce can return HTTP 200 with a body-level error (e.g. an invalid
  // API key or an account that has run out of credits) instead of a non-2xx
  // status — that must not be recorded as a success.
  const bodyError = typeof parsed?.error === "string" && parsed.error.trim() ? parsed.error.trim() : null;
  await recordPaidProviderCreditSignal("zerobounce", { httpStatus: res.status, message: bodyError, failure: Boolean(bodyError) });
  return parsed;
}

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
      const { recordPaidProviderCreditSignal } = await import("../provider-credit-alert");
      await recordPaidProviderCreditSignal("zerobounce", { httpStatus: res.status, failure: true });
      return {
        status: "unknown",
        provider: "zerobounce",
        verifiedAt: new Date().toISOString(),
        reason: res.status >= 500 ? "http_5xx" : "http_4xx",
        outcome: "unavailable",
      };
    }
    let data: { status: string; sub_status?: string; error?: string };
    try {
      data = (await res.json()) as { status: string; sub_status?: string; error?: string };
    } catch {
      return {
        status: "unknown",
        provider: "zerobounce",
        verifiedAt: new Date().toISOString(),
        reason: "parse_error",
        outcome: "unavailable",
      };
    }
    // ZeroBounce can return HTTP 200 with a body-level error (invalid API key,
    // account out of credits) instead of a non-2xx status — don't record that
    // as a success, or a real outage never accumulates a failure streak.
    const bodyError = typeof data.error === "string" && data.error.trim() ? data.error.trim() : null;
    const { recordPaidProviderCreditSignal } = await import("../provider-credit-alert");
    await recordPaidProviderCreditSignal("zerobounce", {
      httpStatus: res.status, message: bodyError, failure: Boolean(bodyError),
    });
    if (bodyError) {
      return {
        status: "unknown",
        provider: "zerobounce",
        verifiedAt: new Date().toISOString(),
        reason: "http_4xx",
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
