/**
 * Merchant Application Service — Canonical Owner
 * ==============================================
 * Single owner of merchant-application persistence, protected-data handling,
 * state transitions, capabilities (draft token + e-sign), and durable outbox
 * enqueue. Route handlers MUST go through this service; they never write raw
 * generic inserts/updates or return full rows.
 *
 * Hardening (v2):
 *   1. Finalize replay verified by constant-time draft token match AND same
 *      idempotency key. e-sign capability is derived deterministically from
 *      draftToken+appId+idempotencyKey (HKDF-style HMAC chain), never stored
 *      as plaintext. Different idempotency key remains 409.
 *   2. No catch-and-swallow in effect handlers; effects are individually keyed.
 *   3. Finalize/status effects split into individually idempotency-keyed outbox
 *      rows (contact_link, consent_record, ghl_sync, workflow_enroll, risk_scan,
 *      approval_email, deal_stage, lifecycle, decline_email).
 *   5. Duplicate-EIN index is unique (migration) so concurrent finalize with
 *      same EIN fingerprint is caught by Postgres; maps to duplicate_ein.
 *   6. POST /api/merchant-applications gated to isAdminOrManager (operator only).
 *   7. operatorUpdateDto removes esignStatus/esignedAt; only applyEsignDocumentState
 *      may mutate those. applyUnderwritingRiskState is the canonical writer for
 *      underwriting fields.
 *   9. applyEsignDocumentState increments stateVersion and is conditional.
 *      Revoke capability after signed. Request dedupes queued/sent.
 */

import { z } from "zod";
import crypto from "crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { merchantApplications, merchantApplicationProtectedOutbox } from "@shared/schema";
import { auditChange } from "./audit-change";
import {
  processProtectedData,
  fingerprint,
  normalizeEin,
  isMerchantEncryptionAvailable,
  ProtectedDataValidationError,
  MERCHANT_PROTECTED_DATA_VERSION,
} from "./merchant-protected-data";

export { ProtectedDataValidationError };

// ── Constants ───────────────────────────────────────────────────────────────

export const DRAFT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const ESIGN_CAPABILITY_TTL_MS = 30 * 60 * 1000; // 30 min

// Fields that are protected PII/financial. Never route-facing, never in projections.
export const PROTECTED_FIELD_INVENTORY = [
  "ein",
  "ownerDob",
  "ownerSsn",
  "bankRoutingNumber",
  "bankAccountNumber",
  "additionalOwners",
] as const;

// Columns that must never appear in any projection returned to a caller.
export const FORBIDDEN_PROJECTION_COLUMNS = new Set<string>([
  "ein",
  "ownerDob",
  "ownerSsn",
  "bankRoutingNumber",
  "bankAccountNumber",
  "additionalOwners",
  "draftTokenHash",
  "esignCapabilityHash",
  "einFingerprint",
  "ssnFingerprint",
  "bankAccountFingerprint",
  "protectedDataMetadata",
  "protectedDataIdempotencyKey",
  "finalizeIdempotencyKey",
]);

// ── Status transition graph ───────────────────────────────────────────────
export const STATUS_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  draft: new Set(["in_progress", "submitted", "withdrawn"]),
  in_progress: new Set(["submitted", "withdrawn"]),
  submitted: new Set(["under_review", "declined", "withdrawn"]),
  under_review: new Set(["approved", "declined"]),
  approved: new Set(),
  declined: new Set(),
  withdrawn: new Set(),
};

const TERMINAL_STATUSES = new Set(["approved", "declined", "withdrawn"]);
const FINALIZE_ELIGIBLE_STATUSES = new Set(["draft", "in_progress"]);
const AUTOSAVE_ELIGIBLE_STATUSES = new Set(["draft", "in_progress"]);
// Statuses considered "existing" for duplicate detection.
const DUP_ACTIVE_STATUSES = ["submitted", "under_review", "approved", "declined", "withdrawn"];

export function canTransition(from: string, to: string): boolean {
  const allowed = STATUS_TRANSITIONS[from];
  return !!allowed && allowed.has(to);
}

// ── Errors ────────────────────────────────────────────────────────────────

export class NotFoundError extends Error {
  constructor(msg = "Not found") { super(msg); this.name = "NotFoundError"; }
}
export class ConflictError extends Error {
  code?: string;
  constructor(msg: string, code?: string) { super(msg); this.name = "ConflictError"; this.code = code; }
}
export class ValidationError extends Error {
  field?: string;
  constructor(msg: string, field?: string) { super(msg); this.name = "ValidationError"; this.field = field; }
}
export class ServiceUnavailableError extends Error {
  constructor(msg: string) { super(msg); this.name = "ServiceUnavailableError"; }
}
export class ForbiddenError extends Error {
  constructor(msg = "Forbidden") { super(msg); this.name = "ForbiddenError"; }
}

// ── DTOs ────────────────────────────────────────────────────────────────────

export const draftCreateDto = z
  .object({
    legalBusinessName: z.string().max(300).optional(),
    businessEmail: z.string().max(300).optional(),
    ownerEmail: z.string().max(300).optional(),
    vertical: z.string().max(120).optional(),
  })
  .strict();

