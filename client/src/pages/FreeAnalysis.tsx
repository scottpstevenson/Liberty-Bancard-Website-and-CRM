import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { EmailMarketingCheckbox, emailConsentNotice, emailConsentPayload, readEmailConsentState } from "@/components/EmailMarketingCheckbox";
import { apiRequest } from "@/lib/queryClient";
import { getStoredUTMParams } from "@/lib/utm";
import { useToast } from "@/hooks/use-toast";
import { trackQuizStart, trackQuizStep, trackQuizComplete, trackConversion, trackFormSubmission } from "@/lib/tracking";
import { trackConversion as trackConversionV2, trackPhoneCallClick } from "@/lib/analytics";
import { CALENDAR_URL, PHONE_TEL, PHONE_NUMBER } from "@/lib/constants";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  DollarSign,
  CreditCard,
  AlertTriangle,
  Monitor,
  Upload,
  Phone,
  UtensilsCrossed,
  Store,
  Stethoscope,
  Car,
  Wrench,
  ShoppingCart,
  MoreHorizontal,
  Zap,
  ShieldCheck,
  Clock,
  FileText,
  Users,
  BadgeCheck,
  Loader2,
  Calendar,
  UserCheck,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Headphones,
  AlertCircle,
} from "lucide-react";
import { PromoBanner } from "@/components/PromoBanner";
import { REVIEW_OFFER } from "@shared/public-offers";
import logoBlue from "@/assets/logo-blue.png";
import { claimText } from "@shared/public-claims";
import { FSR_PROCESS } from "@shared/free-statement-review-content";
import { FREE_ANALYSIS_QUIZ_PAGE } from "@shared/public-free-analysis";

function encodeResults(data: { industry: string; volume: string; processor: string; painPoints: string[] }): string {
  return btoa(JSON.stringify(data));
}

