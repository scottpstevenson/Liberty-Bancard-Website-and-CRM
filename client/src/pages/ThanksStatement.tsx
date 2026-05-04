import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Calendar, Calculator, BarChart3, Send, CheckCircle, Clock, Phone, Users, ArrowRight, ShieldCheck, Star, MapPin, UtensilsCrossed, Store } from "lucide-react";
import { trackCalendarBooking } from "@/lib/tracking";
import { CALENDAR_URL } from "@/lib/constants";

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

        <section className="bg-muted/30 py-12" data-testid="section-thanks-statement-referral">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <Users className="w-8 h-8 text-primary mx-auto mb-3" />
            <h2 className="text-xl font-display font-semibold text-foreground mb-2" data-testid="text-referral-heading">
              Know Another Business Owner?
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              Send them our way. Every merchant deserves to see their real numbers.
            </p>
            <Link href="/upload-statement" data-testid="link-thanks-statement-refer">
              <Button variant="outline" className="gap-2">
                Share the Free Review
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
