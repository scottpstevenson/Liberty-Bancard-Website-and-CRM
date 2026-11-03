import { db } from "../db";
import { contacts, deals } from "@shared/schema";
import type { Contact, Deal } from "@shared/schema";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Exact identity for an inbound GHL message (Stage 4C2). Replaces "find in the first 500 rows".
 *  - contact: one indexed lookup by the GHL contact id; zero, several (ambiguous) or an archived record are named outcomes
 *    that the caller reports, never an empty success;
 *  - deal: chosen only by a real association (the payload's opportunity id) or because the contact has exactly one open
 *    deal. Several candidates without an association select NO deal; "first recent deal" is never used to fill a null.
 */
export type InboundDealSelection = "opportunity" | "single_open" | "none" | "ambiguous" | "conflict";
export type InboundIdentity =
  | { state: "resolved"; contact: Contact; deal: Deal | null; dealSelection: InboundDealSelection; openDealCount: number }
  | { state: "not_found" | "ambiguous_contact" | "archived" | "non_production" };

export function selectInboundDeal(
  openDeals: ReadonlyArray<Pick<Deal, "id" | "ghlOpportunityId">>, opportunityId: string | null | undefined,
): { index: number | null; selection: InboundDealSelection } {
  if (opportunityId) {
    const index = openDeals.findIndex(d => d.ghlOpportunityId === opportunityId);
    if (index >= 0) return { index, selection: "opportunity" };
    // An explicit association that matches none of this contact's open deals is a conflict, never a reason to pick
    // some other deal (single or otherwise).
    return { index: null, selection: "conflict" };
  }
  if (openDeals.length === 1) return { index: 0, selection: "single_open" };
  return { index: null, selection: openDeals.length > 1 ? "ambiguous" : "none" };
}

export async function resolveInboundIdentity(ghlContactId: unknown, opportunityId?: unknown): Promise<InboundIdentity> {
  if (typeof ghlContactId !== "string" || !ghlContactId) return { state: "not_found" };
  const matches = await db.select().from(contacts).where(eq(contacts.ghlContactId, ghlContactId)).limit(2);
  if (matches.length === 0) return { state: "not_found" };
  if (matches.length > 1) return { state: "ambiguous_contact" };
  const contact = matches[0];
  if (contact.archivedAt) return { state: "archived" };
  // Test, demo and synthetic records are outside inbound production handling.
  if (["test", "demo", "synthetic"].includes(contact.recordClass)) return { state: "non_production" };
  const openDeals = await db.select().from(deals)
    .where(and(eq(deals.contactId, contact.id), isNull(deals.closedAt), isNull(deals.archivedAt))).orderBy(deals.id);
  const picked = selectInboundDeal(openDeals, typeof opportunityId === "string" ? opportunityId : null);
  return {
    state: "resolved", contact, deal: picked.index === null ? null : openDeals[picked.index],
    dealSelection: picked.selection, openDealCount: openDeals.length,
  };
}