function decodeResults(encoded: string): { industry: string; volume: string; processor: string; painPoints: string[] } | null {
  try {
    const parsed = JSON.parse(atob(encoded));
    if (parsed.industry && parsed.volume && parsed.processor && Array.isArray(parsed.painPoints)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

const faqItems = [
  {
    q: "Is this really free? What's the catch?",
    a: `${claimText("review.cost.free")} There is no obligation to switch.`,
  },
  {
    q: "Does the quiz give me a savings number?",
    a: "No. The quiz collects the basics so a statement review can start in the right place. Your costs depend on your current pricing and your transaction mix, which only your statement shows.",
  },
  {
    q: "How is my information used?",
    a: "Your answers and contact details are used to respond to your request and, with your permission, to contact you about it. Read our Privacy Policy for details.",
  },
  {
    q: "Am I locked into a contract if I switch?",
    a: claimText("equipment.agreement.summary"),
  },
  {
    q: "How long does it take to switch processors?",
    a: claimText("timing.staged-process"),
  },
  {
    q: "What types of businesses do you work with?",
    a: FSR_PROCESS.support,
  },
];

function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="mt-10" data-testid="section-faq">
      <h3 className="text-lg font-display font-bold text-foreground text-center mb-6">Frequently Asked Questions</h3>
      <div className="space-y-2">
        {faqItems.map((item, idx) => (
          <Card key={idx} data-testid={`card-faq-${idx}`}>
            <CardContent className="p-0">
              <button
                className="w-full flex items-center justify-between p-4 text-left"
                onClick={() => setOpen(open === idx ? null : idx)}
                aria-expanded={open === idx}
                data-testid={`button-faq-toggle-${idx}`}
              >
                <span className="text-sm font-semibold text-foreground pr-4">{item.q}</span>
                {open === idx ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
              </button>
              {open === idx && (
                <div className="px-4 pb-4">
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.a}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

const TOTAL_STEPS = 5;

const industryOptions = [
  { value: "restaurant", label: "Restaurant / Food Service", icon: UtensilsCrossed },
  { value: "retail", label: "Retail / Shop", icon: Store },
  { value: "healthcare", label: "Healthcare / Medical", icon: Stethoscope },
  { value: "automotive", label: "Automotive", icon: Car },
  { value: "home-services", label: "Home Services / Contractors", icon: Wrench },
  { value: "ecommerce", label: "E-Commerce / Online", icon: ShoppingCart },
  { value: "other", label: "Other Industry", icon: MoreHorizontal },
];

const volumeOptions = [
  { value: "under-5k", label: "Under $5,000", sub: "Starter volume" },
  { value: "5k-15k", label: "$5,000 - $15,000", sub: "Growing business" },
  { value: "15k-50k", label: "$15,000 - $50,000", sub: "Established operator" },
  { value: "50k-150k", label: "$50,000 - $150,000", sub: "High volume" },
  { value: "150k-plus", label: "$150,000+", sub: "Enterprise volume" },
];

const processorOptions = [
  { value: "square", label: "Square" },
  { value: "stripe", label: "Stripe" },
  { value: "clover", label: "Clover" },
  { value: "toast", label: "Toast" },
  { value: "bank-processor", label: "Bank / Traditional Processor" },
  { value: "other", label: "Other / Not Sure" },
];

const painPointOptions = [
  { value: "high-fees", label: "Fees are too high", icon: DollarSign },
  { value: "hidden-charges", label: "Hidden or unexpected charges", icon: AlertTriangle },
  { value: "slow-deposits", label: "Slow deposits / funding", icon: Clock },
  { value: "bad-support", label: "Poor customer support", icon: Phone },
  { value: "outdated-equipment", label: "Outdated equipment", icon: Monitor },
  { value: "no-transparency", label: "No pricing transparency", icon: FileText },
];

/** What the statement review would look at for each concern the visitor chose. No figure, saving or product is implied. */
const REVIEW_FOCUS: Record<string, string> = {
  "high-fees": "Your effective cost: the fees included divided by the card volume they apply to.",
  "hidden-charges": "Each fee on the statement: what it is and who charges it.",
  "slow-deposits": "Funding and deposit terms, which depend on your account and your agreement.",
  "bad-support": "What your current agreement says about support, and who to contact.",
  "outdated-equipment": "Equipment, gateway and other charges, listed separately from processing fees.",
  "no-transparency": "The pricing model on your statement and what each line means.",
};

function reviewFocusFor(painPoints: string[]): string[] {
  const focus = painPoints.map((value) => REVIEW_FOCUS[value]).filter((line): line is string => Boolean(line));
  return focus.length > 0 ? focus : [REVIEW_FOCUS["high-fees"]];
}

export default function FreeAnalysis() {
  const [step, setStep] = useState(1);
  const [industry, setIndustry] = useState("");
  const [volume, setVolume] = useState("");
  const [processor, setProcessor] = useState("");
  const [painPoints, setPainPoints] = useState<string[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [emailMarketing, setEmailMarketing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [requestSaved, setRequestSaved] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [refCode, setRefCode] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [affiliateName, setAffiliateName] = useState<string | null>(null);
  const [affiliateCompany, setAffiliateCompany] = useState<string | null>(null);
  const submissionIdempotencyKey = useRef<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const promo = params.get("promo");
    if (promo) {
      setPromoCode(promo.toUpperCase());
      localStorage.setItem("lb_promo_code", promo.toUpperCase());
    } else {
      const stored = localStorage.getItem("lb_promo_code");
      if (stored) setPromoCode(stored);
    }
    const ref = params.get("ref");
    if (ref) {
      setRefCode(ref);
      localStorage.setItem("lb_ref_code", ref);
      const expires = new Date(Date.now() + 30 * 864e5).toUTCString();
      document.cookie = `lb_ref=${encodeURIComponent(ref)};expires=${expires};path=/;SameSite=Lax`;
      // CSRF_EXEMPT: PUBLIC_FLOW — affiliate click tracking; no session auth required
      fetch("/api/affiliate/track-click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: ref }),
      }).catch(() => {});
      fetch(`/api/affiliate/public/${ref}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data) {
            setAffiliateName(data.name);
            if (data.company) setAffiliateCompany(data.company);
          }
        })
        .catch(() => {});
    }

    const industryParam = params.get("industry");
    if (industryParam && industryOptions.some((o) => o.value === industryParam)) {
      setIndustry(industryParam);
    }

    const resultsParam = params.get("results");
    if (resultsParam) {
      const decoded = decodeResults(resultsParam);
      if (decoded) {
        setIndustry(decoded.industry);
        setVolume(decoded.volume);
        setProcessor(decoded.processor);
        setPainPoints(decoded.painPoints);
        setSubmitted(true);
      }
    }
  }, []);

  const canProceed = () => {
    switch (step) {
      case 1:
        return industry !== "";
      case 2:
        return volume !== "";
      case 3:
        return processor !== "";
      case 4:
        return painPoints.length > 0;
      case 5:
        return firstName.trim() !== "" && lastName.trim() !== "" && email.trim() !== "" && phone.trim() !== "";
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS && canProceed()) {
      if (step === 1) trackQuizStart();
      trackQuizStep(step, stepNames[step - 1]);
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const togglePainPoint = (value: string) => {
    setPainPoints((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]
    );
  };

  function getFormErrorMessage(error: any): string {
    const msg = typeof error?.message === "string" ? error.message : "";
    if (msg.startsWith("429:")) return "Too many submissions — please wait a few minutes and try again.";
    if (/^5\d{2}:/.test(msg)) return "Something went wrong on our end — please try again shortly.";
    return msg || `Please try again or call us at ${PHONE_NUMBER}.`;
  }

  const handleSubmit = async () => {
    if (!canProceed()) return;
    submissionIdempotencyKey.current ??= crypto.randomUUID();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const cookieRef = document.cookie.match(/(?:^|; )lb_ref=([^;]*)/)?.[1];
      const storedRef = refCode || localStorage.getItem("lb_ref_code") || (cookieRef ? decodeURIComponent(cookieRef) : undefined) || undefined;
      const storedPromo = promoCode || localStorage.getItem("lb_promo_code") || undefined;
      const utmParams = getStoredUTMParams();
      const consentState = await readEmailConsentState(await apiRequest(
        "POST",
        "/api/public/free-analysis",
        {
          industry,
          monthlyVolume: volume,
          currentProcessor: processor,
          painPoints,
          firstName,
          lastName,
          email,
          phone,
          consentSms: consent,
          ...emailConsentPayload("free_analysis", emailMarketing),
          referralCode: storedRef,
          promoCode: storedPromo,
          utmSource: utmParams.utmSource,
          utmMedium: utmParams.utmMedium,
          utmCampaign: utmParams.utmCampaign,
          utmContent: utmParams.utmContent,
          utmTerm: utmParams.utmTerm,
          gclid: utmParams.gclid,
        },
        { "Idempotency-Key": submissionIdempotencyKey.current },
      ));
      // The request is saved at this point. The email-updates choice is reported from the server's recorded fact only.
      const consentNotice = emailConsentNotice(consentState, emailMarketing);
      if (consentNotice) toast({ title: "Request saved", description: consentNotice });
      setSubmitted(true);
      setRequestSaved(true);
      // No financial value is sent: the quiz computes none.
      trackQuizComplete();
      trackFormSubmission("free_analysis_quiz");
      trackConversion("free_analysis_quiz");
      trackConversionV2("free_analysis_quiz");
    } catch (error: any) {
      setSubmitError(getFormErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const focusLines = reviewFocusFor(painPoints);
  const industryLabel = industryOptions.find((o) => o.value === industry)?.label;
  const volumeLabel = volumeOptions.find((o) => o.value === volume)?.label;
  const processorLabel = processorOptions.find((o) => o.value === processor)?.label;

  if (submitted) {
    return (
      <div className="marketing-surface min-h-screen flex flex-col font-body bg-background">
        <SEO
          title="Your Free Statement Review Request"
          description="What a free statement review would look at, based on your answers."
          path="/free-analysis"
          noindex={true}
        />

        <main className="flex flex-1 flex-col">
        <section className="marketing-surface relative overflow-hidden bg-background border-b border-border" data-testid="section-results-hero">
          <div className="relative max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-16 text-center">
            <Link href="/" data-testid="link-results-logo">
              <img src={logoBlue} alt="Liberty Bancard" className="h-8 mx-auto mb-8" />
            </Link>
            {affiliateName && (
              <div className="flex items-center justify-center gap-2 mb-4" data-testid="badge-affiliate-branding">
                <Badge variant="secondary" className="border border-border bg-card text-muted-foreground shadow-sm">
                  <UserCheck className="w-3 h-3 mr-1" />
                  Recommended by {affiliateName}{affiliateCompany ? ` at ${affiliateCompany}` : ""}
                </Badge>
              </div>
            )}
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-emerald-500" />
            </div>
            <h1
              className="text-3xl md:text-4xl lg:text-5xl font-display font-bold text-foreground mb-2"
              data-testid="text-results-heading"
            >
              {requestSaved ? "We've received your request" : "What a statement review would look at"}
            </h1>
            <p className="text-muted-foreground">
              {firstName ? `${firstName}, here` : "Here"} is what a review would look at, based on your answers. {claimText("timing.staged-process")}
            </p>
          </div>
        </section>

        <section className="bg-muted/30 py-10 flex-grow" data-testid="section-results">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <Card className="mb-6" data-testid="card-your-answers">
              <CardContent className="p-6">
                <h2 className="text-lg font-display font-bold text-foreground mb-3">Your answers</h2>
                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Business type</dt>
                    <dd className="font-medium text-foreground" data-testid="text-answer-industry">{industryLabel ?? "Not provided"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Monthly card volume</dt>
                    <dd className="font-medium text-foreground" data-testid="text-answer-volume">{volumeLabel ?? "Not provided"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Current provider</dt>
                    <dd className="font-medium text-foreground" data-testid="text-answer-processor">{processorLabel ?? "Not provided"}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card className="mb-6" data-testid="card-review-focus">
              <CardContent className="p-6">
                <h2 className="text-lg font-display font-bold text-foreground mb-3">What the review would look at</h2>
                <ul className="space-y-2 text-sm text-muted-foreground leading-relaxed" data-testid="list-review-focus">
                  {focusLines.map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-muted-foreground leading-relaxed mt-4" data-testid="text-no-estimate">
                  No savings figure is shown here. Your costs depend on your current pricing and transaction mix, and your statement is what shows them.
                </p>
                <PromoBanner variant="inline" promoId={REVIEW_OFFER.id} dismissible={false} className="mt-4" />
              </CardContent>
            </Card>

            <Card className="mb-6" data-testid="card-next-steps">
              <CardContent className="p-6">
                <h3 className="text-lg font-display font-bold text-foreground mb-2">
                  What's next?
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {claimText("review.process.summary")}
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button size="lg" className="public-cta gap-2 w-full" asChild>
                    <Link href="/upload-statement" data-testid="link-results-upload">
                      <Upload className="w-4 h-4" />
                      Get a free statement review
                    </Link>
                  </Button>
                  <Button size="lg" variant="outline" className="public-cta gap-2 w-full" asChild>
                    <a href={CALENDAR_URL} target="_blank" rel="noopener noreferrer" data-testid="link-results-book">
                      <Calendar className="w-4 h-4" />
                      Book a processing conversation
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <Card data-testid="card-trust-1">
                <CardContent className="p-4 text-center">
                  <ShieldCheck className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">No obligation</p>
                  <p className="text-xs text-muted-foreground">There is no obligation to switch</p>
                </CardContent>
              </Card>
              <Card data-testid="card-trust-2">
                <CardContent className="p-4 text-center">
                  <FileText className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">Keep the breakdown</p>
                  <p className="text-xs text-muted-foreground">Keep it either way</p>
                </CardContent>
              </Card>
              <Card data-testid="card-trust-3">
                <CardContent className="p-4 text-center">
                  <Phone className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">Questions?</p>
                  <p className="text-xs text-muted-foreground">{PHONE_NUMBER}</p>
                </CardContent>
              </Card>
            </div>

            <p className="text-xs text-muted-foreground text-center" data-testid="text-results-disclaimer">
              Eligibility, underwriting, card brand rules and applicable laws apply. No savings are promised without a statement review.
            </p>
          </div>
        </section>
        </main>

        <Footer />
      </div>
    );
  }

  const stepHeadings = [
    "What type of business do you run?",
    "What's your monthly card processing volume?",
    "Who processes your payments today?",
    "What frustrates you most about processing?",
    "Last step - where should we send your results?",
  ];

  const stepNames = [
    "industry_selection",
    "volume_selection",
    "processor_selection",
    "pain_points",
    "contact_info",
  ];

  const stepEncouragement: Record<number, string> = {
    3: "Great progress! Just 2 more quick questions.",
    4: "Almost there! One more step after this.",
    5: "Final step! Tell us how to reach you.",
  };

  return (
    <div className="marketing-surface min-h-screen flex flex-col font-body bg-background">
      <SEO
        title={FREE_ANALYSIS_QUIZ_PAGE.shortTitle}
        description={FREE_ANALYSIS_QUIZ_PAGE.description}
        path="/free-analysis"
        keywords={FREE_ANALYSIS_QUIZ_PAGE.keywords}
      />

      <PromoBanner variant="bar" promoId={REVIEW_OFFER.id} />

      <main className="flex flex-1 flex-col">
      <section className="marketing-surface relative overflow-hidden bg-background border-b border-border" data-testid="section-quiz-hero">
        <div className="relative max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-14 text-center">
          <Link href="/" data-testid="link-quiz-logo">
            <img src={logoBlue} alt="Liberty Bancard" className="h-8 mx-auto mb-6" />
          </Link>
          <Badge variant="secondary" className="mb-4" data-testid="badge-quiz-time">
            <Clock className="w-3 h-3 mr-1" />
            5 quick questions
          </Badge>
          <h1
            className="public-h1 public-h1--page font-display font-bold text-foreground mb-2"
            data-testid="text-quiz-heading"
          >
            Tell us about your <span className="text-accent">processing</span>
          </h1>
          <p className="text-muted-foreground mb-3" data-testid="text-quiz-subheadline">
            Answer 5 quick questions so a statement review starts in the right place. Your statement is what shows your actual costs.
          </p>
          {affiliateName && (
            <div className="flex items-center justify-center gap-2 mb-3" data-testid="badge-quiz-affiliate-branding">
              <Badge variant="secondary" className="border border-border bg-card text-muted-foreground shadow-sm">
                <UserCheck className="w-3 h-3 mr-1" />
                Recommended by {affiliateName}{affiliateCompany ? ` at ${affiliateCompany}` : ""}
              </Badge>
            </div>
          )}
          {promoCode && (
            <div className="flex items-center justify-center gap-2 mb-3" data-testid="badge-quiz-promo-applied">
              <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                <Zap className="w-3 h-3 mr-1" />
                Promo {promoCode} applied — check your eligibility below
              </Badge>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1" data-testid="text-social-proof-1">
              <Users className="w-3 h-3" />
              Free statement review
            </span>
            <span className="flex items-center gap-1" data-testid="text-social-proof-2">
              <ShieldCheck className="w-3 h-3" />
              No obligation
            </span>
            <span className="flex items-center gap-1" data-testid="text-social-proof-3">
              <BadgeCheck className="w-3 h-3" />
              Keep the breakdown
            </span>
          </div>
        </div>
      </section>

      <section className="bg-muted/30 py-10 flex-grow" data-testid="section-quiz">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1 mb-2" data-testid="progress-indicator">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-full transition-all duration-500 ${
                  i + 1 <= step ? "bg-primary" : "bg-muted"
                }`}
                data-testid={`progress-step-${i + 1}`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between mb-6">
            {stepEncouragement[step] ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium" data-testid="text-step-encouragement">
                {stepEncouragement[step]}
              </p>
            ) : <span />}
            <p className="text-xs text-muted-foreground" data-testid="text-step-counter">
              Step {step} of {TOTAL_STEPS}
            </p>
          </div>

          <Card data-testid="card-quiz">
            <CardContent className="p-6 sm:p-8">
              <h2
                className="text-xl font-display font-bold text-foreground mb-6"
                data-testid="text-step-heading"
              >
                {stepHeadings[step - 1]}
              </h2>

              {step === 1 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="step-industry">
                  {industryOptions.map((option) => (
                    <Card
                      key={option.value}
                      className={`cursor-pointer transition-all duration-200 ${
                        industry === option.value
                          ? "ring-2 ring-primary ring-offset-2"
                          : "hover-elevate"
                      }`}
                      onClick={() => setIndustry(option.value)}
                      data-testid={`card-industry-${option.value}`}
                    >
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                          <option.icon className="w-5 h-5 text-primary" />
                        </div>
                        <span className="text-sm font-medium text-foreground">{option.label}</span>
                        {industry === option.value && (
                          <CheckCircle className="w-5 h-5 text-primary ml-auto shrink-0" />
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {step === 2 && (
                <div className="grid grid-cols-1 gap-3" data-testid="step-volume">
                  {volumeOptions.map((option) => (
                    <Card
                      key={option.value}
                      className={`cursor-pointer transition-all duration-200 ${
                        volume === option.value
                          ? "ring-2 ring-primary ring-offset-2"
                          : "hover-elevate"
                      }`}
                      onClick={() => setVolume(option.value)}
                      data-testid={`card-volume-${option.value}`}
                    >
                      <CardContent className="p-4 flex items-center justify-between gap-3">
                        <div>
                          <span className="text-sm font-medium text-foreground block">{option.label}</span>
                          <span className="text-xs text-muted-foreground">{option.sub}</span>
                        </div>
                        {volume === option.value && (
                          <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {step === 3 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="step-processor">
                  {processorOptions.map((option) => (
                    <Card
                      key={option.value}
                      className={`cursor-pointer transition-all duration-200 ${
                        processor === option.value
                          ? "ring-2 ring-primary ring-offset-2"
                          : "hover-elevate"
                      }`}
                      onClick={() => setProcessor(option.value)}
                      data-testid={`card-processor-${option.value}`}
                    >
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                          <CreditCard className="w-5 h-5 text-primary" />
                        </div>
                        <span className="text-sm font-medium text-foreground">{option.label}</span>
                        {processor === option.value && (
                          <CheckCircle className="w-5 h-5 text-primary ml-auto shrink-0" />
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {step === 4 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="step-pain-points">
                  <p className="text-sm text-muted-foreground sm:col-span-2 mb-1">Select all that apply</p>
                  {painPointOptions.map((option) => (
                    <Card
                      key={option.value}
                      className={`cursor-pointer transition-all duration-200 ${
                        painPoints.includes(option.value)
                          ? "ring-2 ring-primary ring-offset-2"
                          : "hover-elevate"
                      }`}
                      onClick={() => togglePainPoint(option.value)}
                      data-testid={`card-pain-${option.value}`}
                    >
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                          <option.icon className="w-5 h-5 text-primary" />
                        </div>
                        <span className="text-sm font-medium text-foreground">{option.label}</span>
                        {painPoints.includes(option.value) && (
                          <CheckCircle className="w-5 h-5 text-primary ml-auto shrink-0" />
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {step === 5 && (
                <div className="space-y-4" data-testid="step-contact">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">First Name</label>
                      <Input
                        placeholder="John"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        data-testid="input-first-name"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">Last Name</label>
                      <Input
                        placeholder="Smith"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        data-testid="input-last-name"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1 block">Email</label>
                    <Input
                      type="email"
                      placeholder="john@business.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      data-testid="input-email"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground mb-1 block">Phone</label>
                    <Input
                      type="tel"
                      placeholder="(555) 123-4567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      data-testid="input-phone"
                    />
                  </div>
                  <div className="flex items-start gap-2 pt-2">
                    <Checkbox
                      id="consent"
                      checked={consent}
                      onCheckedChange={(checked) => setConsent(checked === true)}
                      data-testid="checkbox-consent"
                    />
                    <label htmlFor="consent" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                      By submitting, I agree to receive calls and texts from Liberty Bancard regarding payment processing services. Reply STOP to opt out. Message &amp; data rates may apply. See our{" "}
                      <Link href="/privacy-policy" className="underline">Privacy Policy</Link> and{" "}
                      <Link href="/sms-terms" className="underline">SMS Terms</Link>.
                    </label>
                  </div>
                  <EmailMarketingCheckbox
                    surface="free_analysis"
                    checked={emailMarketing}
                    onCheckedChange={setEmailMarketing}
                  />
                </div>
              )}

              {step === TOTAL_STEPS && (
                <div className="mt-4 mb-2 flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2" data-testid="text-guarantee-oneliner">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                  There is no obligation to switch, and you keep the breakdown either way.
                </div>
              )}

              {submitError && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 mt-4" data-testid="alert-submit-error" role="alert">
                  <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                  <p className="text-sm text-destructive">{submitError}</p>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 mt-8">
                <Button
                  variant="outline"
                  onClick={handleBack}
                  disabled={step === 1}
                  className="gap-2"
                  data-testid="button-back"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </Button>
                {step < TOTAL_STEPS ? (
                  <Button
                    onClick={handleNext}
                    disabled={!canProceed()}
                    className="gap-2"
                    data-testid="button-next"
                  >
                    Next
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={handleSubmit}
                    disabled={!canProceed() || submitting}
                    className="gap-2"
                    data-testid="button-submit"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        Request my review
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="mt-6 space-y-2">
            <div className="flex flex-wrap justify-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1" data-testid="text-trust-no-cc">
                <CreditCard className="w-3 h-3" />
                No credit card required
              </span>
            </div>
          </div>

          <div className="mt-10" data-testid="section-how-it-works">
            <h3 className="text-lg font-display font-bold text-foreground text-center mb-6">How It Works</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card data-testid="card-how-step-1">
                <CardContent className="p-5 text-center">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <span className="text-primary font-bold">1</span>
                  </div>
                  <p className="text-sm font-semibold text-foreground mb-1">Answer 5 questions</p>
                  <p className="text-xs text-muted-foreground">Tell us about your business, volume and current provider.</p>
                </CardContent>
              </Card>
              <Card data-testid="card-how-step-2">
                <CardContent className="p-5 text-center">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <span className="text-primary font-bold">2</span>
                  </div>
                  <p className="text-sm font-semibold text-foreground mb-1">Send a statement</p>
                  <p className="text-xs text-muted-foreground">Share a recent statement through the secure upload form.</p>
                </CardContent>
              </Card>
              <Card data-testid="card-how-step-3">
                <CardContent className="p-5 text-center">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <span className="text-primary font-bold">3</span>
                  </div>
                  <p className="text-sm font-semibold text-foreground mb-1">We walk you through it</p>
                  <p className="text-xs text-muted-foreground">We review the charges and walk you through the findings. No obligation to switch.</p>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="mt-10" data-testid="section-trust-badges">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card data-testid="card-badge-no-contract">
                <CardContent className="p-4 text-center">
                  <ShieldCheck className="w-7 h-7 text-primary mx-auto mb-2" />
                  <p className="text-xs font-semibold text-foreground">No Obligation to Switch</p>
                  <p className="text-[10px] text-muted-foreground">Terms set in your agreement</p>
                </CardContent>
              </Card>
              <Card data-testid="card-badge-support">
                <CardContent className="p-4 text-center">
                  <Headphones className="w-7 h-7 text-primary mx-auto mb-2" />
                  <p className="text-xs font-semibold text-foreground">Questions? Call us</p>
                  <p className="text-[10px] text-muted-foreground">{PHONE_NUMBER}</p>
                </CardContent>
              </Card>
              <Card data-testid="card-badge-nextday">
                <CardContent className="p-4 text-center">
                  <TrendingUp className="w-7 h-7 text-primary mx-auto mb-2" />
                  <p className="text-xs font-semibold text-foreground">Funding Options</p>
                  <p className="text-[10px] text-muted-foreground">Depends on your account</p>
                </CardContent>
              </Card>
            </div>
          </div>

          <FaqSection />

          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground mb-3" data-testid="text-bottom-cta">
              Still have questions? Call us at <a href={PHONE_TEL} className="text-primary font-semibold underline" onClick={() => trackPhoneCallClick({ sourcePage: "/free-analysis" })}>{PHONE_NUMBER}</a> or{" "}
              <Link href="/get-started" className="text-primary font-semibold underline">book a review call</Link>.
            </p>
          </div>
        </div>
      </section>
      </main>

      <footer className="bg-muted/50 border-t border-border py-6">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <p className="text-xs text-muted-foreground">
            Liberty Bancard | {PHONE_NUMBER} |{" "}
            <Link href="/privacy-policy" className="underline" data-testid="link-footer-privacy">Privacy Policy</Link> |{" "}
            <Link href="/terms" className="underline" data-testid="link-footer-terms">Terms</Link>
          </p>
          <p className="text-xs text-muted-foreground mt-2" data-testid="text-footer-disclaimer">
            Eligibility, underwriting, card brand rules, and applicable laws apply. No savings are promised without a statement review.
          </p>
        </div>
      </footer>
    </div>
  );
}
