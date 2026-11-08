import { useState, useRef } from "react";
import { SEO, type StructuredData } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { trackPhoneCallClick } from "@/lib/analytics";
import { useToast } from "@/hooks/use-toast";
import {
  COMPAT_STATE_LABEL,
  INTEGRATIONS_CALLOUT,
  INTEGRATIONS_CTA,
  INTEGRATIONS_DIRECTORY,
  INTEGRATIONS_HERO,
  INTEGRATIONS_META,
  INTEGRATIONS_PATH,
  INTEGRATIONS_PROCESS,
  INTEGRATIONS_REQUEST,
  INTEGRATION_CATEGORIES,
  INTEGRATION_RECORDS,
  integrationStats,
  showsActiveCheck,
  type IntegrationCategory,
} from "@shared/integrations-content";
import {
  Monitor,
  ShoppingCart,
  Calculator,
  Calendar,
  Users,
  Stethoscope,
  CheckCircle2,
  CircleHelp,
  ArrowRight,
  Upload,
  ExternalLink,
  Puzzle,
  Send,
} from "lucide-react";

/** Icons are presentation only; every word on the page comes from the shared compatibility record. */
const CATEGORY_ICONS: Record<IntegrationCategory, typeof Monitor> = {
  "POS Systems": Monitor,
  Accounting: Calculator,
  eCommerce: ShoppingCart,
  "Practice Management": Stethoscope,
  Scheduling: Calendar,
  CRM: Users,
};

const integrationsSchema: StructuredData = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: INTEGRATIONS_META.title,
  description: INTEGRATIONS_META.schemaDescription,
  url: `https://libertybancard.com${INTEGRATIONS_PATH}`,
  about: {
    "@type": "Service",
    name: "Payment Processing Compatibility Review",
    provider: { "@type": "Organization", name: "Liberty Bancard" },
    description: INTEGRATIONS_META.schemaAbout,
  },
};

