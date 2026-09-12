/**
 * MI-08: Mobile Business Card
 * Renders a canonical business as a card at ≤768px viewports.
 * - Touch targets ≥44px
 * - No horizontal scroll
 * - Status badges with aria-labels (not color-only)
 * - "Open in Maps" link using geo: URI
 * - Field activity note (informational)
 * - Tap → full detail slide-over
 */
import { MapPin, Mail, Phone, Navigation } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BusinessListItem {
  id: number;
  canonical_name: string;
  website_domain: string | null;
  city: string | null;
  state: string | null;
  county_fips: string | null;
  vertical: string | null;
  record_class: string | null;
  free_enrichment_status: string | null;
  free_enrichment_attempt_count: number | null;
  email_discovery_status: string | null;
  email_validation_updated_at: string | null;
  latitude: number | null;
  longitude: number | null;
  street_address: string | null;
  fit_tier: string | null;
  field_claim_status?: string | null;
  safeNextAction: string | null;
  fieldClaim: {
    claimedByEmail: string | null;
    claimedAt: string | null;
  } | null;
}

interface MobileBusinessCardProps {
  business: BusinessListItem;
  onTap: (b: BusinessListItem) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emailStatusColor(status: string | null): string {
  if (!status) return "bg-gray-100 text-gray-600 border-gray-200";
  if (status === "provider_valid")     return "bg-green-100 text-green-800 border-green-200";
  if (status === "provider_catch_all") return "bg-amber-100 text-amber-800 border-amber-200";
  if (status === "provider_invalid")   return "bg-red-100 text-red-800 border-red-200";
  if (status === "discovered")         return "bg-blue-100 text-blue-800 border-blue-200";
  if (status === "stale")              return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-gray-100 text-gray-600 border-gray-200";
}

function fitTierColor(tier: string | null): string {
  if (tier === "A") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (tier === "B") return "bg-blue-100 text-blue-800 border-blue-200";
  if (tier === "C") return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-gray-100 text-gray-600 border-gray-200";
}

function enrichStatusColor(status: string | null): string {
  if (status === "enriched")   return "bg-green-100 text-green-800 border-green-200";
  if (status === "processing") return "bg-blue-100 text-blue-800 border-blue-200";
  if (status === "failed")     return "bg-red-100 text-red-800 border-red-200";
  return "bg-gray-100 text-gray-600 border-gray-200";
}

function geoUri(b: BusinessListItem): string | null {
  if (b.latitude && b.longitude) {
    const addr = b.street_address
      ? encodeURIComponent(`${b.street_address}, ${b.city ?? ""}, ${b.state ?? ""}`)
      : encodeURIComponent(`${b.city ?? ""}, ${b.state ?? ""}`);
    return `geo:${b.latitude},${b.longitude}?q=${addr}`;
  }
  if (b.street_address || b.city) {
    const addr = encodeURIComponent(`${b.street_address ?? ""} ${b.city ?? ""} ${b.state ?? ""}`.trim());
    return `geo:0,0?q=${addr}`;
  }
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MobileBusinessCard({ business: b, onTap }: MobileBusinessCardProps) {
  const mapsUri = geoUri(b);

  return (
    <button
      className="w-full text-left rounded-lg border bg-card shadow-sm p-4 space-y-3 active:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ minHeight: 44 }}
      onClick={() => onTap(b)}
      aria-label={`View details for ${b.canonical_name}`}
    >
      {/* Company name + vertical */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-base leading-tight truncate">{b.canonical_name}</div>
          {b.website_domain && (
            <div className="text-xs text-blue-500 truncate mt-0.5">{b.website_domain}</div>
          )}
        </div>
        {b.fit_tier && (
          <Badge
            variant="outline"
            className={`shrink-0 text-xs font-bold px-2 py-0.5 ${fitTierColor(b.fit_tier)}`}
            aria-label={`Fit tier ${b.fit_tier}`}
          >
            Tier {b.fit_tier}
          </Badge>
        )}
      </div>

      {/* Location */}
      {(b.city || b.state || b.county_fips) && (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{[b.city, b.state, b.county_fips ? `County ${b.county_fips}` : null].filter(Boolean).join(", ")}</span>
          {b.vertical && (
            <>
              <span className="text-muted-foreground/50">·</span>
              <Badge variant="outline" className="text-[11px] px-1.5 py-0 h-5" aria-label={`Vertical: ${b.vertical}`}>
                {b.vertical}
              </Badge>
            </>
          )}
        </div>
      )}

      {/* Status badges */}
      <div className="flex flex-wrap gap-2">
        {b.email_discovery_status && (
          <Badge
            variant="outline"
            className={`text-[11px] px-2 py-0.5 ${emailStatusColor(b.email_discovery_status)}`}
            aria-label={`Email status: ${b.email_discovery_status.replace(/_/g, " ")}`}
          >
            <Mail className="h-3 w-3 mr-1" aria-hidden />
            {b.email_discovery_status.replace(/_/g, " ")}
          </Badge>
        )}
        {b.free_enrichment_status && (
          <Badge
            variant="outline"
            className={`text-[11px] px-2 py-0.5 ${enrichStatusColor(b.free_enrichment_status)}`}
            aria-label={`Enrichment: ${b.free_enrichment_status}`}
          >
            {b.free_enrichment_status}
          </Badge>
        )}
      </div>

      {/* Safe next action */}
      {b.safeNextAction && (
        <div className="text-xs text-muted-foreground">
          Next action: <span className="font-medium text-foreground">{b.safeNextAction.replace(/_/g, " ")}</span>
        </div>
      )}

      {/* Field claim note (informational) */}
      {b.fieldClaim || b.field_claim_status === "claimed" ? (
        <div className="flex items-center gap-1.5 text-xs text-amber-700 rounded bg-amber-50 border border-amber-200 px-2 py-1" aria-label="Field claim active">
          <Navigation className="h-3 w-3 shrink-0" aria-hidden />
          Field claim active
          {b.fieldClaim?.claimedByEmail && <span>· {b.fieldClaim.claimedByEmail}</span>}
          {b.fieldClaim?.claimedAt && <span>· {new Date(b.fieldClaim.claimedAt).toLocaleString()}</span>}
        </div>
      ) : null}

      {/* Maps link */}
      {mapsUri && (
        <div className="pt-1">
          <a
            href={mapsUri}
            className="inline-flex items-center gap-1.5 text-xs text-blue-600 underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            onClick={(e) => e.stopPropagation()}
            aria-label={`Open ${b.canonical_name} in Maps`}
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            Open in Maps
          </a>
        </div>
      )}
    </button>
  );
}
