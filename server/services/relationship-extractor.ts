import { db } from "../db";
import {
  contacts,
  merchantApplications,
  deals,
  contactCompanies,
  companies,
  entityRelationships,
  type EntityRelationship,
  type InsertEntityRelationship,
} from "@shared/schema";
import { eq, and, ne, isNull, or, isNotNull, inArray } from "drizzle-orm";

function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "").slice(-10);
}

function normalizeRoutingNumber(routing: string | null | undefined): string {
  if (!routing) return "";
  return routing.replace(/\D/g, "");
}

async function upsertRelationship(rel: InsertEntityRelationship): Promise<void> {
  try {
    await db
      .insert(entityRelationships)
      .values(rel)
      .onConflictDoUpdate({
        target: [
          entityRelationships.sourceEntityType,
          entityRelationships.sourceEntityId,
          entityRelationships.targetEntityType,
          entityRelationships.targetEntityId,
          entityRelationships.relationshipType,
        ],
        set: {
          confidence: rel.confidence,
          riskFlag: rel.riskFlag,
          riskReason: rel.riskReason,
          updatedAt: new Date(),
        },
      });
  } catch (err: any) {
    console.warn("[RelExtractor] upsertRelationship failed:", err.message);
  }
}

export async function extractRelationshipsForContact(contactId: number): Promise<void> {
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!contact) return;

  // ── 1. Contact ↔ Contact matches (phone, address) ────────────────────────
  const allContacts = await db
    .select()
    .from(contacts)
    .where(and(ne(contacts.id, contactId), isNull(contacts.archivedAt)));

  const phone = normalizePhone(contact.phone);

  for (const other of allContacts) {
    const otherPhone = normalizePhone(other.phone);

    if (phone && otherPhone && phone === otherPhone && phone.length >= 10) {
      await upsertRelationship({
        sourceEntityType: "contact",
        sourceEntityId: contactId,
        targetEntityType: "contact",
        targetEntityId: other.id,
        relationshipType: "same_phone",
        confidence: 0.95,
        source: "system",
      });
    }

    if (
      contact.address &&
      other.address &&
      contact.address.toLowerCase().trim() === other.address.toLowerCase().trim()
    ) {
      await upsertRelationship({
        sourceEntityType: "contact",
        sourceEntityId: contactId,
        targetEntityType: "contact",
        targetEntityId: other.id,
        relationshipType: "same_address",
        confidence: 0.8,
        source: "system",
      });
    }
  }

  // ── 2. Contact ↔ Company membership (via contactCompanies) ───────────────
  const memberships = await db
    .select()
    .from(contactCompanies)
    .where(eq(contactCompanies.contactId, contactId));

  for (const m of memberships) {
    if (!m.companyId) continue;
    await upsertRelationship({
      sourceEntityType: "contact",
      sourceEntityId: contactId,
      targetEntityType: "company",
      targetEntityId: m.companyId,
      relationshipType: "company_member",
      confidence: 1.0,
      source: "system",
    });
  }

  // ── 3. Contact → MID (via deals with a MID assigned) ────────────────────
  const contactDeals = await db
    .select()
    .from(deals)
    .where(and(eq(deals.contactId, contactId), isNotNull(deals.mid)));

  for (const deal of contactDeals) {
    if (!deal.mid) continue;
    await upsertRelationship({
      sourceEntityType: "contact",
      sourceEntityId: contactId,
      targetEntityType: "mid",
      targetEntityId: deal.id,
      relationshipType: "same_owner",
      confidence: 1.0,
      source: "system",
      note: `MID: ${deal.mid}`,
    });

    // ── 4. Deal → ISO partner (via deal.partnerOrgId) ───────────────────
    if (deal.partnerOrgId) {
      await upsertRelationship({
        sourceEntityType: "contact",
        sourceEntityId: contactId,
        targetEntityType: "iso_partner",
        targetEntityId: deal.partnerOrgId,
        relationshipType: "iso_agent",
        confidence: 1.0,
        source: "system",
      });
    }
  }

  // ── 5. Application-level matches (EIN, bank routing, owner name) ─────────
  const apps = await db
    .select()
    .from(merchantApplications)
    .where(eq(merchantApplications.contactId, contactId));

  const contactApp = apps[0];
  if (!contactApp) return;

  const allApps = await db
    .select()
    .from(merchantApplications)
    .where(ne(merchantApplications.contactId, contactId));

  for (const otherApp of allApps) {
    if (!otherApp.contactId || otherApp.contactId === contactId) continue;

    if (
      contactApp.ein &&
      otherApp.ein &&
      contactApp.ein.replace(/\D/g, "") === otherApp.ein.replace(/\D/g, "") &&
      contactApp.ein.length >= 9
    ) {
      await upsertRelationship({
        sourceEntityType: "contact",
        sourceEntityId: contactId,
        targetEntityType: "contact",
        targetEntityId: otherApp.contactId,
        relationshipType: "same_ein",
        confidence: 0.99,
        source: "system",
      });
    }

    const srcRouting = normalizeRoutingNumber(contactApp.bankRoutingNumber);
    const tgtRouting = normalizeRoutingNumber(otherApp.bankRoutingNumber);
    if (srcRouting && tgtRouting && srcRouting === tgtRouting && srcRouting.length >= 9) {
      await upsertRelationship({
        sourceEntityType: "contact",
        sourceEntityId: contactId,
        targetEntityType: "contact",
        targetEntityId: otherApp.contactId,
        relationshipType: "same_bank",
        confidence: 0.9,
        source: "system",
      });
    }

    if (
      contactApp.ownerFirstName &&
      contactApp.ownerLastName &&
      otherApp.ownerFirstName &&
      otherApp.ownerLastName &&
      contactApp.ownerFirstName.toLowerCase() === otherApp.ownerFirstName.toLowerCase() &&
      contactApp.ownerLastName.toLowerCase() === otherApp.ownerLastName.toLowerCase()
    ) {
      await upsertRelationship({
        sourceEntityType: "contact",
        sourceEntityId: contactId,
        targetEntityType: "contact",
        targetEntityId: otherApp.contactId,
        relationshipType: "same_owner",
        confidence: 0.85,
        source: "system",
      });
    }
  }
}