export const autosaveDto = z
  .object({
    legalBusinessName: z.string().max(300).optional(),
    dba: z.string().max(300).optional(),
    businessType: z.string().max(120).optional(),
    businessStartDate: z.string().max(40).optional(),
    businessAddress: z.string().max(300).optional(),
    businessCity: z.string().max(120).optional(),
    businessState: z.string().max(60).optional(),
    businessZip: z.string().max(20).optional(),
    businessPhone: z.string().max(40).optional(),
    businessEmail: z.string().max(300).optional(),
    website: z.string().max(300).optional(),
    vertical: z.string().max(120).optional(),
    ownerFirstName: z.string().max(120).optional(),
    ownerLastName: z.string().max(120).optional(),
    ownerEmail: z.string().max(300).optional(),
    ownerPhone: z.string().max(40).optional(),
    ownerAddress: z.string().max(300).optional(),
    ownerCity: z.string().max(120).optional(),
    ownerState: z.string().max(60).optional(),
    ownerZip: z.string().max(20).optional(),
    ownershipPercent: z.union([z.number(), z.string()]).optional(),
    estimatedMonthlyVolume: z.string().max(60).optional(),
    estimatedAvgTicket: z.string().max(60).optional(),
    highestTicket: z.string().max(60).optional(),
    currentProcessor: z.string().max(200).nullable().optional(),
    currentRate: z.string().max(60).nullable().optional(),
    acceptedCardTypes: z.array(z.string()).optional(),
    terminalNeeded: z.boolean().optional(),
    terminalType: z.string().max(120).nullable().optional(),
    terminalQuantity: z.union([z.number(), z.string()]).optional(),
    ecommerceNeeded: z.boolean().optional(),
    preferredProgram: z.string().max(120).optional(),
    currentStep: z.union([z.number(), z.string()]).optional(),
  })
  .strict();

export const finalizeDto = autosaveDto
  .extend({
    ein: z.string().optional(),
    ownerDob: z.string().optional(),
    ownerSsn: z.string().optional(),
    bankName: z.string().max(200).optional(),
    bankRoutingNumber: z.string().optional(),
    bankAccountNumber: z.string().optional(),
    bankAccountType: z.string().max(60).optional(),
    additionalOwners: z.array(z.record(z.unknown())).optional(),
    pewcConsent: z.boolean().optional(),
    reviewConfirmed: z.boolean().optional(),
    status: z.string().optional(),
    totalSteps: z.union([z.number(), z.string()]).optional(),
    esignStatus: z.string().optional(),
    referralSource: z.string().max(200).optional(),
    referralCode: z.string().max(200).optional(),
    utmSource: z.string().max(200).optional(),
    utmMedium: z.string().max(200).optional(),
    utmCampaign: z.string().max(200).optional(),
    utmTerm: z.string().max(200).optional(),
    utmContent: z.string().max(200).optional(),
    _shareToken: z.string().optional(),
  })
  .strict();

export const operatorCreateDto = finalizeDto
  .extend({
    userId: z.string().optional(),
    contactId: z.number().optional(),
    companyId: z.number().optional(),
    dealId: z.number().optional(),
  })
  .strict();

// Operator PATCH — strict allowlist. esignStatus/esignedAt removed: only
// applyEsignDocumentState may mutate e-sign state. No protected keys.
export const operatorUpdateDto = z
  .object({
    status: z.string().optional(),
    underwritingStatus: z.string().optional(),
    underwritingNotes: z.string().optional(),
    declineReason: z.string().optional(),
    approvedAt: z.coerce.date().nullable().optional(),
    declinedAt: z.coerce.date().nullable().optional(),
    submittedAt: z.coerce.date().nullable().optional(),
    completedAt: z.coerce.date().nullable().optional(),
    contactId: z.number().nullable().optional(),
    companyId: z.number().nullable().optional(),
    dealId: z.number().nullable().optional(),
    preferredProgram: z.string().optional(),
    currentStep: z.number().optional(),
  })
  .strict();

const NON_SENSITIVE_PERSIST_FIELDS = new Set([
  "legalBusinessName", "dba", "businessType", "businessStartDate",
  "businessAddress", "businessCity", "businessState", "businessZip",
  "businessPhone", "businessEmail", "website", "vertical",
  "ownerFirstName", "ownerLastName", "ownerEmail", "ownerPhone",
  "ownerAddress", "ownerCity", "ownerState", "ownerZip", "ownershipPercent",
  "estimatedMonthlyVolume", "estimatedAvgTicket", "highestTicket",
  "currentProcessor", "currentRate", "acceptedCardTypes",
  "terminalNeeded", "terminalType", "terminalQuantity", "ecommerceNeeded",
  "preferredProgram", "currentStep", "bankName", "bankAccountType",
  "referralSource", "referralCode",
]);

// ── Token / capability helpers ──────────────────────────────────────────────

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Derive a deterministic e-sign capability token from high-entropy inputs.
 * Domain-separated HMAC: hmac(draftToken, "esign-cap:v1:" + appId + ":" + idempotencyKey).
 * Caller supplies the plaintext draftToken; only its hash is ever stored.
 * The derived capability is deterministic so replay returns the same value.
 */
export function deriveEsignCapability(
  draftToken: string,
  appId: number,
  idempotencyKey: string,
): string {
  return crypto
    .createHmac("sha256", draftToken)
    .update(`esign-cap:v1:${appId}:${idempotencyKey}`)
    .digest("hex");
}

export function verifyDraftToken(
  token: string,
  row: {
    draftTokenHash?: string | null;
    draftTokenExpiresAt?: Date | null;
    draftTokenRevokedAt?: Date | null;
  },
  now = new Date(),
): boolean {
  if (!token || !row.draftTokenHash) return false;
  // Reject revoked tokens on the normal (non-replay) autosave/read path (item 2).
  if (row.draftTokenRevokedAt) return false;
  // Expiry check.
  if (row.draftTokenExpiresAt && row.draftTokenExpiresAt.getTime() < now.getTime()) return false;
  // Constant-time hash compare (always performed regardless of revocation so timing is uniform).
  return constantTimeEqualHex(hashSecret(token), row.draftTokenHash);
}

/**
 * Verify draft token for FINALIZE only: allows replay on finalized (revoked)
 * rows by skipping the revocation check. The caller must separately verify
 * the idempotency key for replay safety.
 */
