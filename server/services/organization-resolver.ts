import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { businesses, type InsertBusiness } from "@shared/schema";

export type OrganizationResolution =
  | { kind: "created"; business: typeof businesses.$inferSelect }
  | { kind: "matched"; business: typeof businesses.$inferSelect }
  | { kind: "deferred"; reasonCode: "INSUFFICIENT_ORGANIZATION_EVIDENCE" | "AMBIGUOUS_ORGANIZATION_MATCH"; candidateIds: number[] };

function normal(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}
function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Resolves only the business model. It never merges contacts, merchants or
 * companies. Equivalent evidence is serialized by a transaction-scoped
 * advisory lock, then re-read before a new business can be inserted.
 */
export async function resolveOrganization(input: {
  canonicalName: string;
  websiteDomain?: string | null;
  googlePlaceId?: string | null;
  mainPhone?: string | null;
  city?: string | null;
  state?: string | null;
  create?: Omit<InsertBusiness, "canonicalName" | "normalizedName" | "websiteDomain" | "googlePlaceId" | "mainPhone">;
}): Promise<OrganizationResolution> {
  const domain = normal(input.websiteDomain);
  const placeId = input.googlePlaceId?.trim() || null;
  const phone = input.mainPhone?.replace(/\D/g, "") || null;
  const name = normalizedName(input.canonicalName);
  const city = normal(input.city);
  const state = normal(input.state);
  const lockKeys = [
    placeId ? `place:${placeId}` : null,
    domain ? `domain:${domain}` : null,
    phone ? `phone:${phone}` : null,
    city && state && name ? `name:${name}:${city}:${state}` : null,
  ].filter((value): value is string => !!value).sort();
  if (lockKeys.length === 0) return { kind: "deferred", reasonCode: "INSUFFICIENT_ORGANIZATION_EVIDENCE", candidateIds: [] };

  return db.transaction(async (tx) => {
    // Acquire every supplied strong-evidence lock in a stable order. A domain
    // lookup and a place-ID lookup for the same incoming organization therefore
    // serialize instead of creating two rows through different "strongest"
    // identifiers.
    for (const lockKey of lockKeys) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 1642))`);
    }
    // PostgreSQL cannot infer a parameter's type when a nullable value appears
    // only in an IS NULL / IS NOT NULL predicate. Cast every evidence parameter
    // explicitly so partially populated organization inputs remain valid.
    const candidateRows = await tx.execute(sql`
      SELECT *
      FROM businesses
      WHERE (${placeId}::text IS NOT NULL AND google_place_id = ${placeId}::text)
         OR (${domain}::text IS NOT NULL AND lower(website_domain) = ${domain}::text)
         OR (${phone}::text IS NOT NULL AND regexp_replace(coalesce(main_phone, ''), '[^0-9]', '', 'g') = ${phone}::text)
         OR (${placeId}::text IS NULL AND ${domain}::text IS NULL AND ${phone}::text IS NULL
             AND normalized_name = ${name} AND lower(coalesce(city, '')) = ${city ?? ""}
             AND lower(coalesce(state, '')) = ${state ?? ""})
      FOR UPDATE
    `);
    const candidates = ((candidateRows as any).rows ?? []) as Array<typeof businesses.$inferSelect>;
    if (candidates.length === 1) {
      const candidate = candidates[0];
      // A candidate found by one identifier cannot silently absorb a different
      // supplied strong identifier. Leave those conflicts for review.
      const conflicts =
        (placeId && candidate.googlePlaceId && candidate.googlePlaceId !== placeId) ||
        (domain && candidate.websiteDomain && normal(candidate.websiteDomain) !== domain) ||
        (phone && candidate.mainPhone && candidate.mainPhone.replace(/\D/g, "") !== phone);
      if (conflicts) {
        return { kind: "deferred", reasonCode: "AMBIGUOUS_ORGANIZATION_MATCH", candidateIds: [candidate.id] };
      }
      return { kind: "matched", business: candidate };
    }
    if (candidates.length > 1) {
      return { kind: "deferred", reasonCode: "AMBIGUOUS_ORGANIZATION_MATCH", candidateIds: candidates.map((row) => row.id) };
    }
    const [business] = await tx.insert(businesses).values({
      canonicalName: input.canonicalName,
      normalizedName: name,
      websiteDomain: domain,
      googlePlaceId: placeId,
      mainPhone: phone,
      city: input.city ?? null,
      state: input.state ?? null,
      ...(input.create ?? {}),
    }).returning();
    return { kind: "created", business };
  });
}