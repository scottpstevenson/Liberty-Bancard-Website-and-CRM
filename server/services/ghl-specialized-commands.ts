import crypto from "node:crypto";
import os from "node:os";
import { and, asc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { contacts, pipelineStages } from "@shared/schema";
import { storage } from "../storage";

const LAST_BACKFILL_KEY = "ghl_contact_backfill_last_run";
const BACKFILL_PAGE_SIZE = 50;
const PERMISSION_MAX_ATTEMPTS = 8;
const LEASE_MS = 2 * 60_000;
const GHL_API_BASE = "https://services.leadconnectorhq.com";

export type GhlSpecializedRunKind = "contact_id_backfill" | "permission_projection";
export type GhlSpecializedRunState =
  | "pending" | "running" | "retry" | "complete" | "blocked" | "needs_identity_backfill" | "failed";

export interface GhlSpecializedRun {
  runId: string;
  kind: GhlSpecializedRunKind;
  state: GhlSpecializedRunState;
  actorId: string;
  createdAt: string;
  updatedAt: string;
  heartbeatAt: string | null;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  idempotencyKey: string;
  cursor: number;
  watermark: number;
  processed: number;
  matched: number;
  notFound: number;
  skipped: number;
  errors: number;
  lastError: string | null;
  contactId?: number;
  ghlContactId?: string | null;
  fieldProjection?: {
    state: "pending" | "verified" | "failed" | "blocked" | "needs_identity_backfill";
    attemptedFields: string[];
    verifiedFields: string[];
    lastError: string | null;
    verifiedAt: string | null;
  };
}

export function hasUnexpiredGhlCommandLease(run: Pick<GhlSpecializedRun, "leaseExpiresAt">, now = Date.now()) {
  return !!run.leaseExpiresAt && Date.parse(run.leaseExpiresAt) > now;
}

function runSettingKey(runId: string) {
  return `ghl_specialized_run_${runId}`;
}

function activeSettingKey(kind: GhlSpecializedRunKind, contactId?: number) {
  void kind;
  void contactId;
  return "ghl_specialized_command_active";
}

function ownerTag() {
  return `${os.hostname()}:${process.pid}`;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value);
}

