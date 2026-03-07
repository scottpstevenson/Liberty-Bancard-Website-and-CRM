import { useState } from "react";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  CheckCircle,
  DollarSign,
  Landmark,
  Percent,
  Monitor,
  Scale,
  HelpCircle,
  Stethoscope,
  Car,
  UtensilsCrossed,
  Wrench,
  Store,
  MoreHorizontal,
  Upload,
  Calendar,
  FileText,
  Phone,
  Zap,
  ShieldCheck,
} from "lucide-react";
import imgCloverFlex3 from "@assets/images/terminal-clover-flex-3.png";

const TOTAL_STEPS = 6;

const goalOptions = [
  { value: "lower fees", label: "I think I'm overpaying on processing", icon: DollarSign, desc: "We'll show you exactly where" },
  { value: "deposit clarity", label: "Deposits are unpredictable", icon: Landmark, desc: "Get funding you can plan around" },
  { value: "0% interest", label: "Pass fees to the customer (0%)", icon: Percent, desc: "Where permitted by law" },
  { value: "need terminal", label: "I need a terminal or POS", icon: Monitor, desc: "Modern hardware, guided setup" },
  { value: "compare vs flat-rate", label: "Compare vs Square / Stripe", icon: Scale, desc: "See the real cost difference" },
  { value: "not sure", label: "Just exploring options", icon: HelpCircle, desc: "We'll point you in the right direction" },
];

const verticalOptions = [
  { value: "Medical/Dental/Medspa", label: "Medical / Dental / Medspa", icon: Stethoscope },
  { value: "Automotive", label: "Automotive", icon: Car },
  { value: "Restaurant", label: "Restaurant", icon: UtensilsCrossed },
  { value: "Home Services", label: "Home Services", icon: Wrench },
  { value: "Retail", label: "Retail", icon: Store },
  { value: "Other", label: "Other", icon: MoreHorizontal },
];

const volumeOptions = [
  { value: "Under $5k", label: "Under $5,000", sub: "Starter volume" },
  { value: "$5k-$15k", label: "$5,000 - $15,000", sub: "Growing business" },
  { value: "$15k-$50k", label: "$15,000 - $50,000", sub: "Established operator" },
  { value: "$50k-$150k", label: "$50,000 - $150,000", sub: "High volume" },
  { value: "$150k+", label: "$150,000+", sub: "Enterprise volume" },
];

