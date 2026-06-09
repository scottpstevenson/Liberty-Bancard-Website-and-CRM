import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, X, FileText, ShieldCheck, ArrowRight } from "lucide-react";

export function ExitIntentPopup() {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const handleMouseLeave = useCallback((e: MouseEvent) => {
    if (e.clientY <= 5 && !dismissed) {
      const alreadyShown = sessionStorage.getItem("exit-intent-shown");
      if (!alreadyShown) {
        setShow(true);
        sessionStorage.setItem("exit-intent-shown", "true");
      }
    }
  }, [dismissed]);

  useEffect(() => {
    const timer = setTimeout(() => {
      document.addEventListener("mouseleave", handleMouseLeave);
    }, 5000);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [handleMouseLeave]);

  const handleDismiss = () => {
    setShow(false);
    setDismissed(true);
  };

  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      data-testid="exit-intent-popup"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleDismiss}
        data-testid="exit-intent-overlay"
      />
      <Card className="relative z-10 max-w-md w-full border-2 border-primary/20 animate-in zoom-in-95 duration-300" data-testid="exit-intent-card">
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-3 right-3"
          onClick={handleDismiss}
          aria-label="Close"
          data-testid="button-exit-intent-close"
        >
          <X className="w-4 h-4" />
        </Button>
        <CardContent className="p-6 sm:p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-3" data-testid="text-exit-heading">
            Before You Go...
          </h2>
          <p className="text-muted-foreground mb-2 leading-relaxed" data-testid="text-exit-body">
            Get a free, line-item breakdown of your processing statement. No obligation. You keep the analysis even if you don't switch.
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Most merchants have never seen their true effective rate. Your statement tells the story.
          </p>

          <div className="space-y-3 mb-6">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Free review - no contract required</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Upload className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Takes 30 seconds to upload</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-foreground">
              <FileText className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Same-day results during business hours</span>
            </div>
          </div>

          <Link href="/upload-statement" data-testid="link-exit-upload">
            <Button className="w-full gap-2" size="lg" onClick={handleDismiss}>
              <Upload className="w-4 h-4" />
              Get My Free Breakdown
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="mt-3 text-xs text-muted-foreground"
            data-testid="button-exit-no-thanks"
          >
            No thanks, I'll keep guessing
          </Button>
          <p className="text-[10px] text-muted-foreground mt-4">
            Eligibility, underwriting, card brand rules, and applicable laws apply.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
