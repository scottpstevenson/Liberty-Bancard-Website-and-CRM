import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Upload, FileText, BarChart3, AlertCircle, Phone } from "lucide-react";

export default function ThanksCall() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <Navbar />
      <main className="flex-grow pt-16">
        <section className="bg-background py-20" data-testid="section-thanks-call-hero">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-thanks-call-heading">
              You're Booked.
            </h1>
            <p className="text-lg text-muted-foreground mb-8 leading-relaxed" data-testid="text-thanks-call-subheadline">
              We'll review your goals on the call. If you upload your most recent processing statement before the call, we can give you exact answers instead of estimates.
            </p>
            <Link href="/upload-statement" data-testid="link-thanks-call-upload">
              <Button size="lg" className="gap-2">
                <Upload className="w-4 h-4" />
                Upload Statement (30 seconds)
              </Button>
            </Link>
          </div>
        </section>

        <section className="bg-muted py-16" data-testid="section-thanks-call-bring">
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

        <section className="bg-background py-16" data-testid="section-thanks-call-contact">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-xl font-display font-semibold text-foreground mb-4" data-testid="text-reschedule-heading">
              Need to reschedule?
            </h2>
            <p className="text-muted-foreground mb-6" data-testid="text-reschedule-body">
              No problem. Call or text us and we will find a time that works.
            </p>
            <a href="tel:9542668214" data-testid="link-thanks-call-phone">
              <Button variant="outline" className="gap-2">
                <Phone className="w-4 h-4" />
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