async function readSetting<T>(key: string): Promise<T | null> {
  const result = await pool.query<{ value: T }>("SELECT value FROM system_settings WHERE key=$1", [key]);
  return result.rows[0]?.value ?? null;
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2::jsonb,NOW())
     ON CONFLICT(key) DO UPDATE SET value=$2::jsonb,updated_at=NOW()`,
    [key, safeJson(value)],
  );
}

async function lockSetting(client: any, key: string): Promise<any> {
  await client.query(
    `INSERT INTO system_settings(key,value,updated_at) VALUES($1,'null'::jsonb,NOW())
     ON CONFLICT(key) DO NOTHING`,
    [key],
  );
  const result = await client.query("SELECT value FROM system_settings WHERE key=$1 FOR UPDATE", [key]);
  return result.rows[0]?.value ?? null;
}

function newRun(
  kind: GhlSpecializedRunKind,
  actorId: string,
  idempotencyKey: string,
  extra: Partial<GhlSpecializedRun> = {},
): GhlSpecializedRun {
  const now = new Date().toISOString();
  return {
    runId: crypto.randomUUID(),
    kind,
    state: "pending",
    actorId,
    createdAt: now,
    updatedAt: now,
    heartbeatAt: null,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    idempotencyKey,
    cursor: 0,
    watermark: 0,
    processed: 0,
    matched: 0,
    notFound: 0,
    skipped: 0,
    errors: 0,
    lastError: null,
    ...extra,
  };
}

async function createCommand(
  kind: GhlSpecializedRunKind,
  actorId: string,
  idempotencyKey: string,
  extra: Partial<GhlSpecializedRun> = {},
): Promise<GhlSpecializedRun> {
  const client = await pool.connect();
  const idemMaterial = `${kind}:${extra.contactId ?? ""}:${idempotencyKey}`;
  const idemKey = `ghl_specialized_idem_${kind}_${crypto.createHash("sha256").update(idemMaterial).digest("hex")}`;
  try {
    await client.query("BEGIN");
    const existingId = await lockSetting(client, idemKey);
    if (existingId && typeof existingId === "string") {
      const existing = await lockSetting(client, runSettingKey(existingId));
      if (existing) {
        await client.query("COMMIT");
        return existing as GhlSpecializedRun;
      }
    }
    const activeId = await lockSetting(client, activeSettingKey(kind, extra.contactId));
    if (activeId && typeof activeId === "string") {
      const active = await lockSetting(client, runSettingKey(activeId));
      if (active && ["pending", "running", "retry", "blocked"].includes(active.state)) {
        if (active.kind !== kind || (kind === "permission_projection" && active.contactId !== extra.contactId)) {
          throw new Error("GHL_SPECIALIZED_COMMAND_ACTIVE");
        }
        await client.query("COMMIT");
        return active as GhlSpecializedRun;
      }
    }
    const run = newRun(kind, actorId, idempotencyKey, extra);
    if (kind === "contact_id_backfill") {
      const maxId = await client.query<{ watermark: number | null }>("SELECT COALESCE(MAX(id),0)::int AS watermark FROM contacts");
      run.watermark = Number(maxId.rows[0]?.watermark ?? 0);
    }
    await client.query(
      `INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2::jsonb,NOW())
       ON CONFLICT(key) DO UPDATE SET value=$2::jsonb,updated_at=NOW()`,
      [runSettingKey(run.runId), safeJson(run)],
    );
    await client.query(
      `INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2::jsonb,NOW())
       ON CONFLICT(key) DO UPDATE SET value=$2::jsonb,updated_at=NOW()`,
      [idemKey, safeJson(run.runId)],
    );
    await client.query(
      `INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2::jsonb,NOW())
       ON CONFLICT(key) DO UPDATE SET value=$2::jsonb,updated_at=NOW()`,
      [activeSettingKey(kind, run.contactId), safeJson(run.runId)],
    );
    if (kind === "permission_projection" && run.contactId) {
      await client.query(
        `INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2::jsonb,NOW())
         ON CONFLICT(key) DO UPDATE SET value=$2::jsonb,updated_at=NOW()`,
        [`ghl_permission_projection_contact_${run.contactId}`, safeJson(run.runId)],
      );
    }
    if (kind === "contact_id_backfill") {
      await client.query(
        `INSERT INTO system_settings(key,value,updated_at) VALUES($1,$2::jsonb,NOW())
         ON CONFLICT(key) DO UPDATE SET value=$2::jsonb,updated_at=NOW()`,
        [LAST_BACKFILL_KEY, safeJson(run.runId)],
      );
    }
    await client.query("COMMIT");
    return run;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function createGhlContactBackfill(actorId: string, idempotencyKey: string) {
  return createCommand("contact_id_backfill", actorId, idempotencyKey);
}

export async function createGhlPermissionProjection(actorId: string, idempotencyKey: string, contactId: number) {
  return createCommand("permission_projection", actorId, idempotencyKey, {
    contactId,
    fieldProjection: {
      state: "pending",
      attemptedFields: [],
      verifiedFields: [],
      lastError: null,
      verifiedAt: null,
    },
  });
}

async function claimRun(runId: string): Promise<
  { run: GhlSpecializedRun; token: string } |
  { run: GhlSpecializedRun; busy: true } |
  { run: GhlSpecializedRun; terminal: true }
> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await lockSetting(client, runSettingKey(runId)) as GhlSpecializedRun | null;
    if (!run) throw new Error("GHL_SPECIALIZED_RUN_NOT_FOUND");
    if (["complete", "needs_identity_backfill", "failed"].includes(run.state)) {
      await client.query("COMMIT");
      return { run, terminal: true };
    }
    if (hasUnexpiredGhlCommandLease(run)) {
      await client.query("COMMIT");
      return { run, busy: true };
    }
    const token = crypto.randomUUID();
    run.state = "running";
    run.leaseToken = token;
    run.leaseOwner = ownerTag();
    run.leaseExpiresAt = new Date(Date.now() + LEASE_MS).toISOString();
    run.heartbeatAt = new Date().toISOString();
    run.updatedAt = run.heartbeatAt;
    await client.query(
      `UPDATE system_settings SET value=$2::jsonb,updated_at=NOW() WHERE key=$1`,
      [runSettingKey(runId), safeJson(run)],
    );
    await client.query("COMMIT");
    return { run, token };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function persistRun(run: GhlSpecializedRun, token: string): Promise<boolean> {
  const now = new Date().toISOString();
  run.heartbeatAt = now;
  run.updatedAt = now;
  if (run.state === "running") run.leaseExpiresAt = new Date(Date.now() + LEASE_MS).toISOString();
  const result = await pool.query(
    `UPDATE system_settings SET value=$2::jsonb,updated_at=NOW()
      WHERE key=$1 AND value->>'leaseToken'=$3`,
    [runSettingKey(run.runId), safeJson(run), token],
  );
  return (result.rowCount ?? 0) > 0;
}

async function persistOwnedRun(run: GhlSpecializedRun, token: string): Promise<void> {
  if (!await persistRun(run, token)) throw new Error("GHL_SPECIALIZED_LEASE_LOST");
}

async function releaseRun(run: GhlSpecializedRun, token: string, finalState?: GhlSpecializedRunState) {
  if (finalState) run.state = finalState;
  run.leaseToken = null;
  run.leaseOwner = null;
  run.leaseExpiresAt = null;
  run.updatedAt = new Date().toISOString();
  await persistOwnedRun(run, token);
  if (finalState === "complete" || finalState === "needs_identity_backfill" || finalState === "failed") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const active = await lockSetting(client, activeSettingKey(run.kind, run.contactId));
      if (active === run.runId) {
        await client.query(
          `UPDATE system_settings SET value='null'::jsonb,updated_at=NOW() WHERE key=$1`,
          [activeSettingKey(run.kind, run.contactId)],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function lookupExistingGhlContactByEmail(email: string, dependencies: {
  token?: string;
  locationId?: string;
  fetcher?: typeof fetch;
  authorize?: (args: { method: string; path: string; locationId: string }) => Promise<{ allowed: boolean; reasonCode?: string }>;
} = {}): Promise<string | null> {
  const token = dependencies.token ?? process.env.GHL_PRIVATE_INTEGRATION_TOKEN ?? process.env.GHL_API_KEY;
  const locationId = dependencies.locationId ?? process.env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new Error("GHL_NOT_CONFIGURED");
  const path = `/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&email=${encodeURIComponent(email)}`;
  const decision = dependencies.authorize
    ? await dependencies.authorize({ method: "GET", path, locationId })
    : await (await import("./ghl-sync-control")).authorizeGhlCrmOperation({ method: "GET", path, locationId });
  if (!decision.allowed) throw new Error(`GHL_READ_BLOCKED:${decision.reasonCode}`);
  const fetcher = dependencies.fetcher ?? fetch;
  const response = await fetcher(`${GHL_API_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Version: "2021-07-28" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GHL_LOOKUP_HTTP_${response.status}`);
  const payload: any = await response.json();
  const id = payload?.contact?.id ?? payload?.contacts?.[0]?.id ?? null;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

async function processBackfill(runId: string, run: GhlSpecializedRun, token: string, maxItems: number) {
  // This command only reads GHL and fills local IDs. The per-request
  // authorizeGhlCrmOperation gate in lookupExistingGhlContactByEmail still
  // applies; disabled provider writes must not block this read-only lane.
  const contactsPage = await db.select({
    id: contacts.id,
    email: contacts.email,
  }).from(contacts)
    .where(and(
      gt(contacts.id, run.cursor),
      lte(contacts.id, run.watermark),
      isNull(contacts.ghlContactId),
    ))
    .orderBy(asc(contacts.id))
    .limit(Math.min(BACKFILL_PAGE_SIZE, Math.max(1, maxItems)));

  if (contactsPage.length === 0) {
    await releaseRun(run, token, "complete");
    return run;
  }

  for (const row of contactsPage) {
    if (run.leaseToken !== token) throw new Error("GHL_SPECIALIZED_LEASE_LOST");
    const previousCursor = run.cursor;
    run.cursor = row.id;
    run.processed++;
    const email = row.email?.trim().toLowerCase();
    if (!email) {
      run.skipped++;
      await persistOwnedRun(run, token);
      continue;
    }
    try {
      // A duplicate local email is ambiguous identity evidence; do not map one provider identity to several local owners.
      const localIdentity = await db.select({ id: contacts.id }).from(contacts)
        .where(sql`lower(trim(${contacts.email})) = ${email}`)
        .limit(2);
      if (localIdentity.length !== 1 || localIdentity[0].id !== row.id) {
        run.skipped++;
        run.lastError = `LOCAL_EMAIL_IDENTITY_CONFLICT:${row.id}`;
        await persistOwnedRun(run, token);
        continue;
      }
      const ghlId = await lookupExistingGhlContactByEmail(email);
      if (!ghlId) {
        run.notFound++;
        run.lastError = null;
        await persistOwnedRun(run, token);
        continue;
      }
      const existingOwner = await storage.getContactByGhlContactId(ghlId);
      if (existingOwner && existingOwner.id !== row.id) {
        run.skipped++;
        run.lastError = `GHL_ID_OWNED_BY_CONTACT:${existingOwner.id}`;
        await persistOwnedRun(run, token);
        continue;
      }
      const latest = await storage.getContact(row.id);
      if (!latest) {
        run.skipped++;
        await persistOwnedRun(run, token);
        continue;
      }
      if (latest.ghlContactId && latest.ghlContactId !== ghlId) {
        run.skipped++;
        run.lastError = `LOCAL_CONTACT_ALREADY_OWNS_GHL_ID:${row.id}`;
        await persistOwnedRun(run, token);
        continue;
      }
      if (!latest.ghlContactId) {
        try {
          await storage.updateContact(row.id, { ghlContactId: ghlId } as any, {
            actorType: "system",
            actorId: "ghl_contact_id_backfill",
          });
        } catch (error: any) {
          // The unique constraint is the final cross-process ownership fence.
          const databaseError = error?.cause ?? error;
          if (String(databaseError?.code ?? error?.code) === "23505"
              || /contacts_ghl_contact_id_unique|ghl_contact_id/i.test(String(databaseError?.constraint ?? error?.constraint ?? error?.message ?? ""))) {
            run.skipped++;
            run.lastError = "GHL_ID_OWNERSHIP_CONFLICT";
            await persistOwnedRun(run, token);
            continue;
          }
          throw error;
        }
      }
      run.matched++;
      run.lastError = null;
      await persistOwnedRun(run, token);
    } catch (error: any) {
      // A transport/configuration failure is not a processed identity. Retain
      // this address at the cursor for a later retry instead of losing it.
      run.cursor = previousCursor;
      run.processed--;
      run.errors++;
      run.lastError = String(error?.message || "GHL_LOOKUP_FAILED").slice(0, 500);
      await releaseRun(run, token, "retry");
      return run;
    }
  }
  const remaining = await db.select({ id: contacts.id }).from(contacts)
    .where(and(
      gt(contacts.id, run.cursor),
      lte(contacts.id, run.watermark),
      isNull(contacts.ghlContactId),
    ))
    .limit(1);
  if (!remaining.length) await releaseRun(run, token, "complete");
  else await releaseRun(run, token, "pending");
  return run;
}

export function permissionFields(payloads: any[], contact: any) {
  const byChannel = new Map(payloads.map(item => [item.channel, item]));
  const allows = {
    email: byChannel.get("email")?.payload?.lb_email_allowed === true,
    sms: byChannel.get("sms")?.payload?.lb_sms_allowed === true,
    voice_ai: byChannel.get("voice_ai")?.payload?.lb_voice_ai_allowed === true,
    ringless_vm: byChannel.get("ringless_vm")?.payload?.lb_ringless_vm_allowed === true,
    manual_call: byChannel.get("manual_call")?.payload?.lb_manual_call_allowed === true,
  };
  if (contact.doNotContact === true || contact.doNotAutoContact === true) {
    allows.email = false;
    allows.sms = false;
    allows.voice_ai = false;
    allows.ringless_vm = false;
    allows.manual_call = false;
  }
  return [
    { key: "lb_can_email", field_value: String(allows.email) },
    { key: "lb_can_sms", field_value: String(allows.sms) },
    { key: "lb_can_ai_voice", field_value: String(allows.voice_ai) },
    { key: "lb_can_ringless_vm", field_value: String(allows.ringless_vm) },
    { key: "lb_can_manual_call", field_value: String(allows.manual_call) },
    { key: "lb_channel_permissions", field_value: JSON.stringify(allows) },
  ];
}

function remoteFieldValue(fields: any[], key: string) {
  const field = fields.find(item => String(item?.key ?? item?.fieldKey ?? "") === key);
  return field?.field_value ?? field?.value ?? null;
}

async function readGhlContactPermissionFields(contactId: string): Promise<any[]> {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new Error("GHL_NOT_CONFIGURED");
  const path = `/contacts/${encodeURIComponent(contactId)}`;
  const { authorizeGhlCrmOperation } = await import("./ghl-sync-control");
  const decision = await authorizeGhlCrmOperation({ method: "GET", path, locationId });
  if (!decision.allowed) throw new Error(`GHL_READ_BLOCKED:${decision.reasonCode}`);
  const response = await fetch(`${GHL_API_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Version: "2021-07-28" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GHL_PERMISSION_VERIFY_HTTP_${response.status}`);
  const payload: any = await response.json();
  const fields = payload?.contact?.customFields ?? payload?.customFields;
  if (!Array.isArray(fields)) throw new Error("GHL_PERMISSION_VERIFY_FIELDS_UNAVAILABLE");
  return fields;
}

async function dispatchPermissionProjection(run: GhlSpecializedRun) {
  const contact = await storage.getContact(Number(run.contactId));
  if (!contact) throw new Error("CONTACT_NOT_FOUND");
  if (!contact.ghlContactId) {
    run.state = "needs_identity_backfill";
    run.ghlContactId = null;
    run.fieldProjection = {
      state: "needs_identity_backfill", attemptedFields: [], verifiedFields: [],
      lastError: "GHL_CONTACT_ID_REQUIRED; run contact identity backfill first", verifiedAt: null,
    };
    run.skipped++;
    run.processed++;
    run.lastError = run.fieldProjection.lastError;
    return;
  }
  run.ghlContactId = contact.ghlContactId;
  const control = await (await import("./ghl-sync-control")).getGhlSyncControl();
  if (!control.enabled || !control.permissionsEnabled) {
    run.state = "blocked";
    run.fieldProjection = {
      state: "blocked", attemptedFields: [], verifiedFields: [],
      lastError: !control.enabled ? "GHL_CRM_CONTROL_DISABLED" : "GHL_PERMISSIONS_DISABLED", verifiedAt: null,
    };
    run.lastError = run.fieldProjection.lastError;
    return;
  }

  const { evaluateContactability } = await import("./contactability");
  const channels = ["email", "sms", "voice_ai", "ringless_vm", "manual_call"] as const;
  const decisions = await Promise.all(channels.map(async channel => {
    const decision = await evaluateContactability({
      contactId: contact.id,
      channel,
      mode: "dryRun",
    });
    return { channel, payload: decision.ghlPermissionPayload };
  }));
  const customFields = permissionFields(decisions, contact);
  const path = `/contacts/${encodeURIComponent(contact.ghlContactId)}`;
  const inventory = await (await import("./ghl")).getGhlCustomFieldInventory();
  const byKey = new Map(inventory.map(field => [field.key, field.id]));
  const providerFields = customFields.map(field => ({ ...field, id: byKey.get(field.key) }));
  if (providerFields.some(field => !field.id)) {
    run.state = "blocked";
    run.fieldProjection = {
      state: "blocked", attemptedFields: customFields.map(field => field.key), verifiedFields: [],
      lastError: "GHL_PERMISSION_FIELD_ID_UNVERIFIED", verifiedAt: null,
    };
    run.lastError = run.fieldProjection.lastError;
    return;
  }
  const body = { customFields: providerFields };
  const { authorizeGhlCrmOperation, withGhlCrmInflight } = await import("./ghl-sync-control");
  const decision = await authorizeGhlCrmOperation({
    method: "PUT", path, body, locationId: process.env.GHL_LOCATION_ID,
  });
  if (!decision.allowed || decision.capability !== "permission_write") {
    run.state = "blocked";
    run.fieldProjection = {
      state: "blocked", attemptedFields: customFields.map(field => field.key), verifiedFields: [],
      lastError: `GHL_PERMISSION_WRITE_BLOCKED:${decision.reasonCode}`, verifiedAt: null,
    };
    run.lastError = run.fieldProjection.lastError;
    return;
  }
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
  if (!token) throw new Error("GHL_NOT_CONFIGURED");
  const response = await withGhlCrmInflight(decision, () => fetch(`${GHL_API_BASE}${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Version: "2021-07-28" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  }));
  if (!response.ok) throw new Error(`GHL_PERMISSION_WRITE_HTTP_${response.status}`);
  const actualFields = await readGhlContactPermissionFields(contact.ghlContactId);
  const verifiedFields = providerFields
    .filter(field => {
      const actual = actualFields.find(candidate => candidate.id === field.id);
      return String(actual?.field_value ?? actual?.value ?? remoteFieldValue(actualFields, field.key)) === field.field_value;
    })
    .map(field => field.key);
  if (verifiedFields.length !== customFields.length) {
    throw new Error(`GHL_PERMISSION_PROJECTION_NOT_VERIFIED:${verifiedFields.length}/${customFields.length}`);
  }
  run.state = "complete";
  run.processed++;
  run.matched++;
  run.lastError = null;
  run.fieldProjection = {
    state: "verified",
    attemptedFields: customFields.map(field => field.key),
    verifiedFields,
    lastError: null,
    verifiedAt: new Date().toISOString(),
  };
}

