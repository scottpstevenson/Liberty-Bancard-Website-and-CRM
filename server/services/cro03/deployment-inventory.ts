import { createPublicKey, verify } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { stableCro03Json, stableCro03RecipeHash } from "./contracts";

export const CRO03C_DEPLOYMENT_INVENTORY_VERSION = "cro03c-deployment-inventory-ed25519-v1" as const;
export type Cro03cInventoryIdentityKind = "worker" | "ordinal";

export interface Cro03cDeploymentInventoryPayload {
  artifactVersion: typeof CRO03C_DEPLOYMENT_INVENTORY_VERSION;
  inventoryId: string;
  issuerId: string;
  deploymentIdentity: string;
  environmentIdentity: string;
  releaseSha: string;
  queueTopologyHash: string;
  identityKind: Cro03cInventoryIdentityKind;
  workerIdentities: string[];
  expectedCount: number;
  issuedAt: string;
  expiresAt: string;
}

export interface Cro03cSignedDeploymentInventory {
  payload: Cro03cDeploymentInventoryPayload;
  signature: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PAYLOAD_KEYS = [
  "artifactVersion", "inventoryId", "issuerId", "deploymentIdentity", "environmentIdentity",
  "releaseSha", "queueTopologyHash", "identityKind", "workerIdentities", "expectedCount",
  "issuedAt", "expiresAt",
] as const;
const rows = (result: any): any[] => result?.rows ?? result ?? [];

export function canonicalCro03cDeploymentInventory(payload: Cro03cDeploymentInventoryPayload): string {
  return stableCro03Json(payload);
}

function trustedKey(issuerId: string): string {
  let configured: unknown;
  try {
    configured = JSON.parse(process.env.CRO03C_TRUSTED_DEPLOYMENT_INVENTORY_ISSUERS ?? "{}");
  } catch {
    throw new Error("CRO03C_DEPLOYMENT_INVENTORY_TRUST_CONFIG_INVALID");
  }
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
    throw new Error("CRO03C_DEPLOYMENT_INVENTORY_TRUST_CONFIG_INVALID");
  }
  const key = (configured as Record<string, unknown>)[issuerId];
  if (typeof key !== "string" || !key.trim()) throw new Error("CRO03C_DEPLOYMENT_INVENTORY_ISSUER_UNKNOWN");
  return key;
}

export function verifyCro03cDeploymentInventory(
  artifact: Cro03cSignedDeploymentInventory,
  now = new Date(),
): Cro03cDeploymentInventoryPayload {
  const payload = artifact?.payload;
  if (!payload || typeof artifact.signature !== "string" ||
      Object.keys(payload).sort().join("\0") !== [...PAYLOAD_KEYS].sort().join("\0") ||
      payload.artifactVersion !== CRO03C_DEPLOYMENT_INVENTORY_VERSION ||
      !UUID.test(payload.inventoryId) || !payload.issuerId?.trim() ||
      !payload.deploymentIdentity?.trim() || !payload.environmentIdentity?.trim() ||
      !SHA1.test(payload.releaseSha) || !SHA256.test(payload.queueTopologyHash) ||
      !["worker", "ordinal"].includes(payload.identityKind) ||
      !Array.isArray(payload.workerIdentities) || !Number.isInteger(payload.expectedCount) ||
      payload.expectedCount < 1 || payload.expectedCount > 1000 ||
      payload.workerIdentities.length !== payload.expectedCount ||
      payload.workerIdentities.some((identity) => typeof identity !== "string" || !identity.trim() || identity.length > 200) ||
      new Set(payload.workerIdentities).size !== payload.workerIdentities.length ||
      (payload.identityKind === "ordinal" &&
       payload.workerIdentities.some((identity, ordinal) => identity !== `ordinal:${ordinal}`))) {
    throw new Error("CRO03C_DEPLOYMENT_INVENTORY_INVALID");
  }
  const issuedAt = new Date(payload.issuedAt);
  const expiresAt = new Date(payload.expiresAt);
  if (!Number.isFinite(issuedAt.getTime()) || !Number.isFinite(expiresAt.getTime()) ||
      issuedAt.toISOString() !== payload.issuedAt || expiresAt.toISOString() !== payload.expiresAt ||
      issuedAt.getTime() > now.getTime() || expiresAt.getTime() <= issuedAt.getTime()) {
    throw new Error("CRO03C_DEPLOYMENT_INVENTORY_INVALID");
  }
  if (expiresAt.getTime() <= now.getTime()) throw new Error("CRO03C_DEPLOYMENT_INVENTORY_EXPIRED");
  let signature: Buffer;
  let key;
  try {
    signature = Buffer.from(artifact.signature, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== artifact.signature) throw new Error("encoding");
    key = createPublicKey(trustedKey(payload.issuerId));
    if (key.asymmetricKeyType !== "ed25519") throw new Error("key type");
  } catch (error) {
    if (error instanceof Error && /^CRO03C_/.test(error.message)) throw error;
    throw new Error("CRO03C_DEPLOYMENT_INVENTORY_TRUST_CONFIG_INVALID");
  }
  if (!verify(null, Buffer.from(canonicalCro03cDeploymentInventory(payload)), key, signature)) {
    throw new Error("CRO03C_DEPLOYMENT_INVENTORY_SIGNATURE_INVALID");
  }
  return payload;
}

