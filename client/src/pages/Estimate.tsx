import { SEO } from "@/components/SEO";
import { useLocation, Link } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { getStoredUTMParams } from "@/lib/utm";
import { trackEstimateRequest, trackFormSubmission } from "@/lib/tracking";
import { trackConversion as trackConversionV2 } from "@/lib/analytics";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PewcCheckbox } from "@/components/PewcCheckbox";
import { EmailMarketingCheckbox, emailConsentNotice, emailConsentPayload } from "@/components/EmailMarketingCheckbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { usePublicIntake } from "@/hooks/use-public-intake";
import { PublicIntakeNotice } from "@/components/PublicIntakeNotice";
import { useState } from "react";
import { Loader2, Upload, ArrowRight, Calculator, TrendingDown, AlertCircle } from "lucide-react";
import heroAnalytics from "@/assets/images/hero-analytics.jpg";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";


const estimateSchema = z.object({
  contactName: z.string().min(1, "Your name is required"),
  businessName: z.string().min(1, "Business name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(10, "Valid mobile number is required"),
  vertical: z.string().min(1, "Industry / Vertical is required"),
  monthlyVolume: z.string().min(1, "Monthly processing volume is required"),
  totalFees: z.string().min(1, "Total processing fees is required"),
  currentProvider: z.string().optional(),
  notes: z.string().optional(),
  pewcConsent: z.boolean().optional().default(false),
  emailMarketing: z.boolean().optional().default(false),
});

type EstimateFormData = z.infer<typeof estimateSchema>;

const verticals = [
  "Medical/Dental/Medspa",
  "Automotive",
  "Restaurant",
  "Home Services",
  "Retail",
  "Other",
];

export default function Estimate() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const containerRef = useScrollReveal();

  const form = useForm<EstimateFormData>({
    resolver: zodResolver(estimateSchema),
    defaultValues: {
      contactName: "",
      businessName: "",
      email: "",
      phone: "",
      vertical: "",
      monthlyVolume: "",
      totalFees: "",
      currentProvider: "",
      notes: "",
      pewcConsent: false,
      emailMarketing: false,
    },
  });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const intake = usePublicIntake("estimate", "/api/public/estimate");

  const buildPayload = (data: EstimateFormData) => {
    const refCode = localStorage.getItem("lb_ref_code") || undefined;
    return {
      contactName: data.contactName,
      businessName: data.businessName,
      email: data.email,
      phone: data.phone,
      vertical: data.vertical,
      monthlyVolume: data.monthlyVolume,
      totalFees: data.totalFees,
      currentProvider: data.currentProvider || undefined,
      notes: data.notes || undefined,
      pewcConsent: data.pewcConsent ?? false,
      ...emailConsentPayload("estimate_form", data.emailMarketing === true),
      referralCode: refCode,
      ...getStoredUTMParams(),
    };
  };

  const onSubmit = async (data: EstimateFormData) => {
    setSubmitError(null);
    // Conversions and the thank-you page follow ONLY a confirmed save. A recoverable (202), unreadable or failed
    // response keeps the same intent/key and shows the truthful pending notice instead.
    const outcome = await intake.submit(buildPayload(data));
    if (outcome.kind === "saved") {
      const consentNotice = emailConsentNotice(outcome.emailConsent, data.emailMarketing === true);
      if (consentNotice) toast({ title: "Request saved", description: consentNotice });
      trackEstimateRequest();
      trackFormSubmission("estimate_request");
      trackConversionV2("estimate_request");
      setLocation("/thanks-estimate");
    } else if (outcome.kind === "rejected") {
      setSubmitError(outcome.message);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SEO title="Free Effective Rate Estimate" description="Get a quick processing cost estimate. Provide your monthly volume and current fees for a preliminary analysis and next steps." path="/estimate" breadcrumbs={[{ name: "Quick Estimate", path: "/estimate" }]} />
      <Navbar />

      <main className="flex-grow public-main-offset" ref={containerRef}>
        <section className="relative overflow-hidden" data-testid="section-estimate-hero">
          <div className="absolute inset-0">
            <img src={heroAnalytics} alt="Business analytics and payment processing rate comparison dashboard" className="w-full h-full object-cover" width="1408" height="792" />
            <div className="absolute inset-0 bg-gradient-to-r from-[hsl(222_47%_6%/0.97)] via-[hsl(222_47%_6%/0.93)] to-[hsl(222_47%_6%/0.85)]" />
          </div>
          <div className="glow-blob w-64 h-64 bg-sky-500 top-10 right-1/4" />
          <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-20 text-center">
            <h1
              className="public-h1 public-h1--page reveal font-display font-bold text-white mb-6"
              data-testid="text-estimate-heading"
            >
              Get a Fast <span className="text-sky-400">Effective Rate</span> Estimate
            </h1>
            <p
              className="reveal reveal-delay-1 text-lg text-white/70 leading-relaxed mb-6"
              data-testid="text-estimate-subheadline"
            >
              Share monthly volume and total fees. We'll estimate your effective rate and recommend next steps. For a definitive comparison, upload a statement anytime.
            </p>
            <Link
              href="/upload-statement"
              className="public-hit reveal reveal-delay-2 inline-block text-sm font-medium text-sky-400 hover:underline"
              data-testid="link-upload-instead"
            >
              Upload a Statement Instead
            </Link>
          </div>
        </section>

        <section className="bg-muted py-10" data-testid="section-estimate-form">
          <div className="reveal max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
            <Card data-testid="card-estimate-form">
              <CardHeader>
                <CardTitle data-testid="text-estimate-form-title">
                  Get My Estimate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-6"
                    data-testid="form-estimate"
                  >
                    <FormField
                      control={form.control}
                      name="contactName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Your Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Full name"
                              data-testid="input-contact-name"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="businessName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Business Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Your business name"
                              data-testid="input-business-name"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input
                                type="email"
                                placeholder="you@business.com"
                                data-testid="input-email"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Mobile Number</FormLabel>
                            <FormControl>
                              <Input
                                type="tel"
                                placeholder="(555) 123-4567"
                                data-testid="input-phone"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="vertical"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Industry / Vertical</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-vertical">
                                <SelectValue placeholder="Select your industry" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {verticals.map((v) => (
                                <SelectItem key={v} value={v} data-testid={`select-vertical-${v.toLowerCase().replace(/[^a-z]/g, "-")}`}>
                                  {v}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="monthlyVolume"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Monthly Processing Volume ($)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="e.g. 18000"
                                data-testid="input-monthly-volume"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="totalFees"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Total Processing Fees ($)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                placeholder="e.g. 450"
                                data-testid="input-total-fees"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="currentProvider"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Current Provider (optional)</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g. Square, Stripe, Clover"
                              data-testid="input-current-provider"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Anything you want us to focus on? (optional)</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Any additional details..."
                              className="resize-none"
                              rows={3}
                              data-testid="textarea-notes"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <PewcCheckbox
                      checked={form.watch("pewcConsent") ?? false}
                      onCheckedChange={(val) => form.setValue("pewcConsent", val)}
                    />

                    <EmailMarketingCheckbox
                      surface="estimate_form"
                      checked={form.watch("emailMarketing") ?? false}
                      onCheckedChange={(val) => form.setValue("emailMarketing", val)}
                    />

                    {submitError && (
                      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3" data-testid="alert-submit-error" role="alert">
                        <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                        <p className="text-sm text-destructive">{submitError}</p>
                      </div>
                    )}

                    <PublicIntakeNotice
                      state={intake.state}
                      testIdPrefix="estimate-intake"
                      checking={intake.checking}
                      checkNote={intake.checkNote}
                      onCheck={intake.check}
                      onRetry={intake.state.phase !== "idle" && "restored" in intake.state && intake.state.restored ? undefined : form.handleSubmit(onSubmit)}
                      onDismiss={intake.dismiss}
                    />

                    <Button
                      type="submit"
                      className="w-full cta-pulse"
                      disabled={intake.submitting}
                      data-testid="button-estimate-submit"
                    >
                      {intake.submitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Submitting...
                        </>
                      ) : (
                        "Get My Estimate"
                      )}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="bg-background py-10" data-testid="section-effective-rate-education">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal">
              <h2
                className="public-h2 font-display font-bold text-foreground mb-8"
                data-testid="text-effective-rate-heading"
              >
                What Is an Effective Rate?
              </h2>
            </div>

            <div className="reveal reveal-delay-1">
              <Card className="mb-8 border-sky-500/20 bg-gradient-to-br from-sky-50 to-background dark:from-sky-950/30 dark:to-background">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-md bg-sky-500/10 flex items-center justify-center">
                      <Calculator className="w-5 h-5 text-sky-500" />
                    </div>
                    <div className="space-y-3">
                      <p className="text-muted-foreground" data-testid="text-effective-rate-intro">
                        Your effective rate is the simplest reality check:
                      </p>
                      <p className="text-lg font-display font-bold text-foreground" data-testid="text-effective-rate-formula">
                        Effective Rate = Total Fees &divide; Total Volume
                      </p>
                      <div className="flex items-center gap-2 text-sm">
                        <TrendingDown className="w-4 h-4 text-sky-500" />
                        <p className="text-muted-foreground" data-testid="text-effective-rate-example">
                          Example: $450 in fees on $18,000 volume = <span className="font-semibold text-foreground">2.5% effective rate</span>
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="reveal reveal-delay-2">
              <p
                className="text-sm text-muted-foreground mb-6"
                data-testid="text-effective-rate-microcopy"
              >
                For the exact line-item breakdown (and to identify the cost drivers), upload a statement.
              </p>
              <Button className="gap-2" asChild>
                <Link href="/upload-statement" data-testid="link-education-upload-statement">
                  <Upload className="w-4 h-4" />
                  Upload Statement (Exact Breakdown)
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