export function verifyDraftTokenForReplay(
  token: string,
  row: {
    draftTokenHash?: string | null;
    draftTokenExpiresAt?: Date | null;
  },
  now = new Date(),
): boolean {
  if (!token || !row.draftTokenHash) return false;
  // Replay may ignore revocation (finalize sets draftTokenRevokedAt), but MUST
  // still enforce token expiry so an expired token can never replay (item 2).
  if (row.draftTokenExpiresAt && row.draftTokenExpiresAt.getTime() < now.getTime()) return false;
  return constantTimeEqualHex(hashSecret(token), row.draftTokenHash);
}

export function verifyEsignCapability(
  cap: string,
  row: {
    esignCapabilityHash?: string | null;
    esignCapabilityExpiresAt?: Date | null;
    esignCapabilityRevokedAt?: Date | null;
  },
  now = new Date(),
): boolean {
  if (!cap || !row.esignCapabilityHash) return false;
  if (row.esignCapabilityRevokedAt) return false;
  if (row.esignCapabilityExpiresAt && row.esignCapabilityExpiresAt.getTime() < now.getTime()) return false;
  return constantTimeEqualHex(hashSecret(cap), row.esignCapabilityHash);
}

// ── Safe projections ──────────────────────────────────────────────────────

export function toPublicAckDto(row: Record<string, any>, esignCapability?: string) {
  const ack: Record<string, unknown> = {
    id: row.id,
    status: row.status,
    esignStatus: row.esignStatus ?? null,
  };
  if (esignCapability) ack.esignCapability = esignCapability;
  return ack;
}

export function toOperatorDto(row: Record<string, any>) {
  const dto: Record<string, unknown> = {};
  const SAFE_FIELDS = [
    "id", "userId", "contactId", "companyId", "dealId", "status",
    "currentStep", "totalSteps", "legalBusinessName", "dba", "businessType",
    "businessStartDate", "businessAddress", "businessCity", "businessState",
    "businessZip", "businessPhone", "businessEmail", "website", "vertical",
    "ownerFirstName", "ownerLastName", "ownerEmail", "ownerPhone",
    "ownerAddress", "ownerCity", "ownerState", "ownerZip", "ownershipPercent",
    "bankName", "bankAccountType", "estimatedMonthlyVolume", "estimatedAvgTicket",
    "highestTicket", "currentProcessor", "currentRate", "acceptedCardTypes",
    "terminalNeeded", "terminalType", "terminalQuantity", "ecommerceNeeded",
    "preferredProgram", "referralSource", "referralCode",
    "esignStatus", "esignDocumentId", "esignSigningUrl", "esignedAt",
    "underwritingStatus", "underwritingNotes", "underwritingNotesLog",
    "approvedAt", "declinedAt", "declineReason", "submittedAt", "completedAt",
    "stateVersion", "createdAt", "updatedAt",
    "einMask", "ssnMask", "bankAccountMask", "bankRoutingMask",
    "protectedDataVersion",
  ];
  for (const f of SAFE_FIELDS) {
    if (f in row) dto[f] = row[f];
  }
  for (const forbidden of FORBIDDEN_PROJECTION_COLUMNS) {
    delete (dto as Record<string, unknown>)[forbidden];
  }
  return dto;
}

export function toUserDto(row: Record<string, any>) {
  const dto: Record<string, unknown> = {};
  const SAFE_FIELDS = [
    "id", "status", "currentStep", "totalSteps", "legalBusinessName", "dba",
    "businessType", "businessEmail", "vertical", "ownerFirstName", "ownerLastName",
    "ownerEmail", "ownerPhone", "esignStatus", "esignSigningUrl", "esignedAt",
    "submittedAt", "approvedAt", "declinedAt", "createdAt", "updatedAt",
    "einMask", "ssnMask", "bankAccountMask", "bankRoutingMask",
  ];
  for (const f of SAFE_FIELDS) {
    if (f in row) dto[f] = row[f];
  }
  return dto;
}

export function toAutosaveDto(row: Record<string, any>) {
  const dto: Record<string, unknown> = {};
  for (const f of NON_SENSITIVE_PERSIST_FIELDS) {
    if (f in row) dto[f] = row[f];
  }
  dto.status = row.status;
  dto.id = row.id;
  return dto;
}

// ── Protected-data application helper ───────────────────────────────────────

function buildProtectedUpdate(
  applicationId: number,
  raw: {
    ein?: string | null;
    ownerDob?: string | null;
    ownerSsn?: string | null;
    bankRoutingNumber?: string | null;
    bankAccountNumber?: string | null;
    additionalOwners?: unknown;
  },
): { update: Record<string, unknown>; touched: string[] } | null {
  const hasAny =
    (raw.ein && String(raw.ein).trim()) ||
    (raw.ownerDob && String(raw.ownerDob).trim()) ||
    (raw.ownerSsn && String(raw.ownerSsn).trim()) ||
    (raw.bankRoutingNumber && String(raw.bankRoutingNumber).trim()) ||
    (raw.bankAccountNumber && String(raw.bankAccountNumber).trim()) ||
    (raw.additionalOwners && (Array.isArray(raw.additionalOwners) ? raw.additionalOwners.length : true));
  if (!hasAny) return null;

  const result = processProtectedData(applicationId, {
    ein: raw.ein ?? undefined,
    ssn: raw.ownerSsn ?? undefined,
    dob: raw.ownerDob ?? undefined,
    routing: raw.bankRoutingNumber ?? undefined,
    account: raw.bankAccountNumber ?? undefined,
    additionalOwners: raw.additionalOwners,
  });

  const update: Record<string, unknown> = {
    protectedDataVersion: result.version,
    protectedDataMetadata: result.metadata,
  };
  const touched: string[] = [];
  if (result.ein) { update.ein = result.ein.ciphertext; update.einFingerprint = result.ein.fingerprint; update.einMask = result.ein.mask; touched.push("ein"); }
  if (result.ssn) { update.ownerSsn = result.ssn.ciphertext; update.ssnFingerprint = result.ssn.fingerprint; update.ssnMask = result.ssn.mask; touched.push("ownerSsn"); }
  if (result.dob) { update.ownerDob = result.dob.ciphertext; touched.push("ownerDob"); }
  if (result.routing) { update.bankRoutingNumber = result.routing.ciphertext; update.bankRoutingMask = result.routing.mask; touched.push("bankRoutingNumber"); }
  if (result.account) { update.bankAccountNumber = result.account.ciphertext; update.bankAccountFingerprint = result.account.fingerprint; update.bankAccountMask = result.account.mask; touched.push("bankAccountNumber"); }
  if (result.additionalOwners) { update.additionalOwners = result.additionalOwners.ciphertext; touched.push("additionalOwners"); }
  return { update, touched };
}

