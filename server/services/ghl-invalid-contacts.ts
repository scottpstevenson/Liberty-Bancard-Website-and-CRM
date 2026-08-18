import type { Pool } from "pg";
import { pool as sharedPool } from "../db";
import { validateGhlIdentityFields } from "./ghl";

export interface InvalidGhlContactRow {
  contactId: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  reasonCode: string | null;
  stage: string | null;
  occurrences: number;
  lastOccurredAt: string | Date;
  status: "resolved" | "unresolved";
}

export interface ListInvalidGhlContactsParams {
  status: "unresolved" | "resolved" | "all";
  limit: number;
  offset: number;
}

/**
 * Latest `ghl_sync_skipped_invalid_contact` audit entry per contact with an
 * occurrence count. Current validity is computed server-side via the canonical
 * validateGhlIdentityFields(). NEVER exposes raw audit_logs.details or phone.
 *
 * `poolOverride` exists for test isolation (schema-scoped pool).
 */
export async function listInvalidGhlContacts(
  params: ListInvalidGhlContactsParams,
  poolOverride?: Pool,
): Promise<{ total: number; rows: InvalidGhlContactRow[] }> {
  const pool = poolOverride ?? sharedPool;
  const { status, limit, offset } = params;

  // entity_id is an integer column — joins directly to contacts.id, no cast.
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (al.entity_id)
         al.entity_id            AS "contactId",
         al.details->>'reason'   AS "reasonCode",
         al.details->>'stage'    AS "stage",
         al.created_at           AS "lastOccurredAt",
         COUNT(*) OVER (PARTITION BY al.entity_id) AS "occurrences",
         c.first_name            AS "firstName",
         c.last_name             AS "lastName",
         c.email                 AS "email",
         c.phone                 AS "phone"
       FROM audit_logs al
       LEFT JOIN contacts c ON c.id = al.entity_id
       WHERE al.action = 'ghl_sync_skipped_invalid_contact'
         AND al.entity_type = 'contact'
         AND al.entity_id IS NOT NULL
       ORDER BY al.entity_id, al.created_at DESC
     ) t
     ORDER BY t."lastOccurredAt" DESC`,
  );

  const withStatus: InvalidGhlContactRow[] = rows.map((r: any) => {
    const validity = validateGhlIdentityFields({ email: r.email, phone: r.phone });
    const { phone: _phone, ...rest } = r;
    return {
      ...rest,
      occurrences: parseInt(String(r.occurrences), 10),
      status: validity.ok ? ("resolved" as const) : ("unresolved" as const),
    };
  });

  const filtered = status === "all" ? withStatus : withStatus.filter((r) => r.status === status);
  return { total: filtered.length, rows: filtered.slice(offset, offset + limit) };
}
