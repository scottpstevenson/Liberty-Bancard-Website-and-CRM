/**
 * Integration Validator — safe read-only probes for all required secrets and providers.
 *
 * SECURITY CONTRACT:
 *   - Never log, serialize, hash, or return secret values.
 *   - Probes are read-only and non-billable where possible.
 *   - Each result exposes only: presence, format validity, live test outcome,
 *     safe non-sensitive identity metadata, and actionable diagnosis.
 *   - Error objects from fetch calls are scrubbed of Authorization headers before surfacing.
 */

import { pool } from "../db";

export type LiveStatus = "pass" | "fail" | "unverified" | "skipped";
export type Importance = "required_launch" | "required_feature" | "optional";

export interface CheckResult {
  key: string;
  category: "CORE" | "GHL" | "EMAIL" | "ENRICHMENT" | "ALERTS" | "COVERAGE";
  label: string;
  present: boolean;
  formatValid: boolean | null;
  liveStatus: LiveStatus;
  identity: string | null;
  diagnosisHint: string | null;
  ownerAction: string | null;
  lastTestedAt: string;
  importance: Importance;
  featureName?: string;
}

export interface ValidationReport {
  runAt: string;
  checks: CheckResult[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    unverified: number;
    skipped: number;
    requiredLaunchFailing: number;
  };
  goNoGo: "GO" | "NO-GO";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toISOString();
}

/** Scrub an error message of any Authorization header leakage before surfacing. */
function sanitizeError(msg: string): string {
  return msg
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/password=\S+/gi, "password=[REDACTED]")
    .replace(/:([^@]+)@/g, ":[REDACTED]@");
}

// ── 1. CORE RUNTIME ──────────────────────────────────────────────────────────

async function checkDatabase(): Promise<CheckResult> {
  const present = !!process.env.DATABASE_URL;
  if (!present) {
    return {
      key: "DATABASE_URL", category: "CORE", label: "PostgreSQL (DATABASE_URL)",
      present: false, formatValid: false, liveStatus: "fail",
      identity: null,
      diagnosisHint: "DATABASE_URL not set — server cannot start",
      ownerAction: "Add DATABASE_URL to Replit Secrets",
      lastTestedAt: ts(), importance: "required_launch",
    };
  }
  const client = await pool.connect().catch(() => null);
  if (!client) {
    return {
      key: "DATABASE_URL", category: "CORE", label: "PostgreSQL (DATABASE_URL)",
      present: true, formatValid: null, liveStatus: "fail",
      identity: null, diagnosisHint: "Pool connection failed",
      ownerAction: "Verify DATABASE_URL credentials and host accessibility",
      lastTestedAt: ts(), importance: "required_launch",
    };
  }
  try {
    await client.query("BEGIN");
    const res = await client.query(
      "SELECT current_database() AS db, version() AS ver, pg_postmaster_start_time() AS started"
    );
    await client.query("ROLLBACK");
    const row = res.rows[0];
    const dbName = row.db as string;
    const ver = ((row.ver as string) || "").split(" ").slice(0, 2).join(" ");
    return {
      key: "DATABASE_URL", category: "CORE", label: "PostgreSQL (DATABASE_URL)",
      present: true, formatValid: true, liveStatus: "pass",
      identity: `db=${dbName} (${ver})`,
      diagnosisHint: null, ownerAction: null,
      lastTestedAt: ts(), importance: "required_launch",
    };
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    return {
      key: "DATABASE_URL", category: "CORE", label: "PostgreSQL (DATABASE_URL)",
      present: true, formatValid: null, liveStatus: "fail",
      identity: null, diagnosisHint: sanitizeError(err.message),
      ownerAction: "Check DATABASE_URL credentials and network access",
      lastTestedAt: ts(), importance: "required_launch",
    };
  } finally {
    client.release();
  }
}

async function checkRedis(): Promise<CheckResult> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return {
      key: "REDIS_URL", category: "CORE", label: "Redis / BullMQ (REDIS_URL)",
      present: false, formatValid: false, liveStatus: "fail",
      identity: "Using in-memory mock — jobs lost on restart",
      diagnosisHint: "REDIS_URL not set — BullMQ falls back to ioredis-mock; job state is not durable across restarts",
      ownerAction: "Set REDIS_URL to an Upstash or Redis Cloud connection string in Replit Secrets",
      lastTestedAt: ts(), importance: "required_launch",
    };
  }

  let formatValid = false;
  let hostHint = "unknown";
  let isTls = false;
  try {
    const u = new URL(redisUrl);
    formatValid = (u.protocol === "redis:" || u.protocol === "rediss:");
    isTls = u.protocol === "rediss:" || u.hostname.includes("upstash.io");
    hostHint = u.hostname.length > 8 ? `${u.hostname.slice(0, 8)}…` : u.hostname;
  } catch {}

  try {
    const Redis = (await import("ioredis")).default;
    const u = new URL(redisUrl);
    const isTlsConn = u.protocol === "rediss:" || u.hostname.includes("upstash.io");
    const client = new Redis({
      host: u.hostname,
      port: parseInt(u.port || "6379", 10),
      password: u.password || undefined,
      username: u.username || undefined,
      tls: isTlsConn ? {} : undefined,
      connectTimeout: 8000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableReadyCheck: false,
    });
    await client.connect();
    const probeKey = `lb:readiness-probe:${Date.now()}`;
    await client.set(probeKey, "1", "EX", 10);
    const val = await client.get(probeKey);
    await client.del(probeKey);
    await client.quit();
    const roundtrip = val === "1";
    return {
      key: "REDIS_URL", category: "CORE", label: "Redis / BullMQ (REDIS_URL)",
      present: true, formatValid,
      liveStatus: roundtrip ? "pass" : "fail",
      identity: `host=${hostHint} tls=${isTls}`,
      diagnosisHint: roundtrip ? null : "SET/GET/DEL round-trip mismatch — check Redis ACL permissions",
      ownerAction: null,
      lastTestedAt: ts(), importance: "required_launch",
    };
  } catch (err: any) {
    return {
      key: "REDIS_URL", category: "CORE", label: "Redis / BullMQ (REDIS_URL)",
      present: true, formatValid,
      liveStatus: "fail",
      identity: `host=${hostHint}`,
      diagnosisHint: sanitizeError(err.message),
      ownerAction: "Verify REDIS_URL credentials, TLS setting, and host accessibility",
      lastTestedAt: ts(), importance: "required_launch",
    };
  }
}

