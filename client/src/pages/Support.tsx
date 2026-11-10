import { SEO } from "@/components/SEO";
import { useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { trackConversion } from "@/lib/analytics";
import { usePublicIntake } from "@/hooks/use-public-intake";
import { SavedIntakeConfirmation } from "@/components/intake/SavedIntakeConfirmation";
import { PublicIntakeNotice } from "@/components/PublicIntakeNotice";
import { isPlausibleInquiryPhone } from "@shared/public-inquiry";
import { useState } from "react";
import {
  Loader2,
  Hash,
  Users,
  Phone,
  AlertCircle,
} from "lucide-react";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

const supportSchema = z.object({
  name: z.string().trim().min(1, "Your name is required"),
  businessName: z.string().trim().min(1, "Business name is required"),
  email: z.string().trim().email("Valid email is required"),
  // Optional: a phone number is never required to get help. A non-blank value must be a real number.
  mobile: z.string().trim().refine((v) => v === "" || isPlausibleInquiryPhone(v), "Enter a valid phone number, or leave it blank"),
  issueType: z.string().min(1, "Please select an issue type"),
  priority: z.string().min(1, "Please select a priority"),
  message: z.string().trim().min(1, "Please describe your issue"),
});

type SupportFormData = z.infer<typeof supportSchema>;

export default function Support() {
  const [, setLocation] = useLocation();
  const containerRef = useScrollReveal();

  const form = useForm<SupportFormData>({
    resolver: zodResolver(supportSchema),
    defaultValues: {
      name: "",
      businessName: "",
      email: "",
      mobile: "",
      issueType: "",
      priority: "Normal",
      message: "",
    },
  });

  // One stable intent per request: the shared hook owns the idempotency key, the typed outcome and the saved receipt.
  const intake = usePublicIntake("support", "/api/public/support");

  const buildPayload = (data: SupportFormData) => ({
    name: data.name,
    businessName: data.businessName,
    email: data.email,
    // A blank number is omitted, never sent as an empty or placeholder value.
    ...(data.mobile ? { mobile: data.mobile } : {}),
    issueType: data.issueType,
    priority: data.priority,
    message: data.message,
  });

  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (data: SupportFormData) => {
    setSubmitError(null);
    const outcome = await intake.submit(buildPayload(data));
    if (outcome.kind === "saved") {
      // Conversion and the confirmation page follow ONLY a confirmed save (never a 202, an unreadable body or a failure), and the
      // conversion is recorded once per saved request: a replay of the same confirmed request is not a second conversion.
      if (outcome.fresh !== false) trackConversion("support_request", { issue_type: data.issueType, priority: data.priority });
      const reference = outcome.receipt.replace(/-/g, "").slice(0, 8).toUpperCase();
      setLocation(`/thanks-support?ref=${reference}`);
    } else if (outcome.kind === "rejected") {
      for (const [path, message] of Object.entries(outcome.fieldErrors ?? {})) {
        if (path in data) form.setError(path as keyof SupportFormData, { message });
      }
      setSubmitError("We couldn't send your request. Please check your details and try again. If the problem continues, call 954-266-8214.");
    }
  };

  const issueTypes = [
    "Funding / Deposits",
    "Terminal",
    "Chargeback / Dispute",
    "PCI Compliance",
    "Other",
  ];

  const priorities = ["Normal", "Urgent"];

  const expectItems = [
    {
      icon: Hash,
      title: "A reference when it's saved",
      text: "When your request is saved you'll see a reference. Keep it if you call us about this request.",
    },
    {
      icon: Users,
      title: "Reviewed by our team",
      text: "A member of our team reviews each request and follows up using the contact details you give us.",
    },
    {
      icon: Phone,
      title: "Terminal completely down?",
      text: "If you can't take payments at all, call 954-266-8214 instead of waiting on a form.",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO title="Contact Support" description="Existing merchants can send a support request about deposits, terminals, chargebacks or PCI, or call 954-266-8214 or email support@libertybancard.com." path="/support" breadcrumbs={[{ name: "Support", path: "/support" }]} />
      <Navbar />

      <main className="flex-grow public-main-offset" ref={containerRef}>
        <section className="relative overflow-hidden" data-testid="section-support-hero">
          <div className="absolute inset-0 bg-gradient-to-r from-[hsl(222_47%_6%)] via-[hsl(222_47%_7%)] to-[hsl(222_47%_9%)]" aria-hidden="true" />
          <div className="glow-blob w-64 h-64 bg-sky-500 top-10 right-1/4" />
          <div className="glow-blob glow-blob-2 w-48 h-48 bg-blue-600 bottom-10 left-1/6" />
          <div className="public-container relative py-10 lg:py-20">
            <div className="max-w-3xl mx-auto text-center">
              <h1
                className="public-h1 public-h1--page font-bold text-white mb-4"
                data-testid="text-support-heading"
              >
                Get Help From a <span className="text-sky-400">Real Person</span>
              </h1>
              <p
                className="text-lg text-white/70 max-w-xl mx-auto"
                data-testid="text-support-subheadline"
              >
                Terminal issues, deposit questions, chargeback deadlines, PCI compliance - we're here.
              </p>
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-10 pb-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal">
              <Card data-testid="card-support-form">
                <CardContent className="pt-6">
                  <h2
                    className="text-2xl font-bold text-foreground mb-6"
                    data-testid="text-support-form-title"
                  >
                    Submit a Support Request
                  </h2>
                  {intake.state.phase === "saved" ? (
                    <SavedIntakeConfirmation
                      receipt={intake.state.receipt}
                      pendingReview={intake.state.pendingReview}
                      testIdPrefix="support"
                      startLabel="Send another request"
                      onStartNew={() => { form.reset(); setSubmitError(null); intake.acknowledgeSaved(); }}
                    />
                  ) : (
                  <Form {...form}>
                    <form
                      onSubmit={form.handleSubmit(onSubmit)}
                      className="space-y-6"
                      data-testid="form-support"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Your Name</FormLabel>
                              <FormControl>
                                <Input
                                  className="public-form-field"
                                  placeholder="Your full name"
                                  data-testid="input-name"
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
                                  className="public-form-field"
                                  placeholder="Your business name"
                                  data-testid="input-business-name"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Email</FormLabel>
                              <FormControl>
                                <Input
                                  className="public-form-field"
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
                          name="mobile"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Phone (optional)</FormLabel>
                              <FormControl>
                                <Input
                                  className="public-form-field"
                                  type="tel"
                                  placeholder="(555) 123-4567"
                                  data-testid="input-mobile"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="issueType"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Issue Type</FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger className="public-form-field" data-testid="select-issue-type">
                                    <SelectValue placeholder="Select issue type" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {issueTypes.map((type) => (
                                    <SelectItem
                                      key={type}
                                      value={type}
                                      data-testid={`select-item-${type.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                                    >
                                      {type}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        <FormField
                          control={form.control}
                          name="priority"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Priority</FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger className="public-form-field" data-testid="select-priority">
                                    <SelectValue placeholder="Select priority" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {priorities.map((p) => (
                                    <SelectItem
                                      key={p}
                                      value={p}
                                      data-testid={`select-item-${p.toLowerCase()}`}
                                    >
                                      {p}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="message"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Describe your issue</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Tell us what's going on..."
                                className="resize-none"
                                rows={5}
                                data-testid="textarea-message"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <p className="text-sm text-muted-foreground" data-testid="text-support-sensitive-note">
                        Please don&apos;t include full card numbers or bank login details here. To share a processing statement, use the{" "}
                        <a href="/upload-statement#statement-review-form" className="underline" data-testid="link-support-statement-upload">secure statement upload</a>.
                      </p>

                      <PublicIntakeNotice
                        state={intake.state}
                        testIdPrefix="support"
                        checking={intake.checking}
                        checkNote={intake.checkNote}
                        onCheck={intake.check}
                        onRetry={() => { void form.handleSubmit(onSubmit)(); }}
                        onDismiss={intake.dismiss}
                      />

                      {submitError && (
                        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3" data-testid="alert-submit-error" role="alert">
                          <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                          <p className="text-sm text-destructive">{submitError}</p>
                        </div>
                      )}

                      <Button
                        type="submit"
                        className="public-form-action w-full"
                        disabled={intake.submitting}
                        data-testid="button-support-submit"
                      >
                        {intake.submitting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            Sending your request…
                          </>
                        ) : (
                          "Submit Support Request"
                        )}
                      </Button>
                    </form>
                  </Form>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="bg-background py-10" data-testid="section-what-happens-after">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="reveal">
              <h2
                className="text-2xl font-bold text-foreground text-center mb-10"
                data-testid="text-what-happens-after"
              >
                What Happens After You Submit
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {expectItems.map((item, index) => (
                <Card
                  key={item.text}
                  className={`reveal reveal-delay-${index + 1}`}
                  data-testid={`expect-item-${item.text.substring(0, 20).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  <CardContent className="pt-6 text-center">
                    <div className="w-12 h-12 rounded-md bg-sky-500/10 flex items-center justify-center mx-auto mb-4">
                      <item.icon className="w-6 h-6 text-sky-500" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">{item.title}</h3>
                    <p className="text-muted-foreground text-sm">{item.text}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
