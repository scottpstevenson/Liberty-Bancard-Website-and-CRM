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
  bookLabel = "Book a 10-Min Call",
  variant = "hero",
}: ConversionCTAGroupProps) {
  const uploadHref = offer ? `/upload-statement?offer=${offer}` : "/upload-statement";
  const meta = trackingMeta ?? {};

  if (variant === "inline") {
    return (
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap" data-testid="conversion-cta-group">
        <Link href={uploadHref} data-testid="cta-upload">
          <Button
            className="gap-2 bg-sky-500 border-sky-500 text-white"
            onClick={() => trackStatementUploadCtaClick({ ...meta, offer, ctaLabel: uploadLabel })}
          >
            <Upload className="w-4 h-4" />
            {uploadLabel}
          </Button>
        </Link>
        <a
          href={CALENDAR_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="cta-book"
          onClick={() => trackBookingCtaClick({ ...meta, ctaLabel: bookLabel })}
        >
          <Button variant="outline" className="gap-2">
            <Calendar className="w-4 h-4" />
            {bookLabel}
          </Button>
        </a>
        <a
          href={PHONE_TEL}
          aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`}
          data-testid="cta-call"
          onClick={() => trackPhoneCallClick({})}
        >
          <Button variant="ghost" className="gap-2">
            <Phone className="w-4 h-4" />
            {phoneLabel}
          </Button>
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row gap-4 flex-wrap" data-testid="conversion-cta-group">
      <Link href={uploadHref} data-testid="cta-upload">
        <Button
          size="lg"
          className="gap-2 bg-sky-500 border-sky-500 text-white"
          onClick={() => trackStatementUploadCtaClick({ ...meta, offer, ctaLabel: uploadLabel })}
        >
          <Upload className="w-4 h-4" />
          {uploadLabel}
        </Button>
      </Link>
      <a
        href={CALENDAR_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="cta-book"
        onClick={() => trackBookingCtaClick({ ...meta, ctaLabel: bookLabel })}
      >
        <Button size="lg" variant="outline" className="gap-2 bg-white/5 backdrop-blur-sm border-white/20 text-white">
          <Calendar className="w-4 h-4" />
          {bookLabel}
        </Button>
      </a>
      <a
        href={PHONE_TEL}
        aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`}
        data-testid="cta-call"
        onClick={() => trackPhoneCallClick({})}
      >
        <Button size="lg" variant="ghost" className="gap-2 text-white/80 hover:text-white hover:bg-white/10 border border-white/20">
          <Phone className="w-4 h-4" />
          {phoneLabel}
        </Button>
      </a>
    </div>
  );
}
