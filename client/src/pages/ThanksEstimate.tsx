import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Upload, Calendar, AlertTriangle, ArrowRight, CheckCircle, FileText, Phone, TrendingUp } from "lucide-react";

export default function ThanksEstimate() {
  return (
    <div className="min-h-screen flex flex-col font-body">
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

        <section className="bg-muted/30 py-12" data-testid="section-thanks-estimate-reality">
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

        <section className="bg-background py-16" data-testid="section-thanks-estimate-upgrade">
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
              <a href="#" data-testid="link-thanks-estimate-book-call">
                <Button size="lg" variant="outline" className="gap-2">
                  <Calendar className="w-4 h-4" />
                  Book a 10-Minute Call
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