export async function stepGhlSpecializedRun(runId: string, maxItems = BACKFILL_PAGE_SIZE) {
  const boundedMaxItems = Number.isFinite(maxItems)
    ? Math.min(BACKFILL_PAGE_SIZE, Math.max(1, Math.floor(maxItems)))
    : BACKFILL_PAGE_SIZE;
  const claim = await claimRun(runId);
  if ("busy" in claim && claim.busy) return { run: claim.run, leaseBusy: true };
  if ("terminal" in claim && claim.terminal) return { run: claim.run, leaseBusy: false };
  if (!("token" in claim)) return { run: claim.run, leaseBusy: false };
  const run = claim.run;
  if (run.kind === "contact_id_backfill") {
    return { run: await processBackfill(runId, run, claim.token, boundedMaxItems), leaseBusy: false };
  }
  try {
    await dispatchPermissionProjection(run);
    await releaseRun(run, claim.token, run.state);
    return { run, leaseBusy: false };
  } catch (error: any) {
    run.errors++;
    run.lastError = String(error?.message || "GHL_PERMISSION_PROJECTION_FAILED").slice(0, 500);
    run.state = run.errors >= PERMISSION_MAX_ATTEMPTS ? "failed" : "retry";
    if (run.fieldProjection) {
      run.fieldProjection.state = "failed";
      run.fieldProjection.lastError = run.lastError;
    }
    await releaseRun(run, claim.token, run.state);
    return { run, leaseBusy: false };
  }
}