function extractNonSensitive(dto: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dto)) {
    if (NON_SENSITIVE_PERSIST_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

// ── Outbox enqueue (durable, individually keyed) ─────────────────────────

async function enqueueOutbox(
  tx: any,
  applicationId: number,
  eventType: string,
  idempotencyKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx
    .insert(merchantApplicationProtectedOutbox)
    .values({
      applicationId,
      eventType,
      protectedDataVersion: MERCHANT_PROTECTED_DATA_VERSION,
      payload,
      idempotencyKey,
      status: "pending",
    })
    .onConflictDoNothing({ target: merchantApplicationProtectedOutbox.idempotencyKey });
}

/** Enqueue multiple individually-keyed outbox rows; each is its own retryable unit. */
async function enqueueOutboxBatch(
  tx: any,
  rows: Array<{ applicationId: number; eventType: string; idempotencyKey: string; payload: Record<string, unknown> }>,
): Promise<void> {
  for (const r of rows) {
    await enqueueOutbox(tx, r.applicationId, r.eventType, r.idempotencyKey, r.payload);
  }
}

// Build the standard finalize-triggered effect rows.
function buildFinalizeOutboxRows(
  appId: number,
  idempotencyKey: string,
  contact: {
    pewcConsent: boolean;
    ownerEmail?: string | null;
    businessEmail?: string | null;
    ownerFirstName?: string | null;
    ownerLastName?: string | null;
    legalBusinessName?: string | null;
    dba?: string | null;
    businessPhone?: string | null;
    ownerPhone?: string | null;
    vertical?: string | null;
  },
) {
  const base = { applicationId: appId };
  const contactPayload = {
    ownerEmail: contact.ownerEmail ?? null,
    businessEmail: contact.businessEmail ?? null,
    ownerFirstName: contact.ownerFirstName ?? null,
    ownerLastName: contact.ownerLastName ?? null,
    legalBusinessName: contact.legalBusinessName ?? null,
    dba: contact.dba ?? null,
    businessPhone: contact.businessPhone ?? null,
    ownerPhone: contact.ownerPhone ?? null,
    vertical: contact.vertical ?? null,
  };
  return [
    { ...base, eventType: "contact_link", idempotencyKey: `contact_link:${appId}:${idempotencyKey}`, payload: { ...contactPayload } },
    ...(contact.pewcConsent ? [{ ...base, eventType: "consent_record", idempotencyKey: `consent_record:${appId}:${idempotencyKey}`, payload: { ...contactPayload, pewcConsent: true } }] : []),
    { ...base, eventType: "ghl_sync", idempotencyKey: `ghl_sync:${appId}:${idempotencyKey}`, payload: { ...contactPayload } },
    { ...base, eventType: "workflow_enroll", idempotencyKey: `workflow_enroll:${appId}:${idempotencyKey}`, payload: { ...contactPayload } },
    { ...base, eventType: "risk_scan", idempotencyKey: `risk_scan:${appId}:${idempotencyKey}`, payload: {} },
  ];
}

function buildStatusOutboxRows(
  appId: number,
  from: string,
  to: string,
  opts: { dealId?: number | null; contactId?: number | null; declineReason?: string | null },
) {
  const base = { applicationId: appId };
  const base_key = `${appId}:${from}->${to}`;
  const rows = [];
  if (to === "approved") {
    rows.push(
      { ...base, eventType: "approval_email", idempotencyKey: `approval_email:${base_key}`, payload: {} },
      ...(opts.dealId ? [{ ...base, eventType: "deal_stage", idempotencyKey: `deal_stage:${base_key}`, payload: { dealId: opts.dealId } }] : []),
      ...(opts.contactId ? [{ ...base, eventType: "lifecycle_approved", idempotencyKey: `lifecycle_approved:${base_key}`, payload: { contactId: opts.contactId } }] : []),
    );
  } else if (to === "declined") {
    rows.push(
      { ...base, eventType: "decline_email", idempotencyKey: `decline_email:${base_key}`, payload: { declineReason: opts.declineReason ?? null } },
      ...(opts.contactId ? [{ ...base, eventType: "lifecycle_declined", idempotencyKey: `lifecycle_declined:${base_key}`, payload: { contactId: opts.contactId, declineReason: opts.declineReason ?? null } }] : []),
    );
  }
  return rows;
}

// ── Public: create draft ─────────────────────────────────────────────────

export async function createDraft(body: unknown): Promise<{ id: number; draftToken: string }> {
  const parsed = draftCreateDto.parse(body ?? {});
  const draftToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashSecret(draftToken);
  const expiresAt = new Date(Date.now() + DRAFT_TOKEN_TTL_MS);

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(merchantApplications)
      .values({
        status: "in_progress",
        currentStep: 1,
        totalSteps: 6,
        legalBusinessName: parsed.legalBusinessName ?? null,
        businessEmail: parsed.businessEmail ?? null,
        ownerEmail: parsed.ownerEmail ?? null,
        vertical: parsed.vertical ?? null,
        draftTokenHash: tokenHash,
        draftTokenExpiresAt: expiresAt,
        stateVersion: 0,
      })
      .returning({ id: merchantApplications.id, status: merchantApplications.status });

    await auditChange({
      userId: null, actorType: "user",
      action: "merchant_application_draft_created",
      entityType: "merchant_application",
      entityId: row.id,
      details: { status: "in_progress" },
    }, tx);
    return row;
  });

  return { id: created.id, draftToken };
}

