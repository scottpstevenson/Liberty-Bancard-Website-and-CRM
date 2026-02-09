import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Upload, FileText, Calendar, AlertTriangle } from "lucide-react";

export default function ThanksEstimate() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <Navbar />
      <main className="flex-grow pt-16">
        <section className="bg-background py-20" data-testid="section-thanks-estimate-hero">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-thanks-estimate-heading">
              Estimate Request Received.
            </h1>
            <p className="text-lg text-muted-foreground mb-8 leading-relaxed" data-testid="text-thanks-estimate-subheadline">
              We'll calculate your effective rate based on the numbers you provided and recommend next steps. For an exact breakdown with line-item detail, upload your most recent processing statement.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <Link href="/upload-statement" data-testid="link-thanks-estimate-upload">
                <Button size="lg" className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Statement (Exact Breakdown)
                </Button>
              </Link>
              <Link href="/packet/estimate" data-testid="link-thanks-estimate-packet">
                <Button size="lg" variant="outline" className="gap-2">
                  <FileText className="w-4 h-4" />
                  View Your Packet
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="bg-muted py-16" data-testid="section-thanks-estimate-reality">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <Card data-testid="card-reality-check">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                    <AlertTriangle className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-lg font-display font-semibold text-foreground mb-2" data-testid="text-reality-check-heading">
                      Quick Reality Check
                    </h2>
                    <p className="text-muted-foreground text-sm leading-relaxed" data-testid="text-reality-check-body">
                      An estimate based on volume and total fees gives us your effective rate, but it does not show us the specific cost drivers - interchange downgrades, non-qualified surcharges, PCI fees, statement fees, or batch fees. For a true line-item breakdown, upload your most recent statement. It takes about 30 seconds.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-thanks-estimate-call">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-xl font-display font-semibold text-foreground mb-4" data-testid="text-book-call-heading">
              Prefer to talk it through?
            </h2>
            <p className="text-muted-foreground mb-6" data-testid="text-book-call-body">
              Book a quick 10-minute call and we will walk through your estimate together.
            </p>
            <a href="#" data-testid="link-thanks-estimate-book-call">
              <Button variant="outline" className="gap-2">
                <Calendar className="w-4 h-4" />
                Book a 10-Minute Call
              </Button>
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