/**
 * Called by the selected GHL runtime tick. At most one durable command page is
 * advanced per call; admin HTTP steps share the exact same claim/CAS path.
 */
export const PENDING_GHL_COMMAND_POINTERS_SQL = `
  SELECT value #>> '{}' AS run_id FROM system_settings
   WHERE (key=$1 OR (key LIKE 'ghl_specialized_command_active_%' AND NOT EXISTS (
     SELECT 1 FROM system_settings current_pointer
      WHERE current_pointer.key=$1 AND current_pointer.value IS NOT NULL
        AND current_pointer.value <> 'null'::jsonb
   )))
     AND value IS NOT NULL AND value <> 'null'::jsonb
   ORDER BY updated_at ASC LIMIT 100`;

interface PendingCommandDependencies {
  queryPointers?: (query: string, values: string[]) => Promise<{ rows: { run_id: string }[] }>;
  readRun?: typeof getGhlSpecializedRun;
  stepRun?: typeof stepGhlSpecializedRun;
}

export async function runPendingGhlSpecializedCommands(maxItems = BACKFILL_PAGE_SIZE, readOnly = false,
  dependencies: PendingCommandDependencies = {}) {
  const limit = Number.isFinite(maxItems)
    ? Math.min(BACKFILL_PAGE_SIZE, Math.max(1, Math.floor(maxItems)))
    : BACKFILL_PAGE_SIZE;
  const pointers = await (dependencies.queryPointers ?? ((query, values) => pool.query<{ run_id: string }>(query, values)))(
    PENDING_GHL_COMMAND_POINTERS_SQL, [activeSettingKey("contact_id_backfill")]);
  const candidates: GhlSpecializedRun[] = [];
  for (const pointer of pointers.rows) {
    if (!pointer.run_id) continue;
    const run = await (dependencies.readRun ?? getGhlSpecializedRun)(pointer.run_id);
    if (!run || !["pending", "retry", "blocked", "running"].includes(run.state)) continue;
    if (hasUnexpiredGhlCommandLease(run)) continue;
    if (readOnly && run.kind !== "contact_id_backfill") continue;
    candidates.push(run);
  }
  candidates.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const next = candidates[0];
  if (!next) return { advanced: false, held: false, reason: "NO_PENDING_COMMAND", runId: null, state: null };
  // Local identity backfill is provider GET-only. Its command lease fences
  // execution; enabling provider writes or selecting their runtime is unrelated.
  if (next.kind === "permission_projection") {
    const control = await (await import("./ghl-sync-control")).getGhlSyncControl();
    if (!control.enabled || !control.permissionsEnabled
        || control.ownerProfile !== "ghl-sync-only" || !control.selectedRuntime) {
      return { advanced: false, held: true, reason: "GHL_RUNTIME_NOT_SELECTED_OR_DISABLED", runId: next.runId, state: next.state };
    }
    const { getGhlSyncRuntimeTruth } = await import("./ghl-sync-runtime");
    const truth = await getGhlSyncRuntimeTruth();
    if (truth.owner.state !== "current" || !truth.worker.selected || !truth.worker.active) {
      return { advanced: false, held: true, reason: "GHL_RUNTIME_OWNER_LEASE_NOT_CURRENT", runId: next.runId, state: next.state };
    }
  }
  const result = await (dependencies.stepRun ?? stepGhlSpecializedRun)(next.runId, limit);
  return {
    advanced: !result.leaseBusy,
    held: result.leaseBusy || result.run.state === "blocked",
    reason: result.leaseBusy ? "COMMAND_LEASE_ACTIVE" : result.run.state === "blocked" ? result.run.lastError : null,
    runId: result.run.runId,
    kind: result.run.kind,
    state: result.run.state,
    processed: result.run.processed,
    matched: result.run.matched,
    notFound: result.run.notFound,
    skipped: result.run.skipped,
    errors: result.run.errors,
    cursor: result.run.cursor,
    watermark: result.run.watermark,
    heartbeatAt: result.run.heartbeatAt,
    lastError: result.run.lastError,
  };
}

