/**
 * Read taxonomy only: aliases make historical contact labels searchable.
 * They are not business classification, employer evidence or outreach approval.
 */
export const CONTACT_VERTICAL_MAPPING_VERSION = "contact-read-sfp-v2-1";
export const SFP_CONTACT_VERTICAL_IDS = [
  "Automotive", "Healthcare", "Beauty/Spa", "Construction/Trades/Home Services", "Fitness/Recreation",
] as const;
export type ContactTargetVertical = typeof SFP_CONTACT_VERTICAL_IDS[number];

export const CONTACT_VERTICAL_ALIASES: Record<ContactTargetVertical, readonly string[]> = {
  Automotive: ["Automotive", "Auto", "Auto Repair", "auto_repair", "automotive repair", "auto body shop", "tire shop", "car repair"],
  Healthcare: ["Healthcare", "medical", "Medical/Dental/Medspa", "Dental", "dentist", "dentistry", "Med Spa", "medspa", "medical spa", "medical clinic"],
  "Beauty/Spa": ["Beauty/Spa", "Salon/Spa", "salon", "hair salon", "spa", "nail salon", "barber shop", "barbershop", "beauty salon"],
  "Construction/Trades/Home Services": ["Construction/Trades/Home Services", "Construction", "general contractor", "roofing", "plumbing", "plumber", "electrician", "hvac", "landscaping", "home services", "Cleaning Services", "cleaning service"],
  "Fitness/Recreation": ["Fitness/Recreation", "Fitness", "Gym", "fitness center", "Fitness & Recreation", "Fitness/Health Club", "Fitness and Wellness", "Health & Fitness", "yoga studio", "crossfit", "martial arts", "personal training", "recreation center"],
};
const normalized = (value: string) => value.trim().toLowerCase().replace(/[_\s]+/g, " ");
const aliases = new Map<string, ContactTargetVertical>();
for (const id of SFP_CONTACT_VERTICAL_IDS) {
  for (const alias of CONTACT_VERTICAL_ALIASES[id]) {
    const key = normalized(alias);
    if (aliases.has(key) && aliases.get(key) !== id) throw new Error("CONTACT_VERTICAL_ALIAS_CONFLICT");
    aliases.set(key, id);
  }
}
export function resolveContactTargetVertical(value: unknown): ContactTargetVertical | null {
  return typeof value === "string" ? aliases.get(normalized(value)) ?? null : null;
}
/** Static SQL generated from this exact mapping; column identifiers are allowlisted. */
export function contactTargetVerticalSql(column: string): string {
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(column)) throw new Error("CONTACT_VERTICAL_COLUMN_INVALID");
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  return `(CASE regexp_replace(lower(btrim(coalesce(${column},''))), '[_[:space:]]+', ' ', 'g')
    ${[...aliases].map(([alias, id]) => `WHEN ${quote(alias)} THEN ${quote(id)}`).join("\n")}
    ELSE NULL END)`;
}