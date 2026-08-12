export interface DealIdentityContact {
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * Returns a coordinated { primary, secondary } pair for deal card display.
 *
 * Resolution order for `primary` (#932):
 *   contact.companyName → fullName (firstName + lastName) → email → phone
 *   → dealName → "Unnamed contact"
 *
 * Secondary — first among companyName / email / phone that is NOT equal to
 *             primary (case-insensitive, trimmed); null when nothing distinct.
 *
 * Callers: Kanban card, DragOverlay, Deal Detail contact field, Onboarding board cards.
 * DO NOT use this for the Deal Detail "Company" labeled field — that field must
 * always resolve to `contact.companyName || "N/A"` to preserve field semantics.
 * DO NOT use this for CSV export — that path has its own explicit column logic.
 */
export function getDealCardIdentity(
  deal: { id: number; name?: string | null },
  contact: DealIdentityContact | undefined
): { primary: string; secondary: string | null } {
  if (!contact) {
    const fallback = (deal.name && deal.name.trim()) || "Unnamed contact";
    return { primary: fallback, secondary: null };
  }

  const fullName = [contact.firstName, contact.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const company = (contact.companyName || "").trim();
  const email = (contact.email || "").trim();
  const phone = (contact.phone || "").trim();
  const dealName = (deal.name || "").trim();

  const primary = company || fullName || email || phone || dealName || "Unnamed contact";

  const candidates = [company, email, phone].filter(
    (c) => c !== "" && c.toLowerCase() !== primary.toLowerCase()
  );
  const secondary = candidates[0] || null;

  return { primary, secondary };
}
