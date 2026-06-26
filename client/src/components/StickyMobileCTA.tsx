import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Phone, Calendar, Upload } from "lucide-react";
import { PHONE_NUMBER, PHONE_TEL, CALENDAR_URL } from "@/lib/constants";
import { trackPhoneCtaClick, trackBookingCtaClick, trackStatementUploadCtaClick } from "@/lib/tracking";

interface StickyMobileCTAProps {
  hidden?: boolean;
}

export function StickyMobileCTA({ hidden }: StickyMobileCTAProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (hidden) return null;
  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-40 md:hidden bg-primary border-t-2 border-accent transition-transform duration-300 ease-out ${visible ? "translate-y-0" : "translate-y-full invisible pointer-events-none"}`}
      style={{ minHeight: "56px", paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-hidden={!visible}
      data-testid="sticky-mobile-cta"
    >
      <div className="flex h-full" style={{ minHeight: "56px" }}>
        <a
          href={PHONE_TEL}
          aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-white font-semibold text-xs border-r border-white/20 py-2 px-1 active:bg-white/10"
          data-testid="link-sticky-call"
          onClick={() => trackPhoneCtaClick({ ctaLocation: "sticky_bar", ctaLabel: "Call" })}
        >
          <Phone className="w-4 h-4 shrink-0" />
          <span>Call</span>
        </a>
        <a
          href={CALENDAR_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Book a 10-minute call with Liberty Bancard"
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-white font-medium text-xs border-r border-white/20 py-2 px-1 active:bg-white/10"
          data-testid="link-sticky-book"
          onClick={() => trackBookingCtaClick({ ctaLocation: "sticky_bar", ctaLabel: "Book" })}
        >
          <Calendar className="w-4 h-4 shrink-0" />
          <span>Book</span>
        </a>
        <Link
          href="/upload-statement"
          aria-label="Upload your statement for a free savings analysis"
          className="flex-1 flex flex-col items-center justify-center gap-0.5 text-white font-medium text-xs py-2 px-1 active:bg-white/10 text-center leading-snug"
          data-testid="link-sticky-upload"
          onClick={() => trackStatementUploadCtaClick({ ctaLocation: "sticky_bar", ctaLabel: "Upload" })}
        >
          <Upload className="w-4 h-4 shrink-0" />
          <span>Upload</span>
        </Link>
      </div>
    </div>
  );
}
