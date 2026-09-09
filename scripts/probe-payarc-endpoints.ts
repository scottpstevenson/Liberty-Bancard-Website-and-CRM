#!/usr/bin/env npx tsx
/**
 * probe-payarc-endpoints.ts — REV-06A Credential Authority Matrix Builder
 *
 * Probes every candidate Payarc sandbox endpoint with both credentials.
 * Records HTTP status, response shape, and authorization result.
 * Results are printed as a credential authority matrix.
 *
 * Usage: npx tsx scripts/probe-payarc-endpoints.ts
 */

// Base URLs to probe
// Payarc has two separate API bases:
//   Partner/Agent API — boarding, agent batch reports, residuals, disputes (agent-scoped)
//   Merchant API      — charges, deposits, statements, residuals, disputes (merchant-scoped)
//
// Sandbox hosts:    testapi.payarc.net  /  testap1.payarc.net
// Production hosts: api.payarc.net      /  ap1.payarc.net
//
// CONFIGURED_BASE comes from PAYARC_API_BASE_URL env var.
// If that points to api.payarc.net (production), the merchant API is ap1.payarc.net.
// If that points to testapi.payarc.net (sandbox), the merchant API is testap1.payarc.net.
const CONFIGURED_BASE = (process.env.PAYARC_API_BASE_URL || process.env.PAYARC_API_BASE || "https://api.payarc.net/v1").replace(/\/$/, "");

// Derive both API bases from the configured base (handles prod vs sandbox automatically)
const isSandbox = CONFIGURED_BASE.includes("testapi");
const PARTNER_API_BASE = CONFIGURED_BASE;  // The configured base IS the Partner/boarding API
const MERCHANT_API_BASE = isSandbox
  ? "https://testap1.payarc.net/v1"   // sandbox merchant API
  : "https://ap1.payarc.net/v1";      // production merchant API

const PARTNER_KEY = process.env.PAYARC_API_KEY;
const MERCHANT_KEY = process.env.PAYARC_MERCHANT_API_KEY;
const CLIENT_ID = process.env.PAYARC_CLIENT_ID;
const CLIENT_SECRET = process.env.PAYARC_CLIENT_SECRET;

// Auth schemes to try — Payarc gateway uses Bearer; some endpoints may use Token
const AUTH_SCHEMES = ["Bearer", "Token"] as const;

// OAuth2 token exchange — Payarc confirmed endpoint: POST /v1/oauth/token on api.payarc.net
// Accepts JSON body: { grant_type, client_id, client_secret }
// Also tries form-urlencoded as fallback.
async function fetchOAuthToken(baseUrl: string): Promise<string | null> {
  // Confirmed path from Payarc docs
  const tokenPath = "/v1/oauth/token";
  const attempts: Array<{ style: string; headers: Record<string,string>; body: string }> = [
    {
      style: "json",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    },
    {
      style: "form",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: CLIENT_ID!, client_secret: CLIENT_SECRET! }).toString(),
    },
    {
      style: "basic+form",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
    },
  ];

  for (const { style, headers, body } of attempts) {
    try {
      const r = await fetch(`${baseUrl}${tokenPath}`, {
        method: "POST", headers, body,
        signal: AbortSignal.timeout(15_000),
      });
      const status = r.status;
      const text = await r.text().catch(() => "");
      if (r.ok) {
        try {
          const json = JSON.parse(text);
          const token = json.access_token || json.token || json.api_token || json.bearer_token;
          if (token) {
            console.log(`  [oauth] ✓ Token exchange OK at ${baseUrl}${tokenPath} [${style}] (HTTP ${status})`);
            return token as string;
          }
        } catch {}
        console.log(`  [oauth] ${baseUrl}${tokenPath} [${style}] → HTTP ${status} (2xx but no token field in response)`);
      } else {
        console.log(`  [oauth] ${baseUrl}${tokenPath} [${style}] → HTTP ${status}`);
      }
    } catch (e: any) {
      console.log(`  [oauth] ${baseUrl}${tokenPath} [${style}] → ERR: ${e.message?.slice(0,80)}`);
    }
  }
  return null;
}

interface ProbeResult {
  label: string;
  credential: "partner" | "merchant";
  path: string;
  method: string;
  status: number | null;
  ok: boolean;
  authScheme?: string;
  error?: string;
  headers?: Record<string, string>;
}

