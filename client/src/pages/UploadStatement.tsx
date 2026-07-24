import { useEffect, useState } from "react";
import { getCsrfToken } from "@/lib/queryClient";
import { trackStatementUploadStarted, trackStatementUploadFailed, trackPhoneCtaClick, trackBookingCtaClick } from "@/lib/tracking";
import { useFormAbandonment } from "@/hooks/use-form-abandonment";
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
import { PewcCheckbox } from "@/components/PewcCheckbox";
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
import { trackStatementUploadCompleted, trackFormSubmission } from "@/lib/tracking";
import { CALENDAR_URL, PHONE_TEL, PHONE_NUMBER } from "@/lib/constants";
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
  Sparkles,
  AlertCircle,
  Phone,
  Monitor,
  Upload,
  ChevronRight,
} from "lucide-react";

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
  pewcConsent: z.boolean().optional().default(false),
});

type UploadFormData = z.infer<typeof uploadSchema>;

const WHAT_WE_REVIEW = [
  "Effective rate & total monthly fees",
  "Hidden surcharges and assessments",
  "Interchange optimization opportunities",
  "Equipment costs vs. better alternatives",
];

const TRUST_CHIPS = ["Free", "No commitment", "Secure upload", "~30 seconds"];

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
      pewcConsent: false,
    },
  });

  const { isDirty: formIsDirty } = form.formState;
  useFormAbandonment("upload_statement", formIsDirty && !uploadSucceeded);

  useEffect(() => {
    if (preTerminal) form.setValue("needTerminal", true);
    if (preInterest0) form.setValue("interestedIn0Percent", true);
  }, [preTerminal, preInterest0, form]);

  useEffect(() => {
    if (authUser) {
      const fullName = [authUser.firstName, authUser.lastName].filter(Boolean).join(" ");
      if (fullName && !form.getValues("contactName")) form.setValue("contactName", fullName);
      if (authUser.email && !form.getValues("email")) form.setValue("email", authUser.email);
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
      formData.append("pewcConsent", String(data.pewcConsent));
      if (refCode) formData.append("referralCode", refCode);
      Object.entries(utmParams).forEach(([key, value]) => {
        if (value) formData.append(key, String(value));
      });
      if (selectedFile) formData.append("statementFile", selectedFile);

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
      trackStatementUploadCompleted({ page: "/upload-statement", ctaLocation: "form" });
      trackFormSubmission("statement_upload");
      trackConversion("statement_upload");
      setUploadSucceeded(true);
    },
    onError: (error: Error) => {
      setUploadProgress(0);
      const msg = error?.message || "";
      trackStatementUploadFailed({ page: "/upload-statement", errorMessage: msg });
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
    trackStatementUploadStarted({ page: "/upload-statement", ctaLocation: "form" });
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
        if (res.status === 401) throw new Error("Please log in to use the AI analysis feature.");
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

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SEO
        title="Upload Your Processing Statement"
        description="Upload your merchant processing statement for a free, no-obligation rate analysis. See exactly where your fees are going."
        path="/upload-statement"
        keywords="upload processing statement, free statement review, merchant fee analysis"
        breadcrumbs={[{ name: "Upload Statement", path: "/upload-statement" }]}
        structuredData={[getServiceSchema("Free Statement Review", "Upload your merchant processing statement for a free, no-obligation rate analysis.", "/upload-statement")]}
      />
      <Navbar />

      <main className="flex-grow pt-20" ref={containerRef}>

        {/* ═══════════════════════════════════════════════════
            HERO — white bg, strong headline, trust chips
        ═══════════════════════════════════════════════════ */}
        <section className="bg-white px-5 pt-8 pb-5" data-testid="section-upload-hero">
          <div className="max-w-lg mx-auto">
            {/* Eyebrow */}
            <p className="text-xs font-bold tracking-widest text-sky-600 uppercase mb-2">
              Free Statement Review
            </p>

            {/* Headline */}
            <h1
              className="text-[28px] sm:text-3xl font-extrabold text-gray-900 leading-[1.2] mb-3"
              data-testid="text-upload-heading"
            >
              See exactly what you're paying — and what you could save.
            </h1>

            {/* Subheadline */}
            <p
              className="text-base text-gray-500 leading-relaxed mb-5"
              data-testid="text-upload-subheadline"
            >
              Upload a PDF or photo of your processing statement. We'll send back a written savings breakdown — no processor login, no commitment.
            </p>

            {/* Trust chips */}
            <div className="flex flex-wrap gap-2" data-testid="trust-chips">
              {TRUST_CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600"
                  data-testid={`chip-${chip.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  <CheckCircle2 className="w-3 h-3 text-sky-500 shrink-0" />
                  {chip}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            WHAT WE REVIEW — objection-removing mini-card
        ═══════════════════════════════════════════════════ */}
        <section className="bg-gray-50 px-5 py-4" data-testid="section-what-we-review">
          <div className="max-w-lg mx-auto">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-4 py-4">
              <p className="text-[10px] font-bold tracking-widest text-gray-400 uppercase mb-3">
                What we review
              </p>
              <ul className="space-y-2">
                {WHAT_WE_REVIEW.map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-gray-700">
                    <CheckCircle2 className="w-4 h-4 text-sky-500 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-gray-400 mt-3 leading-snug">
                Redact account numbers if you prefer — totals and fee lines are all we need. Your statement is never sold or shared.
              </p>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            MAIN FORM — mobile-optimized, upload dominant
        ═══════════════════════════════════════════════════ */}
        <section className="bg-white px-5 pt-6 pb-10" data-testid="section-upload-form">
          <div className="max-w-lg mx-auto">

            {uploadSucceeded ? (
              /* ── SUCCESS STATE ── */
              <div className="text-center py-12 space-y-5" data-testid="section-upload-success">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="h-9 w-9 text-green-500" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2" data-testid="text-success-heading">
                    Statement Received!
                  </h2>
                  <p className="text-gray-500 max-w-sm mx-auto text-sm leading-relaxed">
                    Our AI is analyzing it now. A team member will follow up with your personalized savings report — typically within 1 business day.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin text-sky-500" />
                  <span data-testid="text-analyzing">Analyzing your statement…</span>
                </div>
                <Button asChild variant="outline" className="rounded-xl" data-testid="button-view-portal">
                  <Link href="/merchant-portal">View My Portal</Link>
                </Button>
              </div>
            ) : (
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-4"
                  data-testid="form-upload-statement"
                >
                  <p className="text-sm font-semibold text-gray-700 mb-1" data-testid="text-form-title">
                    Your information
                  </p>

                  {/* ── Row: Business + Name ── */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="businessName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-medium text-gray-600">Business Name</FormLabel>
                          <FormControl>
                            <Input
                              className="h-12 text-base rounded-xl border-gray-200 focus:border-sky-500 focus:ring-sky-500"
                              placeholder="Your business"
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
                          <FormLabel className="text-xs font-medium text-gray-600">Your Name</FormLabel>
                          <FormControl>
                            <Input
                              className="h-12 text-base rounded-xl border-gray-200 focus:border-sky-500"
                              placeholder="Full name"
                              data-testid="input-contact-name"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* ── Row: Email + Mobile ── */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-medium text-gray-600">Email</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              className="h-12 text-base rounded-xl border-gray-200 focus:border-sky-500"
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
                          <FormLabel className="text-xs font-medium text-gray-600">Mobile</FormLabel>
                          <FormControl>
                            <Input
                              type="tel"
                              className="h-12 text-base rounded-xl border-gray-200 focus:border-sky-500"
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

                  {/* ── Industry ── */}
                  <FormField
                    control={form.control}
                    name="vertical"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium text-gray-600">Industry</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger
                              className="h-12 text-base rounded-xl border-gray-200 focus:border-sky-500"
                              data-testid="select-vertical"
                            >
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

                  {/* ── File Upload — styled tap target ── */}
                  <FormField
                    control={form.control}
                    name="fileName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium text-gray-600">
                          Statement (PDF or photo)
                        </FormLabel>
                        <FormControl>
                          <label
                            className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed cursor-pointer transition-colors min-h-[96px] px-4 py-5
                              ${selectedFile
                                ? "border-sky-400 bg-sky-50"
                                : "border-gray-200 bg-gray-50 hover:border-sky-300 hover:bg-sky-50/50"
                              }`}
                            data-testid="label-file-upload"
                          >
                            <input
                              type="file"
                              accept=".pdf,.png,.jpg,.jpeg"
                              className="sr-only"
                              data-testid="input-file"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                field.onChange(file?.name || "");
                                setSelectedFile(file || null);
                              }}
                            />
                            {selectedFile ? (
                              <>
                                <CheckCircle2 className="w-6 h-6 text-sky-500" />
                                <span className="text-sm font-medium text-sky-700 text-center break-all">
                                  {selectedFile.name}
                                </span>
                                <span className="text-xs text-sky-500">Tap to change file</span>
                              </>
                            ) : (
                              <>
                                <Upload className="w-6 h-6 text-gray-400" />
                                <span className="text-sm font-medium text-gray-700">
                                  Tap to upload statement
                                </span>
                                <span className="text-xs text-gray-400">PDF, JPG, PNG — up to 10 MB</span>
                              </>
                            )}
                          </label>
                        </FormControl>
                        <div className="flex items-center gap-1.5 mt-1">
                          <Lock className="w-3 h-3 text-gray-400 shrink-0" />
                          <span className="text-[11px] text-gray-400" data-testid="text-secure-upload">
                            Encrypted upload — your statement is never sold or shared
                          </span>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* ── Current Provider (optional) ── */}
                  <FormField
                    control={form.control}
                    name="currentProvider"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium text-gray-600">
                          Current provider <span className="text-gray-400 font-normal">(optional)</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            className="h-12 text-base rounded-xl border-gray-200"
                            placeholder="e.g. Square, Stripe, Clover"
                            data-testid="input-current-provider"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* ── Optional checkboxes ── */}
                  <div className="space-y-3 py-1">
                    <FormField
                      control={form.control}
                      name="interestedIn0Percent"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-3">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-interested-0-percent"
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal text-gray-600 leading-snug cursor-pointer">
                            Interested in a compliant 0% processing program?
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="needTerminal"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-3">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="checkbox-need-terminal"
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal text-gray-600 leading-snug cursor-pointer">
                            Do you need a terminal?
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* ── Notes ── */}
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium text-gray-600">
                          Anything you want us to focus on?{" "}
                          <span className="text-gray-400 font-normal">(optional)</span>
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            className="text-base rounded-xl border-gray-200 resize-none"
                            placeholder="Tell us what matters most to you"
                            rows={3}
                            data-testid="textarea-notes"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* ── PEWC ── */}
                  <PewcCheckbox
                    checked={form.watch("pewcConsent") ?? false}
                    onCheckedChange={(val) => form.setValue("pewcConsent", val)}
                  />

                  {/* ── Error banner ── */}
                  {submitError && (
                    <div
                      className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3"
                      data-testid="alert-submit-error"
                      role="alert"
                    >
                      <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                      <p className="text-sm text-red-700">{submitError}</p>
                    </div>
                  )}

                  {/* ── Upload progress ── */}
                  {isUploading && (
                    <div className="space-y-3 rounded-xl bg-gray-50 border border-gray-100 px-4 py-4" data-testid="upload-progress-container" role="status" aria-label="Upload in progress">
                      {uploadProgress < 100 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span className="flex items-center gap-1.5">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-500" />
                              {PROCESSING_STEPS[0]}
                            </span>
                            <span data-testid="text-upload-progress-percent" className="font-semibold">{uploadProgress}%</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden" data-testid="upload-progress-bar-track">
                            <div
                              className="h-full rounded-full bg-sky-500 transition-all duration-200"
                              style={{ width: `${uploadProgress}%` }}
                              data-testid="upload-progress-bar-fill"
                            />
                          </div>
                        </div>
                      )}
                      {uploadProgress >= 100 && (
                        <div className="space-y-1.5" data-testid="upload-processing-steps">
                          {PROCESSING_STEPS.slice(1).map((label, idx) => {
                            const stepNum = idx + 1;
                            const done = processingStep > stepNum;
                            const active = processingStep === stepNum;
                            return (
                              <div
                                key={label}
                                className={`flex items-center gap-2 text-xs transition-all duration-300 ${done ? "text-green-600" : active ? "text-sky-600 font-medium" : "text-gray-400 opacity-50"}`}
                                data-testid={`step-processing-${stepNum}`}
                              >
                                {done ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                ) : active ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                ) : (
                                  <span className="w-3.5 h-3.5 shrink-0 rounded-full border border-gray-300 inline-block" />
                                )}
                                {label}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ═══════════════════════════════════════
                      PRIMARY CTA — dominant dark button
                  ═══════════════════════════════════════ */}
                  <Button
                    type="submit"
                    className="w-full h-14 text-base font-bold rounded-2xl bg-[#0d1b2e] hover:bg-[#162840] text-white shadow-lg shadow-gray-900/20 transition-all active:scale-[0.98]"
                    disabled={submitMutation.isPending || isUploading}
                    data-testid="button-upload-submit"
                  >
                    {submitMutation.isPending || isUploading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        {isUploading ? "Uploading…" : "Submitting…"}
                      </>
                    ) : (
                      <>
                        <Upload className="w-5 h-5 mr-2" />
                        Upload My Statement
                      </>
                    )}
                  </Button>

                  {/* ═══════════════════════════════════════
                      SECONDARY CTAs — book + phone
                  ═══════════════════════════════════════ */}
                  <a
                    href={CALENDAR_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="link-upload-hero-book"
                    onClick={() => trackBookingCtaClick({ page: "/upload-statement", ctaLabel: "Book a 10-Min Review Call", ctaLocation: "form" })}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-12 rounded-2xl border-gray-200 text-gray-700 font-medium hover:bg-gray-50 hover:border-gray-300"
                    >
                      <Calendar className="w-4 h-4 mr-2 text-gray-500" />
                      Book a 10-Min Review Call
                    </Button>
                  </a>

                  <a
                    href={PHONE_TEL}
                    aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`}
                    data-testid="link-upload-hero-phone"
                    onClick={() => trackPhoneCtaClick({ page: "/upload-statement", ctaLabel: PHONE_NUMBER, ctaLocation: "form" })}
                    className="flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors py-1"
                  >
                    <Phone className="w-4 h-4" />
                    Or call {PHONE_NUMBER}
                  </a>

                  {/* Compliance microcopy */}
                  <p className="text-[10px] text-gray-400 text-center leading-snug" data-testid="text-compliance-microcopy">
                    Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
                  </p>
                </form>
              </Form>
            )}
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            WHAT HAPPENS NEXT — 3 steps
        ═══════════════════════════════════════════════════ */}
        <section className="bg-gray-50 px-5 py-10" data-testid="section-what-happens-next">
          <div className="max-w-lg mx-auto reveal">
            <h2
              className="text-xl font-bold text-gray-900 mb-6"
              data-testid="text-what-happens-next"
            >
              What happens next
            </h2>
            <div className="space-y-3">
              {[
                {
                  n: "1",
                  title: "Confirmation",
                  body: "We confirm we received your file right away.",
                  delay: "reveal-delay-1",
                },
                {
                  n: "2",
                  title: "Analysis",
                  body: "We calculate your effective rate and identify cost drivers line-by-line.",
                  delay: "reveal-delay-2",
                },
                {
                  n: "3",
                  title: "Clear options",
                  body: "We send 2-3 options with apples-to-apples math and next steps.",
                  delay: "reveal-delay-3",
                },
              ].map(({ n, title, body, delay }) => (
                <div
                  key={n}
                  className={`flex items-start gap-4 bg-white rounded-2xl border border-gray-100 px-4 py-4 shadow-sm reveal ${delay}`}
                  data-testid={`card-step-${n}`}
                >
                  <div className="w-9 h-9 rounded-full bg-sky-500 text-white flex items-center justify-center text-sm font-bold shrink-0">
                    {n}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{title}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="text-center mt-6 reveal reveal-delay-4">
              <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="button-book-call-next">
                <Button variant="outline" className="rounded-xl gap-2 border-gray-200 text-gray-700">
                  <Calendar className="w-4 h-4" />
                  Get My Free Analysis
                </Button>
              </a>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            AI QUICK ANALYSIS — power-user tool
        ═══════════════════════════════════════════════════ */}
        <section className="bg-white px-5 py-8" data-testid="section-ai-analysis">
          <div className="max-w-lg mx-auto">
            <Card data-testid="card-ai-analysis" className="rounded-2xl border-gray-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-sky-500" />
                  Quick AI rate estimate
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-gray-500">
                  Don't have your statement handy? Enter your volume and rate for an instant estimate.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-600">Monthly Volume ($)</Label>
                    <Input
                      className="h-11 text-base rounded-xl border-gray-200"
                      placeholder="e.g. 50000"
                      data-testid="input-analysis-volume"
                      value={analysisVolume}
                      onChange={(e) => setAnalysisVolume(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-gray-600">Effective Rate (%)</Label>
                    <Input
                      className="h-11 text-base rounded-xl border-gray-200"
                      placeholder="e.g. 3.2"
                      data-testid="input-analysis-rate"
                      value={analysisRate}
                      onChange={(e) => setAnalysisRate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-600">
                    Industry{" "}
                    <span className="text-gray-400 font-normal">(optional — unlocks tailored output)</span>
                  </Label>
                  <Select
                    value={analysisVertical || "_none"}
                    onValueChange={(v) => setAnalysisVertical(v === "_none" ? "" : v)}
                  >
                    <SelectTrigger className="h-11 text-base rounded-xl border-gray-200" data-testid="select-analysis-vertical">
                      <SelectValue placeholder="Select vertical for tailored analysis" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">No vertical (generic analysis)</SelectItem>
                      {ANALYSIS_VERTICALS.map(({ label, slug }) => (
                        <SelectItem key={slug} value={slug} data-testid={`select-analysis-item-${slug}`}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="gap-2 rounded-xl w-full sm:w-auto"
                  onClick={handleAnalysis}
                  disabled={analyzing || !analysisVolume}
                  data-testid="button-analyze-statement"
                >
                  {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Analyze My Rate
                </Button>
                {analysisError && (
                  <div className="text-sm text-red-600" data-testid="text-analysis-error">
                    {analysisError}
                  </div>
                )}
                {analysisResult && (
                  <div className="space-y-3 border-t pt-4" data-testid="analysis-results">
                    {(analysisResult._vertical as string | null | undefined) && (
                      <div className="flex items-center gap-2" data-testid="text-analysis-vertical">
                        <span className="text-xs text-gray-400">Vertical context applied:</span>
                        <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-700">
                          {ANALYSIS_VERTICALS.find((v) => v.slug === (analysisResult._vertical as string))?.label ?? (analysisResult._vertical as string)}
                        </span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-gray-400">Effective Rate</div>
                        <div className="text-lg font-bold text-gray-900" data-testid="text-effective-rate">{analysisResult.effectiveRate}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400">Recommended Program</div>
                        <div className="text-lg font-bold text-gray-900" data-testid="text-recommended-path">{analysisResult.recommendedPath}</div>
                      </div>
                    </div>
                    {analysisResult.keyFindings && (
                      <div>
                        <div className="text-sm font-medium text-gray-900 mb-2">Key Findings</div>
                        <ul className="space-y-1">
                          {analysisResult.keyFindings.map((f: string, i: number) => (
                            <li key={i} className="text-sm text-gray-500 flex items-start gap-2">
                              <CheckCircle2 className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {analysisResult.overallAssessment && (
                      <div className="bg-gray-50 p-3 rounded-xl">
                        <div className="text-sm text-gray-700">{analysisResult.overallAssessment}</div>
                      </div>
                    )}
                    <p className="text-[10px] text-gray-400">
                      Eligibility, underwriting, card brand rules, and applicable laws apply.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            TERMINAL PROMO
        ═══════════════════════════════════════════════════ */}
        <section className="bg-gray-50 px-5 py-8" data-testid="section-terminal-promo">
          <div className="max-w-lg mx-auto">
            <div className="flex items-start gap-4 bg-white rounded-2xl border border-gray-200 shadow-sm px-5 py-5 reveal">
              <div className="flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-sky-50" aria-hidden="true">
                <Monitor className="w-6 h-6 text-sky-500" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-gray-900 mb-1" data-testid="text-terminal-promo-heading">
                  Free Terminal this Month
                </h2>
                <p className="text-sm text-gray-500 leading-relaxed mb-3">
                  Qualifying merchants who sign up this month receive a free terminal — tap, dip, swipe, and manual key entry supported.
                </p>
                <ul className="space-y-1.5 mb-2">
                  {["Same-day setup available", "Cash discount and surcharge ready", "Guided onboarding + dedicated support"].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-xs text-gray-500">
                      <CheckCircle2 className="w-3.5 h-3.5 text-sky-500 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-gray-400">Subject to eligibility and equipment program terms.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════════════
            SECONDARY CTA — sticky-feel bottom panel
        ═══════════════════════════════════════════════════ */}
        <section
          className="bg-[#0d1b2e] px-5 py-10 pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))]"
          data-testid="section-secondary-cta"
        >
          <div className="max-w-lg mx-auto text-center reveal">
            <h2
              className="text-xl font-bold text-white mb-2"
              data-testid="text-prefer-talk"
            >
              Prefer to talk first?
            </h2>
            <p
              className="text-sm text-white/60 mb-6"
              data-testid="text-prefer-talk-description"
            >
              Book a quick 10-minute call. We'll tell you exactly what to upload and what to look for.
            </p>
            <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="button-book-call-secondary">
              <Button
                className="gap-2 rounded-2xl h-12 px-6 bg-white text-gray-900 font-semibold hover:bg-gray-100 w-full sm:w-auto"
              >
                <Calendar className="w-4 h-4" />
                Book a Free 10-Min Call
              </Button>
            </a>
            <div className="mt-4">
              <a
                href={PHONE_TEL}
                onClick={() => trackPhoneCtaClick({ page: "/upload-statement", ctaLabel: PHONE_NUMBER, ctaLocation: "footer-cta" })}
                className="flex items-center justify-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors"
                data-testid="link-footer-phone"
              >
                <Phone className="w-4 h-4" />
                {PHONE_NUMBER}
              </a>
            </div>
          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}
