import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Phone, FileText, CreditCard, Shield, CheckCircle, Clock, ArrowRight, MessageSquare } from "lucide-react";

export default function ThanksSupport() {
  return (
    <div className="min-h-screen flex flex-col font-body">
      <Navbar />
      <main className="flex-grow pt-28">
        <section className="bg-primary text-primary-foreground py-16" data-testid="section-thanks-support-hero">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8" />
            </div>
            <h1 className="text-3xl md:text-4xl font-display font-bold mb-4" data-testid="text-thanks-support-heading">
              We Got Your Request. A Real Person Is On It.
            </h1>
            <p className="text-lg text-primary-foreground/80 mb-2 leading-relaxed max-w-xl mx-auto" data-testid="text-thanks-support-subheadline">
              We're routing your request to the right team member. You'll hear back during business hours - usually within a few hours.
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-primary-foreground/60 mb-8">
              <Clock className="w-4 h-4" />
              <span>Average response time: under 2 hours during business hours</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
              <a href="tel:9542668214" data-testid="link-thanks-support-call">
                <Button size="lg" variant="secondary" className="gap-2">
                  <Phone className="w-4 h-4" />
                  Need It Faster? Call 954-266-8214
                </Button>
              </a>
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
                { icon: FileText, title: "Have Your MID Ready", desc: "Your Merchant ID helps us pull up your account instantly. Find it on your processing statement." },
                { icon: CreditCard, title: "Note Transaction Details", desc: "For specific transaction issues: date, amount, and last four digits of the card number." },
                { icon: Shield, title: "Check PCI Status", desc: "For compliance questions, check if you've completed your annual SAQ. We can walk you through it." },
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
                  <Link href="/upload-statement" className="flex items-start gap-3">
                    <MessageSquare className="w-8 h-8 text-primary shrink-0" />
                    <div>
                      <h3 className="font-semibold text-foreground text-sm mb-1">Get a Free Rate Review</h3>
                      <p className="text-xs text-muted-foreground">Upload your statement and we'll show you if you're overpaying.</p>
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
                      <h3 className="font-semibold text-foreground text-sm mb-1">Quick Effective Rate Check</h3>
                      <p className="text-xs text-muted-foreground">Enter your numbers and see your rate in 60 seconds.</p>
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