let readBackfillTimer: ReturnType<typeof setInterval> | null = null;
let readBackfillInFlight = false;
/** Recover durable, explicitly requested GET-only commands after a restart.
 * This never starts a new backfill and can never dispatch a permission write. */
export function startGhlReadBackfillWorker() {
  if (readBackfillTimer) return;
  const tick = async () => {
    if (readBackfillInFlight) return;
    readBackfillInFlight = true;
    try { await runPendingGhlSpecializedCommands(BACKFILL_PAGE_SIZE, true); }
    catch (error: any) { console.error("[GHL read backfill] command tick failed:", error?.message); }
    finally { readBackfillInFlight = false; }
  };
  readBackfillTimer = setInterval(tick, 30_000);
  readBackfillTimer.unref();
  void tick();
}
export function stopGhlReadBackfillWorker() {
  if (readBackfillTimer) clearInterval(readBackfillTimer);
  readBackfillTimer = null;
}

export async function getGhlSpecializedRun(runId: string) {
  return readSetting<GhlSpecializedRun>(runSettingKey(runId));
}

export async function getLatestGhlBackfillStatus() {
  const [runId, missing, total, activeId] = await Promise.all([
    readSetting<string>(LAST_BACKFILL_KEY),
    db.select({ total: sql<number>`count(*)::int` }).from(contacts).where(isNull(contacts.ghlContactId)),
    db.select({ total: sql<number>`count(*)::int` }).from(contacts),
    readSetting<string>(activeSettingKey("contact_id_backfill")),
  ]);
  const [run, activeRun] = await Promise.all([
    typeof runId === "string" ? getGhlSpecializedRun(runId) : Promise.resolve(null),
    typeof activeId === "string" ? getGhlSpecializedRun(activeId) : Promise.resolve(null),
  ]);
  const relevantActiveRun = activeRun?.kind === "contact_id_backfill" ? activeRun : null;
  const liveLease = !!relevantActiveRun?.leaseExpiresAt && Date.parse(relevantActiveRun.leaseExpiresAt) > Date.now();
  return {
    totalContacts: Number(total[0]?.total ?? 0),
    missingGhlId: Number(missing[0]?.total ?? 0),
    activeRun: relevantActiveRun ? { ...relevantActiveRun, activeLease: liveLease } : null,
    run,
  };
}

