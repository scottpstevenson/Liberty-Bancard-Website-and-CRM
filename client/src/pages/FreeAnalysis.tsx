import { useState, useEffect } from "react";
import { Link } from "wouter";
import { SEO } from "@/components/SEO";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { trackQuizStart, trackQuizStep, trackQuizComplete, trackConversion, trackFormSubmission } from "@/lib/tracking";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  DollarSign,
  CreditCard,
  TrendingDown,
  AlertTriangle,
  Percent,
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
  Shield,
  ShieldCheck,
  Clock,
  FileText,
  Users,
  BadgeCheck,
  Loader2,
  Calendar,
  Copy,
  Share2,
  Mail,
  MessageSquare,
  Facebook,
  UserCheck,
  Star,
  ChevronDown,
  ChevronUp,
  MapPin,
  TrendingUp,
  Lock,
  Headphones,
} from "lucide-react";
import { PromoBanner } from "@/components/PromoBanner";
import { CountdownTimer, getDefaultTarget } from "@/components/CountdownTimer";
import logoWhite from "@assets/logo-white.png";

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
    a: "100% free, no credit card required. We make money when merchants switch to our processing — not from the quiz. Even if you don't switch, you keep the savings breakdown.",
  },
  {
    q: "How accurate are the savings estimates?",
    a: "The quiz provides an estimate based on industry averages for your business type and volume. For exact savings, upload your most recent processing statement and we'll do a free line-by-line analysis.",
  },
  {
    q: "Will you sell my information?",
    a: "Never. Your data is encrypted with 256-bit SSL and used only to calculate your estimate and, with your permission, contact you about your results. Read our Privacy Policy for details.",
  },
  {
    q: "Am I locked into a contract if I switch?",
    a: "No. We offer month-to-month processing agreements with no early termination fees on most programs. We earn your business every month.",
  },
  {
    q: "How long does it take to switch processors?",
    a: "Most merchants are fully switched within 2-5 business days. We handle the equipment, programming, and onboarding so there's zero downtime for your business.",
  },
  {
    q: "What types of businesses do you work with?",
    a: "We serve restaurants, retail, healthcare, salons, auto repair, professional services, e-commerce, construction, and more. If you accept card payments in Florida, we can help.",
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
  { value: "under-5k", label: "Under $5,000", monthlyMid: 2500, sub: "Starter volume" },
  { value: "5k-15k", label: "$5,000 - $15,000", monthlyMid: 10000, sub: "Growing business" },
  { value: "15k-50k", label: "$15,000 - $50,000", monthlyMid: 32500, sub: "Established operator" },
  { value: "50k-150k", label: "$50,000 - $150,000", monthlyMid: 100000, sub: "High volume" },
  { value: "150k-plus", label: "$150,000+", monthlyMid: 200000, sub: "Enterprise volume" },
];

const processorOptions = [
  { value: "square", label: "Square", rate: 2.6 },
  { value: "stripe", label: "Stripe", rate: 2.9 },
  { value: "clover", label: "Clover", rate: 2.3 },
  { value: "toast", label: "Toast", rate: 2.49 },
  { value: "bank-processor", label: "Bank / Traditional Processor", rate: 2.5 },
  { value: "other", label: "Other / Not Sure", rate: 2.75 },
];

const painPointOptions = [
  { value: "high-fees", label: "Fees are too high", icon: DollarSign },
  { value: "hidden-charges", label: "Hidden or unexpected charges", icon: AlertTriangle },
  { value: "slow-deposits", label: "Slow deposits / funding", icon: Clock },
  { value: "bad-support", label: "Poor customer support", icon: Phone },
  { value: "outdated-equipment", label: "Outdated equipment", icon: Monitor },
  { value: "no-transparency", label: "No pricing transparency", icon: FileText },
];

interface QuizResults {
  estimatedMonthlySavings: number;
  estimatedAnnualSavings: number;
  recommendedProgram: string;
  programDescription: string;
  recommendedTerminal: string;
  terminalDescription: string;
  currentRate: number;
  targetRate: number;
}

