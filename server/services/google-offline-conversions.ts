import { createHash, randomUUID } from "node:crypto";
import { pool } from "../db";
import {
  encryptCredential,
  decryptCredential,
  isEncryptionAvailable,
} from "./credential-encryption";
import {
  ADS_MEASUREMENT_VERSION,
  GOOGLE_OFFLINE_CUSTOMER,
} from "@shared/google-offline-config";

export type OfflineKind = "qualified_lead" | "closed_won";
const API = "https://datamanager.googleapis.com/v1";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const isClick = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,500}$/.test(value);
const isCapability = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const code = (value: unknown) =>
  typeof value === "string" && /^[A-Z0-9_]{1,100}$/.test(value)
    ? value
    : "UNRECOGNIZED_PROVIDER_DIAGNOSTIC";
export function offlineConfig() {
  const actions = {
    qualified_lead: process.env.GOOGLE_OFFLINE_QUALIFIED_ACTION_ID ?? "",
    closed_won: process.env.GOOGLE_OFFLINE_WON_ACTION_ID ?? "",
  };
  const mappingsConfigured = Object.values(actions).every((v) =>
    /^[0-9]+$/.test(v),
  );
  return {
    customerId: GOOGLE_OFFLINE_CUSTOMER,
    actions,
    mappingsConfigured,
    credentialsConfigured: !!process.env.GOOGLE_OFFLINE_CREDENTIALS_JSON,
    uploadsEnabled: process.env.GOOGLE_OFFLINE_UPLOAD_ENABLED === "true",
    encryptionAvailable: isEncryptionAvailable(),
  };
}

