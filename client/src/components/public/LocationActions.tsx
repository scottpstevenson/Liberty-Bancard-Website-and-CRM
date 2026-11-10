import { Link } from "wouter";
import { MessageSquare, Phone, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PHONE_NUMBER, PHONE_TEL } from "@/lib/constants";
import { trackStatementUploadCtaClick } from "@/lib/tracking";
import { trackPhoneCallClick } from "@/lib/analytics";
import type { LocationAction } from "@shared/public-locations";

interface LocationActionsProps {
  primary: LocationAction;
  secondary: LocationAction;
  page: string;
  city: string;
  industry?: string;
  location: "hero" | "final_cta";
  /** Dark call-to-action band styling. */
  inverse?: boolean;
}

/**
 * The two actions every location page offers (a statement review, or a question without a statement)
 * plus the verified phone number. The labels and destinations come from the shared location contract.
 */
export function LocationActions({ primary, secondary, page, city, industry, location, inverse = false }: LocationActionsProps) {
  const prefix = location === "hero" ? "location-hero" : "location-cta";
  return (
    <div className="flex flex-col sm:flex-row gap-4 flex-wrap" data-testid={`group-${prefix}-actions`}>
      <Button
        size="lg"
        className={inverse ? "gap-2 bg-accent hover:bg-accent border-accent text-white" : "gap-2"}
        asChild
      >
        <Link
          href={primary.href}
          data-testid={`link-${prefix}-upload`}
          onClick={() => trackStatementUploadCtaClick({ page, ctaLabel: primary.label, ctaLocation: location, city, industry })}
        >
          <Upload className="w-4 h-4" />
          {primary.label}
        </Link>
      </Button>
      <Button
        size="lg"
        variant="outline"
        className={inverse ? "gap-2 bg-transparent border-white/30 text-white hover:bg-white/10" : "gap-2"}
        asChild
      >
        <a href={secondary.href} data-testid={`link-${prefix}-inquiry`}>
          <MessageSquare className="w-4 h-4" />
          {secondary.label}
        </a>
      </Button>
      <Button
        size="lg"
        variant="ghost"
        className={inverse ? "gap-2 text-white/70 hover:text-white hover:bg-white/10 border border-white/20" : "gap-2"}
        asChild
      >
        <a
          href={PHONE_TEL}
          aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`}
          data-testid={`link-${prefix}-phone`}
          onClick={() => trackPhoneCallClick({})}
        >
          <Phone className="w-4 h-4" />
          {PHONE_NUMBER}
        </a>
      </Button>
    </div>
  );
}
