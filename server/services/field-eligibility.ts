/**
 * Field Eligibility Service
 * Checks whether a business is eligible to appear as a field route stop.
 * ALL checks are against the `businesses` table ONLY — never sunbiz_entities,
 * prospects, or master_leads.
 */

import { db } from "../db";
import { businesses, contacts } from "@shared/schema";
import { eq, and, isNotNull, ne, or, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";

export interface FieldEligibilityResult {
  eligible: boolean;
  blockReason?: string;
  canonicalContactId?: number;
}

/**
 * Check if a business is eligible for field sales visits.
 * A business is eligible when:
 *   (a) it exists with record_class = 'canonical'
 *   (b) do_not_visit IS NOT TRUE
 *   (c) non-null lat/lng OR non-empty full address string
 *   (d) at least one contacts row linked via businessId with
 *       do_not_contact IS NOT TRUE and do_not_auto_contact IS NOT TRUE
 */
export async function checkFieldEligibility(businessId: number): Promise<FieldEligibilityResult> {
  // Fetch the business (only from businesses table, never sunbiz/prospects/master_leads)
  const [biz] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!biz) {
    return { eligible: false, blockReason: "business_not_found" };
  }

  if (biz.recordClass !== "canonical") {
    return { eligible: false, blockReason: "not_canonical" };
  }

  if ((biz as any).doNotVisit === true) {
    return { eligible: false, blockReason: "do_not_visit" };
  }

  // Check address reachability: lat/lng OR full address string
  const hasCoords = biz.latitude != null && biz.longitude != null;
  const hasAddress =
    biz.streetAddress != null &&
    biz.streetAddress.trim().length > 0 &&
    biz.city != null &&
    biz.state != null;

  if (!hasCoords && !hasAddress) {
    return { eligible: false, blockReason: "no_location_data" };
  }

  // Require at least one linked canonical contact
  const linkedContacts = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(
      and(
        eq(contacts.businessId, businessId),
        or(eq(contacts.doNotContact, false), isNull(contacts.doNotContact)),
        or(eq(contacts.doNotAutoContact, false), isNull(contacts.doNotAutoContact))
      )
    )
    .limit(1);

  if (linkedContacts.length === 0) {
    return { eligible: false, blockReason: "no_eligible_contact" };
  }

  return {
    eligible: true,
    canonicalContactId: linkedContacts[0].id,
  };
}

/**
 * Compute a fingerprint for a business+contact pair.
 * Used to detect record drift between preview and freeze.
 */
export function computeStopFingerprint(
  businessId: number,
  businessUpdatedAt: Date | null,
  contactId: number,
  contactUpdatedAt: Date | null
): string {
  const crypto = require("crypto");
  const raw = [
    businessId,
    businessUpdatedAt?.toISOString() ?? "null",
    contactId,
    contactUpdatedAt?.toISOString() ?? "null",
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}