// ── Public: get autosave ─────────────────────────────────────────────────

export async function getDraftForToken(appId: number, token: string): Promise<Record<string, unknown>> {
  const [row] = await db.select().from(merchantApplications).where(eq(merchantApplications.id, appId)).limit(1);
  if (!row || !verifyDraftToken(token, row as any)) throw new NotFoundError();
  return toAutosaveDto(row as any);
}

// ── Public: autosave ─────────────────────────────────────────────────────

export async function autosaveDraft(appId: number, token: string, body: unknown): Promise<void> {
  const parsed = autosaveDto.parse(body ?? {});

  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(merchantApplications).where(eq(merchantApplications.id, appId)).limit(1);
    if (!row || !verifyDraftToken(token, row as any)) throw new NotFoundError();
    if (!AUTOSAVE_ELIGIBLE_STATUSES.has(String(row.status))) throw new NotFoundError();

    const updates = extractNonSensitive(parsed);
    updates.status = "in_progress";
    updates.updatedAt = new Date();

    const expectedVersion = row.stateVersion ?? 0;
    const res = await tx
      .update(merchantApplications)
      .set({ ...updates, stateVersion: expectedVersion + 1 })
      .where(and(eq(merchantApplications.id, appId), eq(merchantApplications.stateVersion, expectedVersion)))
      .returning({ id: merchantApplications.id });
    if (!res.length) throw new ConflictError("Concurrent modification", "state_version_conflict");

    await auditChange({
      userId: null, actorType: "user",
      action: "merchant_application_autosaved",
      entityType: "merchant_application",
      entityId: appId,
      details: { fields: Object.keys(updates).filter(k => k !== "updatedAt"), stateVersion: expectedVersion + 1 },
    }, tx);
  });
}

// ── Duplicate check (fingerprint-only, fail-closed) ──────────────────────

export function requireMerchantKeyOr503(): void {
  if (!isMerchantEncryptionAvailable()) {
    throw new ServiceUnavailableError("Merchant protected-data key unavailable — cannot process this request.");
  }
}

export async function checkDuplicateEin(rawEin: string, excludeAppId?: number): Promise<boolean> {
  requireMerchantKeyOr503();
  let normalized: string;
  try { normalized = normalizeEin(rawEin); } catch { return false; }
  const fp = fingerprint(`ein:${normalized}`);
  const conditions: any[] = [
    eq(merchantApplications.einFingerprint, fp),
    or(...DUP_ACTIVE_STATUSES.map(s => eq(merchantApplications.status, s)))!,
  ];
  if (excludeAppId) conditions.push(sql`${merchantApplications.id} != ${excludeAppId}`);
  const [dup] = await db.select({ id: merchantApplications.id }).from(merchantApplications).where(and(...conditions)).limit(1);
  return !!dup;
}

// ── Finalize (public, idempotent, atomic) ────────────────────────────────

export interface FinalizeResult {
  ack: Record<string, unknown>;
  esignCapability?: string;
  replayed: boolean;
}

