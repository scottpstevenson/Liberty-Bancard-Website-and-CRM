/**
 * Canonical vertical-to-collateral-packet mapping.
 *
 * The platform has two independent "vertical" vocabularies that both need to route
 * to the same set of collateral packets:
 *   - `VERTICALS` in shared/schema.ts — the merchant/contact/deal dropdown field
 *     (includes legacy compound values like "Medical/Dental/Medspa", "Automotive",
 *     "Home Services").
 *   - `CANONICAL_DISCOVERY_VERTICALS` in server/services/sdr/lead-finder.ts — the
 *     fine-grained vertical set produced by normalizeDiscoveryVertical() during lead
 *     discovery (e.g. "Med Spa", "Dental", "Auto Repair", "Salon", "Gym", "Hotel",
 *     "Landscaping", "Construction", "Legal").
 *   - The coarse classifyVertical() bucket names (e.g. "Auto", "Salon/Spa",
 *     "Healthcare", "Fitness/Recreation") also show up on older records.
 *
 * This module resolves any of those raw values to one canonical collateral-packet
 * vertical key, which is what `collateralPackets.vertical` stores in the DB and what
 * the `/packet/<slug>` pages in client/src/pages/AssetPage.tsx are keyed by.
 *
 * IMPORTANT: This is collateral-content routing only. It does not change discovery
 * classification, vertical scoring, or any upstream pipeline logic — it only decides
 * which existing packet a given vertical string should resolve to.
 */

export const GENERAL_FALLBACK_VERTICAL = "General / Local Business";

export interface PacketVerticalDefinition {
  /** Canonical value stored in collateralPackets.vertical and used as the packet slug. */
  key: string;
  /** URL slug for /packet/<slug> and /assets/verticals/<slug>. */
  slug: string;
  /** Raw vertical/category strings (case-insensitive) that should map to this packet. */
  aliases: string[];
}

export const PACKET_VERTICAL_DEFINITIONS: PacketVerticalDefinition[] = [
  {
    key: "Medical/Dental/Medspa",
    slug: "medical",
    aliases: [
      "medical/dental/medspa", "med spa", "medspa", "dental", "healthcare",
      "medical", "clinic", "doctor", "physician", "chiropractic",
    ],
  },
  {
    key: "Automotive",
    slug: "auto",
    aliases: ["automotive", "auto repair", "auto", "mechanic", "tire", "collision"],
  },
  {
    key: "Restaurant",
    slug: "restaurant",
    aliases: ["restaurant", "food service", "cafe", "bar"],
  },
  {
    key: "Home Services",
    slug: "home-services",
    aliases: [
      "home services", "construction", "landscaping", "contractor",
      "hvac", "plumbing", "electrician", "roofing",
    ],
  },
  {
    key: "Retail",
    slug: "retail",
    aliases: ["retail", "store", "boutique"],
  },
  {
    key: "Salon",
    slug: "salon",
    aliases: ["salon", "salon/spa", "beauty", "barbershop", "barber", "hair", "nail"],
  },
  {
    key: "Gym",
    slug: "gym",
    aliases: ["gym", "fitness/recreation", "fitness", "wellness studio", "crossfit", "yoga"],
  },
  {
    key: "Hotel",
    slug: "hotel",
    aliases: ["hotel", "hospitality", "lodging", "motel", "inn"],
  },
  {
    key: "Legal",
    slug: "legal",
    aliases: ["legal", "attorney", "law firm", "accounting"],
  },
];

const ALIAS_LOOKUP: Map<string, string> = new Map();
for (const def of PACKET_VERTICAL_DEFINITIONS) {
  ALIAS_LOOKUP.set(def.key.toLowerCase(), def.key);
  for (const alias of def.aliases) {
    ALIAS_LOOKUP.set(alias.toLowerCase(), def.key);
  }
}

/**
 * Resolve a raw vertical/category string (from a deal, merchant, or discovery record)
 * to the canonical collateral-packet vertical key. Returns null when there is no
 * confident mapping — callers should fall back to the general/local-business packet
 * in that case rather than guessing.
 */
export function resolvePacketVertical(raw?: string | null): string | null {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized === "other" || normalized === "unknown") return null;

  const exact = ALIAS_LOOKUP.get(normalized);
  if (exact) return exact;

  for (const [alias, key] of ALIAS_LOOKUP) {
    if (normalized.includes(alias)) return key;
  }

  return null;
}
