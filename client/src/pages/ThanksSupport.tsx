import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Phone, FileText, CreditCard, Shield, CheckCircle, ArrowRight, MessageSquare } from "lucide-react";
import { trackThankYouPageView } from "@/lib/tracking";
import { trackPhoneCallClick } from "@/lib/analytics";
import { useEffect } from "react";

/** The short reference shown on /support after a confirmed save. It is a display value only, never a capability. */
function readReference(): string | null {
  if (typeof window === "undefined") return null;
  const ref = new URLSearchParams(window.location.search).get("ref");
  return ref && /^[0-9A-F]{8}$/.test(ref) ? ref : null;
}

export default function ThanksSupport() {
  useEffect(() => { trackThankYouPageView("support_request"); }, []);
  const reference = readReference();

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title="Support Request Received" description="We received your Liberty Bancard support request. Our team will review it and follow up using the contact details you provided." path="/thanks-support" noindex />
      <Navbar />
      <main className="flex-grow public-main-offset">
        <section className="bg-primary text-primary-foreground py-16" data-testid="section-thanks-support-hero">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8" />
            </div>
            <h1 className="text-3xl md:text-4xl font-display font-bold mb-4" data-testid="text-thanks-support-heading">
              We received your request.
            </h1>
            <p className="text-lg text-primary-foreground/80 mb-2 leading-relaxed max-w-xl mx-auto" data-testid="text-thanks-support-subheadline">
              Our team will review your request and follow up using the contact details you provided.
            </p>
            {reference && (
              <p className="text-sm text-primary-foreground/70 mb-8" data-testid="text-thanks-support-reference">
                Reference <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono">{reference}</code>. Keep it if you call us about this request.
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Button size="lg" variant="secondary" className="gap-2" asChild>
                <a href="tel:9542668214" data-testid="link-thanks-support-call" onClick={() => trackPhoneCallClick({ sourcePage: "/thanks-support" })}>
                  <Phone className="w-4 h-4" />
                  Terminal down? Call 954-266-8214
                </a>
              </Button>
            </div>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-thanks-support-tips">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-6 text-center" data-testid="text-tips-heading">
              Help Us Resolve This Faster
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { icon: FileText, title: "Have Your MID Ready", desc: "Your Merchant ID helps us find your account. You can find it on your processing statement." },
                { icon: CreditCard, title: "Note Transaction Details", desc: "For specific transaction issues: date, amount, and last four digits of the card number." },
                { icon: Shield, title: "Check PCI Status", desc: "For compliance questions, check whether you've completed your annual SAQ." },
              ].map((item, i) => (
                <Card key={i} data-testid={`card-tip-${i + 1}`}>
                  <CardContent className="p-6">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center mb-3">
                      <item.icon className="w-5 h-5 text-primary" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2 text-sm">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-12" data-testid="section-thanks-support-also">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-xl font-display font-bold text-foreground mb-4 text-center" data-testid="text-also-heading">
              While You're Here
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card className="hover-elevate" data-testid="card-also-review">
                <CardContent className="p-5">
                  <Link href="/upload-statement#statement-review-form" className="flex items-start gap-3">
                    <MessageSquare className="w-8 h-8 text-primary shrink-0" />
                    <div>
                      <h3 className="font-semibold text-foreground text-sm mb-1">Get a statement review</h3>
                      <p className="text-xs text-muted-foreground">Send a recent statement and we'll explain the charges.</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                  </Link>
                </CardContent>
              </Card>
              <Card className="hover-elevate" data-testid="card-also-estimate">
                <CardContent className="p-5">
                  <Link href="/estimate" className="flex items-start gap-3">
                    <CreditCard className="w-8 h-8 text-primary shrink-0" />
                    <div>
                      <h3 className="font-semibold text-foreground text-sm mb-1">Preliminary rate estimate</h3>
                      <p className="text-xs text-muted-foreground">Enter your numbers for a preliminary estimate.</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                  </Link>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
