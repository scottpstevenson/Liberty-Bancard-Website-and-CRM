import { Navbar } from "@/components/Navbar";
import { SEO } from "@/components/SEO";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Upload, FileText, BarChart3, AlertCircle, Phone, Calendar, CheckCircle, Clock, Star, MapPin, UtensilsCrossed, Store } from "lucide-react";
import { trackCalendarBooking } from "@/lib/tracking";
import { CALENDAR_URL } from "@/lib/constants";

export default function ThanksCall() {

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Callback Request Received" description="We received your callback request. A Liberty Bancard payments specialist will reach out shortly during business hours." path="/thanks-call" noindex />
      <Navbar />
      <main className="flex-grow pt-16">
        <section className="bg-primary text-primary-foreground py-20" data-testid="section-thanks-call-hero">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-6">
              <Calendar className="w-8 h-8" />
            </div>
            <h1 className="text-3xl md:text-4xl font-display font-bold mb-4" data-testid="text-thanks-call-heading">
              You're Booked.
            </h1>
            <p className="text-lg text-primary-foreground/80 mb-8 leading-relaxed" data-testid="text-thanks-call-subheadline">
              We'll review your goals on the call. If you upload your most recent processing statement before the call, we can give you exact answers instead of estimates.
            </p>
            <Link href="/upload-statement" data-testid="link-thanks-call-upload">
              <Button size="lg" variant="secondary" className="gap-2">
                <Upload className="w-4 h-4" />
                Upload Statement (30 seconds)
              </Button>
            </Link>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-thanks-call-timeline">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-2 text-center" data-testid="text-timeline-heading">
              What Happens Next
            </h2>
            <p className="text-center text-sm text-muted-foreground mb-8">Here's what to expect before and after your call.</p>
            <div className="space-y-4">
              {[
                { step: "1", title: "Confirmation Email Sent", desc: "Check your inbox for call details and a calendar invite.", time: "Now", done: true },
                { step: "2", title: "Upload Your Statement (Optional)", desc: "If we have your statement before the call, we can give exact numbers instead of estimates.", time: "Before the call", done: false },
                { step: "3", title: "10-Minute Call", desc: "We'll walk through your current setup, identify cost drivers, and present options.", time: "Your scheduled time", done: false },
                { step: "4", title: "Written Breakdown Delivered", desc: "You'll receive a clear summary with numbers you can use - even if you don't switch.", time: "Same day as call", done: false },
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

        <section className="bg-muted/30 py-16" data-testid="section-thanks-call-bring">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-6 text-center" data-testid="text-what-to-bring">
              What to Bring
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card data-testid="card-bring-statement">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <FileText className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Your Statement</h3>
                  <p className="text-sm text-muted-foreground">
                    Your most recent processing statement (PDF or photo). Redact account numbers if you prefer.
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="card-bring-volume">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <BarChart3 className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Your Volume</h3>
                  <p className="text-sm text-muted-foreground">
                    A rough idea of your monthly card volume and average transaction size.
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="card-bring-pain-points">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <AlertCircle className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Your Pain Points</h3>
                  <p className="text-sm text-muted-foreground">
                    What is frustrating you about your current setup - fees, funding speed, support, equipment, or something else.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-thanks-call-testimonials">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-xl font-display font-bold text-foreground mb-6 text-center" data-testid="text-testimonials-heading">
              What Merchants Say About Our Calls
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

        <section className="bg-muted/30 py-16" data-testid="section-thanks-call-contact">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-xl font-display font-semibold text-foreground mb-4" data-testid="text-reschedule-heading">
              Need to reschedule?
            </h2>
            <p className="text-muted-foreground mb-6" data-testid="text-reschedule-body">
              No problem. Reschedule online or call us.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" onClick={() => trackCalendarBooking("thanks_call_reschedule")} data-testid="link-thanks-call-reschedule">
                <Button variant="outline" className="gap-2">
                  <Calendar className="w-4 h-4" />
                  Reschedule Online
                </Button>
              </a>
              <a href="tel:9542668214" data-testid="link-thanks-call-phone">
                <Button variant="outline" className="gap-2">
                  <Phone className="w-4 h-4" />
                  Call/Text 954-266-8214
                </Button>
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
