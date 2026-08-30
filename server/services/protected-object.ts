/**
 * Shared protected-object authority for inbound files.
 *
 * Object references are opaque UUIDs. Bytes are encrypted before they are
 * persisted so a queue worker on another runtime can safely read the same
 * object without depending on a checkout-local filesystem.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { protectedObjects } from "@shared/schema";

const MAX_OBJECT_BYTES = 25 * 1024 * 1024;

function encryptionKey(): Buffer {
  const configured = process.env.MERCHANT_DATA_ENCRYPTION_KEY || process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("PROTECTED_OBJECT_KEY_UNAVAILABLE");
  }
  // Test-only fallback keeps deterministic test doubles usable without ever
  // permitting an unencrypted production fallback.
  return createHash("sha256")
    .update(configured || "cro05a-test-only-protected-object-key")
    .digest();
}

function encrypt(bytes: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

function decrypt(payload: Buffer): Buffer {
  if (payload.length < 28) throw new Error("PROTECTED_OBJECT_CORRUPT");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]);
}

export type ProtectedObjectMetadata = {
  objectRef: string;
  checksumSha256: string;
  sizeBytes: number;
  mimeType: string;
  fileName: string;
  tenantScope: string;
  environmentScope: string;
  validationState: string;
  retentionState: string;
  legalHold: boolean;
};

/**
 * Every read-like operation is scoped to the authority that owns the object.
 * This is deliberately not inferred from process state: callers must prove
 * both tenancy and deployment environment, preventing cross-tenant or
 * cross-environment UUID reuse from becoming an object disclosure.
 */
export type ProtectedObjectAuthorizationContext = {
  tenantScope: string;
  environmentScope: string;
};

function requireAuthorizationContext(context: ProtectedObjectAuthorizationContext): ProtectedObjectAuthorizationContext {
  if (!context
    || typeof context.tenantScope !== "string" || !context.tenantScope.trim()
    || typeof context.environmentScope !== "string" || !context.environmentScope.trim()) {
    throw new Error("PROTECTED_OBJECT_AUTH_CONTEXT_REQUIRED");
  }
  return context;
}

export async function putProtectedObject(input: {
  bytes: Buffer;
  mimeType?: string;
  fileName: string;
  tenantScope: string;
  validationState?: "pending" | "validated" | "rejected";
}): Promise<ProtectedObjectMetadata> {
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
    throw new Error("PROTECTED_OBJECT_EMPTY");
  }
  if (input.bytes.length > MAX_OBJECT_BYTES) throw new Error("PROTECTED_OBJECT_TOO_LARGE");
  if (!input.tenantScope.trim()) throw new Error("PROTECTED_OBJECT_TENANT_SCOPE_REQUIRED");
  const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
  const environmentScope = process.env.NODE_ENV || "development";
  const [row] = await db.insert(protectedObjects).values({
    encryptedBytes: encrypt(input.bytes),
    checksumSha256,
    sizeBytes: input.bytes.length,
    mimeType: input.mimeType || "application/octet-stream",
    fileName: input.fileName.slice(0, 255),
    tenantScope: input.tenantScope,
    environmentScope,
    validationState: input.validationState || "validated",
    uploadCompleteAt: new Date(),
  }).returning({
    objectRef: protectedObjects.objectRef,
    checksumSha256: protectedObjects.checksumSha256,
    sizeBytes: protectedObjects.sizeBytes,
    mimeType: protectedObjects.mimeType,
    fileName: protectedObjects.fileName,
    tenantScope: protectedObjects.tenantScope,
    environmentScope: protectedObjects.environmentScope,
    validationState: protectedObjects.validationState,
    retentionState: protectedObjects.retentionState,
    legalHold: protectedObjects.legalHold,
  });
  if (!row) throw new Error("PROTECTED_OBJECT_PERSIST_FAILED");
  return row;
}

export async function getProtectedObject(
  objectRef: string,
  authorization: ProtectedObjectAuthorizationContext,
  expectedChecksum?: string,
): Promise<Buffer> {
  const context = requireAuthorizationContext(authorization);
  const [row] = await db.select({
    encryptedBytes: protectedObjects.encryptedBytes,
    checksumSha256: protectedObjects.checksumSha256,
    validationState: protectedObjects.validationState,
    retentionState: protectedObjects.retentionState,
    deletedAt: protectedObjects.deletedAt,
  }).from(protectedObjects).where(and(
    eq(protectedObjects.objectRef, objectRef),
    eq(protectedObjects.tenantScope, context.tenantScope),
    eq(protectedObjects.environmentScope, context.environmentScope),
    isNull(protectedObjects.deletedAt),
  )).limit(1);
  if (!row || row.validationState !== "validated" || row.retentionState !== "active") {
    throw new Error("PROTECTED_OBJECT_UNAVAILABLE");
  }
  const bytes = decrypt(row.encryptedBytes);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== row.checksumSha256 || (expectedChecksum && checksum !== expectedChecksum)) {
    throw new Error("PROTECTED_OBJECT_CHECKSUM_MISMATCH");
  }
  return bytes;
}

export async function getProtectedObjectMetadata(
  objectRef: string,
  authorization: ProtectedObjectAuthorizationContext,
): Promise<ProtectedObjectMetadata | null> {
  const context = requireAuthorizationContext(authorization);
  const [row] = await db.select({
    objectRef: protectedObjects.objectRef,
    checksumSha256: protectedObjects.checksumSha256,
    sizeBytes: protectedObjects.sizeBytes,
    mimeType: protectedObjects.mimeType,
    fileName: protectedObjects.fileName,
    tenantScope: protectedObjects.tenantScope,
    environmentScope: protectedObjects.environmentScope,
    validationState: protectedObjects.validationState,
    retentionState: protectedObjects.retentionState,
    legalHold: protectedObjects.legalHold,
  }).from(protectedObjects).where(and(
    eq(protectedObjects.objectRef, objectRef),
    eq(protectedObjects.tenantScope, context.tenantScope),
    eq(protectedObjects.environmentScope, context.environmentScope),
  )).limit(1);
  return row || null;
}

export async function markProtectedObjectDeleted(
  objectRef: string,
  authorization: ProtectedObjectAuthorizationContext,
): Promise<boolean> {
  const context = requireAuthorizationContext(authorization);
  const result = await db.update(protectedObjects).set({
    deletedAt: new Date(),
    retentionState: "deleted",
  }).where(and(
    eq(protectedObjects.objectRef, objectRef),
    eq(protectedObjects.tenantScope, context.tenantScope),
    eq(protectedObjects.environmentScope, context.environmentScope),
    eq(protectedObjects.legalHold, false),
    isNull(protectedObjects.deletedAt),
  )).returning({ id: protectedObjects.id });
  return result.length === 1;
}