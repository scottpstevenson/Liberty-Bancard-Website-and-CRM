/**
 * GHL Channel Probes — live API verification for cold-email and SMS channels.
 *
 * These probes call GHL's REST API to verify facts that the readiness system
 * requires.  Credentials present in env vars is a necessary but NOT sufficient
 * condition for readiness; the channel must also pass a live API probe.
 *
 * Cold email:
 *   - GHL location's email sending domain must be mail.libertybancard.com
 *   - Configured sender must be Scott@mail.libertybancard.com
 *
 * SMS:
 *   - At least one sending number must be assigned to the location
 *   - That number must have SMS capability
 *   - A2P 10DLC brand/campaign approval is required (cannot be obtained from
 *     the GHL private API — requires manual admin attestation)
 *
 * When the GHL API cannot prove a fact, getLatestAttestation() is used to
 * check for a dated administrator override.  If none exists, the gate is RED.
 *
 * All probe results are cached for 5 minutes to avoid hammering the GHL API.
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

const GHL_BASE = "https://services.leadconnectorhq.com";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface ProbeCache<T> {
  result: T;
  cachedAt: number;
}

const cache: Record<string, ProbeCache<unknown>> = {};

function getCached<T>(key: string): T | null {
  const entry = cache[key] as ProbeCache<T> | undefined;
  if (entry && Date.now() - entry.cachedAt < CACHE_TTL_MS) return entry.result;
  return null;
}

function setCached<T>(key: string, result: T): T {
  cache[key] = { result, cachedAt: Date.now() };
  return result;
}

function ghlHeaders(): Record<string, string> {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || "";
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

async function ghlGet(path: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  if (!token) return { ok: false, status: 0, body: { error: "GHL_PRIVATE_INTEGRATION_TOKEN not set" } };
  try {
    const url = `${GHL_BASE}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let resp: Response;
    try {
      resp = await fetch(url, { method: "GET", headers: ghlHeaders(), signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    let body: unknown;
    try { body = await resp.json(); } catch { body = {}; }
    return { ok: resp.ok, status: resp.status, body };
  } catch (err: any) {
    return { ok: false, status: 0, body: { error: err.message } };
  }
}

// ── Attestation helpers ────────────────────────────────────────────────────────

export interface AdminAttestation {
  id: number;
  gateKey: string;
  attestedBy: string;
  attestedAt: Date;
  attestationNote: string;
  evidenceJson: unknown;
  expiresAt: Date | null;
}

/** Returns the most recent non-expired, non-superseded attestation for a gate key. */
export async function getLatestAttestation(gateKey: string): Promise<AdminAttestation | null> {
  try {
    const result = await db.execute(sql`
      SELECT id, gate_key, attested_by, attested_at, attestation_note, evidence_json, expires_at
      FROM outbound_admin_attestations
      WHERE gate_key = ${gateKey}
        AND superseded = FALSE
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY attested_at DESC
      LIMIT 1
    `);
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as any;
    return {
      id:               r.id,
      gateKey:          r.gate_key,
      attestedBy:       r.attested_by,
      attestedAt:       new Date(r.attested_at),
      attestationNote:  r.attestation_note,
      evidenceJson:     r.evidence_json,
      expiresAt:        r.expires_at ? new Date(r.expires_at) : null,
    };
  } catch {
    return null;
  }
}

/** Record a dated admin attestation. */
export async function recordAdminAttestation(params: {
  gateKey: string;
  attestedBy: string;
  attestationNote: string;
  evidenceJson?: unknown;
  expiresAt?: Date;
}): Promise<{ id: number }> {
  const result = await db.execute(sql`
    INSERT INTO outbound_admin_attestations
      (gate_key, attested_by, attested_at, attestation_note, evidence_json, expires_at)
    VALUES
      (${params.gateKey}, ${params.attestedBy}, NOW(),
       ${params.attestationNote}, ${JSON.stringify(params.evidenceJson ?? null)}::jsonb,
       ${params.expiresAt ? params.expiresAt.toISOString() : null})
    RETURNING id
  `);
  return { id: (result.rows[0] as any).id };
}

// ── GHL Cold Email Probe ───────────────────────────────────────────────────────

export interface GhlColdEmailProbeResult {
  ok: boolean;
  domainVerified: boolean;
  senderVerified: boolean;
  detectedDomain: string | null;
  detectedSender: string | null;
  requiredDomain: string;
  requiredSender: string;
  probeError: string | null;
  apiReachable: boolean;
  attestation: AdminAttestation | null;
  method: "api_probe" | "admin_attestation" | "unverified";
  probeTimestamp: string;
}

