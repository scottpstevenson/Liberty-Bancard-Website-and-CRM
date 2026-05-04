import { useEffect, useState } from "react";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import {
  CheckCircle, FileCheck, Phone, Mail, Clock,
  ArrowRight, Calendar, Shield, User
} from "lucide-react";
import { trackCalendarBooking } from "@/lib/tracking";

const CALENDAR_URL = import.meta.env.VITE_GHL_CALENDAR_URL || "https://api.leadconnectorhq.com/widget/booking/liberty-bancard";

export default function ThanksApplication() {
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [esignStatus, setEsignStatus] = useState<string | null>(null);
  const [contactEmail, setContactEmail] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("lb_app_confirmation");
      if (raw) {
        const data = JSON.parse(raw);
        setApplicationId(data.applicationId || null);
        setEsignStatus(data.esignStatus || null);
        setContactEmail(data.email || null);
        setBusinessName(data.businessName || null);
        setOwnerName(data.ownerName || null);
      }
    } catch {
    }
  }, []);

  const nextSteps = [
    {
      step: 1,
      title: "Sign your Merchant Processing Agreement",
      description: esignStatus === "sent"
        ? `Your agreement has been sent to ${contactEmail || "your email"}. Check your inbox and complete the e-signature.`
        : `Our team will email your Merchant Processing Agreement to ${contactEmail || "you"} shortly. Complete the e-signature to move forward.`,
      icon: FileCheck,
      timeframe: "Today",
      urgent: true,
    },
    {
      step: 2,
      title: "Application review & underwriting",
      description: "Our underwriting team will review your application within 1 business day and may contact you for any additional information.",
      icon: Shield,
      timeframe: "1–2 business days",
      urgent: false,
    },
    {
      step: 3,
      title: "Account setup & equipment",
      description: "Once approved, we'll assign your Merchant ID (MID), configure your gateway, and ship any equipment you requested.",
      icon: CheckCircle,
      timeframe: "3–5 business days",
      urgent: false,
    },
    {
      step: 4,
      title: "Go live",
      description: "Your new processing begins. You'll see your first batch settlement within 24–48 hours after your first transaction.",
      icon: ArrowRight,
      timeframe: "5–7 business days",
      urgent: false,
    },
  ];

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Application Received" description="We received your Liberty Bancard merchant application. Our underwriting team will reach out within one business day with next steps." path="/thanks/application" noindex />
      <Navbar />
      <main className="flex-grow pt-28">
        <section
          className="relative overflow-hidden"
          data-testid="section-thanks-application-hero"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="glow-blob w-64 h-64 bg-emerald-500 top-10 right-1/4" />
          <div className="relative max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-5">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h1
              className="text-3xl md:text-4xl font-display font-bold text-white mb-3"
              data-testid="text-thanks-application-heading"
            >
              Application Submitted
            </h1>
            {applicationId && (
              <p className="text-white/70 mb-2" data-testid="text-thanks-application-id">
                Reference #<span className="font-semibold text-white">{applicationId}</span>
              </p>
            )}
            {(businessName || ownerName) && (
              <p className="text-white/60 text-sm" data-testid="text-thanks-application-name">
                {businessName && <span>{businessName}</span>}
                {businessName && ownerName && " · "}
                {ownerName && <span>{ownerName}</span>}
              </p>
            )}
          </div>
        </section>

        <section className="bg-muted/30 py-12" data-testid="section-thanks-application-esign">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
            {esignStatus === "sent" && (
              <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20" data-testid="card-esign-sent">
                <CardContent className="p-6 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center shrink-0">
                    <Mail className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-foreground mb-1" data-testid="text-esign-sent-heading">
                      E-Signature Request Sent
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Your Merchant Processing Agreement was emailed to{" "}
                      <span className="font-medium text-foreground">{contactEmail}</span>.{" "}
                      Please check your inbox (and spam folder) and complete the signature as soon as possible to avoid delays.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {(!esignStatus || esignStatus === "email_pending") && (
              <Card className="border-primary/20 bg-primary/5" data-testid="card-esign-pending">
                <CardContent className="p-6 flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <FileCheck className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-foreground mb-1" data-testid="text-esign-pending-heading">
                      Agreement Coming Shortly
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Your application is submitted. Our team will send your Merchant Processing Agreement to{" "}
                      <span className="font-medium text-foreground">{contactEmail || "your email"}</span>{" "}
                      shortly. Watch your inbox.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card data-testid="card-next-steps">
              <CardContent className="p-6 sm:p-8">
                <h2
                  className="text-xl font-display font-bold text-foreground mb-6"
                  data-testid="text-next-steps-heading"
                >
                  What Happens Next
                </h2>
                <div className="space-y-5">
                  {nextSteps.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.step}
                        className="flex items-start gap-4"
                        data-testid={`next-step-${item.step}`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          item.urgent
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          <span className="text-xs font-bold">{item.step}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <p className="text-sm font-semibold text-foreground">{item.title}</p>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {item.timeframe}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {item.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-contact-info">
              <CardContent className="p-6">
                <h2 className="text-base font-semibold text-foreground mb-4" data-testid="text-contact-info-heading">
                  Have Questions? We're Here.
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <a href="tel:9542668214" className="flex items-center gap-3 group" data-testid="link-contact-phone">
                    <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                      <Phone className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Call or Text</p>
                      <p className="text-sm font-medium text-foreground">954-266-8214</p>
                    </div>
                  </a>
                  <a href="mailto:support@libertybancard.com" className="flex items-center gap-3 group" data-testid="link-contact-email">
                    <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                      <Mail className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Email</p>
                      <p className="text-sm font-medium text-foreground">support@libertybancard.com</p>
                    </div>
                  </a>
                </div>
                <div className="mt-4 pt-4 border-t flex flex-col sm:flex-row gap-3">
                  <a
                    href={CALENDAR_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackCalendarBooking("thanks_application")}
                    data-testid="link-thanks-application-book-call"
                  >
                    <Button size="sm" className="gap-2 w-full sm:w-auto">
                      <Calendar className="w-4 h-4" />
                      Book a 10-Minute Walkthrough
                    </Button>
                  </a>
                  <Link href="/dashboard/merchant-portal">
                    <Button size="sm" variant="outline" className="gap-2 w-full sm:w-auto" data-testid="link-thanks-application-portal">
                      <User className="w-4 h-4" />
                      Go to Merchant Portal
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground text-center" data-testid="text-thanks-disclaimer">
              Liberty Bancard is a registered ISO. All applications are subject to underwriting approval. 
              Eligibility, underwriting, card brand rules, and applicable laws apply.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