function getRecommendation(goal: string, vertical: string, volume: string, interestedIn0: boolean, needTerminal: boolean) {
  const isHighVolume = ["$50k-$150k", "$150k+"].includes(volume);

  if (goal === "0% interest" || interestedIn0) {
    return {
      path: "Compliant 0% Program",
      icon: Percent,
      headline: "A compliant fee-offset program could significantly reduce your processing cost.",
      description: "Based on your answers, a cash discount or surcharge program could be a strong fit. We'll verify eligibility for your state, card brands, and business model - then handle disclosures, receipt formatting, and staff scripts.",
      urgency: "Most merchants in your vertical are already exploring this option.",
      nextSteps: [
        { label: "Upload your statement for exact comparison", primary: true, href: "/upload-statement?interest0=yes" },
        { label: "Learn more about 0% programs", primary: false, href: "/0-percent-processing" },
      ],
    };
  }
  if (goal === "lower fees") {
    return {
      path: "Wholesale / Interchange-Plus Pricing",
      icon: DollarSign,
      headline: isHighVolume ? "At your volume, even small rate differences compound fast." : "Most merchants your size have never seen their real effective rate.",
      description: "You're likely on bundled or tiered pricing, which hides the real markup. We'll break down your statement line-by-line and show you exactly what interchange costs vs. what your processor charges on top.",
      urgency: isHighVolume ? "High-volume merchants benefit most from transparent pricing. Upload for a detailed analysis." : "A statement review will reveal whether there's room to improve.",
      nextSteps: [
        { label: "Upload statement for line-item breakdown", primary: true, href: "/upload-statement" },
        { label: "Get a quick estimate first", primary: false, href: "/estimate" },
      ],
    };
  }
  if (goal === "need terminal" || needTerminal) {
    return {
      path: "Terminal + Processing Package",
      icon: Monitor,
      headline: "The right terminal paired with the right pricing makes all the difference.",
      description: "We'll pair you with the Liberty Smart Terminal - modern, reliable, and set up with guided onboarding. Free equipment for qualifying merchants.* Processing is bundled so you get one relationship for hardware + support.",
      urgency: "Most terminal setups are completed within 48 hours of approval.",
      nextSteps: [
        { label: "Upload statement to check eligibility", primary: true, href: "/upload-statement?terminal=yes" },
        { label: "Call us to discuss setup", primary: false, href: "tel:9542668214" },
      ],
    };
  }
  if (goal === "compare vs flat-rate") {
    return {
      path: "Square / Stripe Cost Comparison",
      icon: Scale,
      headline: isHighVolume ? "At your volume, flat-rate pricing deserves a second look." : "Flat-rate is simple, but simple doesn't always mean cost-effective.",
      description: "We'll compare your current flat-rate costs against interchange-plus pricing using your actual numbers. The comparison will reveal exactly where your money goes and whether there's a better structure for your business.",
      urgency: "The comparison takes minutes. Upload your statement to see the real numbers.",
      nextSteps: [
        { label: "Upload statement for exact comparison", primary: true, href: "/upload-statement" },
        { label: "See how the comparison works", primary: false, href: "/beat-square-stripe" },
      ],
    };
  }
  if (goal === "deposit clarity") {
    return {
      path: "Funding Clarity + Rate Review",
      icon: Landmark,
      headline: "Unpredictable deposits usually point to a bigger issue.",
      description: "Funding timing depends on cutoffs, risk holds, and your processor's schedule. We'll review your setup, clarify what's causing delays, and show you next-day funding options where available.*",
      urgency: "Most funding issues can be resolved within your first week of switching.",
      nextSteps: [
        { label: "Upload statement to start review", primary: true, href: "/upload-statement" },
        { label: "Call us about funding issues", primary: false, href: "tel:9542668214" },
      ],
    };
  }
  return {
    path: "Custom Review",
    icon: FileText,
    headline: "Not sure what you need? Your statement will tell us.",
    description: "Upload your most recent processing statement and we'll identify the specific cost drivers, markup, and opportunities in your current setup. You keep the breakdown either way.",
    urgency: "Most reviews are completed same-day during business hours.",
    nextSteps: [
      { label: "Upload statement for free review", primary: true, href: "/upload-statement" },
      { label: "Talk to someone first", primary: false, href: "tel:9542668214" },
    ],
  };
}