export async function importCro03cDeploymentInventory(input: {
  artifact: Cro03cSignedDeploymentInventory; reason: string; actorId: string;
}): Promise<{ inventoryId: string; replayed: boolean }> {
  if (!input.reason?.trim() || input.reason.length > 500) throw new Error("CRO03C_DEPLOYMENT_INVENTORY_IMPORT_INVALID");
  // Always authenticate before disclosing whether an immutable ID exists.
  const payload = verifyCro03cDeploymentInventory(input.artifact);
  const payloadHash = stableCro03RecipeHash(payload);
  return db.transaction(async (tx) => {
    const prior = rows(await tx.execute(sql`
      SELECT payload_hash,signature FROM cro03c_deployment_inventories WHERE id=${payload.inventoryId}::uuid
    `))[0];
    if (prior) {
      if (prior.payload_hash !== payloadHash || prior.signature !== input.artifact.signature) {
        throw new Error("CRO03C_DEPLOYMENT_INVENTORY_CONFLICT");
      }
      return { inventoryId: payload.inventoryId, replayed: true };
    }
    await tx.execute(sql`
      INSERT INTO cro03c_deployment_inventories
        (id,issuer_id,deployment_identity,environment_identity,release_sha,queue_topology_hash,
         identity_kind,worker_identities,expected_count,issued_at,expires_at,payload,payload_hash,signature,created_by)
      VALUES (${payload.inventoryId}::uuid,${payload.issuerId},${payload.deploymentIdentity},
        ${payload.environmentIdentity},${payload.releaseSha},${payload.queueTopologyHash},${payload.identityKind},
        ${JSON.stringify(payload.workerIdentities)}::jsonb,${payload.expectedCount},${payload.issuedAt}::timestamptz,
        ${payload.expiresAt}::timestamptz,${JSON.stringify(payload)}::jsonb,${payloadHash},
        ${input.artifact.signature},${input.actorId})
    `);
    await tx.execute(sql`
      INSERT INTO audit_logs(user_id,action,entity_type,entity_key,details,actor_type,actor_id)
      VALUES (${input.actorId},'cro03c.deployment_inventory.imported','cro03c_deployment_inventory',
        ${payload.inventoryId},${JSON.stringify({ issuerId: payload.issuerId, payloadHash, reason: input.reason.trim() })}::jsonb,
        'user',${input.actorId})
    `);
    return { inventoryId: payload.inventoryId, replayed: false };
  });
}

export async function revokeCro03cDeploymentInventory(input: {
  inventoryId: string; idempotencyKey: string; reason: string; actorId: string;
}): Promise<{ inventoryId: string; replayed: boolean }> {
  if (!input.idempotencyKey?.trim() || input.idempotencyKey.length > 200 ||
      !input.reason?.trim() || input.reason.length > 500) throw new Error("CRO03C_DEPLOYMENT_INVENTORY_REVOCATION_INVALID");
  return db.transaction(async (tx) => {
    const inventory = rows(await tx.execute(sql`
      SELECT id FROM cro03c_deployment_inventories WHERE id=${input.inventoryId}::uuid FOR UPDATE
    `))[0];
    if (!inventory) throw new Error("CRO03C_DEPLOYMENT_INVENTORY_NOT_FOUND");
    const prior = rows(await tx.execute(sql`
      SELECT inventory_id FROM cro03c_deployment_inventory_revocations WHERE idempotency_key=${input.idempotencyKey}
    `))[0];
    if (prior) {
      if (String(prior.inventory_id) !== input.inventoryId) throw new Error("CRO03C_IDEMPOTENCY_CONFLICT");
      return { inventoryId: input.inventoryId, replayed: true };
    }
    const revoked = rows(await tx.execute(sql`
      INSERT INTO cro03c_deployment_inventory_revocations(inventory_id,idempotency_key,reason,revoked_by)
      VALUES (${input.inventoryId}::uuid,${input.idempotencyKey},${input.reason.trim()},${input.actorId})
      ON CONFLICT (inventory_id) DO NOTHING RETURNING inventory_id
    `))[0];
    if (!revoked) throw new Error("CRO03C_DEPLOYMENT_INVENTORY_ALREADY_REVOKED");
    await tx.execute(sql`
      INSERT INTO audit_logs(user_id,action,entity_type,entity_key,details,actor_type,actor_id)
      VALUES (${input.actorId},'cro03c.deployment_inventory.revoked','cro03c_deployment_inventory',
        ${input.inventoryId},${JSON.stringify({ idempotencyKey: input.idempotencyKey, reason: input.reason.trim() })}::jsonb,
        'user',${input.actorId})
    `);
    return { inventoryId: input.inventoryId, replayed: false };
  });
}

export async function currentCro03cDeploymentInventory(input: {
  deploymentIdentity: string; environmentIdentity: string; releaseSha: string; queueTopologyHash: string; now?: Date;
}): Promise<Cro03cDeploymentInventoryPayload> {
  const matches = rows(await db.execute(sql`
    SELECT i.payload
      FROM cro03c_deployment_inventories i
      LEFT JOIN cro03c_deployment_inventory_revocations r ON r.inventory_id=i.id
     WHERE r.inventory_id IS NULL AND i.deployment_identity=${input.deploymentIdentity}
       AND i.environment_identity=${input.environmentIdentity} AND i.release_sha=${input.releaseSha}
       AND i.queue_topology_hash=${input.queueTopologyHash}
       AND i.issued_at <= ${input.now ?? new Date()}::timestamptz
       AND i.expires_at > ${input.now ?? new Date()}::timestamptz
     ORDER BY i.issued_at DESC LIMIT 2
  `));
  if (matches.length !== 1) throw new Error(matches.length ? "CRO03C_DEPLOYMENT_INVENTORY_AMBIGUOUS" : "CRO03C_DEPLOYMENT_INVENTORY_MISSING");
  return matches[0].payload as Cro03cDeploymentInventoryPayload;
}