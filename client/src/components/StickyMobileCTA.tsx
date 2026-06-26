import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Phone, Calendar, Upload } from "lucide-react";
import { PHONE_NUMBER, PHONE_TEL, CALENDAR_URL } from "@/lib/constants";
import { trackPhoneCtaClick, trackBookingCtaClick, trackStatementUploadCtaClick } from "@/lib/tracking";

interface StickyMobileCTAProps {
  hidden?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}

export function StickyMobileCTA({ hidden, onVisibilityChange }: StickyMobileCTAProps) {
  const [visible, setVisible] = useState(false);
  const callbackRef = useRef(onVisibilityChange);
  callbackRef.current = onVisibilityChange;

  useEffect(() => {
    const notify = (v: boolean) => {
      setVisible(v);
      callbackRef.current?.(v);
    };

    const heroEl = document.querySelector<Element>('[data-testid="link-hero-upload"]');

    if (!heroEl) {
      // Non-Home pages: fall back to scroll threshold
      const onScroll = () => notify(window.scrollY > 400);
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }

    // Home page: dock appears only when hero CTA block has left the viewport
    const observer = new IntersectionObserver(
      ([entry]) => notify(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(heroEl);

    // Initialise based on current scroll position (handles mid-scroll page load)
    const rect = heroEl.getBoundingClientRect();
    notify(rect.bottom < 0 || rect.top > window.innerHeight);

    return () => observer.disconnect();
  }, []);

  if (hidden) return null;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-40 md:hidden bg-primary border-t-2 border-accent transition-transform duration-300 ease-out ${visible ? "translate-y-0" : "translate-y-full invisible pointer-events-none"}`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-hidden={!visible}
      data-testid="sticky-mobile-cta"
    >
      <div className="px-4 pt-3 pb-2">
        {/* Primary action — Upload dominant */}
        <Link
          href="/upload-statement"
          aria-label="Upload your statement for a free savings analysis"
          className="flex items-center justify-center gap-2 w-full bg-accent hover:bg-accent/90 text-white font-semibold text-sm rounded-lg py-2.5 transition-colors active:opacity-80"
          data-testid="link-sticky-upload"
          onClick={() => trackStatementUploadCtaClick({ ctaLocation: "sticky_bar", ctaLabel: "Upload Statement — Free" })}
        >
          <Upload className="w-4 h-4 shrink-0" />
          Upload Statement — Free
        </Link>

        {/* Secondary actions */}
        <div className="flex gap-2 mt-2">
          <a
            href={PHONE_TEL}
            aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`}
            className="flex-1 flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 text-white rounded-md py-1.5 text-xs font-medium transition-colors active:opacity-70"
            data-testid="link-sticky-call"
            onClick={() => trackPhoneCtaClick({ ctaLocation: "sticky_bar", ctaLabel: "Call" })}
          >
            <Phone className="w-3.5 h-3.5 shrink-0" />
            Call
          </a>
          <a
            href={CALENDAR_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Book a 10-minute call with Liberty Bancard"
            className="flex-1 flex items-center justify-center gap-1.5 bg-white/10 hover:bg-white/20 text-white rounded-md py-1.5 text-xs font-medium transition-colors active:opacity-70"
            data-testid="link-sticky-book"
            onClick={() => trackBookingCtaClick({ ctaLocation: "sticky_bar", ctaLabel: "Book" })}
          >
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            Book
          </a>
        </div>
      </div>
    </div>
  );
}
