import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Upload, Phone } from "lucide-react";

export function StickyMobileCTA() {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 lg:hidden bg-background/95 backdrop-blur-md border-t border-border px-4 py-3 safe-area-pb"
      data-testid="sticky-mobile-cta"
    >
      <div className="flex gap-3 max-w-lg mx-auto">
        <Link href="/upload-statement" className="flex-1" data-testid="link-sticky-upload">
          <Button className="w-full gap-2">
            <Upload className="w-4 h-4" />
            Upload Statement
          </Button>
        </Link>
        <a href="tel:9542668214" data-testid="link-sticky-call">
          <Button variant="outline" size="icon">
            <Phone className="w-4 h-4" />
          </Button>
        </a>
      </div>
    </div>
  );
}
