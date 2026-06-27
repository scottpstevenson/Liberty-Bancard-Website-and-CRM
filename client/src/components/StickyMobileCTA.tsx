import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Link } from "wouter";
import { Upload } from "lucide-react";
import { trackStatementUploadCtaClick } from "@/lib/tracking";

interface StickyMobileCTAProps {
  hidden?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}

export function StickyMobileCTA({ hidden, onVisibilityChange }: StickyMobileCTAProps) {
  const [location] = useLocation();
  const [visible, setVisible] = useState(false);
  const callbackRef = useRef(onVisibilityChange);
  callbackRef.current = onVisibilityChange;
  const dockRef = useRef<HTMLDivElement>(null);

  // Measure dock height and publish as CSS var for main-tag bottom clearance
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const update = () => {
      document.documentElement.style.setProperty("--dock-height", `${el.offsetHeight}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--dock-height");
    };
  }, []);

  // Visibility logic — re-evaluated on every route change
  // Observes the hero CTA block wrapper; falls back to scroll threshold on non-Home pages
  useEffect(() => {
    const notify = (v: boolean) => {
      setVisible(v);
      callbackRef.current?.(v);
    };

    // Reset on route change before setting up new observer
    notify(false);

    const heroCtaBlock = document.querySelector<Element>('[data-testid="hero-cta-block"]');

    if (!heroCtaBlock) {
      // Non-Home pages: fall back to scroll threshold
      const onScroll = () => notify(window.scrollY > 400);
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        window.removeEventListener("scroll", onScroll);
        notify(false); // reset on cleanup so chat bubble is never stuck hidden
      };
    }

    // Home page: dock appears only when entire hero CTA block has left the viewport
    const observer = new IntersectionObserver(
      ([entry]) => notify(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(heroCtaBlock);

    // Initialise based on current scroll position
    const rect = heroCtaBlock.getBoundingClientRect();
    notify(rect.bottom < 0 || rect.top > window.innerHeight);

    return () => {
      observer.disconnect();
      notify(false); // reset on cleanup so chat bubble is never stuck hidden
    };
  }, [location]);

  if (hidden) return null;

  return (
    <div
      ref={dockRef}
      className={`fixed bottom-0 left-0 right-0 z-40 md:hidden bg-background/95 backdrop-blur-sm border-t border-border shadow-sm transition-transform duration-300 ease-out ${visible ? "translate-y-0" : "translate-y-full invisible pointer-events-none"}`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-hidden={!visible}
      data-testid="sticky-mobile-cta"
    >
      <div className="px-4 py-2">
        <Link
          href="/upload-statement"
          aria-label="Upload your statement for a free savings analysis"
          className="flex items-center justify-center gap-2 w-full bg-primary hover:bg-primary/90 text-white font-semibold text-sm rounded-lg py-2.5 transition-colors active:opacity-80"
          data-testid="link-sticky-upload"
          onClick={() => trackStatementUploadCtaClick({ ctaLocation: "sticky_bar", ctaLabel: "Upload Statement — Free" })}
        >
          <Upload className="w-4 h-4 shrink-0" />
          Upload Statement — Free
        </Link>
      </div>
    </div>
  );
}