async function probeWithScheme(
  key: string,
  base: string,
  path: string,
  method: string,
  scheme: string,
  body?: unknown,
): Promise<{ status: number | null; ok: boolean; headers: Record<string, string>; error?: string }> {
  try {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `${scheme} ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Source": "LibertyBancard-CRM-probe",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    // Read and immediately discard body content — never log it.
    // Response previews could expose MIDs, PANs, PII, or signing material.
    await r.text().catch(() => "");
    const headers: Record<string, string> = {};
    for (const h of ["content-type", "x-ratelimit-remaining", "x-ratelimit-limit", "www-authenticate"]) {
      const v = r.headers.get(h);
      if (v) headers[h] = v;
    }
    return { status: r.status, ok: r.ok, headers };
  } catch (e: any) {
    return { status: null, ok: false, headers: {}, error: e.message?.slice(0, 100) };
  }
}

async function probeOne(
  label: string,
  key: string,
  base: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<ProbeResult> {
  let best: ProbeResult | null = null;
  for (const scheme of AUTH_SCHEMES) {
    const r = await probeWithScheme(key, base, path, method, scheme, body);
    const result: ProbeResult = { label, credential: "partner", path, method, status: r.status, ok: r.ok, authScheme: scheme, headers: r.headers, error: r.error };
    if (r.ok) return result;
    if (!best || (r.status !== null && (best.status === null || r.status < best.status!))) best = result;
  }
  return best!;
}

async function main() {
  console.log(`\n[REV-06A] Payarc Endpoint Probes — Two-API Architecture`);
  console.log(`Partner API base (boarding):  ${PARTNER_API_BASE}`);
  console.log(`Merchant API base (data):     ${MERCHANT_API_BASE}`);
  console.log(`Configured base (env):        ${CONFIGURED_BASE}`);
  console.log(`Static partner key configured: ${!!PARTNER_KEY}`);
  console.log(`OAuth client credentials configured: ${!!(CLIENT_ID && CLIENT_SECRET)}`);
  console.log("─".repeat(80));

  // Step 1: OAuth2 token exchange — confirmed endpoint per Payarc docs:
  //   POST https://api.payarc.net/v1/oauth/token  { grant_type, client_id, client_secret }
  let oauthToken: string | null = null;
  if (CLIENT_ID && CLIENT_SECRET) {
    console.log("\n[oauth] Attempting token exchange at api.payarc.net/v1/oauth/token ...");
    oauthToken = await fetchOAuthToken("https://api.payarc.net");
    if (!oauthToken) oauthToken = await fetchOAuthToken("https://testapi.payarc.net");
    console.log(oauthToken ? "[oauth] Token obtained ✓" : "[oauth] Token exchange failed ✗");
  }
  console.log("");

  const today = new Date().toISOString().slice(0, 10);
  const lastMonth = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // ── PARTNER/AGENT API endpoints (api.payarc.net, PAYARC_API_KEY) ──────────────
  // Identity, boarding, agent batch reports, agent residuals, disputes
  const partnerEndpoints = [
    "/accounts/me",
    "/applicants?limit=1",
    "/merchants?limit=1",
    `/agent/batch/reports?from_date=${lastMonth}&to_date=${today}`,
    `/agent_residual/summary?from_date=${lastMonth}&to_date=${today}`,
    "/agent_residual/details",
    `/dispute-chart?report_date[gte]=${lastMonth}&report_date[lte]=${today}`,
    "/cases?limit=1",
    // Also try merchant-style paths on the partner base (in case same host)
    "/charges?limit=1",
    `/merchant_statements?from_date=${lastMonth}&to_date=${today}`,
    "/deposits?limit=1",
    "/residuals?limit=1",
    "/disputes?limit=1",
  ];

  // ── MERCHANT API endpoints (ap1.payarc.net, PAYARC_MERCHANT_API_KEY) ──────────
  // Confirmed from docs.payarc.net (sandbox base testap1.payarc.net):
  //   GET /v1/accounts      — List All Accounts
  //   GET /v1/merchant_statements?from_date=&to_date= — Get Statements (limit/page pagination)
  const merchantEndpoints = [
    "/accounts",
    "/accounts/me",
    "/charges?limit=1",
    `/merchant_statements?from_date=${lastMonth}&to_date=${today}`,
    "/deposits?limit=1",
    "/residuals?limit=1",
    "/disputes?limit=1",
    "/cases?limit=1",
    "/transactions?limit=1",
  ];

  const verified2xx: Array<{ path: string; base: string; credential: string; scheme: string }> = [];

  // Helper: probe a list of endpoints against a single base + key
  async function probeGroup(groupLabel: string, key: string | undefined, base: string, paths: string[]) {
    if (!key) { console.log(`\n── ${groupLabel}: key not configured — skip ──`); return; }
    console.log(`\n── ${groupLabel} (${base}) ──`);
    for (const path of paths) {
      const r = await probeOne(path, key, base, path);
      const mark = r.ok ? "✓" : "✗";
      console.log(`  ${mark} HTTP ${r.status ?? "ERR"} [${r.authScheme}] ${path}`);
      if (r.ok) verified2xx.push({ path, base, credential: groupLabel, scheme: r.authScheme! });
    }
  }

  // OAuth token (lower priority — mostly for future reference)
  const tokensToTry: Array<{ label: string; token: string; bases: string[] }> = [];
  if (oauthToken) {
    tokensToTry.push({ label: "oauth", token: oauthToken, bases: [CONFIGURED_BASE, MERCHANT_API_BASE] });
  }

  // 1. Partner key against Partner API base (testapi.payarc.net)
  await probeGroup("PARTNER_KEY → testapi (Partner API)", PARTNER_KEY, PARTNER_API_BASE, partnerEndpoints);

  // 2. Merchant key against Merchant API base (testap1.payarc.net) — the key discovery
  await probeGroup("MERCHANT_KEY → testap1 (Merchant API)", MERCHANT_KEY, MERCHANT_API_BASE, merchantEndpoints);

  // 2b. Merchant key against the SAME sandbox host as partner (testapi.payarc.net)
  // Per Payarc FAQ: "The base URL for both the Partner Hub and Merchant APIs is the same"
  // testap1.payarc.net may not resolve; try the confirmed-reachable sandbox host too
  await probeGroup("MERCHANT_KEY → testapi (same host, cross-probe)", MERCHANT_KEY, PARTNER_API_BASE, merchantEndpoints);

  // 3. Cross-probe: partner key against merchant base, merchant key against partner base
  await probeGroup("PARTNER_KEY → merchant base (cross-probe)", PARTNER_KEY, MERCHANT_API_BASE, ["/accounts/me", "/charges?limit=1", "/merchant_statements?from_date=" + lastMonth + "&to_date=" + today]);
  await probeGroup("MERCHANT_KEY → partner base (cross-probe)", MERCHANT_KEY, PARTNER_API_BASE, ["/accounts/me", "/charges?limit=1", "/applicants?limit=1"]);

  // 4. OAuth token if obtained
  for (const { label, token, bases } of tokensToTry) {
    for (const base of bases) {
      await probeGroup(`oauth → ${base}`, token, base, ["/accounts/me", "/charges?limit=1"]);
    }
  }

  console.log("\n" + "─".repeat(80));
  console.log("[REV-06A] CREDENTIAL AUTHORITY MATRIX SUMMARY");
  console.log("─".repeat(80));

  if (verified2xx.length === 0) {
    console.log("NO endpoints returned HTTP 2xx. All operations remain HeldResult.\n");
    console.log("Root cause possibilities:");
    console.log("  1. PAYARC_MERCHANT_API_KEY needs to be set (separate from PAYARC_API_KEY)");
    console.log("  2. Sandbox credentials may have expired — regenerate in Partner Hub");
    console.log("  3. Account may need additional permissions enabled by Payarc support");
  } else {
    console.log("Endpoints returning 2xx (candidates for implementation):");
    for (const r of verified2xx) {
      console.log(`  ✓ [${r.credential}/${r.scheme}] ${r.base}${r.path}`);
    }
    console.log("\nFor each verified endpoint, implement the adapter method and add its");
    console.log("operation string to a new processor_activation_snapshots row.");
  }

  console.log("\n[REV-06A] Probe complete.\n");
}

main().catch(console.error);
