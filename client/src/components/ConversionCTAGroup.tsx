import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Phone, Calendar, Upload } from "lucide-react";
import { PHONE_NUMBER, PHONE_TEL, CALENDAR_URL } from "@/lib/constants";
import {
  trackBookingCtaClick,
  trackStatementUploadCtaClick,
  type CtaTrackParams,
} from "@/lib/tracking";
import { trackPhoneCallClick } from "@/lib/analytics";

interface ConversionCTAGroupProps {
  offer?: string;
  trackingMeta?: CtaTrackParams;
  uploadLabel?: string;
  phoneLabel?: string;
  bookLabel?: string;
  variant?: "hero" | "inline";
}

export function ConversionCTAGroup({
  offer,
  trackingMeta,
  uploadLabel = "Upload My Statement — Free",
  phoneLabel = PHONE_NUMBER,
  bookLabel = "Book a review call",
  variant = "hero",
}: ConversionCTAGroupProps) {
  const uploadHref = offer ? `/upload-statement?offer=${offer}` : "/upload-statement";
  const meta = trackingMeta ?? {};

  if (variant === "inline") {
    return (
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap" data-testid="conversion-cta-group">
        <Button className="gap-2 bg-sky-400 border-sky-400 text-slate-950 hover:bg-sky-300" onClick={() => trackStatementUploadCtaClick({ ...meta, offer, ctaLabel: uploadLabel })} asChild>
          <Link href={uploadHref} data-testid="cta-upload">
            <Upload className="w-4 h-4" />
            {uploadLabel}
          </Link>
        </Button>
        <Button variant="outline" className="gap-2" asChild>
          <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="cta-book" onClick={() => trackBookingCtaClick({ ...meta, ctaLabel: bookLabel })}>
            <Calendar className="w-4 h-4" />
            {bookLabel}
          </a>
        </Button>
        <Button variant="ghost" className="gap-2" asChild>
          <a href={PHONE_TEL} aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`} data-testid="cta-call" onClick={() => trackPhoneCallClick({})}>
            <Phone className="w-4 h-4" />
            {phoneLabel}
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row gap-4 flex-wrap" data-testid="conversion-cta-group">
      <Button size="lg" className="gap-2 bg-sky-400 border-sky-400 text-slate-950 hover:bg-sky-300" onClick={() => trackStatementUploadCtaClick({ ...meta, offer, ctaLabel: uploadLabel })} asChild>
        <Link href={uploadHref} data-testid="cta-upload">
          <Upload className="w-4 h-4" />
          {uploadLabel}
        </Link>
      </Button>
      <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white" asChild>
        <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="cta-book" onClick={() => trackBookingCtaClick({ ...meta, ctaLabel: bookLabel })}>
          <Calendar className="w-4 h-4" />
          {bookLabel}
        </a>
      </Button>
      <Button size="lg" variant="ghost" className="gap-2 text-white/80 hover:text-white hover:bg-white/10 border border-white/20" asChild>
        <a href={PHONE_TEL} aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`} data-testid="cta-call" onClick={() => trackPhoneCallClick({})}>
          <Phone className="w-4 h-4" />
          {phoneLabel}
        </a>
      </Button>
    </div>
  );
}