function calculateSavings(
  industry: string,
  volume: string,
  processor: string,
  painPoints: string[]
): QuizResults {
  const volumeData = volumeOptions.find((v) => v.value === volume);
  const processorData = processorOptions.find((p) => p.value === processor);

  const monthlyVolume = volumeData?.monthlyMid || 25000;
  const currentRate = processorData?.rate || 2.75;

  const isFlatRate = ["square", "stripe"].includes(processor);
  const isHighVolume = monthlyVolume >= 50000;
  const isCashDiscountFriendly =
    ["restaurant", "automotive", "home-services", "retail"].includes(industry);

  let targetRate: number;
  let recommendedProgram: string;
  let programDescription: string;

  if (isCashDiscountFriendly && isHighVolume) {
    targetRate = 0;
    recommendedProgram = "Cash Discount / Dual Pricing";
    programDescription =
      "Based on your industry and volume, a compliant cash discount program could eliminate your processing costs entirely. Customers who pay with cash get the listed price; card payments include a small, clearly disclosed service fee.";
  } else if (isFlatRate || isHighVolume || currentRate > 2.5) {
    targetRate = isHighVolume ? 1.6 : 1.85;
    recommendedProgram = "Interchange-Plus Pricing";
    programDescription =
      "You're likely overpaying with bundled or flat-rate pricing. Interchange-plus gives you the actual card brand cost plus a small, transparent markup. Most merchants in your volume range save 20-40%.";
  } else {
    targetRate = 1.95;
    recommendedProgram = "Interchange-Plus Pricing";
    programDescription =
      "Even at your current rate, there may be hidden fees inflating your effective cost. Interchange-plus pricing eliminates the guesswork and shows you exactly what you're paying.";
  }

  const currentMonthlyCost = (monthlyVolume * currentRate) / 100;
  const targetMonthlyCost = (monthlyVolume * targetRate) / 100;
  const monthlySavings = Math.max(0, currentMonthlyCost - targetMonthlyCost);
  const annualSavings = monthlySavings * 12;

  let recommendedTerminal: string;
  let terminalDescription: string;

  if (industry === "restaurant") {
    recommendedTerminal = "Clover Flex 3";
    terminalDescription = "Handheld POS with built-in printer, perfect for tableside service.";
  } else if (industry === "retail" || industry === "ecommerce") {
    recommendedTerminal = "Clover Station Duo";
    terminalDescription = "Full POS system with dual screens and inventory management.";
  } else if (industry === "home-services" || industry === "automotive") {
    recommendedTerminal = "Dejavoo QD4";
    terminalDescription = "Rugged mobile terminal with all-day battery and 4G LTE.";
  } else if (industry === "healthcare") {
    recommendedTerminal = "Clover Mini 3";
    terminalDescription = "Compact countertop terminal ideal for co-pay collection.";
  } else {
    recommendedTerminal = "PAX A920";
    terminalDescription = "Versatile smart terminal with support for all payment types.";
  }

  return {
    estimatedMonthlySavings: Math.round(monthlySavings),
    estimatedAnnualSavings: Math.round(annualSavings),
    recommendedProgram,
    programDescription,
    recommendedTerminal,
    terminalDescription,
    currentRate,
    targetRate,
  };
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
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [refCode, setRefCode] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [utmParams, setUtmParams] = useState<Record<string, string>>({});
  const [affiliateName, setAffiliateName] = useState<string | null>(null);
  const [affiliateCompany, setAffiliateCompany] = useState<string | null>(null);
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

    const utms: Record<string, string> = {};
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach((key) => {
      const val = params.get(key);
      if (val) utms[key] = val;
    });
    if (Object.keys(utms).length > 0) setUtmParams(utms);
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
        return firstName.trim() !== "" && lastName.trim() !== "" && email.trim() !== "" && phone.trim() !== "" && consent;
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

  const handleSubmit = async () => {
    if (!canProceed()) return;
    setSubmitting(true);
    try {
      const cookieRef = document.cookie.match(/(?:^|; )lb_ref=([^;]*)/)?.[1];
      const storedRef = refCode || localStorage.getItem("lb_ref_code") || (cookieRef ? decodeURIComponent(cookieRef) : undefined) || undefined;
      const storedPromo = promoCode || localStorage.getItem("lb_promo_code") || undefined;
      await apiRequest("POST", "/api/public/free-analysis", {
        industry,
        monthlyVolume: volume,
        currentProcessor: processor,
        painPoints,
        firstName,
        lastName,
        email,
        phone,
        consentSms: consent,
        referralCode: storedRef,
        promoCode: storedPromo,
        utmSource: utmParams.utm_source,
        utmMedium: utmParams.utm_medium,
        utmCampaign: utmParams.utm_campaign,
        utmContent: utmParams.utm_content,
        utmTerm: utmParams.utm_term,
      });
      setSubmitted(true);
      trackQuizComplete();
      trackFormSubmission("free_analysis_quiz", results?.estimatedAnnualSavings);
      trackConversion("free_analysis_quiz", results?.estimatedAnnualSavings);
    } catch (error: any) {
      toast({
        title: "Something went wrong",
        description: error.message || "Please try again or call us at 954-266-8214.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const results = calculateSavings(industry, volume, processor, painPoints);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const getShareableUrl = () => {
    const encoded = encodeResults({ industry, volume, processor, painPoints });
    const url = new URL(`${baseUrl}/free-analysis`);
    url.searchParams.set("results", encoded);
    if (refCode) url.searchParams.set("ref", refCode);
    return url.toString();
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(getShareableUrl());
    toast({ title: "Link copied to clipboard" });
  };

  const shareToFacebook = () => {
    const url = encodeURIComponent(getShareableUrl());
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, "_blank", "width=600,height=400");
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent(`See how much you could save on payment processing`);
    const body = encodeURIComponent(
      `I just found out I could save $${results.estimatedAnnualSavings.toLocaleString()}/year on payment processing with Liberty Bancard.\n\nTake the free 60-second quiz to see your savings estimate:\n${getShareableUrl()}`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`);
  };

  const shareViaSms = () => {
    const body = encodeURIComponent(
      `Check out how much you could save on credit card processing! Free 60-second quiz: ${getShareableUrl()}`
    );
    window.open(`sms:?body=${body}`);
  };

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col font-body bg-background">
        <SEO
          title="Your Free Savings Analysis Results"
          description="See your personalized payment processing savings estimate."
          path="/free-analysis"
          noindex={true}
        />

        <section className="relative overflow-hidden" data-testid="section-results-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="glow-blob w-64 h-64 bg-emerald-500 top-10 right-1/4" />
          <div className="glow-blob glow-blob-2 w-48 h-48 bg-sky-500 bottom-4 left-1/4" />
          <div className="relative max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16 text-center">
            <Link href="/" data-testid="link-results-logo">
              <img src={logoWhite} alt="Liberty Bancard" className="h-8 mx-auto mb-8 opacity-80" />
            </Link>
            {affiliateName && (
              <div className="flex items-center justify-center gap-2 mb-4" data-testid="badge-affiliate-branding">
                <Badge variant="secondary" className="bg-white/10 text-white/90 border-white/20">
                  <UserCheck className="w-3 h-3 mr-1" />
                  Recommended by {affiliateName}{affiliateCompany ? ` at ${affiliateCompany}` : ""}
                </Badge>
              </div>
            )}
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h1
              className="text-3xl md:text-4xl font-display font-bold text-white mb-2"
              data-testid="text-results-heading"
            >
              Your Savings Estimate Is Ready
            </h1>
            <p className="text-white/70">
              {firstName ? `${firstName}, based` : "Based"} on your answers, here's what we found.
            </p>
          </div>
        </section>

        <section className="bg-muted/30 py-12 flex-grow" data-testid="section-results">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <Card data-testid="card-savings-monthly">
                <CardContent className="p-5 text-center">
                  <TrendingDown className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  <p className="text-2xl font-display font-bold text-foreground" data-testid="text-monthly-savings">
                    ${results.estimatedMonthlySavings.toLocaleString()}
                  </p>
                  <p className="text-sm text-muted-foreground">Est. monthly savings</p>
                </CardContent>
              </Card>
              <Card data-testid="card-savings-annual">
                <CardContent className="p-5 text-center">
                  <DollarSign className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  <p className="text-2xl font-display font-bold text-foreground" data-testid="text-annual-savings">
                    ${results.estimatedAnnualSavings.toLocaleString()}
                  </p>
                  <p className="text-sm text-muted-foreground">Est. annual savings</p>
                </CardContent>
              </Card>
              <Card data-testid="card-rate-comparison">
                <CardContent className="p-5 text-center">
                  <Percent className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-2xl font-display font-bold text-foreground" data-testid="text-rate-comparison">
                    {results.currentRate}% → {results.targetRate}%
                  </p>
                  <p className="text-sm text-muted-foreground">Current vs. target rate</p>
                </CardContent>
              </Card>
            </div>

            <Card className="mb-6" data-testid="card-recommended-program">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    {results.recommendedProgram.includes("Cash") ? (
                      <Percent className="w-6 h-6 text-primary" />
                    ) : (
                      <Shield className="w-6 h-6 text-primary" />
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-primary uppercase tracking-wider">
                      Recommended Program
                    </div>
                    <h2
                      className="text-xl font-display font-bold text-foreground"
                      data-testid="text-recommended-program"
                    >
                      {results.recommendedProgram}
                    </h2>
                  </div>
                </div>
                <p className="text-muted-foreground leading-relaxed mb-4" data-testid="text-program-description">
                  {results.programDescription}
                </p>
                <div className="bg-primary/5 rounded-md p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <Zap className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <p className="text-sm text-foreground font-medium" data-testid="text-urgency-message">
                      Complete your application in 48 hours to lock in your rate.
                    </p>
                  </div>
                  <CountdownTimer
                    targetDate={new Date(Date.now() + 48 * 60 * 60 * 1000)}
                    label="Offer expires in"
                    className="pt-1"
                  />
                </div>
                <PromoBanner variant="inline" promoId="free-terminal" dismissible={false} className="mt-4" />
              </CardContent>
            </Card>

            <Card className="mb-6" data-testid="card-recommended-terminal">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <Monitor className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-primary uppercase tracking-wider">
                      Recommended Terminal
                    </div>
                    <h2
                      className="text-xl font-display font-bold text-foreground"
                      data-testid="text-recommended-terminal"
                    >
                      {results.recommendedTerminal}
                    </h2>
                  </div>
                </div>
                <p className="text-muted-foreground leading-relaxed" data-testid="text-terminal-description">
                  {results.terminalDescription}
                </p>
              </CardContent>
            </Card>

            <Card className="mb-6" data-testid="card-next-steps">
              <CardContent className="p-6">
                <h3 className="text-lg font-display font-bold text-foreground mb-2">
                  What's Next?
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Upload your most recent processing statement for a free, line-by-line analysis. We'll confirm your exact savings.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Link href="/upload-statement" data-testid="link-results-upload">
                    <Button size="lg" className="gap-2 w-full">
                      <Upload className="w-4 h-4" />
                      Upload Statement for Exact Savings
                    </Button>
                  </Link>
                  <a href="tel:9542668214" data-testid="link-results-call">
                    <Button size="lg" variant="outline" className="gap-2 w-full">
                      <Phone className="w-4 h-4" />
                      Schedule a Call
                    </Button>
                  </a>
                  <Link href="/shop" data-testid="link-results-shop">
                    <Button size="lg" variant="outline" className="gap-2 w-full">
                      <Monitor className="w-4 h-4" />
                      Shop Terminals
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>

            <Card className="mb-8" data-testid="card-share-results">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <Share2 className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-display font-bold text-foreground">
                      Share These Results
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Know a business owner who could save too?
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" className="gap-2" onClick={copyShareLink} data-testid="button-share-copy">
                    <Copy className="w-4 h-4" />
                    Copy Link
                  </Button>
                  <Button variant="outline" className="gap-2" onClick={shareToFacebook} data-testid="button-share-facebook">
                    <Facebook className="w-4 h-4" />
                    Facebook
                  </Button>
                  <Button variant="outline" className="gap-2" onClick={shareViaEmail} data-testid="button-share-email">
                    <Mail className="w-4 h-4" />
                    Email
                  </Button>
                  <Button variant="outline" className="gap-2" onClick={shareViaSms} data-testid="button-share-sms">
                    <MessageSquare className="w-4 h-4" />
                    Text
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <Card data-testid="card-trust-1">
                <CardContent className="p-4 text-center">
                  <ShieldCheck className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">No Contract Required</p>
                  <p className="text-xs text-muted-foreground">Free, no-obligation review</p>
                </CardContent>
              </Card>
              <Card data-testid="card-trust-2">
                <CardContent className="p-4 text-center">
                  <FileText className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">Keep the Breakdown</p>
                  <p className="text-xs text-muted-foreground">Even if you don't switch</p>
                </CardContent>
              </Card>
              <Card data-testid="card-trust-3">
                <CardContent className="p-4 text-center">
                  <Phone className="w-8 h-8 text-primary mx-auto mb-2" />
                  <p className="text-sm font-medium text-foreground">Real Human Support</p>
                  <p className="text-xs text-muted-foreground">954-266-8214</p>
                </CardContent>
              </Card>
            </div>

            <p className="text-xs text-muted-foreground text-center" data-testid="text-results-disclaimer">
              Estimates are based on industry averages and the information you provided. Actual savings depend on your statement details, card mix, and eligibility. Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
            </p>
          </div>
        </section>

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
    5: "Final step! Your personalized savings estimate is seconds away.",
  };

  return (
    <div className="min-h-screen flex flex-col font-body bg-background">
      <SEO
        title="Free Savings Analysis - See How Much You Could Save"
        description="Take our 60-second quiz to get a personalized processing savings estimate. Free analysis, no obligation. Join 500+ Florida businesses saving with Liberty Bancard."
        path="/free-analysis"
        keywords="free statement analysis, payment processing savings, credit card processing, merchant services, rate comparison"
      />

      <PromoBanner variant="bar" promoId="free-processing" showCountdown />

      <section className="relative overflow-hidden" data-testid="section-quiz-hero">
        <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
        <div className="glow-blob w-64 h-64 bg-sky-500 top-10 right-1/4" />
        <div className="glow-blob glow-blob-2 w-48 h-48 bg-blue-600 bottom-4 left-1/3" />
        <div className="relative max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10 lg:py-14 text-center">
          <Link href="/" data-testid="link-quiz-logo">
            <img src={logoWhite} alt="Liberty Bancard" className="h-8 mx-auto mb-6 opacity-80" />
          </Link>
          <Badge variant="secondary" className="mb-4" data-testid="badge-quiz-time">
            <Clock className="w-3 h-3 mr-1" />
            60-Second Free Analysis
          </Badge>
          <h1
            className="text-3xl md:text-4xl font-display font-bold text-white mb-2"
            data-testid="text-quiz-heading"
          >
            See How Much You Could <span className="text-sky-400">Save</span> on Processing
          </h1>
          <p className="text-white/70 mb-3" data-testid="text-quiz-subheadline">
            Answer 5 quick questions. Get a personalized savings estimate in seconds.
          </p>
          {affiliateName && (
            <div className="flex items-center justify-center gap-2 mb-3" data-testid="badge-quiz-affiliate-branding">
              <Badge variant="secondary" className="bg-white/10 text-white/90 border-white/20">
                <UserCheck className="w-3 h-3 mr-1" />
                Recommended by {affiliateName}{affiliateCompany ? ` at ${affiliateCompany}` : ""}
              </Badge>
            </div>
          )}
          {promoCode && (
            <div className="flex items-center justify-center gap-2 mb-3" data-testid="badge-quiz-promo-applied">
              <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-300 border-emerald-400/30">
                <Zap className="w-3 h-3 mr-1" />
                Promo {promoCode} applied — check your eligibility below
              </Badge>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-white/50">
            <span className="flex items-center gap-1" data-testid="text-social-proof-1">
              <Users className="w-3 h-3" />
              Join 500+ FL businesses
            </span>
            <span className="flex items-center gap-1" data-testid="text-social-proof-2">
              <ShieldCheck className="w-3 h-3" />
              No obligation
            </span>
            <span className="flex items-center gap-1" data-testid="text-social-proof-3">
              <BadgeCheck className="w-3 h-3" />
              Free to keep
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
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium" data-testid="text-step-encouragement">
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
                      I agree to receive communications from Liberty Bancard including SMS messages. Standard rates apply. You can opt out at any time. See our{" "}
                      <Link href="/privacy-policy" className="underline">Privacy Policy</Link> and{" "}
                      <Link href="/sms-terms" className="underline">SMS Terms</Link>.
                    </label>
                  </div>
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
                        Analyzing...
                      </>
                    ) : (
                      <>
                        See My Savings
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
              <span className="flex items-center gap-1" data-testid="text-trust-lock">
                <Lock className="w-3 h-3" />
                256-bit SSL encrypted
              </span>
              <span className="flex items-center gap-1" data-testid="text-trust-no-cc">
                <CreditCard className="w-3 h-3" />
                No credit card required
              </span>
              <span className="flex items-center gap-1" data-testid="text-trust-time">
                <Clock className="w-3 h-3" />
                Takes under 60 seconds
              </span>
            </div>
          </div>

          <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4" data-testid="section-stats-bar">
            <div className="text-center">
              <p className="text-2xl font-display font-bold text-foreground" data-testid="text-stat-merchants">500+</p>
              <p className="text-xs text-muted-foreground">FL Merchants Served</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-display font-bold text-emerald-600" data-testid="text-stat-avg-savings">$4,200</p>
              <p className="text-xs text-muted-foreground">Avg. Annual Savings</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-display font-bold text-foreground" data-testid="text-stat-reviews">48hrs</p>
              <p className="text-xs text-muted-foreground">Avg. Statement Review</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-display font-bold text-foreground" data-testid="text-stat-rating">4.9/5</p>
              <p className="text-xs text-muted-foreground">Merchant Satisfaction</p>
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
                  <p className="text-sm font-semibold text-foreground mb-1">Answer 5 Questions</p>
                  <p className="text-xs text-muted-foreground">Tell us about your business, volume, and current processor. Takes 60 seconds.</p>
                </CardContent>
              </Card>
              <Card data-testid="card-how-step-2">
                <CardContent className="p-5 text-center">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <span className="text-primary font-bold">2</span>
                  </div>
                  <p className="text-sm font-semibold text-foreground mb-1">Get Your Estimate</p>
                  <p className="text-xs text-muted-foreground">We instantly calculate your estimated savings based on industry benchmarks.</p>
                </CardContent>
              </Card>
              <Card data-testid="card-how-step-3">
                <CardContent className="p-5 text-center">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <span className="text-primary font-bold">3</span>
                  </div>
                  <p className="text-sm font-semibold text-foreground mb-1">Confirm Exact Savings</p>
                  <p className="text-xs text-muted-foreground">Upload your statement for a free line-by-line analysis. No obligation to switch.</p>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="mt-10" data-testid="section-testimonials">
            <h3 className="text-lg font-display font-bold text-foreground text-center mb-6">What Business Owners Are Saying</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card data-testid="card-testimonial-1">
                <CardContent className="p-5">
                  <div className="flex items-center gap-1 mb-2">
                    {[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />)}
                  </div>
                  <p className="text-sm text-foreground italic leading-relaxed mb-3">
                    "We had no idea we were overpaying by $400/month until Liberty reviewed our statement. The switch took 2 days and we've saved over $5,000 this year."
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <UtensilsCrossed className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Marco T.</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Restaurant Owner, Fort Lauderdale
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="card-testimonial-2">
                <CardContent className="p-5">
                  <div className="flex items-center gap-1 mb-2">
                    {[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />)}
                  </div>
                  <p className="text-sm text-foreground italic leading-relaxed mb-3">
                    "I was skeptical, but the quiz showed I was paying 3.4% effective rate. Liberty got me to 2.1%. That's $800/month back in my pocket."
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Store className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Jennifer R.</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Retail Store Owner, Miami
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="card-testimonial-3">
                <CardContent className="p-5">
                  <div className="flex items-center gap-1 mb-2">
                    {[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />)}
                  </div>
                  <p className="text-sm text-foreground italic leading-relaxed mb-3">
                    "The 0% processing program completely eliminated my credit card fees. My customers don't mind the small surcharge and I keep 100% of my margins."
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Wrench className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Carlos M.</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Auto Repair Shop, Tampa
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card data-testid="card-testimonial-4">
                <CardContent className="p-5">
                  <div className="flex items-center gap-1 mb-2">
                    {[1,2,3,4,5].map(i => <Star key={i} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />)}
                  </div>
                  <p className="text-sm text-foreground italic leading-relaxed mb-3">
                    "Our dental practice was paying hidden fees we never knew about. Liberty found $6,200/year in savings and the onboarding was seamless."
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Stethoscope className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Dr. Sarah K.</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Dental Practice, Orlando
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="mt-10" data-testid="section-trust-badges">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card data-testid="card-badge-no-contract">
                <CardContent className="p-4 text-center">
                  <ShieldCheck className="w-7 h-7 text-primary mx-auto mb-2" />
                  <p className="text-xs font-semibold text-foreground">No Contract Lock-In</p>
                  <p className="text-[10px] text-muted-foreground">Month-to-month available</p>
                </CardContent>
              </Card>
              <Card data-testid="card-badge-pci">
                <CardContent className="p-4 text-center">
                  <Shield className="w-7 h-7 text-primary mx-auto mb-2" />
                  <p className="text-xs font-semibold text-foreground">PCI Compliant</p>
                  <p className="text-[10px] text-muted-foreground">Level 1 certified</p>
                </CardContent>
              </Card>
              <Card data-testid="card-badge-support">
                <CardContent className="p-4 text-center">
                  <Headphones className="w-7 h-7 text-primary mx-auto mb-2" />
                  <p className="text-xs font-semibold text-foreground">Real Human Support</p>
                  <p className="text-[10px] text-muted-foreground">954-266-8214</p>
                </CardContent>
              </Card>
              <Card data-testid="card-badge-nextday">
                <CardContent className="p-4 text-center">
                  <TrendingUp className="w-7 h-7 text-primary mx-auto mb-2" />
                  <p className="text-xs font-semibold text-foreground">Next-Day Funding</p>
                  <p className="text-[10px] text-muted-foreground">For qualified merchants</p>
                </CardContent>
              </Card>
            </div>
          </div>

          <FaqSection />

          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground mb-3" data-testid="text-bottom-cta">
              Still have questions? Call us at <a href="tel:9542668214" className="text-primary font-semibold underline">954-266-8214</a> or{" "}
              <Link href="/get-started" className="text-primary font-semibold underline">book a free 10-minute call</Link>.
            </p>
          </div>
        </div>
      </section>

      <footer className="bg-muted/50 border-t border-border py-6">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <p className="text-xs text-muted-foreground">
            Liberty Bancard | 954-266-8214 |{" "}
            <Link href="/privacy-policy" className="underline" data-testid="link-footer-privacy">Privacy Policy</Link> |{" "}
            <Link href="/terms" className="underline" data-testid="link-footer-terms">Terms</Link>
          </p>
          <p className="text-xs text-muted-foreground mt-2" data-testid="text-footer-disclaimer">
            Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
          </p>
        </div>
      </footer>
    </div>
  );
}
