import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  DollarSign,
  CreditCard,
  TrendingDown,
  Building2,
  AlertTriangle,
  Percent,
  Monitor,
  Upload,
  Phone,
  Share2,
  Copy,
  Check,
  UtensilsCrossed,
  Store,
  Stethoscope,
  Car,
  Wrench,
  ShoppingCart,
  MoreHorizontal,
  Zap,
  Shield,
  Clock,
  FileText,
} from "lucide-react";

const QUIZ_SHARE_URL = "https://libertybancard.com/quiz/processing-cost?utm_source=agent&utm_medium=share&utm_content=cost-quiz";

function QuizShareButton() {
  const [quizCopied, setQuizCopied] = useState(false);
  const { toast } = useToast();
  const handleCopy = () => {
    navigator.clipboard.writeText(QUIZ_SHARE_URL).catch(() => {
      const el = document.createElement("textarea");
      el.value = QUIZ_SHARE_URL;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    });
    setQuizCopied(true);
    toast({ title: "Link copied!", description: "Ready to paste in email, text, or chat." });
    setTimeout(() => setQuizCopied(false), 2200);
  };
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-2 text-white/80 hover:text-white text-sm border border-white/20 hover:border-white/40 rounded-md px-4 py-2.5 transition-colors"
      data-testid="button-share-quiz"
    >
      {quizCopied ? (
        <>
          <Check className="w-4 h-4 text-emerald-400" />
          Link copied!
        </>
      ) : (
        <>
          <Copy className="w-4 h-4" />
          Share This Quiz
        </>
      )}
    </button>
  );
}

const TOTAL_STEPS = 6;

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
  { value: "under-5k", label: "Under $5,000", monthlyMid: 2500 },
  { value: "5k-15k", label: "$5,000 - $15,000", monthlyMid: 10000 },
  { value: "15k-50k", label: "$15,000 - $50,000", monthlyMid: 32500 },
  { value: "50k-150k", label: "$50,000 - $150,000", monthlyMid: 100000 },
  { value: "150k-plus", label: "$150,000+", monthlyMid: 200000 },
];

const ticketOptions = [
  { value: "under-25", label: "Under $25", mid: 15 },
  { value: "25-75", label: "$25 - $75", mid: 50 },
  { value: "75-200", label: "$75 - $200", mid: 137 },
  { value: "200-500", label: "$200 - $500", mid: 350 },
  { value: "500-plus", label: "$500+", mid: 750 },
];

const processorOptions = [
  { value: "square", label: "Square" },
  { value: "stripe", label: "Stripe" },
  { value: "clover", label: "Clover" },
  { value: "toast", label: "Toast" },
  { value: "bank-processor", label: "Bank / Traditional Processor" },
  { value: "other", label: "Other / Not Sure" },
];

const rateOptions = [
  { value: "under-2", label: "Under 2.0%", rate: 1.8 },
  { value: "2-2.5", label: "2.0% - 2.5%", rate: 2.25 },
  { value: "2.5-3", label: "2.5% - 3.0%", rate: 2.75 },
  { value: "3-3.5", label: "3.0% - 3.5%", rate: 3.25 },
  { value: "3.5-plus", label: "3.5%+", rate: 3.75 },
  { value: "not-sure", label: "Not sure", rate: 2.9 },
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
  estimatedOverpayment: number;
  annualOverpayment: number;
  recommendedProgram: string;
  programDescription: string;
  recommendedTerminal: string;
  terminalDescription: string;
  savingsEstimate: string;
  effectiveRate: number;
  targetRate: number;
}

