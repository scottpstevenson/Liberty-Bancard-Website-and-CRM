import { useEffect, useState } from "react";
import { getCsrfToken } from "@/lib/queryClient";
import { SEO, getServiceSchema } from "@/components/SEO";
import { useLocation, Link } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { trackStatementUpload, trackFormSubmission } from "@/lib/tracking";
import { CALENDAR_URL } from "@/lib/constants";
import { trackConversion } from "@/lib/analytics";
import { getStoredUTMParams } from "@/lib/utm";
import {
  FileSearch,
  ShieldCheck,
  Clock,
  Lock,
  Calendar,
  Loader2,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import imgCloverFlex3 from "@assets/images/terminal-clover-flex-3.png";
import heroSecure from "@assets/images/hero-secure.jpg";

const uploadSchema = z.object({
  businessName: z.string().min(1, "Business name is required"),
  contactName: z.string().min(1, "Your name is required"),
  email: z.string().email("Valid email is required"),
  mobile: z.string().min(10, "Valid mobile number is required"),
  vertical: z.string().min(1, "Please select an industry"),
  fileName: z.string().optional(),
  currentProvider: z.string().optional(),
  interestedIn0Percent: z.boolean().default(false),
  needTerminal: z.boolean().default(false),
  notes: z.string().optional(),
  consentSms: z.boolean().refine((v) => v === true, {
    message: "You must consent to receive communications",
  }),
});

type UploadFormData = z.infer<typeof uploadSchema>;

export default function UploadStatement() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const containerRef = useScrollReveal();
  const [analysisResult, setAnalysisResult] = useState<{
    effectiveRate?: string;
    recommendedPath?: string;
    keyFindings?: string[];
    overallAssessment?: string;
    [key: string]: unknown;
  } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisVolume, setAnalysisVolume] = useState("");
  const [analysisRate, setAnalysisRate] = useState("");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState(false);
  const [processingStep, setProcessingStep] = useState<number>(0);
  const [analysisVertical, setAnalysisVertical] = useState("");
  const [uploadSucceeded, setUploadSucceeded] = useState(false);

  const PROCESSING_STEPS = [
    "Uploading your statement…",
    "Securing your file…",
    "Creating your deal record…",
    "Queuing AI analysis…",
    "Notifying your advisor…",
    "Almost done…",
  ];

  const params = new URLSearchParams(window.location.search);
  const preTerminal = params.get("terminal") === "yes";
  const preInterest0 = params.get("interest0") === "yes";

  const { data: authUser } = useQuery<{ email?: string; firstName?: string; lastName?: string; id?: string } | null>({
    queryKey: ["/api/auth/user"],
    queryFn: async () => {
      const res = await fetch("/api/auth/user", { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data: merchantProfile } = useQuery<{ businessName?: string | null; contactId?: number } | null>({
    queryKey: ["/api/merchant-profile"],
    queryFn: async () => {
      const res = await fetch("/api/merchant-profile", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!authUser,
    staleTime: 1000 * 60 * 5,
  });

  const form = useForm<UploadFormData>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      businessName: "",
      contactName: "",
      email: "",
      mobile: "",
      vertical: "",
      fileName: "",
      currentProvider: "",
      interestedIn0Percent: preInterest0,
      needTerminal: preTerminal,
      notes: "",
      consentSms: false,
    },
  });

  useEffect(() => {
    if (preTerminal) form.setValue("needTerminal", true);
    if (preInterest0) form.setValue("interestedIn0Percent", true);
  }, [preTerminal, preInterest0, form]);

  useEffect(() => {
    if (authUser) {
      const fullName = [authUser.firstName, authUser.lastName].filter(Boolean).join(" ");
      if (fullName && !form.getValues("contactName")) {
        form.setValue("contactName", fullName);
      }
      if (authUser.email && !form.getValues("email")) {
        form.setValue("email", authUser.email);
      }
    }
  }, [authUser, form]);

  useEffect(() => {
    if (merchantProfile?.businessName && !form.getValues("businessName")) {
      form.setValue("businessName", merchantProfile.businessName);
    }
  }, [merchantProfile, form]);

  const ANALYSIS_VERTICALS: { label: string; slug: string }[] = [
    { label: "Medical / Med Spa", slug: "med_spa" },
    { label: "Dental", slug: "dental" },
    { label: "Auto Repair", slug: "auto_repair" },
    { label: "Salon / Beauty", slug: "salon" },
    { label: "Gym / Fitness", slug: "gym" },
    { label: "Hotel / Lodging", slug: "hotel" },
    { label: "Landscaping", slug: "landscaping" },
    { label: "Construction", slug: "construction" },
    { label: "Legal", slug: "legal" },
  ];

  const FORM_TO_ANALYSIS_SLUG: Record<string, string> = {
    "Medical/Dental/Medspa": "med_spa",
    "Automotive": "auto_repair",
  };

  const formVerticalValue = form.watch("vertical");
  useEffect(() => {
    if (formVerticalValue && !analysisVertical) {
      const mapped = FORM_TO_ANALYSIS_SLUG[formVerticalValue];
      if (mapped) setAnalysisVertical(mapped);
    }
  }, [formVerticalValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitMutation = useMutation({
    mutationFn: (data: UploadFormData) => {
      const refCode = localStorage.getItem("lb_ref_code") || undefined;
      const utmParams = getStoredUTMParams();
      const formData = new FormData();
      formData.append("businessName", data.businessName);
      formData.append("contactName", data.contactName);
      formData.append("email", data.email);
      formData.append("mobile", data.mobile);
      formData.append("vertical", data.vertical);
      if (data.currentProvider) formData.append("currentProvider", data.currentProvider);
      formData.append("interestedIn0Percent", String(data.interestedIn0Percent));
      formData.append("needTerminal", String(data.needTerminal));
      if (data.notes) formData.append("notes", data.notes);
      formData.append("consentSms", String(data.consentSms));
      if (refCode) formData.append("referralCode", refCode);
      Object.entries(utmParams).forEach(([key, value]) => {
        if (value) formData.append(key, String(value));
      });
      if (selectedFile) {
        formData.append("statementFile", selectedFile);
      }

      return new Promise<unknown>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.withCredentials = true;
        xhr.open("POST", "/api/public/statement-upload");

        setIsUploading(true);
        setUploadProgress(0);
        setProcessingStep(0);

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadProgress(100);
            // Simulate server-side processing steps so the merchant sees meaningful feedback
            let step = 1;
            setProcessingStep(step);
            const stepInterval = setInterval(() => {
              step += 1;
              setProcessingStep(step);
              if (step >= 6) {
                clearInterval(stepInterval);
                setIsUploading(false);
                try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
              }
            }, 650);
          } else {
            setIsUploading(false);
            let message = "Upload failed";
            try {
              const body = JSON.parse(xhr.responseText);
              message = body.message || message;
            } catch { /* ignore */ }
            reject(new Error(`${xhr.status}: ${message}`));
          }
        });

        xhr.addEventListener("error", () => {
          setIsUploading(false);
          reject(new Error("Network error — please check your connection and try again."));
        });

        xhr.addEventListener("abort", () => {
          setIsUploading(false);
          reject(new Error("Upload was cancelled."));
        });

        xhr.send(formData);
      });
    },
    onSuccess: () => {
      trackStatementUpload();
      trackFormSubmission("statement_upload");
      trackConversion("statement_upload");
      setUploadSucceeded(true);
    },
    onError: (error: Error) => {
      setUploadProgress(0);
      const msg = error?.message || "";
      if (msg.startsWith("429:")) {
        setSubmitError("Too many submissions — please wait a few minutes and try again.");
      } else if (/^5\d{2}:/.test(msg)) {
        setSubmitError("Something went wrong on our end — please try again shortly.");
      } else {
        setSubmitError(msg.replace(/^\d{3}:\s*/, "") || "Please try again or call us at 954-266-8214.");
      }
    },
  });

  const onSubmit = (data: UploadFormData) => {
    setSubmitError(null);
    submitMutation.mutate(data);
  };

  const handleAnalysis = async () => {
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const analysisHeaders: Record<string, string> = { "Content-Type": "application/json" };
      const csrfAnalysis = getCsrfToken();
      if (csrfAnalysis) analysisHeaders["X-CSRF-Token"] = csrfAnalysis;
      const res = await fetch("/api/ai/analyze-statement", {
        method: "POST",
        headers: analysisHeaders,
        credentials: "include",
        body: JSON.stringify({
          statementData: `Monthly volume: $${analysisVolume}, Current effective rate: ${analysisRate}%, Processor type: unknown`,
          ...(analysisVertical ? { vertical: analysisVertical } : {}),
        }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Please log in to use the AI analysis feature.");
        }
        throw new Error("Analysis failed. Please try again.");
      }
      const data = await res.json();
      setAnalysisResult(data);
    } catch (err: any) {
      console.error(err);
      setAnalysisError(err.message || "Analysis failed. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  };

  const verticals = [
    "Medical/Dental/Medspa",
    "Automotive",
    "Restaurant",
    "Home Services",
    "Retail",
    "Other",
  ];

  const trustBullets = [
    {
      icon: FileSearch,
      text: "Written breakdown you keep",
    },
    {
      icon: ShieldCheck,
      text: "Proof-first, no pressure",
    },
    {
      icon: Clock,
      text: "Fast turnaround during business hours",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SEO title="Upload Your Processing Statement" description="Upload your merchant processing statement for a free, no-obligation rate analysis. See exactly where your fees are going." path="/upload-statement" keywords="upload processing statement, free statement review, merchant fee analysis" breadcrumbs={[{ name: "Upload Statement", path: "/upload-statement" }]} structuredData={[getServiceSchema("Free Statement Review", "Upload your merchant processing statement for a free, no-obligation rate analysis.", "/upload-statement")]} />
      <Navbar />

      <main className="flex-grow pt-28" ref={containerRef}>
        <section className="relative overflow-hidden" data-testid="section-upload-hero">
          <div className="absolute inset-0">
            <img src={heroSecure} alt="Secure payment statement analysis and digital security" className="w-full h-full object-cover" width="1408" height="792" />
            <div className="absolute inset-0 bg-gradient-to-r from-[hsl(222,47%,6%)/0.97] via-[hsl(222,47%,6%)/0.93] to-[hsl(222,47%,6%)/0.85]" />
          </div>
          <div className="glow-blob w-64 h-64 bg-sky-500 top-10 right-1/4" />
          <div className="glow-blob glow-blob-2 w-48 h-48 bg-blue-600 bottom-10 left-1/4" />
          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
            <div className="text-center mb-10 reveal">
              <h1
                className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4"
                data-testid="text-upload-heading"
              >
                Upload Your Statement (<span className="text-sky-400">Secure</span>)
              </h1>
              <p
                className="text-lg text-white/70 max-w-2xl mx-auto mb-10"
                data-testid="text-upload-subheadline"
              >
                PDF or photo. Redact account numbers if you want - totals + fee lines are all we need.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 reveal reveal-delay-1">
                {trustBullets.map((bullet) => (
                  <div
                    key={bullet.text}
                    className="glass-dark rounded-md px-4 py-3 flex items-center gap-3 justify-center"
                    data-testid={`trust-bullet-${bullet.text.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  >
                    <bullet.icon className="w-5 h-5 text-sky-400 shrink-0" />
                    <span className="text-sm text-white/80">{bullet.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-muted/30 bg-dots py-12">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 reveal">
            <Card data-testid="card-upload-form">
              <CardContent className="pt-6">
                {uploadSucceeded ? (
                  <div className="text-center py-10 space-y-5" data-testid="section-upload-success">
                    <CheckCircle2 className="h-14 w-14 text-green-500 mx-auto" />
                    <div>
                      <h2 className="text-2xl font-bold text-foreground mb-2" data-testid="text-success-heading">
                        Statement Received!
                      </h2>
                      <p className="text-muted-foreground max-w-md mx-auto">
                        We've got your statement and our AI is analyzing it now. A team member will follow up with your personalized savings report — typically within 1 business day.
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span data-testid="text-analyzing">Analyzing your statement…</span>
                    </div>
                    <div className="pt-2">
                      <Button asChild variant="outline" data-testid="button-view-portal">
                        <Link href="/merchant-portal">View My Portal</Link>
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2
                      className="text-2xl font-bold text-foreground mb-6"
                      data-testid="text-form-title"
                    >
                      Submit Your Statement for Review
                    </h2>

                    <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(onSubmit)}
                    className="space-y-6"
                    data-testid="form-upload-statement"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

                      <FormField
                        control={form.control}
                        name="contactName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Your Name</FormLabel>
                            <FormControl>
                              <Input
                                placeholder="Your full name"
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
                        name="mobile"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Mobile Number</FormLabel>
                            <FormControl>
                              <Input
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
                                <SelectItem
                                  key={v}
                                  value={v}
                                  data-testid={`select-item-${v.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                                >
                                  {v}
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
                      name="fileName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Upload Statement (PDF or Photo)</FormLabel>
                          <FormControl>
                            <Input
                              type="file"
                              accept=".pdf,.png,.jpg,.jpeg"
                              data-testid="input-file"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                field.onChange(file?.name || "");
                                setSelectedFile(file || null);
                              }}
                            />
                          </FormControl>
                          <div className="flex items-center gap-1.5 mt-1">
                            <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                            <span
                              className="text-xs text-muted-foreground"
                              data-testid="text-secure-upload"
                            >
                              Secure upload
                            </span>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

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
                      name="interestedIn0Percent"
                      render={({ field }) => (
                        <FormItem className="flex items-start gap-3">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-interested-0-percent"
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal">
                            Interested in a compliant 0% program? (optional)
                          </FormLabel>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="needTerminal"
                      render={({ field }) => (
                        <FormItem className="flex items-start gap-3">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-need-terminal"
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal">
                            Do you need a terminal? (optional)
                          </FormLabel>
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
                              placeholder="Tell us what matters most to you"
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
                      name="consentSms"
                      render={({ field }) => (
                        <FormItem className="flex items-start gap-3">
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

                    {isUploading && (
                      <div className="space-y-3" data-testid="upload-progress-container" role="status" aria-label="Upload in progress">
                        {/* Phase 1: uploading bytes */}
                        {uploadProgress < 100 && (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span className="flex items-center gap-1.5">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                                {PROCESSING_STEPS[0]}
                              </span>
                              <span data-testid="text-upload-progress-percent">{uploadProgress}%</span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-muted overflow-hidden" data-testid="upload-progress-bar-track">
                              <div
                                className="h-full rounded-full bg-primary transition-all duration-200"
                                style={{ width: `${uploadProgress}%` }}
                                data-testid="upload-progress-bar-fill"
                              />
                            </div>
                          </div>
                        )}
                        {/* Phase 2: processing steps (after bytes are uploaded) */}
                        {uploadProgress >= 100 && (
                          <div className="space-y-1.5" data-testid="upload-processing-steps">
                            {PROCESSING_STEPS.slice(1).map((label, idx) => {
                              const stepNum = idx + 1;
                              const done = processingStep > stepNum;
                              const active = processingStep === stepNum;
                              return (
                                <div
                                  key={label}
                                  className={`flex items-center gap-2 text-xs transition-all duration-300 ${done ? "text-green-600 dark:text-green-400" : active ? "text-primary" : "text-muted-foreground opacity-50"}`}
                                  data-testid={`step-processing-${stepNum}`}
                                >
                                  {done ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  ) : active ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                  ) : (
                                    <span className="w-3.5 h-3.5 shrink-0 rounded-full border border-muted-foreground/30 inline-block" />
                                  )}
                                  {label}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={submitMutation.isPending || isUploading}
                      data-testid="button-upload-submit"
                    >
                      {submitMutation.isPending || isUploading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          {isUploading ? "Uploading…" : "Submitting…"}
                        </>
                      ) : (
                        "Upload My Statement"
                      )}
                    </Button>
                  </form>
                </Form>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="mt-6" data-testid="card-ai-analysis">
              <CardHeader>
                <CardTitle className="text-lg">AI Statement Analysis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Enter your monthly processing volume and current effective rate for an instant AI-powered analysis of your fees.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Monthly Volume ($)</Label>
                    <Input placeholder="e.g. 50000" data-testid="input-analysis-volume" value={analysisVolume} onChange={e => setAnalysisVolume(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Current Effective Rate (%)</Label>
                    <Input placeholder="e.g. 3.2" data-testid="input-analysis-rate" value={analysisRate} onChange={e => setAnalysisRate(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Industry / Vertical <span className="text-muted-foreground font-normal">(optional — unlocks tailored output)</span></Label>
                  <Select
                    value={analysisVertical || "_none"}
                    onValueChange={(v) => setAnalysisVertical(v === "_none" ? "" : v)}
                  >
                    <SelectTrigger data-testid="select-analysis-vertical">
                      <SelectValue placeholder="Select vertical for tailored analysis" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">No vertical (generic analysis)</SelectItem>
                      {ANALYSIS_VERTICALS.map(({ label, slug }) => (
                        <SelectItem
                          key={slug}
                          value={slug}
                          data-testid={`select-analysis-item-${slug}`}
                        >
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="gap-2"
                  onClick={handleAnalysis}
                  disabled={analyzing || !analysisVolume}
                  data-testid="button-analyze-statement"
                >
                  {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Analyze My Statement
                </Button>
                {analysisError && (
                  <div className="text-sm text-destructive" data-testid="text-analysis-error">
                    {analysisError}
                  </div>
                )}
                {analysisResult && (
                  <div className="space-y-3 border-t pt-4" data-testid="analysis-results">
                    {(analysisResult._vertical as string | null | undefined) && (
                      <div className="flex items-center gap-2" data-testid="text-analysis-vertical">
                        <span className="text-xs text-muted-foreground">Vertical context applied:</span>
                        <span className="inline-flex items-center rounded-full bg-sky-100 dark:bg-sky-900/40 px-2.5 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">
                          {ANALYSIS_VERTICALS.find(v => v.slug === (analysisResult._vertical as string))?.label ?? (analysisResult._vertical as string)}
                        </span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground">Effective Rate</div>
                        <div className="text-lg font-bold" data-testid="text-effective-rate">{analysisResult.effectiveRate}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Recommended Program</div>
                        <div className="text-lg font-bold" data-testid="text-recommended-path">{analysisResult.recommendedPath}</div>
                      </div>
                    </div>
                    {analysisResult.keyFindings && (
                      <div>
                        <div className="text-sm font-medium mb-2">Key Findings</div>
                        <ul className="space-y-1">
                          {analysisResult.keyFindings.map((f: string, i: number) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                              <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {analysisResult.overallAssessment && (
                      <div className="bg-muted/50 p-3 rounded-md">
                        <div className="text-sm">{analysisResult.overallAssessment}</div>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Eligibility, underwriting, card brand rules, and applicable laws apply.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="bg-background bg-dots py-16" data-testid="section-what-happens-next">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 reveal">
            <h2
              className="text-2xl sm:text-3xl font-bold text-foreground text-center mb-10"
              data-testid="text-what-happens-next"
            >
              What Happens Next
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="reveal reveal-delay-1" data-testid="card-step-1">
                <CardContent className="pt-8 pb-8 text-center space-y-4">
                  <div className="w-14 h-14 rounded-full bg-sky-500 text-white flex items-center justify-center mx-auto text-2xl font-bold">
                    1
                  </div>
                  <h3 className="text-base font-semibold text-foreground">Confirmation</h3>
                  <p className="text-sm text-muted-foreground">
                    We confirm we received your file (SMS/email).
                  </p>
                </CardContent>
              </Card>
              <Card className="reveal reveal-delay-2" data-testid="card-step-2">
                <CardContent className="pt-8 pb-8 text-center space-y-4">
                  <div className="w-14 h-14 rounded-full bg-sky-500 text-white flex items-center justify-center mx-auto text-2xl font-bold">
                    2
                  </div>
                  <h3 className="text-base font-semibold text-foreground">Analysis</h3>
                  <p className="text-sm text-muted-foreground">
                    We calculate your effective rate and identify cost drivers line-by-line.
                  </p>
                </CardContent>
              </Card>
              <Card className="reveal reveal-delay-3" data-testid="card-step-3">
                <CardContent className="pt-8 pb-8 text-center space-y-4">
                  <div className="w-14 h-14 rounded-full bg-sky-500 text-white flex items-center justify-center mx-auto text-2xl font-bold">
                    3
                  </div>
                  <h3 className="text-base font-semibold text-foreground">Clear Options</h3>
                  <p className="text-sm text-muted-foreground">
                    We send you 2-3 clear options with apples-to-apples math and next steps.
                  </p>
                </CardContent>
              </Card>
            </div>
            <p
              className="text-[10px] text-muted-foreground text-center mt-6"
              data-testid="text-compliance-microcopy"
            >
              Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
            </p>
            <div className="text-center mt-6 reveal reveal-delay-4">
              <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="button-book-call-next">
                <Button variant="outline" className="gap-2">
                  <Calendar className="w-4 h-4" />
                  Get My Free Analysis
                </Button>
              </a>
            </div>
          </div>
        </section>

        <section className="bg-background py-16" data-testid="section-terminal-promo">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 reveal">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div className="flex justify-center reveal reveal-delay-1">
                <img src={imgCloverFlex3} alt="Clover Flex 3 payment terminal" className="w-full max-w-[240px] rounded-md object-contain" loading="lazy" width="240" height="240" data-testid="img-upload-terminal" />
              </div>
              <div className="reveal reveal-delay-2">
                <h2 className="text-2xl font-bold text-foreground mb-3" data-testid="text-terminal-promo-heading">
                  Need a Terminal Too?
                </h2>
                <p className="text-muted-foreground mb-4 leading-relaxed">
                  Your statement review also qualifies you for the Liberty Smart Terminal - free for qualifying merchants.* Tap, dip, swipe, and manual key entry included.
                </p>
                <ul className="space-y-2 mb-4">
                  <li className="flex items-start gap-2 text-sm text-muted-foreground"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />Same-day setup available</li>
                  <li className="flex items-start gap-2 text-sm text-muted-foreground"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />Cash discount and surcharge ready</li>
                  <li className="flex items-start gap-2 text-sm text-muted-foreground"><CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />Guided onboarding and dedicated support</li>
                </ul>
                <p className="text-xs text-muted-foreground">*Eligibility, underwriting, card brand rules, and applicable laws apply.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-muted/30 py-16" data-testid="section-secondary-cta">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center reveal">
            <h2
              className="text-2xl font-bold text-foreground mb-3"
              data-testid="text-prefer-talk"
            >
              Prefer to Talk First?
            </h2>
            <p
              className="text-muted-foreground mb-6"
              data-testid="text-prefer-talk-description"
            >
              Book a quick 10-minute call. We'll tell you exactly what to upload and what to look for.
            </p>
            <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="button-book-call-secondary">
              <Button className="gap-2">
                <Calendar className="w-4 h-4" />
                Get My Free Analysis
              </Button>
            </a>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