/** Accepted occurrence only, no current-contact attribution lookup. An old marketing preference alone is insufficient. */
export async function captureOfflineAttribution(
  requestId: string,
  contactId: number,
  raw: Record<string, unknown>,
) {
  const clickIds = Object.fromEntries(
    ["gclid", "gbraid", "wbraid"]
      .filter((k) => isClick(raw[k]))
      .map((k) => [k, raw[k]]),
  );
  if (
    ![true, "true"].includes(raw.adsMeasurementConsent as any) ||
    raw.adsMeasurementVersion !== ADS_MEASUREMENT_VERSION ||
    !Object.keys(clickIds).length ||
    !isCapability(raw.adsMeasurementKey)
  )
    return { captured: false, reason: "NO_EXPLICIT_CLICK_MEASUREMENT_CONSENT" };
  if (!isEncryptionAvailable())
    return { captured: false, reason: "ENCRYPTION_UNAVAILABLE" };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      hash(raw.adsMeasurementKey),
    ]);
    const result = await client.query(
      `INSERT INTO ads_attribution_snapshots(request_id,contact_id,click_ids_ciphertext,consent_version,revoke_hash)
      SELECT id,$2,$3,$4,$5 FROM inbound_requests WHERE id=$1 AND source_class='sales_request' AND (contact_id IS NULL OR contact_id=$2)
      AND source_type IN ('statement_upload','estimate_form','get_started_form','equipment_inquiry','general_inquiry')
      AND NOT EXISTS(SELECT 1 FROM ads_measurement_revocations WHERE revoke_hash=$5)
      ON CONFLICT(request_id) DO NOTHING RETURNING request_id`,
      [
        requestId,
        contactId,
        encryptCredential(JSON.stringify(clickIds)),
        ADS_MEASUREMENT_VERSION,
        hash(raw.adsMeasurementKey),
      ],
    );
    await client.query("COMMIT");
    return {
      captured: result.rowCount === 1,
      reason: result.rowCount
        ? "CAPTURED"
        : "EXISTING_OR_INELIGIBLE_OCCURRENCE",
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function revokeOfflineAttribution(capability: string) {
  if (!isCapability(capability)) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      hash(capability),
    ]);
    await client.query(
      "INSERT INTO ads_measurement_revocations(revoke_hash) VALUES($1) ON CONFLICT DO NOTHING",
      [hash(capability)],
    );
    await client.query(
      `WITH revoked AS (UPDATE ads_attribution_snapshots SET revoked_at=COALESCE(revoked_at,now()) WHERE revoke_hash=$1 RETURNING request_id)
      UPDATE ads_offline_conversions SET state='revoked',last_error='CONSENT_REVOKED',claim_token=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE attribution_request_id IN (SELECT request_id FROM revoked) AND state='pending'`,
      [hash(capability)],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Closed Won is copied from retained canonical evidence, never the analytics/record-event endpoint or mutable contact GCLID. */
export async function reconcileOfflineClosedWon() {
  const action = offlineConfig().actions.closed_won;
  const r = await pool.query(
    `INSERT INTO ads_offline_conversions(event_key,kind,source_id,attribution_request_id,deal_id,occurred_at,action_id)
    SELECT 'closed_won:deal:'||e.deal_id,'closed_won',e.id::text,a.request_id,e.deal_id,e.occurred_at,$1
    FROM conversion_journey_evidence e JOIN deals d ON d.id=e.deal_id AND d.contact_id=e.contact_id
    JOIN ads_attribution_snapshots a ON a.request_id=d.inbound_request_id AND a.contact_id=e.contact_id
    JOIN inbound_requests r ON r.id=a.request_id AND r.contact_id=a.contact_id
    WHERE e.stage='closed_won' AND e.source_type='deal_transition' AND e.record_class='production'
    AND e.occurred_at>=a.captured_at AND a.revoked_at IS NULL AND r.lifecycle_state IN ('accepted','completed','review_required')
    AND d.pipeline='sales' AND d.record_class='production' AND d.archived_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM ads_offline_conversions x WHERE x.deal_id=e.deal_id AND x.kind='closed_won')
    ORDER BY e.occurred_at,e.id LIMIT 100 ON CONFLICT DO NOTHING RETURNING id`,
    [/^[0-9]+$/.test(action) ? action : null],
  );
  return r.rowCount ?? 0;
}

/** This staff attestation means a reviewed sales lead, not enrichment/channel qualification or an automatic score. */
export async function qualifyOfflineLead(input: {
  dealId: number;
  expectedStage: string;
  reason: string;
  actorId: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT d.*,a.request_id AS attribution_id,a.revoked_at,r.lifecycle_state AS request_state,c.record_class AS contact_record_class
      FROM deals d JOIN contacts c ON c.id=d.contact_id LEFT JOIN ads_attribution_snapshots a ON a.request_id=d.inbound_request_id AND a.contact_id=d.contact_id
      LEFT JOIN inbound_requests r ON r.id=a.request_id AND r.contact_id=a.contact_id WHERE d.id=$1 FOR UPDATE OF d`,
      [input.dealId],
    );
    const d = rows[0];
    if (
      !d ||
      d.pipeline !== "sales" ||
      d.archived_at ||
      d.record_class !== "production" ||
      d.contact_record_class !== "production"
    )
      throw new Error("OFFLINE_SALES_DEAL_REQUIRED");
    if (d.stage !== input.expectedStage)
      throw new Error("OFFLINE_DEAL_STAGE_CHANGED");
    if (
      !d.attribution_id ||
      d.revoked_at ||
      !["accepted", "completed", "review_required"].includes(d.request_state)
    )
      throw new Error("OFFLINE_CONSENTED_OCCURRENCE_REQUIRED");
    const locked = (
      await client.query(
        "SELECT revoked_at FROM ads_attribution_snapshots WHERE request_id=$1 FOR UPDATE",
        [d.attribution_id],
      )
    ).rows[0];
    if (!locked || locked.revoked_at)
      throw new Error("OFFLINE_CONSENTED_OCCURRENCE_REQUIRED");
    const action = offlineConfig().actions.qualified_lead;
    await client.query(
      `INSERT INTO ads_offline_conversions(event_key,kind,source_id,attribution_request_id,deal_id,occurred_at,actor_id,reason,action_id)
      VALUES($1,'qualified_lead',$2,$3,$4,now(),$5,$6,$7) ON CONFLICT(deal_id,kind) DO NOTHING`,
      [
        `qualified_lead:deal:${d.id}`,
        String(d.id),
        d.attribution_id,
        d.id,
        input.actorId,
        input.reason,
        /^[0-9]+$/.test(action) ? action : null,
      ],
    );
    const out = (
      await client.query(
        "SELECT id,state,kind,deal_id,occurred_at FROM ads_offline_conversions WHERE deal_id=$1 AND kind='qualified_lead'",
        [d.id],
      )
    ).rows[0];
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export function offlineEventBody(
  row: any,
  clickIds: Record<string, string>,
  validateOnly = false,
) {
  if (
    !clickIds ||
    !Object.keys(clickIds).length ||
    Object.entries(clickIds).some(
      ([key, value]) =>
        !["gclid", "gbraid", "wbraid"].includes(key) || !isClick(value),
    ) ||
    !/^[0-9]+$/.test(row.action_id) ||
    row.customer_id !== GOOGLE_OFFLINE_CUSTOMER
  )
    throw new Error("OFFLINE_PAYLOAD_INVALID");
  return {
    destinations: [
      {
        operatingAccount: {
          accountType: "GOOGLE_ADS",
          accountId: row.customer_id,
        },
        loginAccount: { accountType: "GOOGLE_ADS", accountId: row.customer_id },
        productDestinationId: row.action_id,
      },
    ],
    events: [
      {
        eventTimestamp: new Date(row.occurred_at).toISOString(),
        eventSource: "WEB",
        transactionId: `lb-${row.id}`,
        adIdentifiers: clickIds,
        consent: {
          adUserData: "CONSENT_GRANTED",
          adPersonalization: "CONSENT_DENIED",
        },
      },
    ],
    validateOnly,
  };
}
export interface OfflineTransport {
  ingest(body: ReturnType<typeof offlineEventBody>): Promise<any>;
  status(requestId: string): Promise<any>;
}
class ProviderRejection extends Error {
  constructor(readonly status: number) {
    super(`GOOGLE_DATA_MANAGER_HTTP_${status}`);
  }
}
async function googleOfflineAuth() {
  const raw = process.env.GOOGLE_OFFLINE_CREDENTIALS_JSON;
  if (!raw) throw new Error("OFFLINE_CREDENTIALS_MISSING");
  let credentials: any;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error("OFFLINE_CREDENTIALS_INVALID");
  }
  if (!["service_account", "authorized_user"].includes(credentials.type))
    throw new Error("OFFLINE_CREDENTIAL_TYPE_INVALID");
  const { google } = await import("googleapis");
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/datamanager"],
  });
  // Preserve the SDK's quota-project header as well as authorization for user ADC credentials.
  const headers = new Headers(
    (await auth.getRequestHeaders(API)) as HeadersInit,
  );
  const authorization = headers.get("authorization");
  if (!authorization?.startsWith("Bearer "))
    throw new Error("OFFLINE_TOKEN_UNAVAILABLE");
  return {
    access: authorization.slice(7),
    quotaProject: headers.get("x-goog-user-project") ?? undefined,
  };
}
export function createGoogleOfflineTransport(
  access: string,
  fetcher: typeof fetch = fetch,
  quotaProject?: string,
): OfflineTransport {
  const request = async (path: string, body?: unknown) => {
    const response = await fetcher(API + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
        ...(quotaProject ? { "x-goog-user-project": quotaProject } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
    if (!response.ok) throw new ProviderRejection(response.status);
    return await response.json();
  };
  return {
    ingest: (body) => request("/events:ingest", body),
    status: (id) =>
      request("/requestStatus:retrieve?requestId=" + encodeURIComponent(id)),
  };
}
async function authorizedGoogleOfflineTransport() {
  const { access, quotaProject } = await googleOfflineAuth();
  return createGoogleOfflineTransport(access, fetch, quotaProject);
}
export const googleOfflineTransport: OfflineTransport = {
  ingest: async (body) =>
    (await authorizedGoogleOfflineTransport()).ingest(body),
  status: async (id) => (await authorizedGoogleOfflineTransport()).status(id),
};

/** Persist only bounded provider enum diagnostics, never echoed request payloads, click IDs or credentials. */
function diagnostics(result: any) {
  return {
    errors: (result.errorInfo?.errorCounts ?? [])
      .slice(0, 20)
      .map((v: any) => ({
        reason: code(v.reason),
        count: /^[0-9]{1,20}$/.test(String(v.recordCount))
          ? String(v.recordCount)
          : "0",
      })),
    warnings: (result.warningInfo?.warningCounts ?? [])
      .slice(0, 20)
      .map((v: any) => ({
        reason: code(v.reason),
        count: /^[0-9]{1,20}$/.test(String(v.recordCount))
          ? String(v.recordCount)
          : "0",
      })),
  };
}
export function classifyOfflineStatus(body: any, row: any) {
  const dest = body?.requestStatusPerDestination?.find(
    (r: any) =>
      r.destination?.operatingAccount?.accountId === row.customer_id &&
      r.destination?.productDestinationId === row.action_id,
  );
  if (!dest)
    return {
      state: "submitted",
      status: "DESTINATION_STATUS_UNAVAILABLE",
      diagnostic: {},
    };
  const diagnostic = diagnostics(dest);
  const state = diagnostic.errors.length
    ? "failed"
    : dest.requestStatus === "SUCCESS"
      ? diagnostic.warnings.length || row.diagnostic?.fieldWarnings > 0
        ? "processed_with_warnings"
        : "processed"
      : ["FAILED", "PARTIAL_SUCCESS"].includes(dest.requestStatus)
        ? "failed"
        : "submitted";
  return { state, status: code(dest.requestStatus), diagnostic };
}

/** One atomic claim per request. An interrupted dispatch is uncertain; a submitted request is only polled, never resent. */
export async function processOfflineConversions(
  options: {
    validateOnly?: boolean;
    transport?: OfflineTransport;
    limit?: number;
  } = {},
) {
  const config = offlineConfig();
  let transport = options.transport;
  if (
    !config.mappingsConfigured ||
    !config.encryptionAvailable ||
    (!options.transport && !config.credentialsConfigured)
  )
    return { processed: 0, held: "CONFIGURATION_REQUIRED" };
  if (!options.validateOnly && !config.uploadsEnabled)
    return { processed: 0, held: "UPLOADS_DISABLED" };
  if (!transport) {
    try {
      transport = await authorizedGoogleOfflineTransport();
    } catch {
      return { processed: 0, held: "AUTHORIZATION_REQUIRED" };
    }
  }
  await reconcileOfflineClosedWon();
  await pool.query(`UPDATE ads_offline_conversions SET state='uncertain',last_error='DISPATCH_LEASE_EXPIRED',claim_token=NULL,lease_expires_at=NULL,updated_at=now()
    WHERE state='attempting' AND lease_expires_at<now()`);
  let processed = 0;
  for (let i = 0; i < Math.min(options.limit ?? 10, 25); i++) {
    const claim = randomUUID();
    const { rows } = await pool.query(
      `UPDATE ads_offline_conversions x SET claim_token=$1,lease_expires_at=now()+interval '2 minutes',updated_at=now()
      WHERE id=(SELECT id FROM ads_offline_conversions WHERE state IN ('pending','submitted') AND next_attempt_at<=now()
       AND (lease_expires_at IS NULL OR lease_expires_at<now()) AND (state='submitted' OR attempt_count<5) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
      [claim],
    );
    const row = rows[0];
    if (!row) break;
    let dispatchStarted = false;
    try {
      if (row.state === "submitted") {
        const result = classifyOfflineStatus(
          await transport.status(row.provider_request_id),
          row,
        );
        await pool.query(
          `UPDATE ads_offline_conversions SET state=$3,provider_status=$4,diagnostic=COALESCE(diagnostic,'{}'::jsonb)||$5::jsonb,claim_token=NULL,lease_expires_at=NULL,next_attempt_at=now()+interval '5 minutes',updated_at=now() WHERE id=$1 AND claim_token=$2`,
          [
            row.id,
            claim,
            result.state,
            result.status,
            JSON.stringify(result.diagnostic),
          ],
        );
        processed++;
        continue;
      }
      const a = (
        await pool.query(
          `SELECT a.*,c.archived_at,c.record_class AS contact_class,d.record_class AS deal_class,d.archived_at AS deal_archived,r.lifecycle_state AS request_state
        FROM ads_attribution_snapshots a JOIN contacts c ON c.id=a.contact_id JOIN inbound_requests r ON r.id=a.request_id AND r.contact_id=a.contact_id
        JOIN deals d ON d.id=$2 AND d.contact_id=a.contact_id AND d.inbound_request_id=a.request_id WHERE a.request_id=$1`,
          [row.attribution_request_id, row.deal_id],
        )
      ).rows[0];
      if (
        !a ||
        a.revoked_at ||
        a.archived_at ||
        a.deal_archived ||
        a.contact_class !== "production" ||
        a.deal_class !== "production" ||
        !["accepted", "completed", "review_required"].includes(a.request_state)
      ) {
        await pool.query(
          `UPDATE ads_offline_conversions SET state='revoked',last_error='ATTRIBUTION_REVOKED_OR_INELIGIBLE',claim_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND claim_token=$2`,
          [row.id, claim],
        );
        continue;
      }
      row.action_id = row.action_id ?? config.actions[row.kind as OfflineKind];
      const sealed = decryptCredential(a.click_ids_ciphertext);
      if (!sealed) throw new Error("OFFLINE_DECRYPT_UNAVAILABLE");
      const body = offlineEventBody(
        row,
        JSON.parse(sealed),
        !!options.validateOnly,
      );
      if (options.validateOnly) {
        await transport.ingest(body);
        await pool.query(
          `UPDATE ads_offline_conversions SET validated_at=now(),action_id=$3,last_error=NULL,claim_token=NULL,lease_expires_at=NULL,next_attempt_at=now()+interval '5 minutes',updated_at=now() WHERE id=$1 AND claim_token=$2`,
          [row.id, claim, row.action_id],
        );
        processed++;
        continue;
      }
      // Recheck revocation at the durable dispatch boundary. Never record dispatch without owning this claim.
      const dispatched = await pool.query(
        `UPDATE ads_offline_conversions x SET state='attempting',action_id=$3,attempt_count=attempt_count+1,dispatched_at=now(),last_error=NULL,updated_at=now()
        WHERE id=$1 AND claim_token=$2 AND state='pending' AND EXISTS(SELECT 1 FROM ads_attribution_snapshots a WHERE a.request_id=x.attribution_request_id AND a.revoked_at IS NULL) RETURNING id`,
        [row.id, claim, row.action_id],
      );
      if (!dispatched.rowCount) {
        await pool.query(
          "UPDATE ads_offline_conversions SET claim_token=NULL,lease_expires_at=NULL WHERE id=$1 AND claim_token=$2",
          [row.id, claim],
        );
        continue;
      }
      dispatchStarted = true;
      const result = await transport.ingest(body);
      if (
        typeof result.requestId !== "string" ||
        !/^[A-Za-z0-9_.:-]{1,200}$/.test(result.requestId)
      )
        throw new Error("OFFLINE_PROVIDER_RECEIPT_MISSING");
      await pool.query(
        `UPDATE ads_offline_conversions SET state='submitted',provider_request_id=$3,provider_status='PROCESSING',diagnostic=$4,claim_token=NULL,lease_expires_at=NULL,next_attempt_at=now()+interval '1 minute',updated_at=now() WHERE id=$1 AND claim_token=$2 AND state='attempting'`,
        [
          row.id,
          claim,
          result.requestId,
          JSON.stringify({
            fieldWarnings: Array.isArray(result.fieldWarnings)
              ? result.fieldWarnings.length
              : 0,
          }),
        ],
      );
      processed++;
    } catch (e) {
      const pendingPoll = row.state === "submitted";
      const rejected = e instanceof ProviderRejection;
      const error = pendingPoll
        ? "STATUS_POLL_UNAVAILABLE"
        : rejected
          ? e.message
          : options.validateOnly
            ? "VALIDATION_UNAVAILABLE"
            : dispatchStarted
              ? "DISPATCH_OUTCOME_UNCERTAIN"
              : "LOCAL_PAYLOAD_UNAVAILABLE";
      const state = pendingPoll
        ? "submitted"
        : options.validateOnly
          ? "pending"
          : !dispatchStarted
            ? "failed"
            : rejected
              ? e.status === 429
                ? row.attempt_count + 1 >= 5
                  ? "failed"
                  : "pending"
                : e.status >= 500
                  ? "uncertain"
                  : "failed"
              : "uncertain";
      await pool.query(
        `UPDATE ads_offline_conversions SET state=$3,last_error=$4,claim_token=NULL,lease_expires_at=NULL,next_attempt_at=now()+interval '15 minutes',updated_at=now() WHERE id=$1 AND claim_token=$2`,
        [row.id, claim, state, error],
      );
    }
  }
  return { processed, held: null };
}
export async function readOfflineConversionStatus() {
  const config = offlineConfig();
  const counts = await pool.query(
    "SELECT state,count(*)::int AS count FROM ads_offline_conversions GROUP BY state",
  );
  const recent = await pool.query(
    `SELECT id,kind,deal_id,state,occurred_at,provider_status,diagnostic,last_error,validated_at,attempt_count,provider_request_id FROM ads_offline_conversions ORDER BY created_at DESC LIMIT 50`,
  );
  return {
    ...config,
    implemented: true,
    provider: "google_data_manager_v1",
    states: counts.rows,
    recent: recent.rows,
    acceptance:
      "Submitted means accepted for asynchronous processing; processed does not prove ad matching or attribution.",
  };
}
export function startGoogleOfflineWorker() {
  if (process.env.GOOGLE_OFFLINE_UPLOAD_ENABLED !== "true") return null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processOfflineConversions();
    } catch {
      console.error("[Google offline] Measurement tick failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