/**
 * Batch version of extractRelationshipsForContact.
 * Pre-fetches all required data in 6 queries total (independent of N),
 * then processes each contact in memory — avoiding N*5 round-trips.
 */
export async function extractRelationshipsForContactsBatch(contactIds: number[]): Promise<void> {
  if (contactIds.length === 0) return;

  // 1. Fetch the target contacts in one IN (...) query
  const targetContacts = await db
    .select()
    .from(contacts)
    .where(inArray(contacts.id, contactIds));
  if (targetContacts.length === 0) return;

  // 2. Fetch all other (non-target) contacts for phone/address matching — one query
  const allOtherContacts = await db
    .select()
    .from(contacts)
    .where(and(isNull(contacts.archivedAt)));

  // 3. Batch-fetch all contactCompany links for the target contacts — one query
  const allMemberships = await db
    .select()
    .from(contactCompanies)
    .where(inArray(contactCompanies.contactId, contactIds));

  // 4. Batch-fetch all deals with MIDs for the target contacts — one query
  const allContactDeals = await db
    .select()
    .from(deals)
    .where(and(inArray(deals.contactId, contactIds), isNotNull(deals.mid)));

  // 5. Batch-fetch merchant applications for the target contacts — one query
  const targetApps = await db
    .select()
    .from(merchantApplications)
    .where(inArray(merchantApplications.contactId, contactIds));

  // 6. Fetch all other merchant applications for EIN/routing/name matching — one query
  const allOtherApps = await db
    .select()
    .from(merchantApplications)
    .where(
      contactIds.length > 0
        ? and(isNotNull(merchantApplications.contactId))
        : isNotNull(merchantApplications.contactId)
    );

  // Build lookup maps for O(1) access
  const membershipsByContact = new Map<number, typeof allMemberships>();
  for (const m of allMemberships) {
    if (!m.contactId) continue;
    if (!membershipsByContact.has(m.contactId)) membershipsByContact.set(m.contactId, []);
    membershipsByContact.get(m.contactId)!.push(m);
  }

  const dealsByContact = new Map<number, typeof allContactDeals>();
  for (const d of allContactDeals) {
    if (!d.contactId) continue;
    if (!dealsByContact.has(d.contactId)) dealsByContact.set(d.contactId, []);
    dealsByContact.get(d.contactId)!.push(d);
  }

  const appByContact = new Map<number, typeof targetApps[number]>();
  for (const a of targetApps) {
    if (a.contactId && contactIds.includes(a.contactId)) {
      appByContact.set(a.contactId, a);
    }
  }

  // Process each contact using pre-fetched data.
  // NOTE: allOtherApps includes every contact's app (including other batch members).
  // We exclude only the *current* contact per-iteration so intra-batch matches
  // (e.g. two contacts in the same batch sharing an EIN) are still produced —
  // matching the original per-contact semantics of ne(contactId).
  for (const contact of targetContacts) {
    const contactId = contact.id;
    const phone = normalizePhone(contact.phone);

    // Contact ↔ Contact matches (phone, address)
    for (const other of allOtherContacts) {
      if (other.id === contactId) continue;
      const otherPhone = normalizePhone(other.phone);
      if (phone && otherPhone && phone === otherPhone && phone.length >= 10) {
        await upsertRelationship({
          sourceEntityType: "contact",
          sourceEntityId: contactId,
          targetEntityType: "contact",
          targetEntityId: other.id,
          relationshipType: "same_phone",
          confidence: 0.95,
          source: "system",
        });
      }
      if (
        contact.address &&
        other.address &&
        contact.address.toLowerCase().trim() === other.address.toLowerCase().trim()
      ) {
        await upsertRelationship({
          sourceEntityType: "contact",
          sourceEntityId: contactId,
          targetEntityType: "contact",
          targetEntityId: other.id,
          relationshipType: "same_address",
          confidence: 0.8,
          source: "system",
        });
      }
    }

    // Contact ↔ Company membership
    for (const m of membershipsByContact.get(contactId) ?? []) {
      if (!m.companyId) continue;
      await upsertRelationship({
        sourceEntityType: "contact",
        sourceEntityId: contactId,
        targetEntityType: "company",
        targetEntityId: m.companyId,
        relationshipType: "company_member",
        confidence: 1.0,
        source: "system",
      });
    }

    // Contact → MID (via deals)
    for (const deal of dealsByContact.get(contactId) ?? []) {
      if (!deal.mid) continue;
      await upsertRelationship({
        sourceEntityType: "contact",
        sourceEntityId: contactId,
        targetEntityType: "mid",
        targetEntityId: deal.id,
        relationshipType: "same_owner",
        confidence: 1.0,
        source: "system",
        note: `MID: ${deal.mid}`,
      });
      if (deal.partnerOrgId) {
        await upsertRelationship({
          sourceEntityType: "contact",
          sourceEntityId: contactId,
          targetEntityType: "iso_partner",
          targetEntityId: deal.partnerOrgId,
          relationshipType: "iso_agent",
          confidence: 1.0,
          source: "system",
        });
      }
    }

    // Application-level matches (EIN, bank routing, owner name).
    // Iterate over allOtherApps and skip only the current contact — this
    // preserves matches between contacts that are both in the current batch.
    const contactApp = appByContact.get(contactId);
    if (!contactApp) continue;

    for (const otherApp of allOtherApps) {
      if (!otherApp.contactId || otherApp.contactId === contactId) continue;

      if (
        contactApp.ein &&
        otherApp.ein &&
        contactApp.ein.replace(/\D/g, "") === otherApp.ein.replace(/\D/g, "") &&
        contactApp.ein.length >= 9
      ) {
        await upsertRelationship({
          sourceEntityType: "contact",
          sourceEntityId: contactId,
          targetEntityType: "contact",
          targetEntityId: otherApp.contactId,
          relationshipType: "same_ein",
          confidence: 0.99,
          source: "system",
        });
      }

      const srcRouting = normalizeRoutingNumber(contactApp.bankRoutingNumber);
      const tgtRouting = normalizeRoutingNumber(otherApp.bankRoutingNumber);
      if (srcRouting && tgtRouting && srcRouting === tgtRouting && srcRouting.length >= 9) {
        await upsertRelationship({
          sourceEntityType: "contact",
          sourceEntityId: contactId,
          targetEntityType: "contact",
          targetEntityId: otherApp.contactId,
          relationshipType: "same_bank",
          confidence: 0.9,
          source: "system",
        });
      }

      if (
        contactApp.ownerFirstName &&
        contactApp.ownerLastName &&
        otherApp.ownerFirstName &&
        otherApp.ownerLastName &&
        contactApp.ownerFirstName.toLowerCase() === otherApp.ownerFirstName.toLowerCase() &&
        contactApp.ownerLastName.toLowerCase() === otherApp.ownerLastName.toLowerCase()
      ) {
        await upsertRelationship({
          sourceEntityType: "contact",
          sourceEntityId: contactId,
          targetEntityType: "contact",
          targetEntityId: otherApp.contactId,
          relationshipType: "same_owner",
          confidence: 0.85,
          source: "system",
        });
      }
    }
  }
}

