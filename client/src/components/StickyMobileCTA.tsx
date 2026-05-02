import { Link } from "wouter";
import { Phone } from "lucide-react";

export function StickyMobileCTA() {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-primary safe-area-pb"
      style={{ minHeight: "52px" }}
      data-testid="sticky-mobile-cta"
    >
      <div className="flex h-full" style={{ minHeight: "52px" }}>
        <a
          href="tel:9542668214"
          className="flex-1 flex items-center justify-center gap-2 text-white font-semibold text-sm border-r border-white/20 py-3 px-2 active:bg-white/10"
          data-testid="link-sticky-call"
        >
          <Phone className="w-4 h-4 shrink-0" />
          <span>954-266-8214</span>
        </a>
        <Link
          href="/upload-statement"
          className="flex-1 flex items-center justify-center text-white font-medium text-sm py-3 px-2 active:bg-white/10 text-center leading-snug"
          data-testid="link-sticky-analysis"
        >
          Get a free savings analysis
        </Link>
      </div>
    </div>
  );
}