export async function finalizeApplication(params: {
  appId: number;
  draftToken: string;
  idempotencyKey: string;
  body: unknown;
  resolvedDealId?: number;
}): Promise<FinalizeResult> {
  const { appId, draftToken, idempotencyKey, resolvedDealId } = params;
  requireMerchantKeyOr503();
  const parsed = finalizeDto.parse(params.body ?? {});

  // Derive capability deterministically. Only hash is ever stored.
  const esignCapability = deriveEsignCapability(draftToken, appId, idempotencyKey);
  const esignCapabilityHash = hashSecret(esignCapability);
  const now = new Date();

  // EIN duplicate pre-check (fail-closed before transaction for fast path).
  if (parsed.ein) {
    const isDup = await checkDuplicateEin(parsed.ein, appId);
    if (isDup) {
      throw new ConflictError(
        "An application for this business already exists. Please contact us if you need assistance.",
        "duplicate_ein",
      );
    }
  }

  return await db.transaction(async (tx) => {
    const [row] = await tx.select().from(merchantApplications).where(eq(merchantApplications.id, appId)).limit(1);

    // No row → generic 404.
    if (!row) throw new NotFoundError();

    // ── Replay branch: already finalized ─────────────────────────────────
    if (row.finalizeIdempotencyKey) {
      // Same idempotency key: verify draft token constant-time (replay-safe) and return stored ack.
      if (row.finalizeIdempotencyKey === idempotencyKey) {
        // Require token match — prevents third-party replay of someone else's submission.
        if (!verifyDraftTokenForReplay(draftToken, row as any)) throw new NotFoundError();
        return {
          ack: (row.finalizeAck as Record<string, unknown>) ?? toPublicAckDto(row as any),
          // Re-derive capability from the same inputs — same draftToken+appId+idempotencyKey
          // always yields the same value, so the client gets the same capability token.
          esignCapability,
          replayed: true,
        };
      }
      // Different idempotency key → 409.
      throw new ConflictError("Application already finalized", "finalize_key_mismatch");
    }

    // ── First-time finalize ───────────────────────────────────────────────
    // Token must be valid and not revoked for non-replay path.
    if (!verifyDraftToken(draftToken, row as any)) throw new NotFoundError();

    if (!FINALIZE_ELIGIBLE_STATUSES.has(String(row.status))) {
      throw new ConflictError("Application not in a finalizable state", "invalid_state");
    }

    // In-transaction duplicate fingerprint guard (defense-in-depth; also catches
    // unique index violation from concurrent finalize with same EIN).
    if (parsed.ein) {
      const normalized = normalizeEin(parsed.ein);
      const fp = fingerprint(`ein:${normalized}`);
      const dupConds = [
        eq(merchantApplications.einFingerprint, fp),
        or(...DUP_ACTIVE_STATUSES.map(s => eq(merchantApplications.status, s)))!,
        sql`${merchantApplications.id} != ${appId}`,
      ];
      const [dup] = await tx.select({ id: merchantApplications.id }).from(merchantApplications).where(and(...dupConds)).limit(1);
      if (dup) {
        throw new ConflictError(
          "An application for this business already exists. Please contact us if you need assistance.",
          "duplicate_ein",
        );
      }
    }

    const nonSensitive = extractNonSensitive(parsed);
    const protectedUpdate = buildProtectedUpdate(appId, {
      ein: parsed.ein, ownerDob: parsed.ownerDob, ownerSsn: parsed.ownerSsn,
      bankRoutingNumber: parsed.bankRoutingNumber, bankAccountNumber: parsed.bankAccountNumber,
      additionalOwners: parsed.additionalOwners,
    });

    const expectedVersion = row.stateVersion ?? 0;
    const ackDraft = toPublicAckDto({ ...row, status: "submitted" });
    const finalUpdate: Record<string, unknown> = {
      ...nonSensitive,
      ...(protectedUpdate?.update ?? {}),
      status: "submitted",
      submittedAt: now,
      updatedAt: now,
      draftTokenRevokedAt: now,
      stateVersion: expectedVersion + 1,
      finalizeIdempotencyKey: idempotencyKey,
      esignCapabilityHash,
      esignCapabilityExpiresAt: new Date(now.getTime() + ESIGN_CAPABILITY_TTL_MS),
      esignCapabilityRevokedAt: null,
      esignSendState: "idle",
    };
    if (resolvedDealId) finalUpdate.dealId = resolvedDealId;

    let res: any[];
    try {
      res = await tx
        .update(merchantApplications)
        .set(finalUpdate)
        .where(and(
          eq(merchantApplications.id, appId),
          eq(merchantApplications.stateVersion, expectedVersion),
          isNull(merchantApplications.finalizeIdempotencyKey),
        ))
        .returning({ id: merchantApplications.id, status: merchantApplications.status, esignStatus: merchantApplications.esignStatus });
    } catch (dbErr: any) {
      // Unique index on einFingerprint (item 5): catch Postgres unique violation.
      if (dbErr?.code === "23505" && dbErr?.constraint?.includes("ein_fingerprint")) {
        throw new ConflictError(
          "An application for this business already exists. Please contact us if you need assistance.",
          "duplicate_ein",
        );
      }
      throw dbErr;
    }
    if (!res.length) throw new ConflictError("Concurrent modification during finalize", "state_version_conflict");

    const ack = { ...ackDraft, esignStatus: res[0].esignStatus ?? "pending" };
    await tx.update(merchantApplications).set({ finalizeAck: ack }).where(eq(merchantApplications.id, appId));

    await auditChange({
      userId: null, actorType: "user",
      action: "merchant_application_finalized",
      entityType: "merchant_application",
      entityId: appId,
      details: {
        transition: `${row.status}->submitted`,
        protectedFields: protectedUpdate?.touched ?? [],
        stateVersion: expectedVersion + 1,
      },
    }, tx);

    // Enqueue individually-keyed outbox rows (item 3).
    const outboxRows = buildFinalizeOutboxRows(appId, idempotencyKey, {
      pewcConsent: parsed.pewcConsent === true,
      ownerEmail: parsed.ownerEmail,
      businessEmail: parsed.businessEmail,
      ownerFirstName: parsed.ownerFirstName,
      ownerLastName: parsed.ownerLastName,
      legalBusinessName: parsed.legalBusinessName,
      dba: parsed.dba,
      businessPhone: parsed.businessPhone,
      ownerPhone: parsed.ownerPhone,
      vertical: parsed.vertical,
    });
    await enqueueOutboxBatch(tx, outboxRows);

    return { ack, esignCapability, replayed: false };
  });
}

// ── Operator create ──────────────────────────────────────────────────────

export async function operatorCreate(params: {
  body: unknown;
  userId?: string | null;
  resolvedDealId?: number;
}): Promise<{ dto: Record<string, unknown>; applicationId: number }> {
  requireMerchantKeyOr503();
  const parsed = operatorCreateDto.parse(params.body ?? {});

  if (parsed.ein) {
    const isDup = await checkDuplicateEin(parsed.ein);
    if (isDup) throw new ConflictError("An application for this business already exists.", "duplicate_ein");
  }

  const now = new Date();
  const idempotencyKey = `operator_create:${crypto.randomBytes(8).toString("hex")}`;

  const result = await db.transaction(async (tx) => {
    const nonSensitive = extractNonSensitive(parsed);
    let shell: any;
    try {
      [shell] = await tx
        .insert(merchantApplications)
        .values({
          ...nonSensitive,
          status: parsed.status && canTransition("draft", String(parsed.status)) ? parsed.status : "submitted",
          userId: params.userId ?? parsed.userId ?? null,
          contactId: parsed.contactId ?? null,
          companyId: parsed.companyId ?? null,
          dealId: params.resolvedDealId ?? parsed.dealId ?? null,
          submittedAt: now,
          stateVersion: 0,
        } as any)
        .returning();
    } catch (dbErr: any) {
      if (dbErr?.code === "23505" && dbErr?.constraint?.includes("ein_fingerprint")) {
        throw new ConflictError("An application for this business already exists.", "duplicate_ein");
      }
      throw dbErr;
    }

    const protectedUpdate = buildProtectedUpdate(shell.id, {
      ein: parsed.ein, ownerDob: parsed.ownerDob, ownerSsn: parsed.ownerSsn,
      bankRoutingNumber: parsed.bankRoutingNumber, bankAccountNumber: parsed.bankAccountNumber,
      additionalOwners: parsed.additionalOwners,
    });

    let finalRow = shell;
    if (protectedUpdate) {
      [finalRow] = await tx
        .update(merchantApplications)
        .set({ ...protectedUpdate.update, updatedAt: now })
        .where(eq(merchantApplications.id, shell.id))
        .returning();
    }

    await auditChange({
      userId: params.userId ?? null, actorType: "user",
      action: "merchant_application_created",
      entityType: "merchant_application",
      entityId: shell.id,
      details: { status: finalRow.status, protectedFields: protectedUpdate?.touched ?? [] },
    }, tx);

    const outboxRows = buildFinalizeOutboxRows(shell.id, idempotencyKey, {
      pewcConsent: parsed.pewcConsent === true,
      ownerEmail: parsed.ownerEmail,
      businessEmail: parsed.businessEmail,
      ownerFirstName: parsed.ownerFirstName,
      ownerLastName: parsed.ownerLastName,
      legalBusinessName: parsed.legalBusinessName,
      dba: parsed.dba,
      businessPhone: parsed.businessPhone,
      ownerPhone: parsed.ownerPhone,
      vertical: parsed.vertical,
    });
    await enqueueOutboxBatch(tx, outboxRows);

    return finalRow;
  });

  return { dto: toOperatorDto(result as any), applicationId: result.id };
}

