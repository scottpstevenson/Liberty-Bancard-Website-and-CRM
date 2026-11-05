/**
 * One validator for a processor transport base URL (Stage 5 / R05). The activation-snapshot admin route, the
 * snapshot gate in the registry and the adapter transport all call this, so a URL accepted when the snapshot is
 * created is exactly what the transport accepts when it sends. Pure: no database, no network, no env access.
 *
 * Payarc rules: https, no userinfo, no explicit port, no query or fragment, path exactly /v1 (a trailing slash is
 * normalized away), host exactly the documented sandbox or production API host. Redirects are never followed by the
 * transport (see payarcRequest), so a documented host cannot bounce a credential elsewhere.
 */
export type ProcessorEnvironment = "sandbox" | "production";

export type ProcessorBaseUrlCheck =
  | { ok: true; baseUrl: string; environment: ProcessorEnvironment; host: string }
  | { ok: false; reason: string };

const PAYARC_HOSTS: Record<string, ProcessorEnvironment> = {
  "testapi.payarc.net": "sandbox",
  "api.payarc.net": "production",
};

export function checkProcessorBaseUrl(processorName: string, raw: unknown): ProcessorBaseUrlCheck {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reason: "base URL is required" };
  if (processorName.toLowerCase() !== "payarc") {
    return { ok: false, reason: `no base-URL allowlist is defined for processor '${processorName}'` };
  }
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, reason: "base URL is not a valid absolute URL" }; }
  if (u.protocol !== "https:") return { ok: false, reason: "base URL must use https" };
  if (u.username || u.password) return { ok: false, reason: "base URL must not contain credentials" };
  if (u.port) return { ok: false, reason: "base URL must not specify a port" };
  if (u.search || u.hash) return { ok: false, reason: "base URL must not contain a query or fragment" };
  if (u.pathname.replace(/\/+$/, "") !== "/v1") return { ok: false, reason: "base URL path must be exactly /v1" };
  const environment = PAYARC_HOSTS[u.hostname.toLowerCase()];
  if (!environment) return { ok: false, reason: `host '${u.hostname}' is not a documented Payarc API host (testapi.payarc.net or api.payarc.net)` };
  return { ok: true, baseUrl: `https://${u.hostname.toLowerCase()}/v1`, environment, host: u.hostname.toLowerCase() };
}

export type CredentialEnvironmentCheck = { ok: true } | { ok: false; reason: string };

/** The partner credential's declared environment (non-secret env var) must not contradict the host environment. */
export function checkPayarcPartnerEnvironment(host: ProcessorEnvironment, env: NodeJS.ProcessEnv = process.env): CredentialEnvironmentCheck {
  const raw = (env.PAYARC_PARTNER_KEY_ENVIRONMENT ?? "").trim().toLowerCase();
  if (raw === "") return { ok: true };
  if (raw !== "sandbox" && raw !== "production") return { ok: false, reason: "PAYARC_PARTNER_KEY_ENVIRONMENT is not 'sandbox' or 'production'" };
  return raw === host ? { ok: true } : { ok: false, reason: `the partner credential is declared for ${raw} but the snapshot host is ${host}` };
}
