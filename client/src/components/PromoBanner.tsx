import { useState } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CountdownTimer, getDefaultTarget } from "@/components/CountdownTimer";
import { type LucideIcon, X, Tag, Zap } from "lucide-react";

interface Promo {
  id: string;
  title: string;
  description: string;
  code?: string;
  icon: LucideIcon;
  ctaLabel?: string;
  ctaHref?: string;
}

const activePromos: Promo[] = [
  {
    id: "free-processing",
    title: "See If You Qualify for Free Processing",
    description: "Eligible businesses can eliminate card processing fees entirely. Upload your statement and we'll show you exactly how.",
    code: "FREE30",
    icon: Zap,
    ctaLabel: "Check Eligibility",
    ctaHref: "/free-analysis?promo=FREE30",
  },
];

interface PromoBannerProps {
  variant?: "bar" | "inline" | "card";
  promoId?: string;
  showCountdown?: boolean;
  dismissible?: boolean;
  className?: string;
}

export function PromoBanner({
  variant = "bar",
  promoId,
  showCountdown = false,
  dismissible = true,
  className = "",
}: PromoBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const promo = promoId ? activePromos.find((p) => p.id === promoId) : activePromos[0];

  if (dismissed || !promo) return null;

  const PromoIcon = promo.icon;
  const target = getDefaultTarget();

  if (variant === "bar") {
    return (
      <div
        className={`relative bg-primary/10 border-b border-primary/20 py-2.5 px-4 ${className}`}
        data-testid={`promo-banner-${promo.id}`}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <PromoIcon className="w-4 h-4 text-primary shrink-0" />
            <span className="text-sm font-medium text-foreground" data-testid="promo-banner-title">
              {promo.title}
            </span>
            <span className="hidden sm:inline text-sm text-muted-foreground">—</span>
            <span className="hidden sm:inline text-sm text-muted-foreground" data-testid="promo-banner-desc">
              {promo.description}
            </span>
          </div>
          {promo.code && (
            <Badge variant="secondary" className="text-xs gap-1" data-testid="promo-banner-code">
              <Tag className="w-3 h-3" />
              {promo.code}
            </Badge>
          )}
          {showCountdown && (
            <CountdownTimer targetDate={target} compact className="text-primary" />
          )}
          {promo.ctaHref && promo.ctaLabel && (
            <Link href={promo.ctaHref} data-testid="promo-banner-cta">
              <Button size="sm">{promo.ctaLabel}</Button>
            </Link>
          )}
          {dismissible && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
              data-testid="promo-banner-dismiss"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (variant === "inline") {
    return (
      <div
        className={`flex items-center gap-3 bg-primary/5 rounded-md p-3 ${className}`}
        data-testid={`promo-inline-${promo.id}`}
      >
        <PromoIcon className="w-5 h-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground" data-testid="promo-inline-title">{promo.title}</p>
          <p className="text-xs text-muted-foreground">{promo.description}</p>
        </div>
        {promo.code && (
          <Badge variant="secondary" className="text-xs gap-1 shrink-0" data-testid="promo-inline-code">
            <Tag className="w-3 h-3" />
            {promo.code}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div
      className={`border border-primary/20 bg-primary/5 rounded-md p-4 ${className}`}
      data-testid={`promo-card-${promo.id}`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <PromoIcon className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground" data-testid="promo-card-title">{promo.title}</h3>
          <p className="text-xs text-muted-foreground">{promo.description}</p>
        </div>
        {dismissible && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            data-testid="promo-card-dismiss"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {promo.code && (
          <Badge variant="secondary" className="text-xs gap-1" data-testid="promo-card-code">
            <Tag className="w-3 h-3" />
            Use code: {promo.code}
          </Badge>
        )}
        {showCountdown && <CountdownTimer targetDate={target} compact className="text-primary" />}
      </div>
      {promo.ctaHref && promo.ctaLabel && (
        <Link href={promo.ctaHref} data-testid="promo-card-cta">
          <Button size="sm" className="mt-3 w-full">{promo.ctaLabel}</Button>
        </Link>
      )}
    </div>
  );
}

export function PromoList({ className = "" }: { className?: string }) {
  return (
    <div className={`space-y-3 ${className}`} data-testid="promo-list">
      {activePromos.map((promo) => (
        <PromoBanner key={promo.id} variant="card" promoId={promo.id} dismissible={false} />
      ))}
    </div>
  );
}

export { activePromos };
export type { Promo };