function calculateResults(
  volume: string,
  ticket: string,
  processor: string,
  rate: string,
  painPoints: string[],
  industry: string
): QuizResults {
  const volumeData = volumeOptions.find((v) => v.value === volume);
  const rateData = rateOptions.find((r) => r.value === rate);
  const ticketData = ticketOptions.find((t) => t.value === ticket);

  const monthlyVolume = volumeData?.monthlyMid || 25000;
  const currentRate = rateData?.rate || 2.9;
  const avgTicket = ticketData?.mid || 50;

  const isFlatRate = ["square", "stripe"].includes(processor);
  const isHighVolume = monthlyVolume >= 50000;
  const isLowTicket = avgTicket < 30;
  const isCashDiscountFriendly =
    ["restaurant", "automotive", "home-services", "retail"].includes(industry) &&
    avgTicket >= 25;

  let targetRate: number;
  let recommendedProgram: string;
  let programDescription: string;

  if (isCashDiscountFriendly && !isLowTicket) {
    targetRate = 0;
    recommendedProgram = "Cash Discount / Dual Pricing";
    programDescription =
      "Based on your industry and average ticket size, a compliant cash discount program could eliminate your processing costs entirely. Customers who pay with cash get the listed price; card payments include a small, clearly disclosed service fee. We handle disclosures, receipt formatting, and compliance.";
  } else if (isFlatRate || isHighVolume || currentRate > 2.5) {
    targetRate = isHighVolume ? 1.6 : 1.85;
    recommendedProgram = "Interchange-Plus Pricing";
    programDescription =
      "You're likely overpaying with bundled or flat-rate pricing. Interchange-plus gives you the actual card brand cost plus a small, transparent markup. No hidden fees, no padded rates. Most merchants in your volume range save 20-40% on processing costs.";
  } else {
    targetRate = 1.95;
    recommendedProgram = "Interchange-Plus Pricing";
    programDescription =
      "Even at your current rate, there may be hidden fees inflating your effective cost. Interchange-plus pricing eliminates the guesswork and shows you exactly what you're paying for every transaction.";
  }

  const currentMonthlyCost = (monthlyVolume * currentRate) / 100;
  const targetMonthlyCost = (monthlyVolume * targetRate) / 100;
  const monthlyOverpayment = Math.max(0, currentMonthlyCost - targetMonthlyCost);
  const annualOverpayment = monthlyOverpayment * 12;

  let recommendedTerminal: string;
  let terminalDescription: string;

  if (industry === "restaurant") {
    recommendedTerminal = "Clover Flex 3";
    terminalDescription =
      "Handheld POS with built-in printer, perfect for tableside service. Tip adjustment, kitchen printing, and full Clover app ecosystem.";
  } else if (industry === "retail" || industry === "ecommerce") {
    recommendedTerminal = "Clover Station Duo";
    terminalDescription =
      "Full POS system with dual screens, cash drawer, and inventory management. Ideal for retail environments with high transaction volume.";
  } else if (industry === "home-services" || industry === "automotive") {
    recommendedTerminal = "Dejavoo QD4";
    terminalDescription =
      "Rugged mobile terminal with all-day battery, 4G LTE, and built-in printer. Drop-tested and built for field work.";
  } else if (industry === "healthcare") {
    recommendedTerminal = "Clover Mini 3";
    terminalDescription =
      "Compact countertop terminal with customer-facing display. Ideal for co-pay collection with fingerprint staff login for security.";
  } else {
    recommendedTerminal = "PAX A920";
    terminalDescription =
      "Versatile smart terminal with 5-inch HD display, all-day battery, and support for all payment types including QR codes.";
  }

  const savingsPercent = currentRate > 0 ? Math.round(((currentRate - targetRate) / currentRate) * 100) : 0;
  const savingsEstimate =
    targetRate === 0
      ? "Up to 100% savings with cash discount"
      : `Estimated ${savingsPercent}% reduction in processing costs`;

  return {
    estimatedOverpayment: Math.round(monthlyOverpayment),
    annualOverpayment: Math.round(annualOverpayment),
    recommendedProgram,
    programDescription,
    recommendedTerminal,
    terminalDescription,
    savingsEstimate,
    effectiveRate: currentRate,
    targetRate,
  };
}

function buildShareUrl(
  industry: string,
  volume: string,
  ticket: string,
  processor: string,
  rate: string,
  painPoints: string[]
): string {
  const params = new URLSearchParams();
  params.set("i", industry);
  params.set("v", volume);
  params.set("t", ticket);
  params.set("p", processor);
  params.set("r", rate);
  if (painPoints.length > 0) params.set("pp", painPoints.join(","));
  return `${window.location.origin}/quiz/processing-cost?${params.toString()}`;
}

function parseShareParams(): {
  industry?: string;
  volume?: string;
  ticket?: string;
  processor?: string;
  rate?: string;
  painPoints?: string[];
} | null {
  const params = new URLSearchParams(window.location.search);
  const i = params.get("i");
  const v = params.get("v");
  const t = params.get("t");
  const p = params.get("p");
  const r = params.get("r");
  const pp = params.get("pp");

  if (i && v && t && p && r) {
    return {
      industry: i,
      volume: v,
      ticket: t,
      processor: p,
      rate: r,
      painPoints: pp ? pp.split(",") : [],
    };
  }
  return null;
}

