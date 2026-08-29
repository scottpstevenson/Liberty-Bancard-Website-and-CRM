import crypto from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  lockCommercialGraph,
  lockCommercialGraphMembershipSets,
  lockCommercialGraphNodes,
} from "./commercial-graph-locks";

/**
 * Canonical, versioned identity evidence. It intentionally records no raw
 * email/phone value: operators compare HMAC lookup tokens and access the
 * source contact only through the authenticated CRM.
 */
export const IDENTITY_NORMALIZATION_VERSION = 1;
const LOOKUP_SECRET = process.env.CREDENTIAL_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;

export type IdentitySource =
  | "contact_writer"
  | "storage_create"
  | "storage_update"
  | "ghl_inbound"
  | "csv_import"
  | "public_form";

export type ContactIdentityInput = {
  id: number;
  email?: string | null;
  phone?: string | null;
};

type SqlExecutor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };
type PgExecutor = { query: (query: string, params?: unknown[]) => Promise<{ rows: any[] }> };

function lookupToken(kind: "email" | "phone", value: string): string {
  if (!LOOKUP_SECRET) {
    throw new Error("Canonical identity observations require CREDENTIAL_ENCRYPTION_KEY or SESSION_SECRET");
  }
  return crypto.createHmac("sha256", LOOKUP_SECRET).update(`${IDENTITY_NORMALIZATION_VERSION}:${kind}:${value}`).digest("hex");
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    && !normalized.endsWith(".internal")
    && !normalized.startsWith("noemail-");
  return {
    normalized: valid ? normalized : null,
    invalidReason: valid ? null : "invalid_or_placeholder_email",
    eligibility: valid ? "eligible" : "ineligible",
    confidence: valid ? 100 : 0,
  } as const;
}

function normalizePhone(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  const normalized = digits.length === 10 ? `+1${digits}` : digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  // Telephone ownership cannot be inferred from the raw legacy field. It is
  // evidence only, never independently sufficient to propose a merge.
  return {
    normalized,
    invalidReason: normalized ? null : "invalid_or_missing_phone",
    eligibility: normalized ? "weak" : "ineligible",
    confidence: normalized ? 35 : 0,
    countryCode: normalized?.startsWith("+1") ? "US" : null,
  } as const;
}

async function writeContactIdentityObservations(
  executor: SqlExecutor,
  contact: ContactIdentityInput,
  sourceType: IdentitySource,
  sourceId?: string | null,
): Promise<void> {
  for (const [kind, normalizer] of [
    ["email", normalizeEmail(contact.email)] as const,
    ["phone", normalizePhone(contact.phone)] as const,
  ]) {
    // Identity observations are versioned history, but only one current
    // observation per contact/kind may participate in matching.
    await executor.execute(sql`
      UPDATE contact_identity_observations
      SET superseded_at = now()
      WHERE contact_id = ${contact.id} AND identity_kind = ${kind} AND superseded_at IS NULL
    `);
    // Invalid observations still get a keyed token so no raw identifier is
    // persisted in logs; they are explicitly ineligible for matching.
    const tokenValue = normalizer.normalized ?? `invalid:${String(kind)}:${normalizer.invalidReason}`;
    await executor.execute(sql`
      INSERT INTO contact_identity_observations (
        contact_id, identity_kind, normalized_value, lookup_token,
        normalization_version, source_type, source_id, country_code,
        phone_endpoint_type, phone_ownership, eligibility, confidence, invalid_reason, superseded_at
      ) VALUES (
        ${contact.id}, ${kind}, ${null}, ${lookupToken(kind, tokenValue)},
        ${IDENTITY_NORMALIZATION_VERSION}, ${sourceType}, ${sourceId ?? null},
        ${"countryCode" in normalizer ? normalizer.countryCode : null},
        ${kind === "phone" ? "unknown" : null}, ${kind === "phone" ? "unknown" : null},
         ${normalizer.eligibility}, ${normalizer.confidence}, ${normalizer.invalidReason}, ${null}
      )
      ON CONFLICT DO NOTHING
    `);
  }
}

export async function recordContactIdentityObservations(
  executor: SqlExecutor,
  contact: ContactIdentityInput,
  sourceType: IdentitySource,
  sourceId?: string | null,
): Promise<void> {
  await lockCommercialGraph(executor, [{ type: "contact", id: contact.id }], ["identity"]);
  await writeContactIdentityObservations(executor, contact, sourceType, sourceId);
}

export async function recordContactIdentityObservationsForContacts(
  executor: SqlExecutor,
  contacts: ContactIdentityInput[],
  sourceType: IdentitySource,
  sourceId?: string | null,
): Promise<void> {
  const ordered = [...new Map(contacts.map(contact => [contact.id, contact])).values()]
    .sort((a, b) => a.id - b.id);
  const nodes = ordered.map(contact => ({ type: "contact" as const, id: contact.id }));
  await lockCommercialGraphNodes(executor, nodes);
  await lockCommercialGraphMembershipSets(executor, nodes, ["identity"]);
  for (const contact of ordered) {
    await writeContactIdentityObservations(executor, contact, sourceType, sourceId);
  }
}

/** Transactional adapter for the two maintained pg-pool bulk import scripts. */
export async function recordContactIdentityObservationsForPg(
  executor: PgExecutor, contact: ContactIdentityInput, sourceType: IdentitySource, sourceId?: string | null,
): Promise<void> {
  await recordContactIdentityObservationsForPgContacts(executor, [contact], sourceType, sourceId);
}

