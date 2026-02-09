import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Phone, ArrowLeft, FileText, CreditCard, Shield } from "lucide-react";

export default function ThanksSupport() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <Navbar />
      <main className="flex-grow pt-16">
        <section className="bg-background py-20" data-testid="section-thanks-support-hero">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-thanks-support-heading">
              Support Request Received.
            </h1>
            <p className="text-lg text-muted-foreground mb-8 leading-relaxed" data-testid="text-thanks-support-subheadline">
              We're routing your request to the right person. You'll hear back during business hours, usually within a few hours.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <a href="tel:9542668214" data-testid="link-thanks-support-call">
                <Button size="lg" className="gap-2">
                  <Phone className="w-4 h-4" />
                  Call/Text 954-266-8214
                </Button>
              </a>
              <Link href="/support" data-testid="link-thanks-support-back">
                <Button size="lg" variant="outline" className="gap-2">
                  <ArrowLeft className="w-4 h-4" />
                  Back to Support
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="bg-muted py-16" data-testid="section-thanks-support-tips">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-6 text-center" data-testid="text-tips-heading">
              Tips to Resolve Faster
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card data-testid="card-tip-1">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <FileText className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Have Your MID Ready</h3>
                  <p className="text-sm text-muted-foreground">
                    Your Merchant ID (MID) helps us pull up your account instantly. You can find it on your processing statement.
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="card-tip-2">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <CreditCard className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Note Transaction Details</h3>
                  <p className="text-sm text-muted-foreground">
                    If your issue involves a specific transaction, have the date, amount, and last four digits of the card ready.
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="card-tip-3">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Shield className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Check PCI Status</h3>
                  <p className="text-sm text-muted-foreground">
                    For PCI compliance questions, check whether you have completed your annual SAQ. We can help you through it.
                  </p>
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