export default function CostQuiz() {
  const [step, setStep] = useState(1);
  const [industry, setIndustry] = useState("");
  const [volume, setVolume] = useState("");
  const [ticket, setTicket] = useState("");
  const [processor, setProcessor] = useState("");
  const [rate, setRate] = useState("");
  const [painPoints, setPainPoints] = useState<string[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const shared = parseShareParams();
    if (shared) {
      setIndustry(shared.industry || "");
      setVolume(shared.volume || "");
      setTicket(shared.ticket || "");
      setProcessor(shared.processor || "");
      setRate(shared.rate || "");
      setPainPoints(shared.painPoints || []);
      setShowResults(true);
    }
  }, []);

  const canProceed = () => {
    switch (step) {
      case 1:
        return industry !== "";
      case 2:
        return volume !== "";
      case 3:
        return ticket !== "";
      case 4:
        return processor !== "";
      case 5:
        return rate !== "";
      case 6:
        return painPoints.length > 0;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS && canProceed()) {
      setStep(step + 1);
    } else if (step === TOTAL_STEPS && canProceed()) {
      setShowResults(true);
      const shareUrl = buildShareUrl(industry, volume, ticket, processor, rate, painPoints);
      window.history.replaceState(null, "", shareUrl.replace(window.location.origin, ""));
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleRestart = () => {
    setStep(1);
    setIndustry("");
    setVolume("");
    setTicket("");
    setProcessor("");
    setRate("");
    setPainPoints([]);
    setShowResults(false);
    window.history.replaceState(null, "", "/quiz/processing-cost");
  };

  const togglePainPoint = (value: string) => {
    setPainPoints((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]
    );
  };

  const handleCopyLink = () => {
    const url = buildShareUrl(industry, volume, ticket, processor, rate, painPoints);
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const results = showResults
    ? calculateResults(volume, ticket, processor, rate, painPoints, industry)
    : null;

  const stepHeadings = [
    "What industry are you in?",
    "What's your approximate monthly card volume?",
    "What's your average transaction size?",
    "Who processes your payments today?",
    "What's your current processing rate?",
    "What frustrates you most about your current processor?",
  ];

  if (showResults && results) {
    return (
      <div className="min-h-screen flex flex-col font-body">
        <SEO
          title="Your Processing Cost Results"
          description="See your personalized payment processing savings estimate and recommended program."
          path="/quiz/processing-cost"
          noindex={true}
        />
        <Navbar />

        <main className="flex-grow pt-28">
          <section className="relative overflow-hidden" data-testid="section-quiz-results-hero">
            <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
            <div className="glow-blob w-64 h-64 bg-emerald-500 top-10 right-1/4" />
            <div className="glow-blob glow-blob-2 w-48 h-48 bg-sky-500 bottom-4 left-1/4" />
            <div className="relative max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-emerald-400" />
              </div>
              <h1
                className="text-3xl md:text-4xl font-display font-bold text-white mb-2"
                data-testid="text-quiz-results-heading"
              >
                Your Personalized Results
              </h1>
              <p className="text-white/70">
                Based on your answers, here's what we found.
              </p>
            </div>
          </section>

          <section className="bg-muted/30 py-12" data-testid="section-quiz-results">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                <Card data-testid="card-overpayment-monthly">
                  <CardContent className="p-5 text-center">
                    <TrendingDown className="w-8 h-8 text-red-500 mx-auto mb-2" />
                    <p className="text-2xl font-display font-bold text-foreground" data-testid="text-monthly-overpayment">
                      ${results.estimatedOverpayment.toLocaleString()}
                    </p>
                    <p className="text-sm text-muted-foreground">Est. monthly overpayment</p>
                  </CardContent>
                </Card>
                <Card data-testid="card-overpayment-annual">
                  <CardContent className="p-5 text-center">
                    <DollarSign className="w-8 h-8 text-red-500 mx-auto mb-2" />
                    <p className="text-2xl font-display font-bold text-foreground" data-testid="text-annual-overpayment">
                      ${results.annualOverpayment.toLocaleString()}
                    </p>
                    <p className="text-sm text-muted-foreground">Est. annual overpayment</p>
                  </CardContent>
                </Card>
                <Card data-testid="card-rate-comparison">
                  <CardContent className="p-5 text-center">
                    <Percent className="w-8 h-8 text-primary mx-auto mb-2" />
                    <p className="text-2xl font-display font-bold text-foreground" data-testid="text-rate-comparison">
                      {results.effectiveRate}% → {results.targetRate}%
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
                  <Badge variant="secondary" data-testid="badge-savings-estimate">
                    <Zap className="w-3 h-3 mr-1" />
                    {results.savingsEstimate}
                  </Badge>
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

              <Card className="mb-8" data-testid="card-cta">
                <CardContent className="p-6">
                  <h3 className="text-lg font-display font-bold text-foreground mb-2">
                    Ready to see your exact savings?
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Upload your most recent processing statement for a free, line-by-line analysis. No obligation, no contract required.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Link href="/upload-statement" data-testid="link-quiz-upload">
                      <Button size="lg" className="gap-2 w-full">
                        <Upload className="w-4 h-4" />
                        Upload Statement for Free Review
                      </Button>
                    </Link>
                    <a href="tel:9542668214" data-testid="link-quiz-call">
                      <Button size="lg" variant="outline" className="gap-2 w-full">
                        <Phone className="w-4 h-4" />
                        Call 954-266-8214
                      </Button>
                    </a>
                  </div>
                </CardContent>
              </Card>

              <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleCopyLink}
                  data-testid="button-copy-link"
                >
                  {copied ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  {copied ? "Link Copied" : "Copy Share Link"}
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleRestart}
                  data-testid="button-retake-quiz"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Retake Quiz
                </Button>
              </div>

              <p className="text-xs text-muted-foreground text-center" data-testid="text-quiz-disclaimer">
                Estimates are based on industry averages and the information you provided. Actual savings depend on your statement details, card mix, and eligibility. Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
              </p>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="Processing Cost Quiz - Are You Overpaying?"
        description="Take our 60-second quiz to find out if you're overpaying on credit card processing. Get a personalized savings estimate and program recommendation."
        path="/quiz/processing-cost"
        noindex={true}
      />
      <Navbar />

      <main className="flex-grow pt-28">
        <section className="relative overflow-hidden" data-testid="section-quiz-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="glow-blob w-64 h-64 bg-sky-500 top-10 right-1/4" />
          <div className="relative max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 text-center">
            <Badge variant="secondary" className="mb-4" data-testid="badge-quiz-label">
              60-Second Quiz
            </Badge>
            <h1
              className="text-3xl md:text-4xl font-display font-bold text-white mb-2"
              data-testid="text-quiz-heading"
            >
              Are You <span className="text-sky-400">Overpaying</span> on Processing?
            </h1>
            <p className="text-white/70 mb-5" data-testid="text-quiz-subheadline">
              Answer 6 quick questions. We'll show you exactly where your money goes.
            </p>
            <QuizShareButton />
          </div>
        </section>

        <section className="bg-muted/30 py-12" data-testid="section-quiz">
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
            <p className="text-xs text-muted-foreground text-right mb-6">
              Step {step} of {TOTAL_STEPS}
            </p>

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
                          <span className="text-sm font-medium text-foreground">
                            {option.label}
                          </span>
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
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                              <CreditCard className="w-5 h-5 text-primary" />
                            </div>
                            <span className="text-sm font-medium text-foreground">
                              {option.label}
                            </span>
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
                  <div className="grid grid-cols-1 gap-3" data-testid="step-ticket">
                    {ticketOptions.map((option) => (
                      <Card
                        key={option.value}
                        className={`cursor-pointer transition-all duration-200 ${
                          ticket === option.value
                            ? "ring-2 ring-primary ring-offset-2"
                            : "hover-elevate"
                        }`}
                        onClick={() => setTicket(option.value)}
                        data-testid={`card-ticket-${option.value}`}
                      >
                        <CardContent className="p-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                              <DollarSign className="w-5 h-5 text-primary" />
                            </div>
                            <span className="text-sm font-medium text-foreground">
                              {option.label}
                            </span>
                          </div>
                          {ticket === option.value && (
                            <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {step === 4 && (
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
                        <CardContent className="p-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                              <Building2 className="w-5 h-5 text-primary" />
                            </div>
                            <span className="text-sm font-medium text-foreground">
                              {option.label}
                            </span>
                          </div>
                          {processor === option.value && (
                            <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {step === 5 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="step-rate">
                    {rateOptions.map((option) => (
                      <Card
                        key={option.value}
                        className={`cursor-pointer transition-all duration-200 ${
                          rate === option.value
                            ? "ring-2 ring-primary ring-offset-2"
                            : "hover-elevate"
                        }`}
                        onClick={() => setRate(option.value)}
                        data-testid={`card-rate-${option.value}`}
                      >
                        <CardContent className="p-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                              <Percent className="w-5 h-5 text-primary" />
                            </div>
                            <span className="text-sm font-medium text-foreground">
                              {option.label}
                            </span>
                          </div>
                          {rate === option.value && (
                            <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                          )}
                        </CardContent>
                      </Card>
                    ))}
                    <p className="text-xs text-muted-foreground sm:col-span-2 mt-1">
                      Not sure? Check your latest statement or select "Not sure" — we can still estimate.
                    </p>
                  </div>
                )}

                {step === 6 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="step-pain-points">
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
                          <span className="text-sm font-medium text-foreground">
                            {option.label}
                          </span>
                          {painPoints.includes(option.value) && (
                            <CheckCircle className="w-5 h-5 text-primary ml-auto shrink-0" />
                          )}
                        </CardContent>
                      </Card>
                    ))}
                    <p className="text-xs text-muted-foreground sm:col-span-2 mt-1">
                      Select all that apply.
                    </p>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 mt-8">
                  <Button
                    variant="outline"
                    onClick={handleBack}
                    disabled={step === 1}
                    className="gap-2"
                    data-testid="button-quiz-back"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back
                  </Button>
                  <Button
                    onClick={handleNext}
                    disabled={!canProceed()}
                    className="gap-2"
                    data-testid="button-quiz-next"
                  >
                    {step === TOTAL_STEPS ? "See My Results" : "Next"}
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}