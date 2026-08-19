import { db } from "../db";
import { auditLogs } from "@shared/schema";
import { sanitizeAuditPayload, sanitizeEntityKey } from "./audit-sanitizer";

export type ActorType = "user" | "ai" | "system";

export interface AuditChangeParams {
  userId?: string | null;
  actorType?: ActorType;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  entityKey?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
}

export async function auditChange(params: AuditChangeParams, tx?: any): Promise<void> {
  const client: typeof db = tx ?? db;
  // C-13 (#1626): sanitize caller payloads at the DB-insert boundary.
  // communication_events (business message content) does NOT go through here.
  await client.insert(auditLogs).values({
    userId: params.userId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    entityKey: sanitizeEntityKey(params.entityKey),
    details: (sanitizeAuditPayload(params.details) as Record<string, unknown> | null) ?? null,
    beforeState: (sanitizeAuditPayload(params.before) as Record<string, unknown> | null) ?? null,
    afterState: (sanitizeAuditPayload(params.after) as Record<string, unknown> | null) ?? null,
    actorType: params.actorType ?? "user",
    actorId: params.actorId ?? null,
  });
}

/**
 * Insert multiple audit log entries in a single SQL statement.
 * Use instead of calling auditChange() in a loop to avoid N round-trips.
 */
export async function bulkAuditChange(entries: AuditChangeParams[], tx?: any): Promise<void> {
  if (entries.length === 0) return;
  const client: typeof db = tx ?? db;
  await client.insert(auditLogs).values(
    entries.map(params => ({
      userId: params.userId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      entityKey: sanitizeEntityKey(params.entityKey),
      details: (sanitizeAuditPayload(params.details) as Record<string, unknown> | null) ?? null,
      beforeState: (sanitizeAuditPayload(params.before) as Record<string, unknown> | null) ?? null,
      afterState: (sanitizeAuditPayload(params.after) as Record<string, unknown> | null) ?? null,
      actorType: params.actorType ?? "user",
      actorId: params.actorId ?? null,
    }))
  );
}

export { bulkAuditChange as auditChangeBatch };

export interface AuditContext {
  userId?: string | null;
  actorType?: ActorType;
  actorId?: string | null;
}

export const SYSTEM_ACTOR: AuditContext = { actorType: "system", userId: null };

export function aiActor(advisorName: string): AuditContext {
  return { actorType: "ai", actorId: advisorName, userId: null };
}
