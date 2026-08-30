import { createPublicKey, verify } from "node:crypto";
import { stableCro03Json, stableCro03RecipeHash } from "./contracts";

export const CRO03C_APPROVAL_ARTIFACT_VERSION = "cro03c-approval-ed25519-v1" as const;
export const CRO03C_APPROVAL_DIMENSIONS = ["operator", "data", "finance", "legal"] as const;
export type Cro03cApprovalDimension = typeof CRO03C_APPROVAL_DIMENSIONS[number];

export interface Cro03cSignedApprovalPayload {
  artifactVersion: typeof CRO03C_APPROVAL_ARTIFACT_VERSION;
  receiptId: string;
  idempotencyKey: string;
  issuerId: string;
  dimension: Cro03cApprovalDimension;
  scope: Record<string, unknown>;
  scopeHash: string;
  issuedAt: string;
  expiresAt: string;
}

export interface Cro03cSignedApprovalArtifact {
  payload: Cro03cSignedApprovalPayload;
  signature: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const PAYLOAD_KEYS = [
  "artifactVersion", "receiptId", "idempotencyKey", "issuerId", "dimension",
  "scope", "scopeHash", "issuedAt", "expiresAt",
] as const;

function assertCanonicalJsonValue(value: unknown): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) assertCanonicalJsonValue(item);
    return;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const item of Object.values(value as Record<string, unknown>)) assertCanonicalJsonValue(item);
    return;
  }
  throw new Error("CRO03C_APPROVAL_ARTIFACT_INVALID");
}

/** The signed bytes are UTF-8 canonical JSON with sorted object keys. */
export function canonicalCro03cApprovalPayload(payload: Cro03cSignedApprovalPayload): string {
  assertCanonicalJsonValue(payload);
  return stableCro03Json(payload);
}

function trustedIssuerPublicKey(issuerId: string): string {
  let configured: unknown;
  try {
    configured = JSON.parse(process.env.CRO03C_TRUSTED_APPROVAL_ISSUERS ?? "{}");
  } catch {
    throw new Error("CRO03C_APPROVAL_TRUST_CONFIG_INVALID");
  }
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
    throw new Error("CRO03C_APPROVAL_TRUST_CONFIG_INVALID");
  }
  const key = (configured as Record<string, unknown>)[issuerId];
  if (typeof key !== "string" || !key.trim()) throw new Error("CRO03C_APPROVAL_ISSUER_UNKNOWN");
  return key;
}

export function verifyCro03cApprovalArtifact(
  artifact: Cro03cSignedApprovalArtifact,
  now: Date = new Date(),
): Cro03cSignedApprovalPayload {
  if (!artifact || typeof artifact !== "object" || typeof artifact.signature !== "string" ||
      !artifact.payload || typeof artifact.payload !== "object") {
    throw new Error("CRO03C_APPROVAL_ARTIFACT_INVALID");
  }
  const payload = artifact.payload;
  if (Object.keys(payload).sort().join("\0") !== [...PAYLOAD_KEYS].sort().join("\0") ||
      payload.artifactVersion !== CRO03C_APPROVAL_ARTIFACT_VERSION ||
      !UUID.test(payload.receiptId) ||
      !payload.idempotencyKey?.trim() || payload.idempotencyKey.length > 200 ||
      !payload.issuerId?.trim() || payload.issuerId.length > 200 ||
      !(CRO03C_APPROVAL_DIMENSIONS as readonly string[]).includes(payload.dimension) ||
      !payload.scope || typeof payload.scope !== "object" || Array.isArray(payload.scope) ||
      !SHA256.test(payload.scopeHash)) {
    throw new Error("CRO03C_APPROVAL_ARTIFACT_INVALID");
  }
  assertCanonicalJsonValue(payload);
  const issuedAt = new Date(payload.issuedAt);
  const expiresAt = new Date(payload.expiresAt);
  if (!Number.isFinite(issuedAt.getTime()) || !Number.isFinite(expiresAt.getTime()) ||
      issuedAt.toISOString() !== payload.issuedAt || expiresAt.toISOString() !== payload.expiresAt ||
      expiresAt.getTime() <= issuedAt.getTime() || issuedAt.getTime() > now.getTime()) {
    throw new Error("CRO03C_APPROVAL_ARTIFACT_INVALID");
  }
  if (expiresAt.getTime() <= now.getTime()) throw new Error("CRO03C_APPROVAL_RECEIPT_EXPIRED");
  if (stableCro03RecipeHash(payload.scope) !== payload.scopeHash) {
    throw new Error("CRO03C_APPROVAL_SCOPE_MISMATCH");
  }
  let signature: Buffer;
  let publicKey;
  try {
    signature = Buffer.from(artifact.signature, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== artifact.signature) {
      throw new Error("invalid signature encoding");
    }
    publicKey = createPublicKey(trustedIssuerPublicKey(payload.issuerId));
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("not Ed25519");
  } catch (error) {
    if (error instanceof Error && /^CRO03C_/.test(error.message)) throw error;
    throw new Error("CRO03C_APPROVAL_TRUST_CONFIG_INVALID");
  }
  if (!verify(null, Buffer.from(canonicalCro03cApprovalPayload(payload), "utf8"), publicKey, signature)) {
    throw new Error("CRO03C_APPROVAL_SIGNATURE_INVALID");
  }
  return payload;
}

export function artifactFromCro03cReceiptRow(row: {
  id: unknown; idempotency_key: unknown; issuer_id: unknown; dimension: unknown;
  scope: unknown; scope_hash: unknown; issued_at: Date | string; expires_at: Date | string; signature: unknown;
}): Cro03cSignedApprovalArtifact {
  return {
    payload: {
      artifactVersion: CRO03C_APPROVAL_ARTIFACT_VERSION,
      receiptId: String(row.id),
      idempotencyKey: String(row.idempotency_key),
      issuerId: String(row.issuer_id),
      dimension: String(row.dimension) as Cro03cApprovalDimension,
      scope: row.scope as Record<string, unknown>,
      scopeHash: String(row.scope_hash),
      issuedAt: new Date(row.issued_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
    },
    signature: String(row.signature),
  };
}