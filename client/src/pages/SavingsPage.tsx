import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Helmet } from "react-helmet-async";
import {
  TrendingDown,
  DollarSign,
  Share2,
  Copy,
  Mail,
  Linkedin,
  Twitter,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Phone,
  Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { CALENDAR_URL } from "@/lib/constants";

interface ShareData {
  merchantName: string;
  generatedAt: string;
  dealId: number;
  monthlyVolume: number;
  contactEmail: string | null;
  current: { effectiveRate: string; monthlyFees: number };
  liberty: { effectiveRate: string; monthlyFees: number };
  monthlySavings: number;
  annualSavings: number;
  threeYearSavings: number;
  savingsPercent: number;
  recommendedPlan: string;
  affiliateCode: string | null;
  referralLink: string;
  shareUrl: string;
}

function fmt(val: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
}

function fmtExact(val: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
}

export default function SavingsPage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery<ShareData>({
    queryKey: [`/api/savings/${token}`],
    queryFn: async () => {
      const res = await fetch(`/api/savings/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Results not found");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="marketing-surface min-h-screen flex items-center justify-center bg-background text-foreground px-4">
        <div className="text-center space-y-4 max-w-md">
          <AlertTriangle className="w-16 h-16 mx-auto text-amber-500" />
          <h1 className="text-2xl font-bold text-foreground">Results Not Found</h1>
          <p className="text-muted-foreground">
            This link may have expired or is invalid. Request a fresh analysis from your Liberty Bancard representative.
          </p>
          <a
            href="/upload-statement"
            className="inline-flex items-center gap-2 mt-4 px-6 py-3 bg-primary text-primary-foreground rounded-md font-semibold hover-elevate active-elevate-2"
            data-testid="link-get-free-analysis"
          >
            Get My Free Analysis
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    );
  }

  const pageUrl = data.shareUrl;
  const shareText = `Just found out I was overpaying ${fmtExact(data.monthlySavings)}/month on credit card processing. Liberty Bancard showed me in 24 hours — free analysis:`;
  const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl + "?utm_source=linkedin")}&summary=${encodeURIComponent(shareText + " " + pageUrl)}`;
  const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText + " " + pageUrl + "?utm_source=twitter")}`;
  const facebookUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl + "?utm_source=facebook")}`;
  const mailtoUrl = `mailto:?subject=${encodeURIComponent("You might be overpaying on credit card processing")}&body=${encodeURIComponent(shareText + "\n\n" + pageUrl + "?utm_source=email")}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl + "?utm_source=copy");
      toast({ title: "Link copied!", description: "Share it with other business owners." });
    } catch {
      toast({ title: "Copy failed", description: "Please copy the URL from your browser address bar.", variant: "destructive" });
    }
  };

  return (
    <>
      <Helmet>
        <title>Your Savings Analysis — Liberty Bancard</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="description" content="See how much you could save on credit card processing with Liberty Bancard." />
      </Helmet>

      <div className="min-h-screen bg-background text-foreground">
        <header className="border-b border-border bg-card" data-testid="header-savings">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <span className="font-bold text-lg tracking-tight text-foreground">Liberty Bancard</span>
            <a
              href="/upload-statement"
              className="text-sm text-accent hover:underline transition-colors flex items-center gap-1"
              data-testid="link-header-upload"
            >
              Get My Free Analysis <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </header>

        <main className="marketing-surface max-w-4xl mx-auto px-4 py-10 space-y-8">

          {/* ── Hero ── */}
          <section className="text-center space-y-3" data-testid="section-hero">
            <p className="text-accent font-medium text-lg" data-testid="text-merchant-name">
              {data.merchantName || "Your Business"}
            </p>
            <div className="relative overflow-hidden bg-card border border-border rounded-lg p-8 space-y-4">
                  <div className="relative space-y-4">
              <p className="text-muted-foreground text-sm uppercase tracking-widest font-semibold">You've Been Overpaying By</p>
              <div
                className="num text-6xl sm:text-7xl font-black text-foreground"
                data-testid="text-monthly-savings-hero"
              >
                {fmtExact(data.monthlySavings)}
                <span className="text-2xl sm:text-3xl font-bold text-accent">/mo</span>
              </div>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
                <div className="text-center">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">That's</p>
                  <p className="num text-2xl font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-annual-savings-hero">
                    {fmt(data.annualSavings)} this year
                  </p>
                </div>
                <div className="hidden sm:block w-px h-8 bg-border" />
                <div className="text-center">
                  <p className="text-muted-foreground text-xs uppercase tracking-wide">Or</p>
                  <p className="num text-2xl font-bold text-emerald-600 dark:text-emerald-400" data-testid="text-3yr-savings-hero">
                    {fmt(data.threeYearSavings)} over 3 years
                  </p>
                </div>
              </div>
              </div>
            </div>
          </section>

          {/* ── Comparison Table ── */}
          <section data-testid="section-comparison">
            <h2 className="text-lg font-bold mb-4 text-foreground">Side-by-Side Comparison</h2>
            <div className="grid grid-cols-3 gap-px bg-border rounded-lg overflow-hidden text-sm">
              <div className="bg-muted px-4 py-3 font-medium text-muted-foreground" />
              <div className="bg-red-50 dark:bg-red-950/30 px-4 py-3 text-center font-semibold text-red-700 dark:text-red-300" data-testid="text-col-current">
                Current Processor
              </div>
              <div className="bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-center font-semibold text-emerald-700 dark:text-emerald-300" data-testid="text-col-liberty">
                Liberty Bancard
              </div>

              <div className="bg-card px-4 py-3 text-muted-foreground">Effective Rate</div>
              <div className="bg-red-50/60 dark:bg-red-950/20 px-4 py-3 text-center num text-red-700 dark:text-red-300" data-testid="text-current-rate">
                {data.current.effectiveRate}
              </div>
              <div className="bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3 text-center num text-emerald-700 dark:text-emerald-300 flex items-center justify-center gap-1" data-testid="text-liberty-rate">
                <CheckCircle2 className="w-3 h-3" />{data.liberty.effectiveRate}
              </div>

              <div className="bg-card px-4 py-3 text-muted-foreground">Monthly Cost</div>
              <div className="bg-red-50/60 dark:bg-red-950/20 px-4 py-3 text-center num text-red-700 dark:text-red-300" data-testid="text-current-monthly">
                {fmtExact(data.current.monthlyFees)}
              </div>
              <div className="bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3 text-center num text-emerald-700 dark:text-emerald-300" data-testid="text-liberty-monthly">
                {fmtExact(data.liberty.monthlyFees > 0 ? data.liberty.monthlyFees : 0)}
              </div>

              <div className="bg-card px-4 py-3 font-semibold text-foreground">Monthly Savings</div>
              <div className="bg-red-50/60 dark:bg-red-950/20 px-4 py-3 text-center text-muted-foreground">—</div>
              <div className="bg-emerald-50/60 dark:bg-emerald-950/20 px-4 py-3 text-center num font-bold text-emerald-700 dark:text-emerald-300" data-testid="text-monthly-savings-table">
                {fmtExact(data.monthlySavings)}
              </div>
            </div>
            {data.savingsPercent > 0 && (
              <div className="mt-3 flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                <TrendingDown className="w-4 h-4" />
                {data.savingsPercent}% lower effective rate with Liberty Bancard
              </div>
            )}
          </section>

          {/* ── Share Section ── */}
          <section className="bg-card border border-border rounded-lg p-6 space-y-4" data-testid="section-share">
            <div className="flex items-center gap-2">
              <Share2 className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-bold text-foreground">Share Your Results</h2>
            </div>
            <p className="text-muted-foreground text-sm">
              Know another business owner paying too much? Share this — and show them what's possible.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href={linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 bg-[#0077B5] hover:bg-[#005e8f] text-white rounded-md font-medium text-sm transition-colors"
                data-testid="button-share-linkedin"
              >
                <Linkedin className="w-4 h-4" />
                LinkedIn
              </a>
              <a
                href={twitterUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 bg-black hover:bg-slate-800 text-white border border-white/20 rounded-md font-medium text-sm transition-colors"
                data-testid="button-share-twitter"
              >
                <Twitter className="w-4 h-4" />
                X / Twitter
              </a>
              <a
                href={facebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2.5 bg-[#1877F2] hover:bg-[#0f5fb5] text-white rounded-md font-medium text-sm transition-colors"
                data-testid="button-share-facebook"
              >
                <DollarSign className="w-4 h-4" />
                Facebook
              </a>
              <a
                href={mailtoUrl}
                className="flex items-center gap-2 px-4 py-2.5 bg-secondary text-secondary-foreground hover-elevate active-elevate-2 rounded-md font-medium text-sm"
                data-testid="button-share-email"
              >
                <Mail className="w-4 h-4" />
                Email
              </a>
              <Button
                variant="outline"
                className="gap-2"
                onClick={handleCopy}
                data-testid="button-copy-link"
              >
                <Copy className="w-4 h-4" />
                Copy Link
              </Button>
            </div>
          </section>

          {/* ── Referral CTA ── */}
          <section
            className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-lg p-6 space-y-3"
            data-testid="section-referral"
          >
            <h2 className="text-lg font-bold text-emerald-700 dark:text-emerald-400">Know Another Business Owner?</h2>
            <p className="text-muted-foreground text-sm">
              They could save too — and you earn <strong className="text-foreground">$100</strong> when they sign up.
              Forward them your referral link below.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <code
                className="flex-1 text-xs bg-muted border border-border rounded-md px-3 py-2 text-foreground break-all font-mono"
                data-testid="text-referral-link"
              >
                {data.referralLink}
              </code>
              <button
                className="shrink-0 flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white hover-elevate active-elevate-2 rounded-md text-sm font-semibold"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(data.referralLink);
                    toast({ title: "Referral link copied!" });
                  } catch {
                    toast({ title: "Copy failed", variant: "destructive" });
                  }
                }}
                data-testid="button-copy-referral"
              >
                <Copy className="w-4 h-4" />
                Copy
              </button>
            </div>
            {!data.affiliateCode && (
              <p className="text-xs text-muted-foreground">
                Don't have a referral account yet?{" "}
                <a href="/affiliate" className="text-accent hover:underline">Join our affiliate program</a> to earn on every referral.
              </p>
            )}
          </section>

          {/* ── Apply / Book CTAs ── */}
          <section
            className="relative overflow-hidden bg-primary rounded-lg p-8 text-center space-y-5"
            data-testid="section-apply-cta"
          >
              <div className="absolute top-0 left-0 right-0 h-[3px] bg-accent" aria-hidden="true" />
            <div className="relative space-y-5">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white">Ready to Start Saving?</h2>
              <p className="text-white/70 text-sm max-w-sm mx-auto">
                Lock in these rates today — your application takes about 10 minutes and there's no obligation.
              </p>
            </div>

            <a
              href={`/merchant-application?name=${encodeURIComponent(data.merchantName !== "Your Business" ? data.merchantName : "")}&email=${encodeURIComponent(data.contactEmail ?? "")}&volume=${encodeURIComponent(data.monthlyVolume > 0 ? String(Math.round(data.monthlyVolume)) : "")}&token=${encodeURIComponent(token || "")}`}
              className="inline-flex items-center gap-2 px-8 py-4 bg-emerald-500 hover-elevate active-elevate-2 rounded-md font-bold text-lg text-white"
              data-testid="link-apply-now"
            >
              <Rocket className="w-5 h-5" />
              Get My Free Analysis
            </a>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-white/50 text-xs uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <a
              href={CALENDAR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 border border-white/20 hover:bg-white/10 rounded-md font-semibold text-sm text-white transition-colors"
              data-testid="link-book-call"
            >
              <Phone className="w-4 h-4" />
              Book a 15-Minute Call First
            </a>

            <p className="text-xs text-white/50">No credit card required. Cancel anytime.</p>
            </div>
          </section>
        </main>

        {/* ── Footer ── */}
        <footer className="border-t border-border mt-12 py-8 px-4" data-testid="footer-savings">
          <div className="max-w-4xl mx-auto text-center space-y-2">
            <p className="text-muted-foreground text-xs max-w-2xl mx-auto">
              Results shown are estimates based on statement data provided and are not a guarantee of savings.
              Actual savings may vary based on business type, card mix, transaction volume, and applicable card brand rules.
              Liberty Bancard is a registered ISO/MSP. PCI compliance fees and other pass-through costs may apply.
            </p>
            <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground pt-2">
              <a href="/" className="hover:text-foreground transition-colors">Liberty Bancard</a>
              <a href="/upload-statement" className="hover:text-foreground transition-colors">Free Analysis</a>
              <a href="/privacy-policy" className="hover:text-foreground transition-colors">Privacy</a>
              <a href="/terms" className="hover:text-foreground transition-colors">Terms</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
