import { eq } from "drizzle-orm";
import { businesses, type Business, type InsertBusiness } from "@shared/schema";
import { db } from "../db";
import { resolveOrganization, type OrganizationResolution } from "./organization-resolver";

// Identity fields are resolver-only. These are intentionally the only fields
// a caller may project after resolution; provenance and relationship facts use
// their respective authorities.
export const ORGANIZATION_DESCRIPTIVE_FIELDS = [
  "mainEmail", "streetAddress", "postalCode", "vertical", "subVertical",
  "facebookUrl", "instagramUrl", "yelpUrl", "reviewCount", "rating",
  "industryPrimary", "industrySecondary", "status", "lastSourceType", "lastEnrichedAt",
] as const;
type DescriptiveField = typeof ORGANIZATION_DESCRIPTIVE_FIELDS[number];
export type OrganizationDescriptiveUpdate = Partial<Pick<InsertBusiness, DescriptiveField>>;

export async function resolveOrganizationIdentity(input: Parameters<typeof resolveOrganization>[0]): Promise<OrganizationResolution> {
  return resolveOrganization(input);
}

export async function updateOrganizationDescriptive(id: number, updates: OrganizationDescriptiveUpdate): Promise<Business | undefined> {
  for (const key of Object.keys(updates)) if (!ORGANIZATION_DESCRIPTIVE_FIELDS.includes(key as DescriptiveField)) throw new Error(`ORGANIZATION_FIELD_NOT_OWNED:${key}`);
  const [business] = await db.update(businesses).set({ ...updates, updatedAt: new Date() }).where(eq(businesses.id, id)).returning();
  return business;
}