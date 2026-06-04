import { useState } from "react";
import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Calendar, Calculator, BarChart3, Send, CheckCircle, Clock, Phone, Users, ArrowRight, ShieldCheck, Star, MapPin, UtensilsCrossed, Store, Copy, MessageSquare, Gift } from "lucide-react";
import { trackCalendarBooking } from "@/lib/tracking";
import { CALENDAR_URL } from "@/lib/constants";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";

const GENERIC_SHARE_URL = `${typeof window !== "undefined" ? window.location.origin : "https://libertybancard.com"}/upload-statement?utm_source=referral-share&utm_medium=social`;

function ReferralShareSection() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  // Try merchant portal referral code (logged-in merchant)
  const { data: referralData } = useQuery<{
    profile: { referralCode: string | null };
  }>({
    queryKey: ["/api/merchant-portal/referrals"],
    retry: false,
  });

  // Fallback: try partner session (logged-in affiliate/ISO)
  const { data: partnerSession } = useQuery<{
    affiliateCode: string | null;
  }>({
    queryKey: ["/api/partner/session"],
    retry: false,
    enabled: !referralData?.profile?.referralCode,
  });

  const referralCode =
    referralData?.profile?.referralCode ??
    partnerSession?.affiliateCode ??
    null;
  const shareUrl = referralCode
    ? `${window.location.origin}/refer/${referralCode}`
    : GENERIC_SHARE_URL;
  const isPersonalized = !!referralCode;

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      toast({ title: "Link copied!", description: "Share it with any business owner you know." });
      setTimeout(() => setCopied(false), 3000);
    });
  };

  const handleLinkedIn = () => {
    const summary = encodeURIComponent(
      isPersonalized
        ? "I help businesses lower their merchant processing fees through Liberty Bancard. Use my link for a free statement review — no pressure: "
        : "Just got a free analysis of my merchant processing fees from Liberty Bancard — they found real savings without any pressure. If your business accepts cards, worth a look: "
    );
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}&summary=${summary}${encodeURIComponent(shareUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer,width=600,height=600");
  };

  const handleSms = () => {
    const msg = isPersonalized
      ? `Hey! I help businesses save on payment processing. Here's my referral link for a free review — ${shareUrl}`
      : `Hey! I just had my merchant statement reviewed for free by Liberty Bancard. They found savings right away. No pressure, totally free. Check it out: ${shareUrl}`;
    window.open(`sms:?body=${encodeURIComponent(msg)}`, "_self");
  };

  return (
    <section className="bg-muted/30 py-14" data-testid="section-thanks-statement-referral">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Users className="w-6 h-6 text-primary" />
          </div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-2" data-testid="text-referral-heading">
            Know Another Business Owner?
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            {isPersonalized
              ? "Share your personal referral link and earn $100 for every merchant who activates."
              : "Share this free review with any business owner who accepts cards. They'll thank you — and you could earn $100 per referral."}
          </p>
        </div>

        <Card data-testid="card-share-options">
          <CardContent className="p-6 space-y-5">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                {isPersonalized ? "Your personal referral link" : "Share link"}
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 bg-muted rounded-md px-3 py-2">
                  <p className="text-sm text-muted-foreground truncate font-mono" data-testid="text-share-url">
                    {shareUrl}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="shrink-0 gap-1.5"
                  data-testid="button-copy-share-link"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="gap-2 justify-start"
                onClick={handleLinkedIn}
                data-testid="button-share-linkedin"
              >
                <svg className="w-4 h-4 text-[#0A66C2]" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                Share on LinkedIn
              </Button>
              <Button
                variant="outline"
                className="gap-2 justify-start"
                onClick={handleSms}
                data-testid="button-share-sms"
              >
                <MessageSquare className="w-4 h-4 text-emerald-600" />
                Send via SMS
              </Button>
            </div>

            {!isPersonalized && (
              <div className="border-t border-border pt-5">
                <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                  <Gift className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                      Earn $100 per referral
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                      Create a free referral account and get paid when the merchants you refer activate.
                    </p>
                    <Link href="/affiliate" data-testid="link-create-affiliate-account">
                      <Button size="sm" variant="outline" className="mt-3 gap-1.5 border-amber-400 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/30">
                        Create Your Free Referral Account
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {isPersonalized && (
              <div className="border-t border-border pt-5">
                <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  Your referral link is active. Every conversion earns you commission.
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

export default function ThanksStatement() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Statement Received" description="We received your processing statement. Liberty Bancard will deliver your free line-by-line analysis during business hours." path="/thanks-statement" noindex />
      <Navbar />
      <main className="flex-grow pt-28">
        <section className="bg-primary text-primary-foreground py-16" data-testid="section-thanks-statement-hero">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8" />
            </div>
            <h1 className="text-3xl md:text-4xl font-display font-bold mb-4" data-testid="text-thanks-statement-heading">
              Statement Received. Your Review Has Started.
            </h1>
            <p className="text-lg text-primary-foreground/80 mb-8 leading-relaxed max-w-xl mx-auto" data-testid="text-thanks-statement-subheadline">
              We're reviewing your statement line-by-line right now. You'll get your breakdown during business hours - usually the same day.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" onClick={() => trackCalendarBooking("thanks_statement")} data-testid="link-thanks-statement-book-call">
                <Button size="lg" variant="secondary" className="gap-2">
                  <Calendar className="w-4 h-4" />
                  Book a 10-Minute Walkthrough
                </Button>
              </a>
              <a href="tel:9542668214" data-testid="link-thanks-statement-call">
                <Button size="lg" variant="outline" className="gap-2 bg-transparent border-primary-foreground/30 text-primary-foreground">
                  <Phone className="w-4 h-4" />
                  Call/Text 954-266-8214
                </Button>
              </a>
            </div>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-thanks-statement-next">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-2 text-center" data-testid="text-what-happens-next">
              What Happens Next
            </h2>
            <p className="text-center text-sm text-muted-foreground mb-8">Here's our process - no guesswork, no surprises.</p>
            <div className="relative">
              <div className="hidden md:block absolute top-6 left-0 right-0 h-0.5 bg-border" />
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[
                  { icon: Calculator, step: "Step 1", title: "We Calculate Your Rate", desc: "Your true effective rate - total fees divided by total volume.", time: "Happening now", active: true },
                  { icon: BarChart3, step: "Step 2", title: "We Find Cost Drivers", desc: "Card mix, downgrades, monthly add-ons, batch fees, PCI charges.", time: "Within hours", active: false },
                  { icon: Send, step: "Step 3", title: "You Get Clear Options", desc: "2-3 paths forward with real math. No vague promises.", time: "Same day", active: false },
                  { icon: Phone, step: "Step 4", title: "Quick Walkthrough Call", desc: "10-minute call to review findings and answer questions.", time: "When you're ready", active: false },
                ].map((item, i) => (
                  <Card key={i} className={item.active ? "border-primary/50 shadow-md" : ""} data-testid={`card-next-step-${i + 1}`}>
                    <CardContent className="p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${item.active ? "bg-primary text-primary-foreground" : "bg-primary/10"}`}>
                          <item.icon className={`w-5 h-5 ${item.active ? "" : "text-primary"}`} />
                        </div>
                      </div>
                      <div className="text-xs font-medium text-primary mb-1">{item.step}</div>
                      <h3 className="font-semibold text-foreground text-sm mb-1">{item.title}</h3>
                      <p className="text-xs text-muted-foreground mb-2">{item.desc}</p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {item.time}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-16" data-testid="section-thanks-statement-testimonials">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-6 text-center" data-testid="text-testimonials-heading">
              What Other Merchants Say
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card data-testid="card-testimonial-1">
                <CardContent className="p-5">
                  <div className="flex items-center gap-1 mb-2">
                    {[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />)}
                  </div>
                  <p className="text-sm text-foreground italic leading-relaxed mb-3">
                    "We had no idea we were overpaying by $400/month until Liberty reviewed our statement. The switch took 2 days and we've saved over $5,000 this year."
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <UtensilsCrossed className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Marco T.</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Restaurant Owner, Fort Lauderdale
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="card-testimonial-2">
                <CardContent className="p-5">
                  <div className="flex items-center gap-1 mb-2">
                    {[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />)}
                  </div>
                  <p className="text-sm text-foreground italic leading-relaxed mb-3">
                    "I was skeptical, but the quiz showed I was paying 3.4% effective rate. Liberty got me to 2.1%. That's $800/month back in my pocket."
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Store className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Jennifer R.</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Retail Store Owner, Miami
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-thanks-statement-while-waiting">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-6 text-center" data-testid="text-while-waiting">
              While You Wait
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card className="hover-elevate" data-testid="card-while-1">
                <CardContent className="p-5">
                  <Link href="/0-percent-processing" className="flex items-start gap-3">
                    <ShieldCheck className="w-8 h-8 text-primary shrink-0" />
                    <div>
                      <h3 className="font-semibold text-foreground text-sm mb-1">Learn About 0% Programs</h3>
                      <p className="text-xs text-muted-foreground">See if a compliant fee-offset program could work for your business.</p>
                    </div>
                  </Link>
                </CardContent>
              </Card>
              <Card className="hover-elevate" data-testid="card-while-2">
                <CardContent className="p-5">
                  <Link href="/beat-square-stripe" className="flex items-start gap-3">
                    <BarChart3 className="w-8 h-8 text-primary shrink-0" />
                    <div>
                      <h3 className="font-semibold text-foreground text-sm mb-1">Compare vs Square/Stripe</h3>
                      <p className="text-xs text-muted-foreground">See how flat-rate stacks up against interchange-plus pricing.</p>
                    </div>
                  </Link>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <ReferralShareSection />
      </main>
      <Footer />
    </div>
  );
}