export default function GetStarted() {
  const [step, setStep] = useState(1);
  const [goal, setGoal] = useState("");
  const [vertical, setVertical] = useState("");
  const [monthlyVolume, setMonthlyVolume] = useState("");
  const [needTerminal, setNeedTerminal] = useState<boolean | null>(null);
  const [interestedIn0, setInterestedIn0] = useState<boolean | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();
  const resultsRef = useScrollReveal();

  const canProceed = () => {
    switch (step) {
      case 1: return goal !== "";
      case 2: return vertical !== "";
      case 3: return monthlyVolume !== "";
      case 4: return needTerminal !== null;
      case 5: return interestedIn0 !== null;
      case 6: return firstName.trim() !== "" && lastName.trim() !== "" && email.trim() !== "" && phone.trim() !== "" && consent;
      default: return false;
    }
  };

  const handleNext = () => {
    if (canProceed() && step < TOTAL_STEPS) {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleSubmit = async () => {
    if (!canProceed()) return;
    setSubmitting(true);
    try {
      await apiRequest("POST", "/api/public/get-started", {
        goal,
        vertical,
        monthlyVolume,
        needTerminal: needTerminal === true,
        interestedIn0Percent: interestedIn0 === true,
        firstName,
        lastName,
        email,
        phone,
        consentSms: consent,
      });
      setSubmitted(true);
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

  const recommendation = getRecommendation(goal, vertical, monthlyVolume, interestedIn0 === true, needTerminal === true);

  if (submitted) {
    const RecIcon = recommendation.icon;
    return (
      <div className="min-h-screen flex flex-col font-body">
        <Navbar />
        <main className="flex-grow pt-28" ref={resultsRef}>
          <section className="relative overflow-hidden" data-testid="section-get-started-results-hero">
            <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
            <div className="glow-blob w-64 h-64 bg-emerald-500 top-10 right-1/4" />
            <div className="glow-blob glow-blob-2 w-48 h-48 bg-sky-500 bottom-4 left-1/4" />
            <div className="relative max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-emerald-400" />
              </div>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-2" data-testid="text-results-heading">
                Your Personalized Recommendation
              </h1>
              <p className="text-white/70">Based on your answers, here's the best path forward.</p>
            </div>
          </section>

          <section className="bg-muted/30 py-12" data-testid="section-get-started-results">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="reveal">
                <Card className="border-2 border-primary/20 mb-8" data-testid="card-recommendation">
                  <CardContent className="p-6 sm:p-8">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <RecIcon className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <div className="text-xs font-medium text-primary uppercase tracking-wider">Recommended Path</div>
                        <h2 className="text-xl font-display font-bold text-foreground" data-testid="text-recommendation-path">
                          {recommendation.path}
                        </h2>
                      </div>
                    </div>

                    <h3 className="text-lg font-semibold text-foreground mb-3" data-testid="text-recommendation-headline">
                      {recommendation.headline}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed mb-4" data-testid="text-recommendation-description">
                      {recommendation.description}
                    </p>

                    <div className="bg-primary/5 rounded-md p-3 mb-6 flex items-start gap-2" data-testid="text-recommendation-urgency">
                      <Zap className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <p className="text-sm text-foreground font-medium">{recommendation.urgency}</p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      {recommendation.nextSteps.map((ns, i) => (
                        ns.href.startsWith("tel:") ? (
                          <a key={i} href={ns.href} data-testid={`link-results-action-${i}`}>
                            <Button size="lg" variant={ns.primary ? "default" : "outline"} className="gap-2 w-full">
                              <Phone className="w-4 h-4" />
                              {ns.label}
                            </Button>
                          </a>
                        ) : (
                          <Link key={i} href={ns.href} data-testid={`link-results-action-${i}`}>
                            <Button size="lg" variant={ns.primary ? "default" : "outline"} className="gap-2 w-full">
                              {ns.primary ? <Upload className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                              {ns.label}
                            </Button>
                          </Link>
                        )
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                <div className="reveal reveal-delay-1">
                  <Card data-testid="card-result-trust-1">
                    <CardContent className="p-4 text-center">
                      <ShieldCheck className="w-8 h-8 text-primary mx-auto mb-2" />
                      <p className="text-sm font-medium text-foreground">No Contract Required</p>
                      <p className="text-xs text-muted-foreground">Review is free and no-obligation</p>
                    </CardContent>
                  </Card>
                </div>
                <div className="reveal reveal-delay-2">
                  <Card data-testid="card-result-trust-2">
                    <CardContent className="p-4 text-center">
                      <FileText className="w-8 h-8 text-primary mx-auto mb-2" />
                      <p className="text-sm font-medium text-foreground">Keep the Breakdown</p>
                      <p className="text-xs text-muted-foreground">Even if you don't switch</p>
                    </CardContent>
                  </Card>
                </div>
                <div className="reveal reveal-delay-3">
                  <Card data-testid="card-result-trust-3">
                    <CardContent className="p-4 text-center">
                      <Phone className="w-8 h-8 text-primary mx-auto mb-2" />
                      <p className="text-sm font-medium text-foreground">Real Human Support</p>
                      <p className="text-xs text-muted-foreground">954-266-8214</p>
                    </CardContent>
                  </Card>
                </div>
              </div>

              <p className="text-xs text-muted-foreground text-center" data-testid="text-results-disclaimer">
                Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
              </p>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    );
  }

  const stepHeadings = [
    "What's the #1 thing you want to solve?",
    "What type of business do you run?",
    "What's your monthly card volume?",
    "Do you need a terminal or POS system?",
    "Interested in passing fees to the customer?",
    "Last step - how can we reach you?",
  ];

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO title="Get Started - Free Statement Analysis" description="Answer a few questions and get a personalized processing recommendation. Free statement review, no obligation." path="/get-started" breadcrumbs={[{ name: "Get Started", path: "/get-started" }]} />
      <Navbar />
      <main className="flex-grow pt-28">
        <section className="relative overflow-hidden" data-testid="section-get-started-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="glow-blob w-64 h-64 bg-sky-500 top-10 right-1/4" />
          <div className="relative max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 text-center">
            <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-2" data-testid="text-get-started-heading">
              Find Your <span className="text-sky-400">Best Path</span> Forward
            </h1>
            <p className="text-white/70" data-testid="text-get-started-subheadline">
              60 seconds. 6 questions. We'll tell you exactly what to do next.
            </p>
          </div>
        </section>

        <section className="bg-muted/30 py-12" data-testid="section-get-started">
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
            <p className="text-xs text-muted-foreground text-right mb-6">Step {step} of {TOTAL_STEPS}</p>

            <Card data-testid="card-quiz">
              <CardContent className="p-6 sm:p-8">
                <h2 className="text-xl font-display font-bold text-foreground mb-6" data-testid="text-step-heading">
                  {stepHeadings[step - 1]}
                </h2>

                {step === 1 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="step-goal">
                    {goalOptions.map((option) => (
                      <Card
                        key={option.value}
                        className={`cursor-pointer transition-all duration-200 ${
                          goal === option.value
                            ? "ring-2 ring-primary ring-offset-2"
                            : "hover-elevate"
                        }`}
                        onClick={() => setGoal(option.value)}
                        data-testid={`card-goal-${option.value.replace(/\s+/g, "-")}`}
                      >
                        <CardContent className="p-4 flex items-center gap-3">
                          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                            <option.icon className="w-5 h-5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <span className="text-sm font-medium text-foreground block">{option.label}</span>
                            <span className="text-xs text-muted-foreground">{option.desc}</span>
                          </div>
                          {goal === option.value && (
                            <CheckCircle className="w-5 h-5 text-primary ml-auto shrink-0" />
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {step === 2 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="step-vertical">
                    {verticalOptions.map((option) => (
                      <Card
                        key={option.value}
                        className={`cursor-pointer transition-all duration-200 ${
                          vertical === option.value
                            ? "ring-2 ring-primary ring-offset-2"
                            : "hover-elevate"
                        }`}
                        onClick={() => setVertical(option.value)}
                        data-testid={`card-vertical-${option.value.replace(/[/\s]+/g, "-").toLowerCase()}`}
                      >
                        <CardContent className="p-4 flex items-center gap-3">
                          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                            <option.icon className="w-5 h-5 text-primary" />
                          </div>
                          <span className="text-sm font-medium text-foreground">{option.label}</span>
                          {vertical === option.value && (
                            <CheckCircle className="w-5 h-5 text-primary ml-auto shrink-0" />
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {step === 3 && (
                  <div className="grid grid-cols-1 gap-3" data-testid="step-volume">
                    {volumeOptions.map((option) => (
                      <Card
                        key={option.value}
                        className={`cursor-pointer transition-all duration-200 ${
                          monthlyVolume === option.value
                            ? "ring-2 ring-primary ring-offset-2"
                            : "hover-elevate"
                        }`}
                        onClick={() => setMonthlyVolume(option.value)}
                        data-testid={`card-volume-${option.value.replace(/[$ +]/g, "").toLowerCase()}`}
                      >
                        <CardContent className="p-4 flex items-center justify-between gap-3">
                          <div>
                            <span className="text-sm font-medium text-foreground block">{option.label}</span>
                            <span className="text-xs text-muted-foreground">{option.sub}</span>
                          </div>
                          {monthlyVolume === option.value && (
                            <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {step === 4 && (
                  <div data-testid="step-terminal">
                    <div className="flex justify-center mb-6">
                      <img src={imgCloverFlex3} alt="Clover Flex 3 payment terminal" className="w-40 rounded-md object-contain" data-testid="img-quiz-terminal" />
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      We offer the Liberty Smart Terminal - free for qualifying merchants.* Tap, dip, swipe, and manual key.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <Button
                        variant={needTerminal === true ? "default" : "outline"}
                        size="lg"
                        className="h-auto py-6 text-lg"
                        onClick={() => setNeedTerminal(true)}
                        data-testid="button-terminal-yes"
                      >
                        Yes, I need one
                      </Button>
                      <Button
                        variant={needTerminal === false ? "default" : "outline"}
                        size="lg"
                        className="h-auto py-6 text-lg"
                        onClick={() => setNeedTerminal(false)}
                        data-testid="button-terminal-no"
                      >
                        No, I'm set
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-3">*Eligibility, underwriting, card brand rules, and applicable laws apply.</p>
                  </div>
                )}

                {step === 5 && (
                  <div data-testid="step-zero-percent">
                    <p className="text-sm text-muted-foreground mb-4">
                      Where permitted by law and card brand rules, you can pass processing fees to the cardholder through a compliant cash discount or surcharge program.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <Button
                        variant={interestedIn0 === true ? "default" : "outline"}
                        size="lg"
                        className="h-auto py-6 text-lg"
                        onClick={() => setInterestedIn0(true)}
                        data-testid="button-zero-yes"
                      >
                        Yes, tell me more
                      </Button>
                      <Button
                        variant={interestedIn0 === false ? "default" : "outline"}
                        size="lg"
                        className="h-auto py-6 text-lg"
                        onClick={() => setInterestedIn0(false)}
                        data-testid="button-zero-no"
                      >
                        Not interested
                      </Button>
                    </div>
                  </div>
                )}

                {step === 6 && (
                  <div data-testid="step-contact">
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm font-medium text-foreground mb-1.5 block" htmlFor="firstName">
                            First Name
                          </label>
                          <Input
                            id="firstName"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            placeholder="Jane"
                            data-testid="input-first-name"
                          />
                        </div>
                        <div>
                          <label className="text-sm font-medium text-foreground mb-1.5 block" htmlFor="lastName">
                            Last Name
                          </label>
                          <Input
                            id="lastName"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            placeholder="Doe"
                            data-testid="input-last-name"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1.5 block" htmlFor="email">
                          Email
                        </label>
                        <Input
                          id="email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="jane@example.com"
                          data-testid="input-email"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1.5 block" htmlFor="phone">
                          Phone
                        </label>
                        <Input
                          id="phone"
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="(555) 123-4567"
                          data-testid="input-phone"
                        />
                      </div>
                      <div className="flex items-start gap-3 pt-2">
                        <Checkbox
                          id="consent"
                          checked={consent}
                          onCheckedChange={(checked) => setConsent(checked === true)}
                          data-testid="checkbox-consent"
                        />
                        <label htmlFor="consent" className="text-sm text-muted-foreground leading-relaxed cursor-pointer">
                          I agree to receive calls, texts, and emails from Liberty Bancard. Message and data rates may apply. Reply STOP to opt out.
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-center mt-8 pt-6 border-t border-border gap-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleBack}
                    disabled={step === 1}
                    data-testid="button-back"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>

                  {step < TOTAL_STEPS ? (
                    <Button
                      type="button"
                      onClick={handleNext}
                      disabled={!canProceed()}
                      data-testid="button-next"
                    >
                      Next
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={handleSubmit}
                      disabled={!canProceed() || submitting}
                      data-testid="button-submit"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Getting your results...
                        </>
                      ) : (
                        <>
                          Get My Recommendation
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground text-center mt-6" data-testid="text-quiz-disclaimer">
              Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