export interface RiskScanResult {
  hasRisk: boolean;
  relationships: Array<{
    targetContactId: number;
    targetName: string;
    relationshipType: string;
    riskReason: string;
    confidence: number;
  }>;
}

function isContactFlagged(c: typeof contacts.$inferSelect): boolean {
  return (
    !!c.status?.toLowerCase().includes("terminated") ||
    !!c.status?.toLowerCase().includes("closed") ||
    (c.tags ?? []).some(
      (t) =>
        t.toLowerCase().includes("terminated") ||
        t.toLowerCase().includes("high-chargeback") ||
        t.toLowerCase().includes("fraud"),
    )
  );
}

async function getFirstDegreeContactIds(contactId: number): Promise<number[]> {
  const rels = await db
    .select()
    .from(entityRelationships)
    .where(
      and(
        isNull(entityRelationships.dismissedAt),
        or(
          and(
            eq(entityRelationships.sourceEntityType, "contact"),
            eq(entityRelationships.sourceEntityId, contactId),
            eq(entityRelationships.targetEntityType, "contact"),
          ),
          and(
            eq(entityRelationships.targetEntityType, "contact"),
            eq(entityRelationships.targetEntityId, contactId),
            eq(entityRelationships.sourceEntityType, "contact"),
          ),
        ),
      ),
    );

  const ids = new Set<number>();
  for (const rel of rels) {
    const other = rel.sourceEntityId === contactId ? rel.targetEntityId : rel.sourceEntityId;
    if (other !== contactId) ids.add(other);
  }
  return [...ids];
}