export async function recordContactIdentityObservationsForPgContacts(
  executor: PgExecutor,
  contacts: ContactIdentityInput[],
  sourceType: IdentitySource,
  sourceId?: string | null,
): Promise<void> {
  const ordered = [...new Map(contacts.map(contact => [contact.id, contact])).values()]
    .sort((a, b) => a.id - b.id);
  for (const contact of ordered) {
    await executor.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 1700))`,
      [`cro02:v1:node:contact:${contact.id}`],
    );
  }
  for (const contact of ordered) {
    await executor.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 1700))`,
      [`cro02:v1:membership-set:identity:contact:${contact.id}`],
    );
  }
  for (const contact of ordered) {
    for (const [kind, normalizer] of [["email", normalizeEmail(contact.email)] as const, ["phone", normalizePhone(contact.phone)] as const]) {
      const tokenValue = normalizer.normalized ?? `invalid:${String(kind)}:${normalizer.invalidReason}`;
      await executor.query(`UPDATE contact_identity_observations SET superseded_at = now() WHERE contact_id = $1 AND identity_kind = $2 AND superseded_at IS NULL`, [contact.id, kind]);
      await executor.query(`
        INSERT INTO contact_identity_observations
        (contact_id, identity_kind, normalized_value, lookup_token, normalization_version, source_type, source_id, country_code, phone_endpoint_type, phone_ownership, eligibility, confidence, invalid_reason, superseded_at)
        VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL)
        ON CONFLICT DO NOTHING`,
        [contact.id, kind, lookupToken(kind, tokenValue), IDENTITY_NORMALIZATION_VERSION, sourceType, sourceId ?? null,
          "countryCode" in normalizer ? normalizer.countryCode : null, kind === "phone" ? "unknown" : null,
          kind === "phone" ? "unknown" : null, normalizer.eligibility, normalizer.confidence, normalizer.invalidReason]);
    }
  }
}

export class ContactRedirectResolutionError extends Error {
  constructor(message: string) { super(message); this.name = "ContactRedirectResolutionError"; }
}

export type LiveContactRedirectResolution = {
  requestedContactId: number;
  effectiveContactId: number;
  chain: number[];
  operationIds: string[];
  effectHold: boolean;
  effectHoldOperationIds: string[];
};

export const CONTACT_MERGE_EFFECT_HOLD_REASON = "contact_merge_consent_handoff_pending";
export const CONTACT_REDIRECT_IDENTITY_STATUSES = [
  "committed",
  "reconciliation_pending",
  "completed",
] as const;

export function isIdentityAuthoritativeRedirectState(status: string): boolean {
  return (CONTACT_REDIRECT_IDENTITY_STATUSES as readonly string[]).includes(status);
}

export function isContactMergeEffectHoldState(
  status: string,
  reconciliationStatus: string | null | undefined,
): boolean {
  return status === "committed"
    || (status === "reconciliation_pending"
      && reconciliationStatus === "consent_handoff_retry_required");
}

/**
 * Resolve only at live work boundaries; never use this in generic reads.
 * Redirect corruption is a safety fault: reject cycles/depth overflow instead
 * of silently choosing an arbitrary contact from a recursive query.
 */
export async function resolveLiveContactRedirect(contactId: number): Promise<LiveContactRedirectResolution> {
  const chain = [contactId];
  const operationIds: string[] = [];
  const effectHoldOperationIds: string[] = [];
  const visited = new Set<number>([contactId]);
  let current = contactId;
  for (let depth = 0; depth < 8; depth++) {
    const found = ((await db.execute(sql`
      SELECT r.survivor_contact_id, r.operation_id, op.status, op.reconciliation_status
      FROM contact_merge_redirects r
      JOIN contact_merge_operations op ON op.id = r.operation_id
      WHERE r.deprecated_contact_id = ${current} AND r.active
      ORDER BY r.id
    `) as any).rows ?? []) as any[];
    if (!found.length) {
      return {
        requestedContactId: contactId,
        effectiveContactId: current,
        chain,
        operationIds,
        effectHold: effectHoldOperationIds.length > 0,
        effectHoldOperationIds,
      };
    }
    if (found.length !== 1 || !isIdentityAuthoritativeRedirectState(String(found[0].status))) {
      throw new ContactRedirectResolutionError(`Invalid or ambiguous active contact merge redirect for ${contactId}`);
    }
    const row = found[0];
    const next = Number(row.survivor_contact_id);
    if (!Number.isInteger(next) || visited.has(next)) {
      throw new ContactRedirectResolutionError(`Invalid or cyclic contact merge redirect for ${contactId}`);
    }
    const operationId = String(row.operation_id);
    visited.add(next); chain.push(next); operationIds.push(operationId); current = next;
    if (isContactMergeEffectHoldState(String(row.status), row.reconciliation_status)) {
      effectHoldOperationIds.push(operationId);
    }
  }
  throw new ContactRedirectResolutionError(`Contact merge redirect depth exceeded for ${contactId}`);
}

/** Compatibility helper for existing live dispatch sites. */
export async function resolveLiveContactId(contactId: number): Promise<number> {
  return (await resolveLiveContactRedirect(contactId)).effectiveContactId;
}