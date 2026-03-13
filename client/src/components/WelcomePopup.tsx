import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CountdownTimer, getDefaultTarget } from "@/components/CountdownTimer";
import { trackConversion } from "@/lib/tracking";
import {
  X,
  Zap,
  TrendingDown,
  Clock,
  ShieldCheck,
  ArrowRight,
  DollarSign,
  Upload,
  FileText,
} from "lucide-react";

const STORAGE_KEY = "lb_welcome_shown";
const AB_VARIANT_KEY = "lb_welcome_variant";

type PopupVariant = "quiz" | "upload";

interface VariantConfig {
  badge: string;
  heading: string;
  body: string;
  bullets: { icon: typeof DollarSign; text: string }[];
  ctaText: string;
  ctaHref: string;
  dismissText: string;
}

const variants: Record<PopupVariant, VariantConfig> = {
  quiz: {
    badge: "Limited Time Offer",
    heading: "See If You Qualify for Free Processing",
    body: "Take our 60-second quiz and find out if your business qualifies for 0% processing fees through our cash discount program.",
    bullets: [
      { icon: DollarSign, text: "Businesses save $2,000 - $15,000+ per year" },
      { icon: Clock, text: "Takes 60 seconds — get your estimate instantly" },
      { icon: ShieldCheck, text: "No obligation — keep your results either way" },
      { icon: TrendingDown, text: "500+ FL businesses already switched" },
    ],
    ctaText: "Check My Eligibility",
    ctaHref: "/free-analysis?promo=FREE30",
    dismissText: "No thanks, I'm good",
  },
  upload: {
    badge: "Free Statement Review",
    heading: "See Exactly What You're Paying",
    body: "Upload your processing statement and get a free, line-by-line breakdown of every fee. Keep the analysis even if you don't switch.",
    bullets: [
      { icon: FileText, text: "Written breakdown you keep — no obligation" },
      { icon: Clock, text: "Same-day turnaround during business hours" },
      { icon: ShieldCheck, text: "256-bit encrypted & secure upload" },
      { icon: TrendingDown, text: "Average merchant saves $4,200/year" },
    ],
    ctaText: "Upload My Statement",
    ctaHref: "/upload-statement",
    dismissText: "Maybe later",
  },
};

function getVariant(): PopupVariant {
  const stored = localStorage.getItem(AB_VARIANT_KEY);
  if (stored === "quiz" || stored === "upload") return stored;
  const variant: PopupVariant = Math.random() < 0.5 ? "quiz" : "upload";
  localStorage.setItem(AB_VARIANT_KEY, variant);
  return variant;
}

export function WelcomePopup() {
  const [show, setShow] = useState(false);
  const variant = useMemo(() => getVariant(), []);
  const config = variants[variant];

  useEffect(() => {
    const alreadyShown = localStorage.getItem(STORAGE_KEY);
    if (alreadyShown) return;

    const timer = setTimeout(() => {
      setShow(true);
      localStorage.setItem(STORAGE_KEY, "true");
      trackConversion(`welcome_popup_shown_${variant}`);
    }, 4000);

    return () => clearTimeout(timer);
  }, [variant]);

  const handleCtaClick = () => {
    trackConversion(`welcome_popup_cta_${variant}`);
    setShow(false);
  };

  const handleDismiss = () => {
    trackConversion(`welcome_popup_dismissed_${variant}`);
    setShow(false);
  };

  if (!show) return null;

  const target = getDefaultTarget();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      data-testid="welcome-popup"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={handleDismiss}
        data-testid="welcome-popup-overlay"
      />
      <Card
        className="relative z-10 max-w-md w-full border-2 border-primary/20 animate-in zoom-in-95 duration-300 overflow-hidden"
        data-testid="welcome-popup-card"
        data-variant={variant}
      >
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-6 pt-5 pb-3">
          <div className="flex items-center justify-between">
            <Badge
              variant="secondary"
              className="bg-primary/15 text-primary border-primary/25 gap-1"
              data-testid="welcome-popup-badge"
            >
              {variant === "upload" ? (
                <Upload className="w-3 h-3" />
              ) : (
                <Zap className="w-3 h-3" />
              )}
              {config.badge}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 -mr-2"
              onClick={handleDismiss}
              data-testid="button-welcome-close"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <CardContent className="px-6 pb-6 pt-3">
          <h2
            className="text-xl font-display font-bold text-foreground mb-1.5"
            data-testid="text-welcome-heading"
          >
            {config.heading}
          </h2>
          <p
            className="text-sm text-muted-foreground mb-4 leading-relaxed"
            data-testid="text-welcome-body"
          >
            {config.body}
          </p>

          <div className="space-y-2.5 mb-5">
            {config.bullets.map((bullet, i) => (
              <div key={i} className="flex items-center gap-2.5 text-sm text-foreground">
                <bullet.icon className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>{bullet.text}</span>
              </div>
            ))}
          </div>

          <Link
            href={config.ctaHref}
            data-testid="link-welcome-quiz"
          >
            <Button
              className="w-full gap-2"
              size="lg"
              onClick={handleCtaClick}
            >
              {config.ctaText}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>

          <div className="flex items-center justify-center mt-3 gap-2">
            <CountdownTimer
              targetDate={target}
              compact
              className="text-primary text-xs"
            />
            <span className="text-xs text-muted-foreground">
              — offer expires soon
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            className="mt-2 w-full text-xs text-muted-foreground"
            data-testid="button-welcome-dismiss"
          >
            {config.dismissText}
          </Button>

          <p className="text-[10px] text-muted-foreground text-center mt-3">
            Eligibility, underwriting, card brand rules, and applicable laws
            apply.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