const REQUIRED_DOMAIN = "mail.libertybancard.com";
const REQUIRED_SENDER = "scott@mail.libertybancard.com";

/**
 * Probe GHL's location email settings to verify sending domain and sender.
 * Falls back to admin attestation if the API cannot provide the data.
 */
export async function probeGhlColdEmail(): Promise<GhlColdEmailProbeResult> {
  const cached = getCached<GhlColdEmailProbeResult>("ghl_cold_email");
  if (cached) return cached;

  const locationId = process.env.GHL_LOCATION_ID;
  const timestamp  = new Date().toISOString();

  const base: Omit<GhlColdEmailProbeResult, "attestation" | "method" | "probeTimestamp"> = {
    ok: false,
    domainVerified: false,
    senderVerified: false,
    detectedDomain: null,
    detectedSender: null,
    requiredDomain: REQUIRED_DOMAIN,
    requiredSender: REQUIRED_SENDER,
    probeError: null,
    apiReachable: false,
  };

  if (!locationId) {
    const attestation = await getLatestAttestation("ghl_cold_email_domain");
    const senderAttestation = await getLatestAttestation("ghl_cold_email_sender");
    const bothAttested = !!attestation && !!senderAttestation;
    return setCached("ghl_cold_email", {
      ...base,
      probeError: "GHL_LOCATION_ID not set — cannot probe",
      attestation,
      method: bothAttested ? "admin_attestation" : "unverified",
      ok: bothAttested,
      domainVerified: !!attestation,
      senderVerified: !!senderAttestation,
      probeTimestamp: timestamp,
    });
  }

  const { ok: apiOk, status, body } = await ghlGet(`/locations/${locationId}/email-settings`);

  if (!apiOk || status === 0) {
    const fallbackBody = body as any;
    const errMsg = fallbackBody?.error || fallbackBody?.message || `HTTP ${status}`;

    const attestation      = await getLatestAttestation("ghl_cold_email_domain");
    const senderAttestation = await getLatestAttestation("ghl_cold_email_sender");
    const bothAttested = !!attestation && !!senderAttestation;

    return setCached("ghl_cold_email", {
      ...base,
      apiReachable: status !== 0,
      probeError: `GHL email-settings API returned ${status}: ${errMsg}. Manual attestation ${bothAttested ? "present" : "required"}.`,
      attestation,
      method: bothAttested ? "admin_attestation" : "unverified",
      ok: bothAttested,
      domainVerified: !!attestation,
      senderVerified: !!senderAttestation,
      probeTimestamp: timestamp,
    });
  }

  const data = body as any;
  const detectedDomain = (
    data?.fromDomain ||
    data?.domain ||
    data?.sendingDomain ||
    data?.emailDomain ||
    null
  ) as string | null;
  const detectedSender = (
    data?.fromEmail ||
    data?.senderEmail ||
    data?.defaultSender ||
    null
  ) as string | null;

  const domainVerified = !!detectedDomain &&
    detectedDomain.toLowerCase().includes(REQUIRED_DOMAIN.toLowerCase());
  const senderVerified = !!detectedSender &&
    detectedSender.toLowerCase() === REQUIRED_SENDER.toLowerCase();

  const attestation = await getLatestAttestation("ghl_cold_email_domain");

  const result: GhlColdEmailProbeResult = {
    ...base,
    apiReachable: true,
    detectedDomain,
    detectedSender,
    domainVerified: domainVerified || !!attestation,
    senderVerified,
    probeError: (!domainVerified && !attestation)
      ? `GHL sending domain is "${detectedDomain || "unknown"}" — must be ${REQUIRED_DOMAIN}`
      : (!senderVerified ? `GHL sender is "${detectedSender || "unknown"}" — must be ${REQUIRED_SENDER}` : null),
    attestation,
    method: "api_probe",
    ok: (domainVerified || !!attestation) && senderVerified,
    probeTimestamp: timestamp,
  };
  return setCached("ghl_cold_email", result);
}

// ── GHL SMS Probe ──────────────────────────────────────────────────────────────

export interface GhlSmsProbeResult {
  ok: boolean;
  apiReachable: boolean;
  phoneNumbers: Array<{
    number: string;
    friendlyName: string;
    smsCapable: boolean;
    status: string;
  }>;
  smsSendingNumber: string | null;
  smsCapable: boolean;
  a2pApprovalAttested: boolean;
  a2pAttestation: AdminAttestation | null;
  numberAttestation: AdminAttestation | null;
  probeError: string | null;
  method: "api_probe" | "admin_attestation" | "unverified";
  probeTimestamp: string;
  consentNote: string;
}