// ── Operator update ──────────────────────────────────────────────────────

export async function operatorUpdate(params: {
  appId: number;
  body: unknown;
  user: { id?: string | null; role?: string | null; firstName?: string | null; lastName?: string | null; email?: string | null };
}): Promise<Record<string, unknown>> {
  const parsed = operatorUpdateDto.parse(params.body ?? {});
  const { appId, user } = params;

  return await db.transaction(async (tx) => {
    const [row] = await tx.select().from(merchantApplications).where(eq(merchantApplications.id, appId)).limit(1);
    if (!row) throw new NotFoundError();

    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k === "status" || k === "underwritingNotes") continue;
      updates[k] = v;
    }

    if (parsed.status && parsed.status !== row.status) {
      if (TERMINAL_STATUSES.has(String(row.status))) {
        throw new ConflictError("Application is in a terminal state; no reopen.", "terminal_state");
      }
      if (!canTransition(String(row.status), String(parsed.status))) {
        throw new ConflictError(`Invalid status transition ${row.status}->${parsed.status}`, "invalid_transition");
      }
      updates.status = parsed.status;
    }

    const incomingNote = typeof parsed.underwritingNotes === "string" ? parsed.underwritingNotes.trim() : "";
    if (incomingNote) {
      const authorName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || user.id || "Unknown";
      const prevLog = Array.isArray((row as any).underwritingNotesLog) ? (row as any).underwritingNotesLog : [];
      updates.underwritingNotes = incomingNote;
      updates.underwritingNotesLog = [
        ...prevLog,
        { note: incomingNote, author: authorName, authorId: user.id ?? null, createdAt: new Date().toISOString() },
      ];
    }

    updates.updatedAt = new Date();
    const expectedVersion = row.stateVersion ?? 0;
    updates.stateVersion = expectedVersion + 1;

    const res = await tx
      .update(merchantApplications)
      .set(updates as any)
      .where(and(eq(merchantApplications.id, appId), eq(merchantApplications.stateVersion, expectedVersion)))
      .returning();
    if (!res.length) throw new ConflictError("Concurrent modification", "state_version_conflict");
    const updated = res[0];

    await auditChange({
      userId: user.id ?? null, actorType: "user",
      action: "merchant_application_updated",
      entityType: "merchant_application",
      entityId: appId,
      details: {
        fields: Object.keys(updates).filter(k => k !== "updatedAt" && k !== "stateVersion"),
        ...(parsed.status && parsed.status !== row.status ? { transition: `${row.status}->${parsed.status}` } : {}),
        stateVersion: expectedVersion + 1,
      },
    }, tx);

    if (parsed.status && parsed.status !== row.status) {
      const statusRows = buildStatusOutboxRows(appId, String(row.status), String(parsed.status), {
        dealId: updated.dealId,
        contactId: updated.contactId,
        declineReason: updated.declineReason,
      });
      await enqueueOutboxBatch(tx, statusRows);
    }

    return toOperatorDto(updated as any);
  });
}

// ── Canonical underwriting risk state updater ────────────────────────────

/**
 * Canonical writer for underwritingStatus + risk note append.
 * Used by relationship-extractor and any automated risk engine.
 * Does NOT accept e-sign or status columns.
 */
export async function applyUnderwritingRiskState(params: {
  applicationId: number;
  underwritingStatus: string;
  riskNote?: { note: string; author: string; authorId?: string | null };
}): Promise<{ updated: boolean }> {
  return await db.transaction(async (tx) => {
    const [row] = await tx.select().from(merchantApplications).where(eq(merchantApplications.id, params.applicationId)).limit(1);
    if (!row) return { updated: false };

    const updates: Record<string, unknown> = {
      underwritingStatus: params.underwritingStatus,
      updatedAt: new Date(),
    };

    if (params.riskNote) {
      const prevLog = Array.isArray((row as any).underwritingNotesLog) ? (row as any).underwritingNotesLog : [];
      updates.underwritingNotesLog = [
        ...prevLog,
        { ...params.riskNote, createdAt: new Date().toISOString() },
      ];
      updates.underwritingNotes = params.riskNote.note;
    }

    const expectedVersion = row.stateVersion ?? 0;
    const res = await tx
      .update(merchantApplications)
      .set({ ...updates, stateVersion: expectedVersion + 1 })
      .where(and(eq(merchantApplications.id, params.applicationId), eq(merchantApplications.stateVersion, expectedVersion)))
      .returning({ id: merchantApplications.id });

    if (!res.length) return { updated: false };

    await auditChange({
      actorType: "system",
      action: "merchant_application_underwriting_risk",
      entityType: "merchant_application",
      entityId: params.applicationId,
      details: { underwritingStatus: params.underwritingStatus, hasRiskNote: !!params.riskNote },
    }, tx);

    return { updated: true };
  });
}