export async function getContactPermissionProjectionStatus(contactId: number) {
  const runId = await readSetting<string>(`ghl_permission_projection_contact_${contactId}`);
  return typeof runId === "string" ? getGhlSpecializedRun(runId) : null;
}

export async function freshGhlPipelinesReadOnly() {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new Error("GHL_NOT_CONFIGURED");
  const path = `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`;
  const { authorizeGhlCrmOperation } = await import("./ghl-sync-control");
  const decision = await authorizeGhlCrmOperation({ method: "GET", path, locationId });
  if (!decision.allowed || decision.capability !== "crm_read") {
    throw new Error(`GHL_PIPELINE_READ_BLOCKED:${decision.reasonCode}`);
  }
  const response = await fetch(`${GHL_API_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Version: "2021-07-28" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GHL_PIPELINE_READ_HTTP_${response.status}`);
  const payload: any = await response.json();
  if (!Array.isArray(payload?.pipelines)) throw new Error("GHL_PIPELINE_READ_RESPONSE_INVALID");
  return payload.pipelines.map((pipeline: any) => ({
    id: typeof pipeline?.id === "string" ? pipeline.id : "",
    name: typeof pipeline?.name === "string" ? pipeline.name : "",
    stages: Array.isArray(pipeline?.stages) ? pipeline.stages.map((stage: any) => ({
      id: typeof stage?.id === "string" ? stage.id : "",
      name: typeof stage?.name === "string" ? stage.name : "",
    })) : [],
  })).filter((pipeline: any) => pipeline.id);
}

