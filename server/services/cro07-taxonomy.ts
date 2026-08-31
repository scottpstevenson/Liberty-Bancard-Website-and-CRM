/**
 * CRO-07 canonical event taxonomy.
 *
 * Versioned registry that ADDS alias/projection mapping on top of the
 * existing shared/analytics-events.ts constant set. It never rewrites
 * historical analytics_events rows — it only maps legacy/raw names to a
 * canonical event for reporting, and records deprecation over time.
 */

import { pool } from "../db";
import { ALL_CANONICAL_EVENTS } from "@shared/analytics-events";

export const CRO07_TAXONOMY_VERSION = 1;

interface TaxonomyDefinition {
  canonicalEvent: string;
  subject: string;
  requiredIdentity: string[];
  producerAuthority: string;
  occurrenceRule: "at_most_once" | "many";
  aliases: string[];
}

// Every canonical analytics event is registered at version 1 with no
// aliases (they already use canonical names). Known legacy/raw aliases used
// elsewhere in the codebase (acquisition exports, reporting) are mapped
// explicitly so readers can normalize without the source rows changing.
const LEGACY_ALIASES: Record<string, string[]> = {
  statement_upload_completed: ["statement_uploaded"],
  closed_won: ["deal_closed_won"],
  form_submitted: ["merchant_application_submitted"],
  proposal_converted: ["merchant_approved"],
};

const SUBJECT_BY_PREFIX: Array<{ prefix: string; subject: string }> = [
  { prefix: "phone_", subject: "call" },
  { prefix: "booking_", subject: "booking" },
  { prefix: "statement_", subject: "statement" },
  { prefix: "form_", subject: "form" },
  { prefix: "pewc_", subject: "consent" },
  { prefix: "consent_", subject: "consent" },
  { prefix: "deal_", subject: "deal" },
  { prefix: "sequence_", subject: "sequence" },
  { prefix: "channel_", subject: "channel" },
  { prefix: "sales_tool_", subject: "engagement" },
  { prefix: "proposal_", subject: "proposal" },
  { prefix: "appointment_", subject: "appointment" },
  { prefix: "offer_route_", subject: "routing" },
];

function subjectFor(eventName: string): string {
  const match = SUBJECT_BY_PREFIX.find((s) => eventName.startsWith(s.prefix));
  return match?.subject ?? "generic";
}

function buildDefinitions(): TaxonomyDefinition[] {
  return Array.from(ALL_CANONICAL_EVENTS).map((canonicalEvent) => ({
    canonicalEvent,
    subject: subjectFor(canonicalEvent),
    requiredIdentity: ["eventName", "occurredAt"],
    producerAuthority: "recordAnalyticsEvent",
    occurrenceRule: "many",
    aliases: LEGACY_ALIASES[canonicalEvent] ?? [],
  }));
}

/**
 * Idempotently upserts the current taxonomy version into cro07_event_taxonomy.
 * Safe to call on every boot; never mutates a prior version's row (a
 * `canonical_event + version` unique index enforces this).
 */
export async function ensureCro07TaxonomyRegistered(): Promise<{ inserted: number; version: number }> {
  const definitions = buildDefinitions();
  let inserted = 0;
  for (const def of definitions) {
    const result = await pool.query(
      `INSERT INTO cro07_event_taxonomy (
        version, canonical_event, subject, required_identity, producer_authority, occurrence_rule, aliases
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (canonical_event, version) DO NOTHING
      RETURNING id`,
      [
        CRO07_TAXONOMY_VERSION, def.canonicalEvent, def.subject,
        JSON.stringify(def.requiredIdentity), def.producerAuthority, def.occurrenceRule, JSON.stringify(def.aliases),
      ],
    );
    if (result.rows[0]) inserted += 1;
  }
  return { inserted, version: CRO07_TAXONOMY_VERSION };
}

/** Resolves a raw/legacy event name to its canonical form, or returns it unchanged if already canonical. */
export function resolveCanonicalEventName(rawName: string): string {
  if (ALL_CANONICAL_EVENTS.has(rawName)) return rawName;
  for (const [canonical, aliases] of Object.entries(LEGACY_ALIASES)) {
    if (aliases.includes(rawName)) return canonical;
  }
  return rawName;
}

export async function getCro07Taxonomy() {
  const result = await pool.query(
    `SELECT * FROM cro07_event_taxonomy WHERE version = $1 ORDER BY canonical_event`,
    [CRO07_TAXONOMY_VERSION],
  );
  return result.rows;
}