function checkAppUrl(): CheckResult {
  const val = process.env.APP_URL;
  if (!val) {
    return {
      key: "APP_URL", category: "CORE", label: "Canonical App URL (APP_URL)",
      present: false, formatValid: false, liveStatus: "fail",
      identity: null,
      diagnosisHint: "APP_URL not set — email links, unsubscribe tokens, and CORS origin will use static fallback",
      ownerAction: "Set APP_URL=https://libertybancard.com in Replit Secrets",
      lastTestedAt: ts(), importance: "required_launch",
    };
  }
  let formatValid = false;
  let httpsOk = false;
  let hostname = "";
  try {
    const u = new URL(val);
    formatValid = true;
    httpsOk = u.protocol === "https:";
    hostname = u.hostname;
  } catch {}
  return {
    key: "APP_URL", category: "CORE", label: "Canonical App URL (APP_URL)",
    present: true, formatValid,
    liveStatus: formatValid && httpsOk ? "pass" : "fail",
    identity: hostname || val.slice(0, 40),
    diagnosisHint: !formatValid ? "Not a valid URL"
      : !httpsOk ? "Must use https:// — http:// breaks email link security and cookie SameSite"
      : null,
    ownerAction: !httpsOk ? "Set APP_URL=https://libertybancard.com (https required)" : null,
    lastTestedAt: ts(), importance: "required_launch",
  };
}

function checkCryptoSecret(
  key: string, label: string, minLen = 32, importance: Importance = "required_launch"
): CheckResult {
  const val = process.env[key];
  if (!val) {
    return {
      key, category: "CORE", label,
      present: false, formatValid: false, liveStatus: "fail",
      identity: null,
      diagnosisHint: `${key} not set — cryptographic operations using this secret will fail or use an insecure fallback`,
      ownerAction: `Set ${key} in Replit Secrets (openssl rand -base64 ${Math.ceil(minLen * 0.75)} generates a strong value)`,
      lastTestedAt: ts(), importance,
    };
  }
  const lenOk = val.length >= minLen;
  return {
    key, category: "CORE", label,
    present: true, formatValid: lenOk,
    liveStatus: lenOk ? "pass" : "fail",
    identity: `length=${val.length} chars`,
    diagnosisHint: !lenOk ? `Secret is only ${val.length} chars — minimum ${minLen} required for cryptographic strength` : null,
    ownerAction: !lenOk ? `Replace ${key} with a longer random secret` : null,
    lastTestedAt: ts(), importance,
  };
}

// ── 2. GHL ───────────────────────────────────────────────────────────────────