export async function scanApplicationRisk(
  contactId: number,
  applicationId?: number,
): Promise<RiskScanResult> {
  const [contact] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!contact) return { hasRisk: false, relationships: [] };

  await extractRelationshipsForContact(contactId);

  // ── First-degree contact→contact edges ──────────────────────────────────
  const firstDegreeRels = await db
    .select()
    .from(entityRelationships)
    .where(
      and(
        isNull(entityRelationships.dismissedAt),
        eq(entityRelationships.sourceEntityType, "contact"),
        eq(entityRelationships.sourceEntityId, contactId),
        eq(entityRelationships.targetEntityType, "contact"),
      ),
    );

  const riskyResults: RiskScanResult["relationships"] = [];
  // Tracks contacts whose own "flagged?" status we have already evaluated.
  // Start with the subject contact so it is never treated as its own neighbor.
  const checkedForFlagged = new Set<number>([contactId]);

  // ── Phase 1: first-degree neighbors ─────────────────────────────────────
  // Collect hop1 contact IDs from the pre-fetched edges.
  const firstDegreeIds: number[] = [];
  for (const rel of firstDegreeRels) {
    firstDegreeIds.push(rel.targetEntityId);
  }

  for (const rel of firstDegreeRels) {
    const hop1Id = rel.targetEntityId;
    checkedForFlagged.add(hop1Id); // mark checked regardless of outcome

    const [hop1Contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, hop1Id));
    if (!hop1Contact) continue;

    if (isContactFlagged(hop1Contact)) {
      const riskReason = `(1st degree) Shares ${rel.relationshipType.replace(/_/g, " ")} with terminated/flagged merchant: ${hop1Contact.firstName} ${hop1Contact.lastName}`;

      await db
        .update(entityRelationships)
        .set({ riskFlag: true, riskReason, updatedAt: new Date() })
        .where(eq(entityRelationships.id, rel.id));

      riskyResults.push({
        targetContactId: hop1Contact.id,
        targetName: `${hop1Contact.firstName} ${hop1Contact.lastName}`,
        relationshipType: rel.relationshipType,
        riskReason,
        confidence: rel.confidence ?? 1,
      });
    }
  }

  // ── Phase 2: second-degree neighbors (contacts of first-degree contacts) ─
  // Note: we intentionally do NOT skip hop1 IDs here — we need to expand
  // each of them to reach their own neighbors (the 2nd-hop contacts).
  for (const hop1Id of firstDegreeIds) {
    const hop2Ids = await getFirstDegreeContactIds(hop1Id);

    for (const hop2Id of hop2Ids) {
      if (checkedForFlagged.has(hop2Id)) continue; // already evaluated
      checkedForFlagged.add(hop2Id);

      const [hop2Contact] = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, hop2Id));
      if (!hop2Contact) continue;

      if (isContactFlagged(hop2Contact)) {
        // Flag the edge that bridges the subject to hop1 (the entry point).
        const riskReason = `(2nd degree) Connected via contact #${hop1Id} to terminated/flagged merchant: ${hop2Contact.firstName} ${hop2Contact.lastName}`;

        await db
          .update(entityRelationships)
          .set({ riskFlag: true, riskReason, updatedAt: new Date() })
          .where(
            and(
              or(
                and(
                  eq(entityRelationships.sourceEntityType, "contact"),
                  eq(entityRelationships.sourceEntityId, contactId),
                  eq(entityRelationships.targetEntityType, "contact"),
                  eq(entityRelationships.targetEntityId, hop1Id),
                ),
                and(
                  eq(entityRelationships.sourceEntityType, "contact"),
                  eq(entityRelationships.sourceEntityId, hop1Id),
                  eq(entityRelationships.targetEntityType, "contact"),
                  eq(entityRelationships.targetEntityId, contactId),
                ),
              ),
              isNull(entityRelationships.dismissedAt),
            ),
          );

        riskyResults.push({
          targetContactId: hop2Contact.id,
          targetName: `${hop2Contact.firstName} ${hop2Contact.lastName}`,
          relationshipType: "second_degree",
          riskReason,
          confidence: 0.7,
        });
      }
    }
  }

  // Persist findings to the merchant application's underwriting notes log
  if (riskyResults.length > 0 && applicationId) {
    try {
      const [app] = await db
        .select()
        .from(merchantApplications)
        .where(eq(merchantApplications.id, applicationId));
      if (app) {
        const existingLog: Array<{ note: string; author: string; authorId?: string | null; createdAt: string }> =
          Array.isArray(app.underwritingNotesLog) ? (app.underwritingNotesLog as any[]) : [];
        const riskNote = {
          note:
            `⚠️ Automated Risk Scan — ${riskyResults.length} flagged relationship(s) detected:\n` +
            riskyResults
              .map((r) => `• ${r.relationshipType.replace(/_/g, " ")} → ${r.targetName} (${Math.round(r.confidence * 100)}% confidence)`)
              .join("\n"),
          author: "System — Relationship Risk Engine",
          authorId: null,
          createdAt: new Date().toISOString(),
        };
        await db
          .update(merchantApplications)
          .set({
            underwritingNotesLog: [...existingLog, riskNote] as any,
            underwritingStatus: "under_review",
            updatedAt: new Date(),
          })
          .where(eq(merchantApplications.id, applicationId));
      }
    } catch (err: any) {
      console.warn("[RelExtractor] Failed to persist risk findings to application:", err.message);
    }
  }

  return { hasRisk: riskyResults.length > 0, relationships: riskyResults };
}

export async function propagateRiskFlagToRelatedEntities(contactId: number, riskReason: string): Promise<number> {
  const rels = await db
    .select()
    .from(entityRelationships)
    .where(
      or(
        and(
          eq(entityRelationships.sourceEntityType, "contact"),
          eq(entityRelationships.sourceEntityId, contactId),
        ),
        and(
          eq(entityRelationships.targetEntityType, "contact"),
          eq(entityRelationships.targetEntityId, contactId),
        ),
      ),
    );

  let count = 0;
  for (const rel of rels) {
    await db
      .update(entityRelationships)
      .set({ riskFlag: true, riskReason, updatedAt: new Date() })
      .where(eq(entityRelationships.id, rel.id));
    count++;
  }

  return count;
}
