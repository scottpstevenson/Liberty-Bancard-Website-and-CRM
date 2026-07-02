export interface ZeroBounceResult {
  status: "valid" | "invalid" | "unsafe" | "unverified" | "unknown";
  provider: "zerobounce";
  verifiedAt: string;
  subStatus?: string | null;
  skipped?: boolean;
  reason?: string;
}

export async function verifyEmail(email: string): Promise<ZeroBounceResult> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) {
    return {
      status: "unknown",
      provider: "zerobounce",
      verifiedAt: new Date().toISOString(),
      skipped: true,
      reason: "no_key",
    };
  }

  try {
    const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      return {
        status: "unknown",
        provider: "zerobounce",
        verifiedAt: new Date().toISOString(),
        reason: `http_${res.status}`,
      };
    }
    const data = (await res.json()) as { status: string; sub_status?: string };
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
    };
  } catch (err) {
    return {
      status: "unknown",
      provider: "zerobounce",
      verifiedAt: new Date().toISOString(),
      reason: String(err),
    };
  }
}
