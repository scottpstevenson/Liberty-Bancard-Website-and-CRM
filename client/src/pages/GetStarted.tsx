import { useState } from "react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
} from "lucide-react";

const TOTAL_STEPS = 6;

const goalOptions = [
  { value: "lower fees", label: "Lower my processing fees", icon: DollarSign },
  { value: "deposit clarity", label: "Deposit clarity and faster funding", icon: Landmark },
  { value: "0% interest", label: "0% processing (pass fees to customer)", icon: Percent },
  { value: "need terminal", label: "I need a terminal or POS system", icon: Monitor },
  { value: "compare vs flat-rate", label: "Compare vs Square, Stripe, or flat-rate", icon: Scale },
  { value: "not sure", label: "Not sure yet -- just exploring", icon: HelpCircle },
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
  { value: "Under $5k", label: "Under $5k" },
  { value: "$5k-$15k", label: "$5k - $15k" },
  { value: "$15k-$50k", label: "$15k - $50k" },
  { value: "$50k-$150k", label: "$50k - $150k" },
  { value: "$150k+", label: "$150k+" },
];

function getRecommendation(goal: string, interestedIn0: boolean, needTerminal: boolean) {
  if (goal === "0% interest" || interestedIn0) {
    return {
      path: "Compliant 0% Program",
      description: "Based on your answers, a compliant cash discount or surcharge program may be a fit. Upload your statement for an exact comparison.",
    };
  }
  if (goal === "lower fees") {
    return {
      path: "Wholesale / Interchange-Plus Pricing",
      description: "You may be overpaying with bundled or tiered pricing. Upload your statement and we will show you the exact markup.",
    };
  }
  if (goal === "need terminal" || needTerminal) {
    return {
      path: "Terminal + Processing Setup",
      description: "We will pair you with the right terminal for your business and build a processing package around it.",
    };
  }
  if (goal === "compare vs flat-rate") {
    return {
      path: "Square / Stripe Comparison",
      description: "Flat-rate pricing is simple but often costs more at volume. Upload your statement and we will show you the difference.",
    };
  }
  return {
    path: "Custom Review",
    description: "We will review your situation and recommend the best path forward. Upload your statement for the most accurate analysis.",
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

  const recommendation = getRecommendation(goal, interestedIn0 === true, needTerminal === true);

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col font-body">
        <Navbar />
        <main className="flex-grow pt-16">
          <section className="bg-background py-20" data-testid="section-get-started-results">
            <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-8 h-8 text-primary" />
              </div>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4" data-testid="text-results-heading">
                Your Recommended Path
              </h1>
              <Card className="mb-8" data-testid="card-recommendation">
                <CardContent className="p-6">
                  <h2 className="text-xl font-display font-semibold text-foreground mb-2" data-testid="text-recommendation-path">
                    {recommendation.path}
                  </h2>
                  <p className="text-muted-foreground leading-relaxed" data-testid="text-recommendation-description">
                    {recommendation.description}
                  </p>
                </CardContent>
              </Card>
              <div className="flex flex-col sm:flex-row gap-4 justify-center flex-wrap">
                <Link href="/upload-statement" data-testid="link-results-upload">
                  <Button size="lg" className="gap-2">
                    <Upload className="w-4 h-4" />
                    Upload Statement
                  </Button>
                </Link>
                <a href="#" data-testid="link-results-book-call">
                  <Button size="lg" variant="outline" className="gap-2">
                    <Calendar className="w-4 h-4" />
                    Book 10-Min Call
                  </Button>
                </a>
              </div>
              <p className="text-xs text-muted-foreground mt-6" data-testid="text-results-disclaimer">
                Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
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
      <Navbar />
      <main className="flex-grow pt-16">
        <section className="bg-background py-16" data-testid="section-get-started">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-8 text-center">
              <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2" data-testid="text-get-started-heading">
                Get Started
              </h1>
              <p className="text-muted-foreground" data-testid="text-get-started-subheadline">
                Answer a few quick questions so we can point you in the right direction.
              </p>
            </div>

            <div className="flex items-center gap-1 mb-8" data-testid="progress-indicator">
              {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                <div
                  key={i}
                  className={`h-2 flex-1 rounded-full transition-colors duration-300 ${
                    i + 1 <= step ? "bg-primary" : "bg-muted"
                  }`}
                  data-testid={`progress-step-${i + 1}`}
                />
              ))}
            </div>

            <Card data-testid="card-quiz">
              <CardContent className="p-6 sm:p-8">
                <div
                  className="transition-opacity duration-300"
                  style={{ opacity: 1 }}
                >
                  {step === 1 && (
                    <div data-testid="step-goal">
                      <h2 className="text-xl font-display font-bold text-foreground mb-6" data-testid="text-step-1-heading">
                        What are you trying to solve?
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                              <span className="text-sm font-medium text-foreground">{option.label}</span>
                              {goal === option.value && (
                                <CheckCircle className="w-5 h-5 text-primary ml-auto shrink-0" />
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}

                  {step === 2 && (
                    <div data-testid="step-vertical">
                      <h2 className="text-xl font-display font-bold text-foreground mb-6" data-testid="text-step-2-heading">
                        What type of business do you run?
                      </h2>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                    </div>
                  )}

                  {step === 3 && (
                    <div data-testid="step-volume">
                      <h2 className="text-xl font-display font-bold text-foreground mb-6" data-testid="text-step-3-heading">
                        What is your monthly card volume?
                      </h2>
                      <div className="grid grid-cols-1 gap-3">
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
                              <span className="text-sm font-medium text-foreground">{option.label}</span>
                              {monthlyVolume === option.value && (
                                <CheckCircle className="w-5 h-5 text-primary shrink-0" />
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}

                  {step === 4 && (
                    <div data-testid="step-terminal">
                      <h2 className="text-xl font-display font-bold text-foreground mb-6" data-testid="text-step-4-heading">
                        Do you need a terminal or POS system?
                      </h2>
                      <div className="grid grid-cols-2 gap-4">
                        <Button
                          variant={needTerminal === true ? "default" : "outline"}
                          size="lg"
                          className="h-auto py-6 text-lg"
                          onClick={() => setNeedTerminal(true)}
                          data-testid="button-terminal-yes"
                        >
                          Yes
                        </Button>
                        <Button
                          variant={needTerminal === false ? "default" : "outline"}
                          size="lg"
                          className="h-auto py-6 text-lg"
                          onClick={() => setNeedTerminal(false)}
                          data-testid="button-terminal-no"
                        >
                          No
                        </Button>
                      </div>
                    </div>
                  )}

                  {step === 5 && (
                    <div data-testid="step-zero-percent">
                      <h2 className="text-xl font-display font-bold text-foreground mb-3" data-testid="text-step-5-heading">
                        Interested in compliant 0% processing?
                      </h2>
                      <p className="text-sm text-muted-foreground mb-6" data-testid="text-step-5-note">
                        Where permitted by law and card brand rules, you can pass processing fees to the cardholder.
                      </p>
                      <div className="grid grid-cols-2 gap-4">
                        <Button
                          variant={interestedIn0 === true ? "default" : "outline"}
                          size="lg"
                          className="h-auto py-6 text-lg"
                          onClick={() => setInterestedIn0(true)}
                          data-testid="button-zero-yes"
                        >
                          Yes
                        </Button>
                        <Button
                          variant={interestedIn0 === false ? "default" : "outline"}
                          size="lg"
                          className="h-auto py-6 text-lg"
                          onClick={() => setInterestedIn0(false)}
                          data-testid="button-zero-no"
                        >
                          No
                        </Button>
                      </div>
                    </div>
                  )}

                  {step === 6 && (
                    <div data-testid="step-contact">
                      <h2 className="text-xl font-display font-bold text-foreground mb-6" data-testid="text-step-6-heading">
                        How can we reach you?
                      </h2>
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
                </div>

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

                  <span className="text-sm text-muted-foreground" data-testid="text-step-count">
                    Step {step} of {TOTAL_STEPS}
                  </span>

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
                          Submitting...
                        </>
                      ) : (
                        "Submit"
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
