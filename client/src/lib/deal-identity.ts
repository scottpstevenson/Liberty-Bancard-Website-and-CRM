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
 * Primary  — first non-empty value in: full name → companyName → email → phone → `Deal #${deal.id}`
 * Secondary — first among companyName / email / phone that is NOT equal to primary
 *             (case-insensitive, trimmed); null when nothing distinct is available.
 *
 * Callers: Kanban card, DragOverlay, and Deal Detail contact field only.
 * DO NOT use this for the Deal Detail "Company" labeled field — that field must
 * always resolve to `contact.companyName || "N/A"` to preserve field semantics.
 * DO NOT use this for CSV export — that path has its own explicit column logic.
 */
export function getDealCardIdentity(
  deal: { id: number },
  contact: DealIdentityContact | undefined
): { primary: string; secondary: string | null } {
  if (!contact) return { primary: `Deal #${deal.id}`, secondary: null };

  const fullName = [contact.firstName, contact.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const company = (contact.companyName || "").trim();
  const email = (contact.email || "").trim();
  const phone = (contact.phone || "").trim();

  const primary = fullName || company || email || phone || `Deal #${deal.id}`;

  const candidates = [company, email, phone].filter(
    (c) => c !== "" && c.toLowerCase() !== primary.toLowerCase()
  );
  const secondary = candidates[0] || null;

  return { primary, secondary };
}