export default function Integrations() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const { toast } = useToast();
  const [requestForm, setRequestForm] = useState({
    softwareName: "",
    softwareCategory: "",
    contactName: "",
    email: "",
    businessName: "",
    phone: "",
    notes: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  const requestMutation = useMutation({
    mutationFn: async (payload: typeof requestForm) => {
      idempotencyKeyRef.current ??= crypto.randomUUID();
      const res = await apiRequest("POST", "/api/public/integration-request", payload, {
        "Idempotency-Key": idempotencyKeyRef.current,
      });
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
      setRequestForm({
        softwareName: "",
        softwareCategory: "",
        contactName: "",
        email: "",
        businessName: "",
        phone: "",
        notes: "",
      });
      toast({
        title: INTEGRATIONS_REQUEST.toastTitle,
        description: INTEGRATIONS_REQUEST.toastBody,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not submit request",
        description: err.message || "Please try again or email support@libertybancard.com.",
        variant: "destructive",
      });
    },
  });

  const handleRequestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestForm.softwareName.trim() || !requestForm.contactName.trim() || !requestForm.email.trim()) {
      toast({
        title: "Missing information",
        description: "Please share the software name, your name, and an email address.",
        variant: "destructive",
      });
      return;
    }
    requestMutation.mutate(requestForm);
  };

  const filtered = selectedCategory
    ? INTEGRATION_RECORDS.filter((i) => i.category === selectedCategory)
    : INTEGRATION_RECORDS;

  const grouped = INTEGRATION_CATEGORIES.map((cat) => ({
    ...cat,
    icon: CATEGORY_ICONS[cat.name],
    items: filtered.filter((i) => i.category === cat.name),
  })).filter((cat) => cat.items.length > 0);

  const stats = integrationStats();

  return (
    <>
      <SEO
        title="Software Integrations & Compatibility"
        description={INTEGRATIONS_META.description}
        path={INTEGRATIONS_PATH}
        keywords={INTEGRATIONS_META.keywords}
        breadcrumbs={[{ name: "Integrations", path: INTEGRATIONS_PATH }]}
        structuredData={[integrationsSchema]}
      />

      <Navbar />

      <main className="pt-32 pb-20">
        {/* Hero */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-16">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <Badge variant="secondary" className="mb-4" data-testid="badge-integrations">
              {INTEGRATIONS_HERO.badge}
            </Badge>
            <h1
              className="text-4xl sm:text-5xl font-bold tracking-tight mb-6"
              data-testid="text-integrations-title"
            >
              {INTEGRATIONS_HERO.headingLead}{" "}
              <span className="text-primary">{INTEGRATIONS_HERO.headingAccent}</span>
            </h1>
            <p
              className="text-lg text-muted-foreground leading-relaxed mb-8"
              data-testid="text-integrations-subtitle"
            >
              {INTEGRATIONS_HERO.sub}
            </p>

            <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-lg p-5 mb-8 text-left max-w-2xl mx-auto">
              <div className="flex items-start gap-3">
                <Puzzle className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-1">
                    {INTEGRATIONS_CALLOUT.title}
                  </p>
                  <p className="text-sm text-sky-900 dark:text-sky-100">
                    {INTEGRATIONS_CALLOUT.text}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 justify-center">
              <Button size="lg" className="gap-2" asChild>
                <Link href="/upload-statement" data-testid="link-integrations-cta">
                  <Upload className="w-4 h-4" />
                  {INTEGRATIONS_HERO.primaryCta}
                </Link>
              </Button>
              <a
                href="#category-list"
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-muted-foreground hover:text-foreground border border-border rounded-md transition-colors"
                data-testid="link-browse-integrations"
              >
                {INTEGRATIONS_HERO.browseCta}
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Directory facts: counts of listed products, never a compatibility count */}
          <div className="grid grid-cols-2 gap-4 max-w-md mx-auto mb-16">
            {stats.map((item, i) => (
              <div
                key={item.label}
                className="text-center bg-muted/30 rounded-lg p-4"
                data-testid={`stat-integrations-${i}`}
              >
                <div className="text-2xl font-bold text-primary mb-1">{item.stat}</div>
                <div className="text-xs text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="text-center max-w-2xl mx-auto mb-10">
            <h2 className="text-2xl font-bold mb-2">{INTEGRATIONS_DIRECTORY.heading}</h2>
            <p className="text-sm text-muted-foreground">{INTEGRATIONS_DIRECTORY.subheading}</p>
          </div>

          {/* Category Filter */}
          <div
            id="category-list"
            className="flex flex-wrap gap-2 justify-center mb-12"
            data-testid="filter-categories"
          >
            <button
              onClick={() => setSelectedCategory(null)}
              className={`text-sm font-medium px-4 py-2 rounded-full border transition-colors ${
                selectedCategory === null
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
              }`}
              data-testid="filter-all"
            >
              All Categories
            </button>
            {INTEGRATION_CATEGORIES.map((cat) => (
              <button
                key={cat.name}
                onClick={() => setSelectedCategory(cat.name)}
                className={`text-sm font-medium px-4 py-2 rounded-full border transition-colors ${
                  selectedCategory === cat.name
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                }`}
                data-testid={`filter-${cat.name.toLowerCase().replace(/\s/g, "-")}`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Integration Tiles by Category */}
          <div className="space-y-14">
            {grouped.map((cat) => (
              <div key={cat.name} data-testid={`section-category-${cat.name.toLowerCase().replace(/\s/g, "-")}`}>
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                    <cat.icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">{cat.name}</h2>
                    <p className="text-sm text-muted-foreground">{cat.description}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {cat.items.map((integration) => {
                    const Icon = CATEGORY_ICONS[integration.category];
                    return (
                      <Card
                        key={integration.id}
                        className="flex flex-col hover:shadow-md transition-shadow"
                        data-testid={`card-integration-${integration.id}`}
                      >
                        <CardContent className="p-5 flex flex-col flex-grow">
                          <div className="flex items-start justify-between gap-2 mb-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center shrink-0">
                                <Icon className="w-5 h-5 text-muted-foreground" />
                              </div>
                              <div>
                                <h3
                                  className="text-sm font-semibold text-foreground"
                                  data-testid={`text-integration-name-${integration.id}`}
                                >
                                  {integration.name}
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                  {integration.category}
                                </p>
                              </div>
                            </div>
                            <Badge
                              variant="secondary"
                              className="text-xs shrink-0"
                              data-testid={`badge-integration-state-${integration.id}`}
                            >
                              {COMPAT_STATE_LABEL[integration.state]}
                            </Badge>
                          </div>

                          <p
                            className="text-sm text-muted-foreground leading-relaxed mb-4 flex-grow"
                            data-testid={`text-integration-desc-${integration.id}`}
                          >
                            {integration.summary}
                          </p>

                          <div className="border-t border-border pt-3">
                            <div className="flex items-start gap-2 mb-3">
                              {showsActiveCheck(integration) ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                              ) : (
                                <CircleHelp className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                              )}
                              <p
                                className="text-xs text-muted-foreground"
                                data-testid={`text-integration-hardware-${integration.id}`}
                              >
                                <span className="font-medium text-foreground">
                                  {showsActiveCheck(integration) ? "Path: " : "We'll ask about: "}
                                </span>
                                {showsActiveCheck(integration) ? integration.path : integration.askAbout}
                              </p>
                            </div>

                            {integration.learnMoreUrl && (
                              <Link
                                href={integration.learnMoreUrl}
                                className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
                                data-testid={`link-integration-learn-${integration.id}`}
                              >
                                Learn more
                                <ExternalLink className="w-3 h-3" />
                              </Link>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Don't see your software? — Integration request form */}
        <section className="bg-muted/30 py-16" data-testid="section-not-listed">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-8">
              <Badge variant="secondary" className="mb-3" data-testid="badge-request-integration">
                Request an Integration
              </Badge>
              <h2
                className="text-2xl md:text-3xl font-bold mb-4"
                data-testid="text-not-listed-heading"
              >
                {INTEGRATIONS_REQUEST.heading}
              </h2>
              <p className="text-muted-foreground max-w-xl mx-auto">
                {INTEGRATIONS_REQUEST.sub}
              </p>
            </div>

            <Card data-testid="card-integration-request-form">
              <CardContent className="p-6 sm:p-8">
                {submitted ? (
                  <div className="text-center py-6" data-testid="status-request-success">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                    <h3 className="text-lg font-semibold mb-2">Thanks — we got your request</h3>
                    <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                      {INTEGRATIONS_REQUEST.successBody} <a href="tel:9542668214" className="text-primary hover:underline" onClick={() => trackPhoneCallClick({ sourcePage: "/integrations" })}>954-266-8214</a>.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => setSubmitted(false)}
                      data-testid="button-submit-another-request"
                    >
                      Submit another request
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleRequestSubmit} className="space-y-4" data-testid="form-integration-request">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="ir-software-name">Software name *</Label>
                        <Input
                          id="ir-software-name"
                          required
                          placeholder="e.g. Lightspeed Retail"
                          value={requestForm.softwareName}
                          onChange={(e) => setRequestForm({ ...requestForm, softwareName: e.target.value })}
                          data-testid="input-software-name"
                        />
                      </div>
                      <div>
                        <Label htmlFor="ir-software-category">Software category</Label>
                        <Input
                          id="ir-software-category"
                          placeholder="POS, EHR, booking, etc."
                          value={requestForm.softwareCategory}
                          onChange={(e) => setRequestForm({ ...requestForm, softwareCategory: e.target.value })}
                          data-testid="input-software-category"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="ir-contact-name">Your name *</Label>
                        <Input
                          id="ir-contact-name"
                          required
                          placeholder="Full name"
                          value={requestForm.contactName}
                          onChange={(e) => setRequestForm({ ...requestForm, contactName: e.target.value })}
                          data-testid="input-contact-name"
                        />
                      </div>
                      <div>
                        <Label htmlFor="ir-email">Email *</Label>
                        <Input
                          id="ir-email"
                          type="email"
                          required
                          placeholder="you@company.com"
                          value={requestForm.email}
                          onChange={(e) => setRequestForm({ ...requestForm, email: e.target.value })}
                          data-testid="input-email"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="ir-business-name">Business name</Label>
                        <Input
                          id="ir-business-name"
                          placeholder="Your business"
                          value={requestForm.businessName}
                          onChange={(e) => setRequestForm({ ...requestForm, businessName: e.target.value })}
                          data-testid="input-business-name"
                        />
                      </div>
                      <div>
                        <Label htmlFor="ir-phone">Phone</Label>
                        <Input
                          id="ir-phone"
                          type="tel"
                          placeholder="(optional)"
                          value={requestForm.phone}
                          onChange={(e) => setRequestForm({ ...requestForm, phone: e.target.value })}
                          data-testid="input-phone"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="ir-notes">How do you use it?</Label>
                      <Textarea
                        id="ir-notes"
                        rows={3}
                        placeholder="Tell us how the software fits into your business — checkout, scheduling, billing, reporting, etc."
                        value={requestForm.notes}
                        onChange={(e) => setRequestForm({ ...requestForm, notes: e.target.value })}
                        data-testid="input-notes"
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between pt-2">
                      <p className="text-xs text-muted-foreground">
                        We'll only use your info to reply about this request.
                      </p>
                      <Button
                        type="submit"
                        size="lg"
                        className="gap-2"
                        disabled={requestMutation.isPending}
                        data-testid="button-submit-integration-request"
                      >
                        <Send className="w-4 h-4" />
                        {requestMutation.isPending ? "Sending..." : "Request Integration"}
                      </Button>
                    </div>
                  </form>
                )}
              </CardContent>
            </Card>

            <div className="text-center mt-6">
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground" asChild>
                <Link href="/upload-statement" data-testid="link-not-listed-cta">
                  <Upload className="w-4 h-4" />
                  Or get a free statement analysis instead
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* How compatibility is confirmed */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-20" data-testid="section-compat-process">
          <h2 className="text-2xl font-bold text-center mb-8">{INTEGRATIONS_PROCESS.heading}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {INTEGRATIONS_PROCESS.steps.map((step, i) => (
              <Card key={step.title} data-testid={`card-compat-step-${i + 1}`}>
                <CardContent className="p-6">
                  <div className="text-sm font-semibold text-primary mb-2">Step {i + 1}</div>
                  <h3 className="text-lg font-bold mb-2 text-foreground">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center mt-10">
            <p className="text-muted-foreground max-w-xl mx-auto mb-4">{INTEGRATIONS_CTA.body}</p>
            <Button size="lg" className="gap-2" asChild>
              <Link href="/upload-statement" data-testid="link-vs-cta">
                <Upload className="w-4 h-4" />
                {INTEGRATIONS_HERO.primaryCta}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground mt-3">{INTEGRATIONS_PROCESS.footnote}</p>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