const A2P_CONSENT_NOTE =
  "A2P sends require documented PEWC consent on the contact record. " +
  "Sequence-worker checks contactability permission before every SMS step.";

export async function probeGhlSms(): Promise<GhlSmsProbeResult> {
  const cached = getCached<GhlSmsProbeResult>("ghl_sms");
  if (cached) return cached;

  const locationId = process.env.GHL_LOCATION_ID;
  const timestamp  = new Date().toISOString();

  const a2pAttestation    = await getLatestAttestation("ghl_sms_a2p_approved");
  const numberAttestation = await getLatestAttestation("ghl_sms_sending_number");

  const base: Omit<GhlSmsProbeResult, "a2pAttestation" | "numberAttestation" | "method" | "probeTimestamp" | "consentNote"> = {
    ok: false,
    apiReachable: false,
    phoneNumbers: [],
    smsSendingNumber: null,
    smsCapable: false,
    a2pApprovalAttested: !!a2pAttestation,
    probeError: null,
  };

  if (!locationId) {
    return setCached("ghl_sms", {
      ...base,
      probeError: "GHL_LOCATION_ID not set — cannot probe phone numbers",
      ok: !!a2pAttestation && !!numberAttestation,
      a2pAttestation,
      numberAttestation,
      smsSendingNumber: numberAttestation?.evidenceJson ? (numberAttestation.evidenceJson as any).number || null : null,
      smsCapable: !!numberAttestation,
      method: (!!a2pAttestation && !!numberAttestation) ? "admin_attestation" : "unverified",
      probeTimestamp: timestamp,
      consentNote: A2P_CONSENT_NOTE,
    });
  }

  const { ok: apiOk, status, body } = await ghlGet(`/locations/${locationId}/phone-numbers`);

  if (!apiOk || status === 0) {
    const errMsg = (body as any)?.message || `HTTP ${status}`;
    return setCached("ghl_sms", {
      ...base,
      apiReachable: status !== 0,
      probeError: `GHL phone-numbers API returned ${status}: ${errMsg}`,
      ok: !!a2pAttestation && !!numberAttestation,
      a2pAttestation,
      numberAttestation,
      smsSendingNumber: numberAttestation?.evidenceJson ? (numberAttestation.evidenceJson as any).number || null : null,
      smsCapable: !!numberAttestation,
      method: (!!a2pAttestation && !!numberAttestation) ? "admin_attestation" : "unverified",
      probeTimestamp: timestamp,
      consentNote: A2P_CONSENT_NOTE,
    });
  }

  const data = body as any;
  const rawNumbers: any[] = Array.isArray(data) ? data : (data?.numbers || data?.phoneNumbers || []);

  const phoneNumbers = rawNumbers.map((n: any) => ({
    number:       n.phoneNumber || n.number || n.phone || "",
    friendlyName: n.friendlyName || n.name || n.phoneNumber || "",
    smsCapable:   !!(n.capabilities?.SMS || n.smsEnabled || n.type === "SMS"),
    status:       n.status || "unknown",
  }));

  const smsNumbers = phoneNumbers.filter(n => n.smsCapable);
  const primarySms = smsNumbers[0] || null;

  const a2pApprovalNote =
    "GHL private API does not expose A2P 10DLC campaign status. " +
    "Admin must attest campaign approval via Replit admin panel.";

  const ok = !!primarySms && !!a2pAttestation;
  const probeError = !primarySms
    ? "No SMS-capable number found on this GHL location"
    : !a2pAttestation
    ? `SMS number found (${primarySms.number}) but A2P 10DLC campaign approval not attested. ${a2pApprovalNote}`
    : null;

  return setCached("ghl_sms", {
    ...base,
    apiReachable: true,
    phoneNumbers,
    smsSendingNumber: primarySms?.number || null,
    smsCapable: !!primarySms,
    a2pApprovalAttested: !!a2pAttestation,
    probeError,
    ok,
    a2pAttestation,
    numberAttestation,
    method: "api_probe",
    probeTimestamp: timestamp,
    consentNote: A2P_CONSENT_NOTE,
  });
}

/** Invalidate all probe caches (call after recording an attestation). */
export function invalidateProbeCache(): void {
  delete cache["ghl_cold_email"];
  delete cache["ghl_sms"];
}
