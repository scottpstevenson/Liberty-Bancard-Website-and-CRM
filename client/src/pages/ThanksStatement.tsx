import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Calendar, FileText, Calculator, BarChart3, Send, MessageSquare } from "lucide-react";

export default function ThanksStatement() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <Navbar />
      <main className="flex-grow pt-16">
        <section className="bg-background py-20" data-testid="section-thanks-statement-hero">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-thanks-statement-heading">
              Statement Received -- You're In.
            </h1>
            <p className="text-lg text-muted-foreground mb-8 leading-relaxed" data-testid="text-thanks-statement-subheadline">
              We'll review your statement line-by-line and send your breakdown during business hours. Want to walk through it together? Book a 10-minute call.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <a href="#" data-testid="link-thanks-statement-book-call">
                <Button size="lg" className="gap-2">
                  <Calendar className="w-4 h-4" />
                  Book a 10-Minute Call
                </Button>
              </a>
              <Link href="/packet/statement-review" data-testid="link-thanks-statement-packet">
                <Button size="lg" variant="outline" className="gap-2">
                  <FileText className="w-4 h-4" />
                  View Your Packet
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="bg-muted py-16" data-testid="section-thanks-statement-next">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-8 text-center" data-testid="text-what-happens-next">
              What Happens Next
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card data-testid="card-next-step-1">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Calculator className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Step 1</h3>
                  <p className="text-sm text-muted-foreground">
                    We calculate your true effective rate from the statement you uploaded.
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="card-next-step-2">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <BarChart3 className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Step 2</h3>
                  <p className="text-sm text-muted-foreground">
                    We identify the specific cost drivers and markup in your current setup.
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="card-next-step-3">
                <CardContent className="p-6 text-center">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <Send className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Step 3</h3>
                  <p className="text-sm text-muted-foreground">
                    We send you 2-3 clear options to reduce your total processing cost.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-thanks-statement-context">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="flex items-center justify-center gap-3 mb-4">
              <MessageSquare className="w-6 h-6 text-primary" />
              <h2 className="text-xl font-display font-semibold text-foreground" data-testid="text-need-context">
                Need to add context?
              </h2>
            </div>
            <p className="text-muted-foreground mb-6" data-testid="text-context-description">
              If there is anything specific you want us to look at, or if you have questions about your current setup, reply to the confirmation email or call/text us at 954-266-8214.
            </p>
            <a href="tel:9542668214" data-testid="link-thanks-statement-call">
              <Button variant="outline" className="gap-2">
                Call/Text 954-266-8214
              </Button>
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
