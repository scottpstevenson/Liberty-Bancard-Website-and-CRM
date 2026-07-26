import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Upload, Calendar, AlertTriangle, ArrowRight, CheckCircle, FileText, Phone, TrendingUp, Star, MapPin, Wrench, Stethoscope, Clock } from "lucide-react";
import { trackCalendarBooking, trackThankYouPageView } from "@/lib/tracking";
import { CALENDAR_URL } from "@/lib/constants";
import { useEffect } from "react";

export default function ThanksEstimate() {
  useEffect(() => { trackThankYouPageView("savings_estimate"); }, []);

  return (
    <div className="min-h-screen flex flex-col font-body overflow-x-hidden">
      <SEO title="Estimate Received" description="We received your processing estimate request. Liberty Bancard will follow up shortly with your custom rate breakdown." path="/thanks-estimate" noindex />
      <Navbar />
      <main className="flex-grow pt-28">
        <section className="bg-background py-16" data-testid="section-thanks-estimate-hero">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-thanks-estimate-heading">
              Got Your Numbers. Here's What to Do Next.
            </h1>
            <p className="text-lg text-muted-foreground mb-8 leading-relaxed max-w-xl mx-auto" data-testid="text-thanks-estimate-subheadline">
              We'll calculate your estimated effective rate and follow up with recommendations. But here's the thing - an estimate only tells part of the story.
            </p>
          </div>
        </section>

        <section className="bg-muted/30 py-12" data-testid="section-thanks-estimate-timeline">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-2 text-center" data-testid="text-timeline-heading">
              What Happens Next
            </h2>
            <p className="text-center text-sm text-muted-foreground mb-8">Your estimate is being processed. Here's what to expect.</p>
            <div className="space-y-4">
              {[
                { step: "1", title: "We Review Your Numbers", desc: "We'll calculate your estimated effective rate based on the volume and fee info you provided.", time: "Within 1 hour", done: true },
                { step: "2", title: "We Send Initial Findings", desc: "You'll receive an email with your rate assessment and preliminary recommendations.", time: "Same day", done: false },
                { step: "3", title: "Upload Statement for Full Picture", desc: "The real savings opportunities are in the line items. A statement review reveals hidden cost drivers.", time: "When you're ready", done: false },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-4" data-testid={`timeline-step-${i + 1}`}>
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${item.done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
                    {item.done ? <CheckCircle className="w-5 h-5" /> : <span className="text-sm font-bold">{item.step}</span>}
                  </div>
                  <div className="flex-1 pb-4 border-b border-border last:border-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-foreground text-sm">{item.title}</h3>
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />{item.time}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-background py-12" data-testid="section-thanks-estimate-reality">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <Card className="border-2 border-amber-200 dark:border-amber-800" data-testid="card-reality-check">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-md bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-display font-bold text-foreground mb-2" data-testid="text-reality-check-heading">
                      Why the Estimate Isn't Enough
                    </h2>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-3" data-testid="text-reality-check-body">
                      Volume and total fees give us your effective rate - but they don't show the hidden cost drivers. Interchange downgrades, non-qualified surcharges, PCI fees, statement fees, batch fees, and monthly add-ons are invisible without a statement.
                    </p>
                    <p className="text-sm text-foreground font-medium">
                      The real savings opportunities live in the line items.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="bg-muted/30 py-16" data-testid="section-thanks-estimate-upgrade">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <TrendingUp className="w-10 h-10 text-primary mx-auto mb-4" />
            <h2 className="text-2xl font-display font-bold text-foreground mb-3" data-testid="text-upgrade-heading">
              Want the Full Picture? Upload Your Statement.
            </h2>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Takes 30 seconds. You'll get a complete line-item breakdown with specific cost drivers and clear options to reduce your total cost.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap mb-6">
              <Link href="/upload-statement" data-testid="link-thanks-estimate-upload">
                <Button size="lg" className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Statement for Full Breakdown
                </Button>
              </Link>
              <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" onClick={() => trackCalendarBooking("thanks_estimate")} data-testid="link-thanks-estimate-book-call">
                <Button size="lg" variant="outline" className="gap-2">
                  <Calendar className="w-4 h-4" />
                  Get My Free Analysis
                </Button>
              </a>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-lg mx-auto">
              {[
                { text: "Free, no obligation", icon: FileText },
                { text: "Same-day results", icon: CheckCircle },
                { text: "Keep it either way", icon: ArrowRight },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid={`trust-point-${i}`}>
                  <item.icon className="w-4 h-4 text-emerald-500" />
                  {item.text}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-thanks-estimate-testimonials">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-xl font-display font-bold text-foreground mb-6 text-center" data-testid="text-testimonials-heading">
              Merchants Who Took the Next Step
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card data-testid="card-testimonial-1">
                <CardContent className="p-5">
                  <div className="flex items-center gap-1 mb-2">
                    {[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />)}
                  </div>
                  <p className="text-sm text-foreground italic leading-relaxed mb-3">
                    "The 0% processing program completely eliminated my credit card fees. My customers don't mind the small surcharge and I keep 100% of my margins."
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Wrench className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Carlos M.</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Auto Repair Shop, Tampa
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
                    "Our dental practice was paying hidden fees we never knew about. Liberty found $6,200/year in savings and the onboarding was seamless."
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Stethoscope className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Dr. Sarah K.</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Dental Practice, Orlando
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-12" data-testid="section-thanks-estimate-call">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <p className="text-sm text-muted-foreground mb-2">Need help now?</p>
            <a href="tel:9542668214" className="text-lg font-semibold text-primary" data-testid="link-thanks-estimate-phone">
              Call/Text 954-266-8214
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
