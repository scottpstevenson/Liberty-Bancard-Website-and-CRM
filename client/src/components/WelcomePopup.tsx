import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CountdownTimer, getDefaultTarget } from "@/components/CountdownTimer";
import {
  X,
  Zap,
  TrendingDown,
  Clock,
  ShieldCheck,
  ArrowRight,
  DollarSign,
} from "lucide-react";

const STORAGE_KEY = "lb_welcome_shown";

export function WelcomePopup() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const alreadyShown = localStorage.getItem(STORAGE_KEY);
    if (alreadyShown) return;

    const timer = setTimeout(() => {
      setShow(true);
      localStorage.setItem(STORAGE_KEY, "true");
    }, 4000);

    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  const target = getDefaultTarget();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      data-testid="welcome-popup"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setShow(false)}
        data-testid="welcome-popup-overlay"
      />
      <Card
        className="relative z-10 max-w-md w-full border-2 border-primary/20 animate-in zoom-in-95 duration-300 overflow-hidden"
        data-testid="welcome-popup-card"
      >
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-6 pt-5 pb-3">
          <div className="flex items-center justify-between">
            <Badge
              variant="secondary"
              className="bg-primary/15 text-primary border-primary/25 gap-1"
              data-testid="welcome-popup-badge"
            >
              <Zap className="w-3 h-3" />
              Limited Time Offer
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 -mr-2"
              onClick={() => setShow(false)}
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
            See If You Qualify for Free Processing
          </h2>
          <p
            className="text-sm text-muted-foreground mb-4 leading-relaxed"
            data-testid="text-welcome-body"
          >
            Take our 60-second quiz and find out if your business qualifies for
            0% processing fees through our cash discount program.
          </p>

          <div className="space-y-2.5 mb-5">
            <div className="flex items-center gap-2.5 text-sm text-foreground">
              <DollarSign className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Businesses save $2,000 - $15,000+ per year</span>
            </div>
            <div className="flex items-center gap-2.5 text-sm text-foreground">
              <Clock className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Takes 60 seconds — get your estimate instantly</span>
            </div>
            <div className="flex items-center gap-2.5 text-sm text-foreground">
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>No obligation — keep your results either way</span>
            </div>
            <div className="flex items-center gap-2.5 text-sm text-foreground">
              <TrendingDown className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>500+ FL businesses already switched</span>
            </div>
          </div>

          <Link
            href="/free-analysis?promo=FREE30"
            data-testid="link-welcome-quiz"
          >
            <Button
              className="w-full gap-2"
              size="lg"
              onClick={() => setShow(false)}
            >
              Check My Eligibility
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
            onClick={() => setShow(false)}
            className="mt-2 w-full text-xs text-muted-foreground"
            data-testid="button-welcome-dismiss"
          >
            No thanks, I'm good
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
