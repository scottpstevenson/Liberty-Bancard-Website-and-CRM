import { SEO } from "@/components/SEO";
import { useLocation, Link } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { getStoredUTMParams } from "@/lib/utm";
import { trackEstimateRequest, trackFormSubmission } from "@/lib/tracking";
import { trackConversion as trackConversionV2 } from "@/lib/analytics";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { Loader2, Upload, ArrowRight, Calculator, TrendingDown, AlertCircle } from "lucide-react";
import heroAnalytics from "@assets/images/hero-analytics.jpg";
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
  consent: z.boolean().refine((val) => val === true, {
    message: "You must consent to receive communications",
  }),
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
      consent: false,
    },
  });

  const [submitError, setSubmitError] = useState<string | null>(null);

  function getFormErrorMessage(error: Error): string {
    const msg = error?.message || "";
    if (msg.startsWith("429:")) return "Too many submissions — please wait a few minutes and try again.";
    if (/^5\d{2}:/.test(msg)) return "Something went wrong on our end — please try again shortly.";
    return msg || "Please try again or call us at 954-266-8214.";
  }

  const submitMutation = useMutation({
    mutationFn: async (data: EstimateFormData) => {
      const refCode = localStorage.getItem("lb_ref_code") || undefined;
      const utmParams = getStoredUTMParams();
      const res = await apiRequest("POST", "/api/public/estimate", {
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        monthlyVolume: data.monthlyVolume,
        totalFees: data.totalFees,
        currentProvider: data.currentProvider || undefined,
        notes: data.notes || undefined,
        referralCode: refCode,
        ...utmParams,
      });
      return res.json();
    },
    onSuccess: () => {
      trackEstimateRequest();
      trackFormSubmission("estimate_request");
      trackConversionV2("estimate_request");
      setLocation("/thanks-estimate");
    },
    onError: (error: Error) => {
      setSubmitError(getFormErrorMessage(error));
    },
  });

  const onSubmit = (data: EstimateFormData) => {
    setSubmitError(null);
    submitMutation.mutate(data);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SEO title="Quick Estimate Request" description="Get a quick processing cost estimate. Provide your monthly volume and current fees for a preliminary analysis." path="/estimate" breadcrumbs={[{ name: "Quick Estimate", path: "/estimate" }]} />
      <Navbar />

      <main className="flex-grow pt-28" ref={containerRef}>
        <section className="relative overflow-hidden" data-testid="section-estimate-hero">
          <div className="absolute inset-0">
            <img src={heroAnalytics} alt="Business analytics and payment processing rate comparison dashboard" className="w-full h-full object-cover" width="1408" height="792" />
            <div className="absolute inset-0 bg-gradient-to-r from-[hsl(222,47%,6%)/0.97] via-[hsl(222,47%,6%)/0.93] to-[hsl(222,47%,6%)/0.85]" />
          </div>
          <div className="glow-blob w-64 h-64 bg-sky-500 top-10 right-1/4" />
          <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28 text-center">
            <h1
              className="reveal text-4xl md:text-5xl font-display font-bold text-white leading-tight mb-6"
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
              className="reveal reveal-delay-2 inline-block text-sm font-medium text-sky-400 hover:underline"
              data-testid="link-upload-instead"
            >
              Upload a Statement Instead
            </Link>
          </div>
        </section>

        <section className="bg-muted py-20" data-testid="section-estimate-form">
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

                    <FormField
                      control={form.control}
                      name="consent"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start gap-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-consent"
                            />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="text-sm font-normal text-muted-foreground">
                              I consent to receive text/email communications from Liberty Bancard.
                            </FormLabel>
                            <FormMessage />
                          </div>
                        </FormItem>
                      )}
                    />

                    {submitError && (
                      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3" data-testid="alert-submit-error" role="alert">
                        <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                        <p className="text-sm text-destructive">{submitError}</p>
                      </div>
                    )}

                    <Button
                      type="submit"
                      className="w-full cta-pulse"
                      disabled={submitMutation.isPending}
                      data-testid="button-estimate-submit"
                    >
                      {submitMutation.isPending ? (
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

        <section className="bg-background bg-grid py-20" data-testid="section-effective-rate-education">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal">
              <h2
                className="text-3xl md:text-4xl font-display font-bold text-foreground mb-8"
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
              <Link href="/upload-statement" data-testid="link-education-upload-statement">
                <Button className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Statement (Exact Breakdown)
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