// ── Canonical e-sign local state updater ────────────────────────────────

/**
 * Conditional, replay-safe update of e-sign local state. Increments
 * stateVersion (item 9). Revokes capability after signed.
 */
export async function applyEsignDocumentState(params: {
  applicationId?: number;
  documentId?: string;
  esignStatus: string;
  esignDocumentId?: string | null;
  esignSigningUrl?: string | null;
  esignedAt?: Date | null;
}): Promise<{ updated: boolean }> {
  const { applicationId, documentId, esignStatus } = params;

  return await db.transaction(async (tx) => {
    let row: any;
    if (applicationId != null) {
      [row] = await tx.select().from(merchantApplications).where(eq(merchantApplications.id, applicationId)).limit(1);
    } else if (documentId) {
      [row] = await tx.select().from(merchantApplications).where(eq(merchantApplications.esignDocumentId, documentId)).limit(1);
    }
    if (!row) return { updated: false };

    if (row.esignStatus === "signed" && esignStatus !== "signed") return { updated: false };
    if (row.esignStatus === esignStatus && esignStatus === "signed") return { updated: false };

    const expectedVersion = row.stateVersion ?? 0;
    const updates: Record<string, unknown> = {
      esignStatus,
      updatedAt: new Date(),
      stateVersion: expectedVersion + 1,
    };
    if (params.esignDocumentId !== undefined) updates.esignDocumentId = params.esignDocumentId;
    if (params.esignSigningUrl !== undefined) updates.esignSigningUrl = params.esignSigningUrl;
    if (esignStatus === "signed") {
      updates.esignedAt = params.esignedAt ?? new Date();
      // Revoke e-sign capability after successful signed state (item 9).
      updates.esignCapabilityRevokedAt = new Date();
    }

    const res = await tx
      .update(merchantApplications)
      .set(updates)
      .where(and(eq(merchantApplications.id, row.id), eq(merchantApplications.stateVersion, expectedVersion)))
      .returning({ id: merchantApplications.id });

    if (!res.length) return { updated: false };

    await auditChange({
      actorType: "system",
      action: "merchant_application_esign_state",
      entityType: "merchant_application",
      entityId: row.id,
      details: { esignStatus, hasDocument: !!(params.esignDocumentId ?? row.esignDocumentId) },
    }, tx);
    return { updated: true };
  });
}

/**
 * Canonical writer for the e-sign SEND lifecycle column (esignSendState).
 * Increments stateVersion so send-state changes are versioned and conditional,
 * rather than raw db.update() from the worker (item 9). Returns updated=false on
 * a lost optimistic-lock race so the worker can re-read/retry.
 */
export async function applyEsignSendState(params: {
  applicationId: number;
  sendState: "idle" | "queued" | "sending" | "sent" | "failed";
  tx?: any;
}): Promise<{ updated: boolean }> {
  const run = async (tx: any) => {
    const [row] = await tx
      .select({ id: merchantApplications.id, stateVersion: merchantApplications.stateVersion })
      .from(merchantApplications)
      .where(eq(merchantApplications.id, params.applicationId))
      .limit(1);
    if (!row) return { updated: false };
    const expectedVersion = row.stateVersion ?? 0;
    const res = await tx
      .update(merchantApplications)
      .set({ esignSendState: params.sendState, updatedAt: new Date(), stateVersion: expectedVersion + 1 })
      .where(and(
        eq(merchantApplications.id, params.applicationId),
        eq(merchantApplications.stateVersion, expectedVersion),
      ))
      .returning({ id: merchantApplications.id });
    return { updated: res.length > 0 };
  };
  if (params.tx) return run(params.tx);
  return await db.transaction(run);
}

// ── E-sign send request (queue via outbox, atomic) ────────────────────────

export async function requestEsignSend(params: {
  appId: number;
  actor: "public" | "authenticated";
  userId?: string | null;
}): Promise<{ status: string }> {
  const { appId } = params;
  return await db.transaction(async (tx) => {
    const [row] = await tx.select().from(merchantApplications).where(eq(merchantApplications.id, appId)).limit(1);
    if (!row) throw new NotFoundError();

    if (row.esignStatus === "sent" && row.esignDocumentId) return { status: "sent" };

    const current = String((row as any).esignSendState ?? "idle");
    if (current !== "idle" && current !== "failed") return { status: "pending" };

    const expectedVersion = row.stateVersion ?? 0;
    const res = await tx
      .update(merchantApplications)
      .set({ esignSendState: "queued", updatedAt: new Date(), stateVersion: expectedVersion + 1 })
      .where(and(
        eq(merchantApplications.id, appId),
        eq(merchantApplications.stateVersion, expectedVersion),
        or(eq(merchantApplications.esignSendState, "idle"), eq(merchantApplications.esignSendState, "failed"))!,
      ))
      .returning({ id: merchantApplications.id });
    if (!res.length) return { status: "pending" };

    await enqueueOutbox(tx, appId, "esign_send", `esign_send:${appId}:${Date.now()}`, {
      effect: "esign_send",
      actor: params.actor,
    });

    await auditChange({
      userId: params.userId ?? null,
      actorType: params.actor === "authenticated" ? "user" : "system",
      action: "merchant_application_esign_queued",
      entityType: "merchant_application",
      entityId: appId,
      details: { actor: params.actor },
    }, tx);

    return { status: "pending" };
  });
}
