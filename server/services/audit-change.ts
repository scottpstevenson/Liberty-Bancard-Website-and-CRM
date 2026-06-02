import { db } from "../db";
import { auditLogs } from "@shared/schema";

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
  await client.insert(auditLogs).values({
    userId: params.userId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId ?? null,
    entityKey: params.entityKey ?? null,
    details: params.details ?? null,
    beforeState: params.before ?? null,
    afterState: params.after ?? null,
    actorType: params.actorType ?? "user",
    actorId: params.actorId ?? null,
  });
}

export async function auditChangeBatch(entries: AuditChangeParams[], tx?: any): Promise<void> {
  if (entries.length === 0) return;
  const client: typeof db = tx ?? db;
  await client.insert(auditLogs).values(
    entries.map(params => ({
      userId: params.userId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      entityKey: params.entityKey ?? null,
      details: params.details ?? null,
      beforeState: params.before ?? null,
      afterState: params.after ?? null,
      actorType: params.actorType ?? "user",
      actorId: params.actorId ?? null,
    }))
  );
}

export interface AuditContext {
  userId?: string | null;
  actorType?: ActorType;
  actorId?: string | null;
}

export const SYSTEM_ACTOR: AuditContext = { actorType: "system", userId: null };

export function aiActor(advisorName: string): AuditContext {
  return { actorType: "ai", actorId: advisorName, userId: null };
}