async function checkGhlToken(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  const webhookSecret = process.env.GHL_WEBHOOK_SECRET;
  const base = process.env.GHL_API_BASE || "https://services.leadconnectorhq.com";
  const usingPrivate = !!process.env.GHL_PRIVATE_INTEGRATION_TOKEN;

  const tokenPresent = !!token;
  const tokenFormatOk = tokenPresent && token!.startsWith("pit-") && token!.length >= 36;
  const locationPresent = !!locationId;
  const locationFormatOk = locationPresent && locationId!.length >= 16 && locationId!.length <= 30;

  // Webhook secret sanity: GHL webhook secrets should NOT be PIT tokens.
  const webhookLooksLikePIT = webhookSecret?.startsWith("pit-") && (webhookSecret?.length ?? 0) >= 36;

  // Token probe result — hoisted so location-ID check can inherit it
  let tokenProbeLiveStatus: LiveStatus = "unverified";

  if (!tokenPresent || !locationPresent) {
    results.push({
      key: "GHL_PRIVATE_INTEGRATION_TOKEN", category: "GHL", label: "GHL Token + Location Probe",
      present: tokenPresent, formatValid: null, liveStatus: "fail",
      identity: null,
      diagnosisHint: !tokenPresent
        ? "GHL_PRIVATE_INTEGRATION_TOKEN not set — GHL sync disabled"
        : "GHL_LOCATION_ID not set — cannot probe token access",
      ownerAction: !tokenPresent
        ? "Set GHL_PRIVATE_INTEGRATION_TOKEN from GHL → Settings → Private Integrations"
        : "Set GHL_LOCATION_ID from GHL → Settings → Business Profile → Location ID",
      lastTestedAt: ts(), importance: "required_launch",
    });
  } else {
    const locationMasked = `${locationId!.slice(0, 4)}…${locationId!.slice(-4)}`;
    const tokenSource = usingPrivate ? "GHL_PRIVATE_INTEGRATION_TOKEN (pit-*)" : "GHL_API_KEY";

    let liveStatus: LiveStatus = "fail";
    let locationName: string | null = null;
    let returnedId: string | null = null;
    let diagnosisHint: string | null = null;
    let ownerAction: string | null = null;
    let httpStatus = 0;

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      let resp: Response;
      try {
        resp = await fetch(`${base}/locations/${locationId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Version: "2021-07-28",
            "Content-Type": "application/json",
          },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }

      httpStatus = resp.status;

      if (resp.status === 200) {
        const data = await resp.json().catch(() => ({}));
        locationName = data?.location?.name || data?.name || null;
        returnedId = data?.location?.id || data?.id || null;

        if (returnedId && returnedId !== locationId) {
          liveStatus = "fail";
          tokenProbeLiveStatus = "fail";
          diagnosisHint = `Token authenticated but returned location ID …${returnedId.slice(-4)} — does not match configured GHL_LOCATION_ID …${locationId.slice(-4)}. Token is scoped to a different location.`;
          ownerAction = `Update GHL_LOCATION_ID to match the location this token covers, or regenerate the token inside the correct GHL sub-account, then restart the app.`;
        } else {
          liveStatus = "pass";
          tokenProbeLiveStatus = "pass";
        }
      } else if (resp.status === 401) {
        liveStatus = "fail";
        diagnosisHint = `GHL returned 401 Unauthorized — token is invalid or expired. Token format: ${tokenFormatOk ? "valid (pit-*)" : "unexpected"}. Source: ${tokenSource}.`;
        ownerAction = `Regenerate the token in GHL → Settings → Private Integrations → your integration → Regenerate. Update GHL_PRIVATE_INTEGRATION_TOKEN in Replit Secrets, then restart the app.`;
      } else if (resp.status === 403) {
        const body = await resp.json().catch(() => ({}));
        const msg = (body as any)?.message || "";
        liveStatus = "fail";
        diagnosisHint = [
          `GHL returned 403 for location ID ${locationMasked}.`,
          `GHL message: "${msg}".`,
          `Token format: ${tokenFormatOk ? "valid (pit-* format, 40 chars)" : "unexpected format"}.`,
          `Token source: ${tokenSource}.`,
          `API base: ${base}. Version header: 2021-07-28.`,
          `Most likely cause: the Private Integration Token was created inside a DIFFERENT GHL sub-account than the one identified by GHL_LOCATION_ID ${locationMasked}. PITs are scoped to the sub-account where they are created.`,
          webhookLooksLikePIT ? `⚠ CONFIGURATION NOTE: GHL_WEBHOOK_SECRET also has pit-* format — confirm these two secrets are not accidentally swapped.` : null,
          `User confirmed secrets were reviewed recently. If the token value in Replit Secrets is correct, the GHL_LOCATION_ID (${locationMasked}) must be verified against the sub-account where the token was created.`,
        ].filter(Boolean).join(" "),
        ownerAction = [
          `1. In GHL: open the specific sub-account for location ${locationMasked}.`,
          `2. Go to Settings → Private Integrations.`,
          `3. Find or create the integration — copy its exact token.`,
          `4. Update GHL_PRIVATE_INTEGRATION_TOKEN in Replit Secrets.`,
          `5. Cross-check: Settings → Business Profile → Location ID must match GHL_LOCATION_ID ${locationMasked}.`,
          `6. Restart the app (Replit Secrets take effect on restart, not hot-reload).`,
        ].join(" ");
      } else {
        liveStatus = "fail";
        const body = await resp.text().catch(() => "");
        diagnosisHint = `Unexpected HTTP ${resp.status}. Check GHL service status at status.gohighlevel.com. Response: ${body.slice(0, 120)}`;
        ownerAction = "Check GHL service status";
      }
    } catch (err: any) {
      liveStatus = "fail";
      diagnosisHint = err.name === "AbortError"
        ? "GHL location probe timed out after 12s — network issue or GHL outage"
        : sanitizeError(err.message);
      ownerAction = "Check network connectivity and GHL service status";
    }

    results.push({
      key: "GHL_PRIVATE_INTEGRATION_TOKEN", category: "GHL", label: "GHL Token + Location Probe",
      present: tokenPresent, formatValid: tokenFormatOk,
      liveStatus,
      identity: [
        locationName ? `Location: "${locationName}"` : null,
        `ID: ${locationMasked}`,
        httpStatus > 0 ? `HTTP ${httpStatus}` : null,
        `api: ${base === "https://services.leadconnectorhq.com" ? "services.leadconnectorhq.com" : "custom"}`,
        `ver: 2021-07-28`,
      ].filter(Boolean).join(" · "),
      diagnosisHint,
      ownerAction,
      lastTestedAt: ts(), importance: "required_launch",
    });
  }

  // Webhook secret
  results.push({
    key: "GHL_WEBHOOK_SECRET", category: "GHL", label: "GHL Webhook Signature Secret",
    present: !!webhookSecret, formatValid: !!webhookSecret && webhookSecret.length >= 16,
    liveStatus: webhookSecret && webhookSecret.length >= 16 ? "pass" : "fail",
    identity: webhookSecret
      ? `length=${webhookSecret.length}${webhookLooksLikePIT ? " — ⚠ has pit-* format, verify not swapped with token" : ""}`
      : null,
    diagnosisHint: !webhookSecret
      ? "Not set — incoming GHL webhooks cannot be signature-verified; all webhook payloads would be accepted as trusted"
      : webhookSecret.length < 16 ? "Too short — minimum 16 chars for a secure webhook secret"
      : webhookLooksLikePIT ? "Webhook secret has PIT token format (pit-*). Confirm GHL_WEBHOOK_SECRET and GHL_PRIVATE_INTEGRATION_TOKEN are not swapped. Webhook secret should be a manually configured string from GHL → Settings → Webhooks → your endpoint → Signing Key."
      : null,
    ownerAction: !webhookSecret
      ? "Set GHL_WEBHOOK_SECRET from GHL → Settings → Webhooks → your endpoint → Signing Key"
      : null,
    lastTestedAt: ts(), importance: "required_launch",
  });

  // Location ID standalone — inherit live status from the token probe
  const locationLiveStatus: LiveStatus = !locationPresent || !locationFormatOk
    ? "fail"
    : tokenProbeLiveStatus === "pass" ? "pass"   // token probe confirmed this location
    : tokenProbeLiveStatus === "fail" ? "fail"
    : "unverified";
  results.push({
    key: "GHL_LOCATION_ID", category: "GHL", label: "GHL Location ID",
    present: locationPresent, formatValid: locationFormatOk,
    liveStatus: locationLiveStatus,
    identity: locationPresent ? `${locationId!.slice(0, 4)}…${locationId!.slice(-4)} (${locationId!.length} chars)` : null,
    diagnosisHint: !locationPresent ? "Not set"
      : !locationFormatOk ? `Unexpected length (${locationId!.length}) — GHL location IDs are typically 16-24 characters`
      : null,
    ownerAction: !locationPresent
      ? "Set GHL_LOCATION_ID from GHL → Settings → Business Profile → Location ID"
      : null,
    lastTestedAt: ts(), importance: "required_launch",
  });

  return results;
}

async function checkGhlCapabilities(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  const base = process.env.GHL_API_BASE || "https://services.leadconnectorhq.com";

  if (!token || !locationId) return results;

  const headers = {
    Authorization: `Bearer ${token}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
  };

  // Pipeline check
  try {
    const resp = await fetch(
      `${base}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
      { headers, signal: AbortSignal.timeout(10000) }
    );
    if (resp.status === 200) {
      const data = await resp.json().catch(() => ({}));
      const pipelines: any[] = data?.pipelines || [];
      const names = pipelines.map((p: any) => p.name).slice(0, 4).join(", ");
      results.push({
        key: "GHL_PIPELINE", category: "GHL", label: "GHL Pipelines (capabilities probe)",
        present: true, formatValid: true,
        liveStatus: pipelines.length > 0 ? "pass" : "fail",
        identity: pipelines.length > 0 ? `${pipelines.length} pipeline(s): ${names}` : "No pipelines found",
        diagnosisHint: pipelines.length === 0 ? "No pipelines in this GHL location — create one in GHL → CRM → Pipelines" : null,
        ownerAction: null, lastTestedAt: ts(),
        importance: "required_feature", featureName: "Deal pipeline sync",
      });
    } else {
      results.push({
        key: "GHL_PIPELINE", category: "GHL", label: "GHL Pipelines (capabilities probe)",
        present: true, formatValid: null, liveStatus: resp.status === 403 || resp.status === 401 ? "fail" : "unverified",
        identity: `HTTP ${resp.status}`,
        diagnosisHint: `Pipeline fetch returned HTTP ${resp.status} — likely a token/scope issue`,
        ownerAction: null, lastTestedAt: ts(),
        importance: "required_feature", featureName: "Deal pipeline sync",
      });
    }
  } catch (err: any) {
    results.push({
      key: "GHL_PIPELINE", category: "GHL", label: "GHL Pipelines (capabilities probe)",
      present: true, formatValid: null, liveStatus: "unverified",
      identity: null, diagnosisHint: sanitizeError(err.message),
      ownerAction: null, lastTestedAt: ts(),
      importance: "required_feature", featureName: "Deal pipeline sync",
    });
  }

  // Custom fields — lb_* reconciliation
  try {
    const resp = await fetch(`${base}/locations/${locationId}/customFields`, { headers, signal: AbortSignal.timeout(10000) });
    if (resp.status === 200) {
      const data = await resp.json().catch(() => ({}));
      const fields: any[] = data?.customFields || [];
      const lbFields = fields.filter((f: any) => (f.fieldKey || f.key || "").startsWith("lb_"));
      const { REQUIRED_CUSTOM_FIELDS } = await import("./sdr/ghl-client");
      const existingKeys = new Set(lbFields.map((f: any) => f.fieldKey || f.key));
      const missing = REQUIRED_CUSTOM_FIELDS.filter((f) => !existingKeys.has(f.key));
      results.push({
        key: "GHL_CUSTOM_FIELDS", category: "GHL", label: "GHL lb_* Custom Fields",
        present: true, formatValid: true,
        liveStatus: missing.length === 0 ? "pass" : "fail",
        identity: `${lbFields.length} lb_* fields present, ${missing.length} missing of ${REQUIRED_CUSTOM_FIELDS.length} required`,
        diagnosisHint: missing.length > 0
          ? `Missing: ${missing.slice(0, 6).map((f) => f.key).join(", ")}${missing.length > 6 ? ` +${missing.length - 6} more` : ""}`
          : null,
        ownerAction: missing.length > 0
          ? "Run POST /api/admin/ghl/bootstrap-fields to create missing lb_* fields in GHL"
          : null,
        lastTestedAt: ts(), importance: "required_feature", featureName: "GHL contact sync / SDR scoring",
      });
    } else {
      results.push({
        key: "GHL_CUSTOM_FIELDS", category: "GHL", label: "GHL lb_* Custom Fields",
        present: true, formatValid: null,
        liveStatus: resp.status === 403 || resp.status === 401 ? "fail" : "unverified",
        identity: `HTTP ${resp.status}`,
        diagnosisHint: "Cannot fetch GHL custom fields — resolve token/location issue first",
        ownerAction: null, lastTestedAt: ts(),
        importance: "required_feature", featureName: "GHL contact sync",
      });
    }
  } catch (err: any) {
    results.push({
      key: "GHL_CUSTOM_FIELDS", category: "GHL", label: "GHL lb_* Custom Fields",
      present: true, formatValid: null, liveStatus: "unverified",
      identity: null, diagnosisHint: sanitizeError(err.message),
      ownerAction: null, lastTestedAt: ts(),
      importance: "required_feature", featureName: "GHL contact sync",
    });
  }

  return results;
}

function checkGhlWorkflowEnvs(): CheckResult[] {
  const items = [
    { key: "GHL_WORKFLOW_MERCHANT_APP", label: "Workflow: Merchant Application", feature: "Merchant onboarding confirmation" },
    { key: "GHL_WORKFLOW_MERCHANT_APPROVED", label: "Workflow: Merchant Approved", feature: "Merchant portal welcome email" },
    { key: "GHL_WORKFLOW_PARTNER_WELCOME", label: "Workflow: Partner Welcome", feature: "Partner portal onboarding" },
    { key: "GHL_WORKFLOW_STATEMENT", label: "Workflow: Statement Upload", feature: "Statement review pipeline trigger" },
    { key: "GHL_WORKFLOW_INBOUND_LEAD", label: "Workflow: Inbound Lead", feature: "Inbound lead capture sequence" },
    { key: "GHL_WORKFLOW_COLD_OUTBOUND", label: "Workflow: Cold Outbound", feature: "SDR cold outreach sequences" },
    { key: "GHL_WORKFLOW_AFFILIATE_WELCOME", label: "Workflow: Affiliate Welcome", feature: "Affiliate program enrollment" },
    { key: "GHL_PIPELINE_ID", label: "GHL Sales Pipeline ID", feature: "Deal sync to GHL sales pipeline" },
    { key: "GHL_ONBOARDING_PIPELINE_ID", label: "GHL Onboarding Pipeline ID", feature: "Merchant onboarding pipeline sync" },
    { key: "GHL_CALENDAR_ID", label: "GHL Calendar ID", feature: "Appointment booking integration" },
    { key: "GHL_CALENDAR_BOOKING_URL", label: "GHL Booking URL", feature: "Meeting booking link in emails" },
  ];

  return items.map(({ key, label, feature }) => {
    const val = process.env[key];
    const present = !!val;
    const fmtOk = present && val!.trim().length >= 6;
    return {
      key, category: "GHL" as const, label,
      present, formatValid: present ? fmtOk : null,
      liveStatus: present ? "unverified" as const : "skipped" as const,
      identity: present ? `…${val!.trim().slice(-6)}` : null,
      diagnosisHint: !present ? `Not set — ${feature} will be unavailable` : null,
      ownerAction: !present ? `Set ${key} from GHL → Automation → Workflows or Settings` : null,
      lastTestedAt: ts(), importance: "required_feature" as const, featureName: feature,
    };
  });
}

// ── 3a. GMAIL OAUTH ───────────────────────────────────────────────────────────

async function checkGmailOAuth(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const secretsPresent = !!(clientId && clientSecret);

  results.push({
    key: "GOOGLE_CLIENT_ID", category: "EMAIL" as const,
    label: "Gmail OAuth — GOOGLE_CLIENT_ID",
    present: !!clientId, formatValid: clientId ? clientId.trim().length > 10 : null,
    liveStatus: clientId ? "unverified" as const : "skipped" as const,
    identity: clientId ? `…${clientId.slice(-8)}` : null,
    diagnosisHint: !clientId ? "Not set — Gmail OAuth unavailable; cold email falls back to GHL, department email falls back to GHL" : null,
    ownerAction: !clientId ? "Create OAuth 2.0 credentials in Google Cloud Console → APIs & Services → Credentials" : null,
    lastTestedAt: ts(), importance: "optional" as const, featureName: "Gmail OAuth (staff/department email)",
  });

  results.push({
    key: "GOOGLE_CLIENT_SECRET", category: "EMAIL" as const,
    label: "Gmail OAuth — GOOGLE_CLIENT_SECRET",
    present: !!clientSecret, formatValid: clientSecret ? clientSecret.trim().length > 10 : null,
    liveStatus: clientSecret ? "unverified" as const : "skipped" as const,
    identity: null,
    diagnosisHint: !clientSecret ? "Not set — Gmail OAuth unavailable" : null,
    ownerAction: !clientSecret ? "Add GOOGLE_CLIENT_SECRET to Replit Secrets" : null,
    lastTestedAt: ts(), importance: "optional" as const, featureName: "Gmail OAuth (staff/department email)",
  });

  if (secretsPresent) {
    try {
      const { getGmailOAuthStatus } = await import("./gmail-oauth");
      const status = await getGmailOAuthStatus();
      results.push({
        key: "GMAIL_OAUTH_CONNECTED", category: "EMAIL" as const,
        label: "Gmail OAuth — Token Connected",
        present: status.connected, formatValid: status.connected ? true : null,
        liveStatus: status.connected ? "pass" as const : "fail" as const,
        identity: status.connected ? (status.email || "connected") : null,
        diagnosisHint: !status.connected ? "OAuth refresh token not stored — complete the flow at /dashboard/outbound-readiness" : null,
        ownerAction: !status.connected ? "Visit /dashboard/outbound-readiness → click 'Connect Gmail'" : null,
        lastTestedAt: ts(), importance: "optional" as const, featureName: "Gmail OAuth token storage",
      });
      if (status.connected && status.aliases.length > 0) {
        results.push({
          key: "GMAIL_SEND_AS_ALIASES", category: "EMAIL" as const,
          label: "Gmail Send-As Aliases",
          present: true, formatValid: true,
          liveStatus: "pass" as const,
          identity: status.aliases.slice(0, 3).join(", "),
          diagnosisHint: null, ownerAction: null,
          lastTestedAt: ts(), importance: "optional" as const, featureName: "Gmail verified send-as addresses",
        });
      }
    } catch (_statusErr) {
      // Non-fatal — secrets present but couldn't query DB
    }
  }

  return results;
}

// ── 3. EMAIL ──────────────────────────────────────────────────────────────────

async function checkSmtp(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const portRaw = process.env.SMTP_PORT;
  const from = process.env.SMTP_FROM;

  const portNum = portRaw ? parseInt(portRaw, 10) : 587;
  const portValid = !portRaw || (!isNaN(portNum) && portNum > 0 && portNum <= 65535);
  const userDomain = user ? user.split("@")[1] || null : null;
  const fromDomain = from ? from.split("@")[1] || null : null;

  if (!host || !user || !pass) {
    results.push({
      key: "SMTP", category: "EMAIL", label: "SMTP Configuration",
      present: !!(host || user || pass), formatValid: false, liveStatus: "fail",
      identity: host ? `host=${host}` : null,
      diagnosisHint: !host ? "SMTP_HOST not set"
        : !user ? "SMTP_USER not set"
        : "SMTP_PASS not set — GHL is sole delivery path; transactional emails skip if GHL unavailable",
      ownerAction: "Set SMTP_HOST, SMTP_USER, SMTP_PASS (and optionally SMTP_PORT, SMTP_FROM) in Replit Secrets",
      lastTestedAt: ts(), importance: "required_feature", featureName: "Transactional email fallback",
    });
    return results;
  }

  let liveStatus: LiveStatus = "fail";
  let diagnosisHint: string | null = null;
  let ownerAction: string | null = null;
  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host, port: portNum,
      secure: portNum === 465,
      auth: { user: user!, pass: pass! },
      connectionTimeout: 10000,
      greetingTimeout: 8000,
    });
    await transporter.verify();
    liveStatus = "pass";
  } catch (err: any) {
    liveStatus = "fail";
    const msg = err.message || "";
    if (/invalid login|535|authentication/i.test(msg)) {
      diagnosisHint = "SMTP authentication failed — credentials rejected by server";
      ownerAction = "Verify SMTP_USER and SMTP_PASS. For Gmail: use App Password, not account password.";
    } else if (/ECONNREFUSED|ENOTFOUND/i.test(msg)) {
      diagnosisHint = `Cannot reach SMTP server — hostname or port incorrect`;
      ownerAction = `Verify SMTP_HOST=${host} is reachable and port ${portNum} is open`;
    } else if (/certificate|TLS|ssl/i.test(msg)) {
      diagnosisHint = `TLS/certificate error on port ${portNum}`;
      ownerAction = "Set SMTP_PORT=587 for STARTTLS or SMTP_PORT=465 for SSL";
    } else {
      diagnosisHint = `SMTP verify() failed: ${sanitizeError(msg).slice(0, 200)}`;
      ownerAction = "Check SMTP_HOST, SMTP_PORT, and credentials";
    }
  }

  results.push({
    key: "SMTP", category: "EMAIL", label: "SMTP Connection",
    present: true, formatValid: portValid,
    liveStatus,
    identity: `host=${host} port=${portNum} tls=${portNum === 465 ? "SSL" : "STARTTLS"} from=${from || user}`,
    diagnosisHint,
    ownerAction,
    lastTestedAt: ts(), importance: "required_feature", featureName: "Transactional email fallback",
  });

  if (userDomain && fromDomain && userDomain !== fromDomain) {
    results.push({
      key: "SMTP_FROM", category: "EMAIL", label: "SMTP From/Auth Domain Alignment",
      present: true, formatValid: false, liveStatus: "fail",
      identity: `auth-domain=${userDomain} from-domain=${fromDomain}`,
      diagnosisHint: "SMTP_FROM domain differs from SMTP_USER domain — may trigger spam filters and SPF failures",
      ownerAction: "Set SMTP_FROM to match SMTP_USER domain, or remove SMTP_FROM to default to SMTP_USER",
      lastTestedAt: ts(), importance: "required_feature", featureName: "Email deliverability",
    });
  }

  return results;
}

// ── 4. ENRICHMENT AND OPTIONAL PROVIDERS ─────────────────────────────────────

async function checkSerper(): Promise<CheckResult> {
  const key = process.env.SERPER_API_KEY;
  if (!key) {
    return {
      key: "SERPER_API_KEY", category: "ENRICHMENT", label: "Serper.dev (Google Search Enrichment)",
      present: false, formatValid: false, liveStatus: "fail",
      identity: null,
      diagnosisHint: "Not set — lead enrichment and discovery engine will not run Serper queries",
      ownerAction: "Set SERPER_API_KEY from serper.dev → Dashboard → API Key",
      lastTestedAt: ts(), importance: "required_feature", featureName: "Lead enrichment + discovery engine",
    };
  }
  try {
    const { storage } = await import("../storage");
    const raw = await storage.getSystemSetting("serper_usage");
    if (raw) {
      const u = typeof raw === "string" ? JSON.parse(raw) : raw;
      const remaining = u.remainingCalls ?? (u.monthlyQuota - u.totalCalls);
      const monthly = u.monthlyQuota ?? 0;
      const pctUsed = monthly > 0 ? Math.round(((monthly - remaining) / monthly) * 100) : null;
      return {
        key: "SERPER_API_KEY", category: "ENRICHMENT", label: "Serper.dev (Google Search Enrichment)",
        present: true, formatValid: true, liveStatus: "pass",
        identity: `${remaining?.toLocaleString()} / ${monthly?.toLocaleString()} calls remaining (${pctUsed}% used)`,
        diagnosisHint: remaining < 1000 ? `⚠ Only ${remaining} calls remaining this month` : null,
        ownerAction: null, lastTestedAt: ts(),
        importance: "required_feature", featureName: "Lead enrichment",
      };
    }
  } catch {}
  return {
    key: "SERPER_API_KEY", category: "ENRICHMENT", label: "Serper.dev (Google Search Enrichment)",
    present: true, formatValid: true, liveStatus: "unverified",
    identity: "Key present — no usage data recorded yet",
    diagnosisHint: null, ownerAction: null,
    lastTestedAt: ts(), importance: "required_feature", featureName: "Lead enrichment",
  };
}

function makeOptionalCheck(
  key: string, label: string, category: "ENRICHMENT" | "ALERTS" | "COVERAGE",
  importance: Importance, feature: string
): CheckResult {
  const val = process.env[key];
  const present = !!val;
  return {
    key, category, label, present,
    formatValid: present ? val!.trim().length >= 8 : null,
    liveStatus: present ? "unverified" : (importance === "optional" ? "skipped" : "fail"),
    identity: present ? `length=${val!.length}` : null,
    diagnosisHint: !present && importance !== "optional" ? `Not set — ${feature} unavailable` : null,
    ownerAction: null, lastTestedAt: ts(), importance, featureName: feature,
  };
}

// ── 5. ALERTS AND BACKUPS ─────────────────────────────────────────────────────

async function checkSlack(): Promise<CheckResult> {
  const url = process.env.SLACK_AUDIT_WEBHOOK_URL;
  if (!url) {
    return {
      key: "SLACK_AUDIT_WEBHOOK_URL", category: "ALERTS", label: "Slack Audit Webhook",
      present: false, formatValid: false, liveStatus: "skipped",
      identity: null,
      diagnosisHint: "Not set — Slack alerts disabled; in-app incident feed remains active",
      ownerAction: "Optional: set SLACK_AUDIT_WEBHOOK_URL from Slack → Incoming Webhooks",
      lastTestedAt: ts(), importance: "optional", featureName: "Slack critical alerts",
    };
  }
  let formatValid = false;
  try {
    const u = new URL(url);
    formatValid = u.hostname.includes("slack.com");
  } catch {}
  return {
    key: "SLACK_AUDIT_WEBHOOK_URL", category: "ALERTS", label: "Slack Audit Webhook",
    present: true, formatValid, liveStatus: formatValid ? "unverified" : "fail",
    identity: formatValid ? "hooks.slack.com" : "unexpected URL format",
    diagnosisHint: !formatValid ? "URL does not match expected Slack webhook format" : null,
    ownerAction: !formatValid ? "Verify SLACK_AUDIT_WEBHOOK_URL — should start with https://hooks.slack.com/" : null,
    lastTestedAt: ts(), importance: "optional", featureName: "Slack alerts",
  };
}

async function checkBackups(): Promise<CheckResult> {
  try {
    const { listBackups } = await import("./db-backup");
    const backups = await listBackups();
    const latest = backups[0];
    const ageHours = latest?.createdAt
      ? (Date.now() - new Date(latest.createdAt).getTime()) / 3600000
      : Infinity;
    const ageLabel = isFinite(ageHours)
      ? ageHours < 24 ? `${Math.round(ageHours)}h ago` : `${Math.round(ageHours / 24)}d ago`
      : "unknown";
    return {
      key: "DB_BACKUP", category: "ALERTS", label: "Database Backup",
      present: backups.length > 0, formatValid: true,
      liveStatus: backups.length > 0 ? "pass" : "fail",
      identity: backups.length > 0
        ? `${backups.length} backup(s) — latest: ${latest.name} (${(latest.sizeBytes / 1024 / 1024).toFixed(1)} MB, ${ageLabel})`
        : "No backup artifacts found",
      diagnosisHint: backups.length === 0
        ? "No backups found — trigger a manual backup from the Launch Readiness page"
        : "⚠ Backups write to local disk (./backups/) which is EPHEMERAL on Replit — files are lost on deployment. Configure external object storage for production durability.",
      ownerAction: backups.length === 0 ? "Click 'Run Now' on the Backups card to create the first backup" : null,
      lastTestedAt: ts(), importance: "optional", featureName: "Disaster recovery",
    };
  } catch (err: any) {
    return {
      key: "DB_BACKUP", category: "ALERTS", label: "Database Backup",
      present: false, formatValid: null, liveStatus: "fail",
      identity: null, diagnosisHint: sanitizeError(err.message),
      ownerAction: null, lastTestedAt: ts(), importance: "optional", featureName: "Disaster recovery",
    };
  }
}

// ── 5b. BULLMQ INCIDENT TRACKING ──────────────────────────────────────────────
// Surfaces recent BullMQ job-lock failures so operators know if the queue had
// incidents even after the server has recovered. Reads audit_logs for entries
// written when acquireJobLock fails (action = "JOB_LOCK_FAILED").

async function checkBullmqIncidents(): Promise<CheckResult> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24 h
    const result = await pool.query<{ count: string; last_at: string }>(
      `SELECT COUNT(*)::text AS count, MAX(created_at)::text AS last_at
       FROM audit_logs
       WHERE action = 'JOB_LOCK_FAILED' AND created_at > $1`,
      [cutoff]
    );
    const row = result.rows[0];
    const failCount = parseInt(row?.count ?? "0", 10);
    const lastAt = row?.last_at ? new Date(row.last_at).toISOString() : null;

    if (failCount === 0) {
      return {
        key: "BULLMQ_LOCK_INCIDENTS", category: "CORE", label: "BullMQ Job-Lock Health (24 h)",
        present: true, formatValid: true, liveStatus: "pass",
        identity: "0 lock failures in last 24 h",
        diagnosisHint: null, ownerAction: null,
        lastTestedAt: ts(), importance: "optional",
      };
    }

    return {
      key: "BULLMQ_LOCK_INCIDENTS", category: "CORE", label: "BullMQ Job-Lock Health (24 h)",
      present: true, formatValid: true,
      liveStatus: failCount > 5 ? "fail" : "unverified",
      identity: `${failCount} lock failure${failCount !== 1 ? "s" : ""} — last: ${lastAt ?? "unknown"}`,
      diagnosisHint: failCount > 5
        ? "More than 5 job-lock failures in 24 h — check Redis latency or REDIS_URL credentials"
        : `${failCount} transient lock failure${failCount !== 1 ? "s" : ""} detected — likely startup race; monitor for recurrence`,
      ownerAction: failCount > 5 ? "Check Redis connectivity and REDIS_URL config; review server logs around the failure times" : null,
      lastTestedAt: ts(), importance: "optional",
    };
  } catch (err: any) {
    return {
      key: "BULLMQ_LOCK_INCIDENTS", category: "CORE", label: "BullMQ Job-Lock Health (24 h)",
      present: false, formatValid: null, liveStatus: "skipped",
      identity: null,
      diagnosisHint: `Could not query audit_logs: ${sanitizeError(err.message)}`,
      ownerAction: null, lastTestedAt: ts(), importance: "optional",
    };
  }
}

// ── 6. COVERAGE ───────────────────────────────────────────────────────────────

function checkCoverageItems(): CheckResult[] {
  const items: Array<{ key: string; label: string; importance: Importance; feature: string }> = [
    { key: "AI_INTEGRATIONS_OPENAI_API_KEY", label: "OpenAI API Key (Replit Integration)", importance: "required_feature", feature: "All AI advisor + enrichment features" },
    { key: "PEWC_DISCLOSURE_VERSION", label: "PEWC Disclosure Version", importance: "required_launch", feature: "PEWC consent compliance — must be set before enrolling contacts" },
    { key: "NMI_SECURITY_KEY", label: "NMI Processor Security Key", importance: "required_feature", feature: "Direct processor boarding (NMI)" },
    { key: "GHL_MERCHANT_AGREEMENT_TEMPLATE_ID", label: "GHL E-Sign Template ID", importance: "required_feature", feature: "Merchant agreement e-signature" },
    { key: "GHL_SUPPORT_TEAM_USER_ID", label: "GHL Support Team User ID", importance: "required_feature", feature: "Support ticket assignment in GHL" },
    { key: "VAPID_PUBLIC_KEY", label: "VAPID Public Key (Push)", importance: "optional", feature: "PWA push notifications" },
    { key: "VAPID_PRIVATE_KEY", label: "VAPID Private Key (Push)", importance: "optional", feature: "PWA push notifications" },
    { key: "SENTRY_DSN", label: "Sentry DSN", importance: "optional", feature: "Error monitoring / Sentry" },
    { key: "ADMIN_EMAIL", label: "Admin Notification Email", importance: "optional", feature: "System alert email delivery" },
  ];

  return items.map(({ key, label, importance, feature }) => {
    const val = process.env[key];
    const present = !!val;
    return {
      key, category: "COVERAGE" as const, label, present,
      formatValid: present ? val!.trim().length > 0 : null,
      liveStatus: present ? "unverified" as const
        : importance === "required_launch" ? "fail" as const
        : importance === "required_feature" ? "fail" as const
        : "skipped" as const,
      identity: present ? `length=${val!.length}` : null,
      diagnosisHint: !present && importance !== "optional" ? `Not set — ${feature}` : null,
      ownerAction: null, lastTestedAt: ts(), importance, featureName: feature,
    };
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

let _cache: { data: ValidationReport; at: number } | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000;

export function clearValidationCache(): void {
  _cache = null;
}

export async function runFullValidation(forceRefresh = false): Promise<ValidationReport> {
  if (!forceRefresh && _cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return _cache.data;
  }

  const [
    dbResult, redisResult, bullmqResult,
    ghlTokenResults, ghlCapResults,
    gmailResults, smtpResults, serperResult, slackResult, backupResult,
  ] = await Promise.all([
    checkDatabase(), checkRedis(), checkBullmqIncidents(),
    checkGhlToken(), checkGhlCapabilities(),
    checkGmailOAuth(), checkSmtp(), checkSerper(), checkSlack(), checkBackups(),
  ]);

  const checks: CheckResult[] = [
    dbResult, redisResult, bullmqResult,
    checkAppUrl(),
    checkCryptoSecret("SESSION_SECRET", "Session Secret (SESSION_SECRET)", 32),
    checkCryptoSecret("UNSUBSCRIBE_TOKEN_SECRET", "Unsubscribe Token Secret", 16, "required_launch"),
    checkCryptoSecret("INTERNAL_WEBHOOK_SECRET", "Internal Webhook Secret", 16, "required_feature"),
    ...ghlTokenResults,
    ...ghlCapResults,
    ...checkGhlWorkflowEnvs(),
    ...gmailResults,
    ...smtpResults,
    serperResult,
    makeOptionalCheck("OUTSCRAPER_API_KEY", "Outscraper", "ENRICHMENT", "optional", "Google Maps bulk scraping"),
    makeOptionalCheck("APIFY_API_TOKEN", "Apify", "ENRICHMENT", "optional", "Yelp/Facebook scraping"),
    makeOptionalCheck("APOLLO_API_KEY", "Apollo.io", "ENRICHMENT", "optional", "B2B contact discovery"),
    slackResult, backupResult,
    ...checkCoverageItems(),
  ];

  const summary = {
    total: checks.length,
    pass: checks.filter((c) => c.liveStatus === "pass").length,
    fail: checks.filter((c) => c.liveStatus === "fail").length,
    unverified: checks.filter((c) => c.liveStatus === "unverified").length,
    skipped: checks.filter((c) => c.liveStatus === "skipped").length,
    requiredLaunchFailing: checks.filter(
      (c) => c.importance === "required_launch" && c.liveStatus === "fail"
    ).length,
  };

  const report: ValidationReport = {
    runAt: ts(),
    checks,
    summary,
    goNoGo: summary.requiredLaunchFailing === 0 ? "GO" : "NO-GO",
  };

  _cache = { data: report, at: Date.now() };
  return report;
}