export async function validateGhlSemanticStageMappings(mappings: Array<{
  localPipelineId: string;
  localStageId: number;
  ghlPipelineId: string;
  ghlStageId: string;
}>) {
  const local = await db.select({
    id: pipelineStages.id,
    pipeline: pipelineStages.pipeline,
  }).from(pipelineStages);
  const localSet = new Set(local.map(row => `${row.pipeline}\0${row.id}`));
  const pipelines = await freshGhlPipelinesReadOnly();
  const remoteSet = new Set<string>();
  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) remoteSet.add(`${pipeline.id}\0${stage.id}`);
  }
  const seenLocal = new Set<string>();
  const seenRemote = new Set<string>();
  for (const mapping of mappings) {
    const localKey = `${mapping.localPipelineId}\0${mapping.localStageId}`;
    const remoteKey = `${mapping.ghlPipelineId}\0${mapping.ghlStageId}`;
    if (!localSet.has(localKey)) throw new Error(`LOCAL_STAGE_NOT_FOUND:${mapping.localPipelineId}:${mapping.localStageId}`);
    if (!remoteSet.has(remoteKey)) throw new Error(`GHL_STAGE_NOT_FOUND:${mapping.ghlPipelineId}:${mapping.ghlStageId}`);
    if (seenLocal.has(localKey)) throw new Error(`DUPLICATE_LOCAL_STAGE_MAPPING:${localKey}`);
    if (seenRemote.has(remoteKey)) throw new Error(`DUPLICATE_GHL_STAGE_MAPPING:${remoteKey}`);
    seenLocal.add(localKey);
    seenRemote.add(remoteKey);
  }
}