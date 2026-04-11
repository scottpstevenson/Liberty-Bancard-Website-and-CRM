import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Upload, X } from "lucide-react";

export function MobileStickyCtA() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (!dismissed && window.scrollY > 300) {
        setVisible(true);
      } else if (window.scrollY <= 300) {
        setVisible(false);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [dismissed]);

  if (dismissed || !visible) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden"
      data-testid="mobile-sticky-cta"
    >
      <div className="bg-background/95 backdrop-blur-md border-t border-border shadow-lg px-4 py-3 flex items-center gap-3">
        <Link href="/upload-statement" className="flex-1" data-testid="link-mobile-sticky-cta">
          <Button
            size="sm"
            className="w-full gap-2 bg-sky-500 hover:bg-sky-400 text-white font-bold"
            data-testid="button-mobile-sticky-cta"
          >
            <Upload className="w-4 h-4" />
            Get Free Analysis
          </Button>
        </Link>
        <button
          onClick={() => setDismissed(true)}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
          aria-label="Dismiss"
          data-testid="button-mobile-sticky-dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
