/**
 * Server-internal task types.
 *
 * These types are NOT exported to any client-facing module (shared/schema.ts).
 * InternalTaskInsert allows provenance fields (source, automationKey) that
 * are intentionally absent from the public InsertTask schema.
 */

import type { InsertTask } from "@shared/schema";

export type InternalTaskInsert = InsertTask & {
  source?: string | null;
  automationKey?: string | null;
};
