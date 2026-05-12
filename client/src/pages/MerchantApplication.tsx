import { useState, useEffect, useRef } from "react";
import { SEO } from "@/components/SEO";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest } from "@/lib/queryClient";
import { getStoredUTMParams } from "@/lib/utm";
import { trackMerchantApplication } from "@/lib/tracking";
import { trackConversion } from "@/lib/analytics";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  CheckCircle,
  Building2,
  User,
  Landmark,
  CreditCard,
  Monitor,
  FileCheck,
  ClipboardList,
  ShieldCheck,
  Save,
  Info,
} from "lucide-react";
import { Link, useLocation } from "wouter";

const DRAFT_KEY = "merchant_app_draft";

const TOTAL_STEPS = 6;

const BUSINESS_TYPES = [
  "Sole Proprietorship",
  "LLC",
  "Corporation",
  "Partnership",
  "Non-Profit",
  "Government",
];

const VERTICALS = [
  "Medical/Dental/Medspa",
  "Automotive",
  "Restaurant",
  "Home Services",
  "Retail",
  "Other",
];

const TERMINAL_TYPES = [
  "Clover Flex",
  "Clover Mini",
  "Clover Station",
  "Dejavoo Z11",
  "PAX A920",
  "Virtual Terminal Only",
  "Mobile Reader",
];

const PREFERRED_PROGRAMS = [
  "Cash Discount",
  "Interchange Plus",
  "Tiered",
];

const CARD_TYPES = ["Visa", "Mastercard", "Amex", "Discover"];

const stepInfo = [
  { label: "Business Information", icon: Building2 },
  { label: "Owner Information", icon: User },
  { label: "Bank Information", icon: Landmark },
  { label: "Processing Details", icon: CreditCard },
  { label: "Equipment & Program", icon: Monitor },
  { label: "Review & Submit", icon: FileCheck },
];

export default function MerchantApplication() {
  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [applicationId, setApplicationId] = useState<number | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [draftTime, setDraftTime] = useState<string | null>(null);
  const [draftDismissed, setDraftDismissed] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [showDraftSaved, setShowDraftSaved] = useState(false);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const draftSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [legalBusinessName, setLegalBusinessName] = useState("");
  const [dba, setDba] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [ein, setEin] = useState("");
  const [businessStartDate, setBusinessStartDate] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessCity, setBusinessCity] = useState("");
  const [businessState, setBusinessState] = useState("");
  const [businessZip, setBusinessZip] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [vertical, setVertical] = useState("");

  const [ownerFirstName, setOwnerFirstName] = useState("");
  const [ownerLastName, setOwnerLastName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [ownerDob, setOwnerDob] = useState("");
  const [ownerSsn, setOwnerSsn] = useState("");
  const [ownerAddress, setOwnerAddress] = useState("");
  const [ownerCity, setOwnerCity] = useState("");
  const [ownerState, setOwnerState] = useState("");
  const [ownerZip, setOwnerZip] = useState("");
  const [ownershipPercent, setOwnershipPercent] = useState("");

  const [bankName, setBankName] = useState("");
  const [bankRoutingNumber, setBankRoutingNumber] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [bankAccountType, setBankAccountType] = useState("");

  const [estimatedMonthlyVolume, setEstimatedMonthlyVolume] = useState("");
  const [estimatedAvgTicket, setEstimatedAvgTicket] = useState("");
  const [highestTicket, setHighestTicket] = useState("");
  const [currentProcessor, setCurrentProcessor] = useState("");
  const [currentRate, setCurrentRate] = useState("");
  const [acceptedCardTypes, setAcceptedCardTypes] = useState<string[]>([]);

  const [terminalNeeded, setTerminalNeeded] = useState<boolean | null>(null);
  const [terminalType, setTerminalType] = useState("");
  const [terminalQuantity, setTerminalQuantity] = useState("1");
  const [ecommerceNeeded, setEcommerceNeeded] = useState<boolean | null>(null);
  const [preferredProgram, setPreferredProgram] = useState("");

  const [esignSending, setEsignSending] = useState(false);
  const [esignStatus, setEsignStatus] = useState<string | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.formData) {
          setHasDraft(true);
          setDraftTime(parsed.lastSaved || null);
        }
      } catch {
        localStorage.removeItem(DRAFT_KEY);
      }
    }
  }, []);

  useEffect(() => {
    if (submitted) return;
    const formData = {
      legalBusinessName, dba, businessType, ein, businessStartDate,
      businessAddress, businessCity, businessState, businessZip,
      businessPhone, businessEmail, website, vertical,
      ownerFirstName, ownerLastName, ownerEmail, ownerPhone,
      ownerDob, ownerAddress, ownerCity, ownerState, ownerZip,
      ownershipPercent,
      ssnEntered: ownerSsn.replace(/\D/g, "").length === 9,
      bankName,
      bankAccountType,
      bankAccountEntered: bankRoutingNumber.trim() !== "" && bankAccountNumber.trim() !== "",
      estimatedMonthlyVolume, estimatedAvgTicket, highestTicket,
      currentProcessor, currentRate, acceptedCardTypes,
      terminalNeeded, terminalType, terminalQuantity, ecommerceNeeded, preferredProgram,
      reviewConfirmed,
    };
    const now = new Date().toISOString();
    const draft = { currentStep, formData, lastSaved: now };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    if (currentStep >= 1 && (legalBusinessName.trim() !== "" || ownerFirstName.trim() !== "")) {
      setDraftSavedAt(new Date());
      setShowDraftSaved(true);
      if (draftSavedTimerRef.current) clearTimeout(draftSavedTimerRef.current);
      draftSavedTimerRef.current = setTimeout(() => setShowDraftSaved(false), 2500);
    }
  }, [currentStep, legalBusinessName, dba, businessType, ein, businessStartDate,
    businessAddress, businessCity, businessState, businessZip, businessPhone,
    businessEmail, website, vertical, ownerFirstName, ownerLastName, ownerEmail,
    ownerPhone, ownerDob, ownerSsn, ownerAddress, ownerCity, ownerState, ownerZip,
    ownershipPercent, bankName, bankRoutingNumber, bankAccountNumber, bankAccountType,
    estimatedMonthlyVolume, estimatedAvgTicket, highestTicket, currentProcessor,
    currentRate, acceptedCardTypes, terminalNeeded, terminalType, terminalQuantity,
    ecommerceNeeded, preferredProgram, reviewConfirmed, submitted]);

  useEffect(() => {
    if (currentStep >= 2 && !submitted) {
      const warn = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = "";
      };
      window.addEventListener("beforeunload", warn);
      return () => window.removeEventListener("beforeunload", warn);
    }
  }, [currentStep, submitted]);

  const restoreDraft = () => {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (!saved) return;
    try {
      const { currentStep: step, formData: data } = JSON.parse(saved);
      if (data.legalBusinessName) setLegalBusinessName(data.legalBusinessName);
      if (data.dba) setDba(data.dba);
      if (data.businessType) setBusinessType(data.businessType);
      if (data.ein) setEin(data.ein);
      if (data.businessStartDate) setBusinessStartDate(data.businessStartDate);
      if (data.businessAddress) setBusinessAddress(data.businessAddress);
      if (data.businessCity) setBusinessCity(data.businessCity);
      if (data.businessState) setBusinessState(data.businessState);
      if (data.businessZip) setBusinessZip(data.businessZip);
      if (data.businessPhone) setBusinessPhone(data.businessPhone);
      if (data.businessEmail) setBusinessEmail(data.businessEmail);
      if (data.website) setWebsite(data.website);
      if (data.vertical) setVertical(data.vertical);
      if (data.ownerFirstName) setOwnerFirstName(data.ownerFirstName);
      if (data.ownerLastName) setOwnerLastName(data.ownerLastName);
      if (data.ownerEmail) setOwnerEmail(data.ownerEmail);
      if (data.ownerPhone) setOwnerPhone(data.ownerPhone);
      if (data.ownerDob) setOwnerDob(data.ownerDob);
      if (data.ownerAddress) setOwnerAddress(data.ownerAddress);
      if (data.ownerCity) setOwnerCity(data.ownerCity);
      if (data.ownerState) setOwnerState(data.ownerState);
      if (data.ownerZip) setOwnerZip(data.ownerZip);
      if (data.ownershipPercent) setOwnershipPercent(data.ownershipPercent);
      if (data.bankName) setBankName(data.bankName);
      if (data.bankAccountType) setBankAccountType(data.bankAccountType);
      if (data.estimatedMonthlyVolume) setEstimatedMonthlyVolume(data.estimatedMonthlyVolume);
      if (data.estimatedAvgTicket) setEstimatedAvgTicket(data.estimatedAvgTicket);
      if (data.highestTicket) setHighestTicket(data.highestTicket);
      if (data.currentProcessor) setCurrentProcessor(data.currentProcessor);
      if (data.currentRate) setCurrentRate(data.currentRate);
      if (data.acceptedCardTypes) setAcceptedCardTypes(data.acceptedCardTypes);
      if (data.terminalNeeded !== undefined) setTerminalNeeded(data.terminalNeeded);
      if (data.terminalType) setTerminalType(data.terminalType);
      if (data.terminalQuantity) setTerminalQuantity(data.terminalQuantity);
      if (data.ecommerceNeeded !== undefined) setEcommerceNeeded(data.ecommerceNeeded);
      if (data.preferredProgram) setPreferredProgram(data.preferredProgram);
      if (step) setCurrentStep(step);
      setHasDraft(false);
      setDraftDismissed(true);
      toast({ title: "Draft restored", description: "Your application progress has been restored." });
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  };

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    setHasDraft(false);
    setDraftDismissed(true);
  };

  const toggleCardType = (type: string) => {
    setAcceptedCardTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const maskSsn = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 9);
    if (digits.length <= 3) return digits;
    if (digits.length <= 5) return digits.slice(0, 3) + "-" + digits.slice(3);
    return digits.slice(0, 3) + "-" + digits.slice(3, 5) + "-" + digits.slice(5);
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return (
          legalBusinessName.trim() !== "" &&
          businessType !== "" &&
          ein.trim() !== "" &&
          businessAddress.trim() !== "" &&
          businessCity.trim() !== "" &&
          businessState.trim() !== "" &&
          businessZip.trim() !== "" &&
          businessPhone.trim() !== "" &&
          businessEmail.trim() !== "" &&
          vertical !== ""
        );
      case 2:
        return (
          ownerFirstName.trim() !== "" &&
          ownerLastName.trim() !== "" &&
          ownerEmail.trim() !== "" &&
          ownerPhone.trim() !== "" &&
          ownerDob.trim() !== "" &&
          ownerSsn.replace(/\D/g, "").length === 9 &&
          ownerAddress.trim() !== "" &&
          ownerCity.trim() !== "" &&
          ownerState.trim() !== "" &&
          ownerZip.trim() !== "" &&
          ownershipPercent.trim() !== ""
        );
      case 3:
        return (
          bankName.trim() !== "" &&
          bankRoutingNumber.trim() !== "" &&
          bankAccountNumber.trim() !== "" &&
          bankAccountType !== ""
        );
      case 4:
        return (
          estimatedMonthlyVolume.trim() !== "" &&
          estimatedAvgTicket.trim() !== "" &&
          highestTicket.trim() !== "" &&
          acceptedCardTypes.length > 0
        );
      case 5:
        return (
          terminalNeeded !== null &&
          ecommerceNeeded !== null &&
          preferredProgram !== "" &&
          (terminalNeeded === false || (terminalType !== "" && terminalQuantity.trim() !== ""))
        );
      case 6:
        return reviewConfirmed;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (canProceed() && currentStep < TOTAL_STEPS) {
      setCurrentStep(currentStep + 1);
      setTimeout(() => stepHeadingRef.current?.focus(), 50);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setTimeout(() => stepHeadingRef.current?.focus(), 50);
    }
  };

  const handleSubmit = async () => {
    if (!canProceed()) return;
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/merchant-applications", {
        status: "submitted",
        currentStep: 6,
        totalSteps: 6,
        legalBusinessName,
        dba,
        businessType,
        ein,
        businessStartDate,
        businessAddress,
        businessCity,
        businessState,
        businessZip,
        businessPhone,
        businessEmail,
        website,
        vertical,
        ownerFirstName,
        ownerLastName,
        ownerEmail,
        ownerPhone,
        ownerDob,
        ownerSsn: ownerSsn.replace(/\D/g, ""),
        ownerAddress,
        ownerCity,
        ownerState,
        ownerZip,
        ownershipPercent: parseInt(ownershipPercent) || 0,
        bankName,
        bankRoutingNumber,
        bankAccountNumber,
        bankAccountType,
        estimatedMonthlyVolume,
        estimatedAvgTicket,
        highestTicket,
        currentProcessor: currentProcessor || null,
        currentRate: currentRate || null,
        acceptedCardTypes,
        terminalNeeded: terminalNeeded === true,
        terminalType: terminalNeeded ? terminalType : null,
        terminalQuantity: terminalNeeded ? parseInt(terminalQuantity) || 1 : 0,
        ecommerceNeeded: ecommerceNeeded === true,
        preferredProgram,
        esignStatus: "pending",
        ...getStoredUTMParams(),
      });
      const data = await res.json();
      trackMerchantApplication();
      trackConversion("merchant_application", {
        application_id: data.id,
        estimated_volume: estimatedMonthlyVolume,
        program: preferredProgram,
      });
      setApplicationId(data.id);

      setEsignSending(true);
      let resolvedEsignStatus = "email_pending";
      try {
        const esignRes = await apiRequest("POST", "/api/merchant-applications/request-esign", {
          applicationId: data.id,
          email: ownerEmail || businessEmail,
        });
        const esignData = await esignRes.json();
        resolvedEsignStatus = esignData.status || "sent";
        setEsignStatus(resolvedEsignStatus);
      } catch (esignErr: any) {
        console.log("[E-Sign] GHL e-sign dispatch note:", esignErr.message);
        setEsignStatus("email_pending");
      } finally {
        setEsignSending(false);
      }

      localStorage.removeItem(DRAFT_KEY);
      setSubmitted(true);
      try {
        sessionStorage.setItem("lb_app_confirmation", JSON.stringify({
          applicationId: data.id,
          esignStatus: resolvedEsignStatus,
          email: ownerEmail || businessEmail,
          businessName: legalBusinessName,
          ownerName: `${ownerFirstName} ${ownerLastName}`.trim(),
        }));
      } catch {}
      setLocation("/thanks/application");
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

  const progressPercent = Math.round(((currentStep - 1) / (TOTAL_STEPS - 1)) * 100);

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col font-body">
        <Navbar />
        <main className="flex-grow pt-28">
          <section className="relative overflow-hidden" data-testid="section-application-success-hero">
            <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
            <div className="glow-blob w-64 h-64 bg-emerald-500 top-10 right-1/4" />
            <div className="relative max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-emerald-400" />
              </div>
              <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-2" data-testid="text-application-success-heading">
                Application Submitted
              </h1>
              <p className="text-white/70" data-testid="text-application-id">
                Your application ID is <span className="font-semibold text-white">#{applicationId}</span>
              </p>
            </div>
          </section>

          <section className="bg-muted/30 py-12" data-testid="section-application-success">
            <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
              {esignStatus === "sent" && (
                <Card data-testid="card-esign-info">
                  <CardContent className="p-6 sm:p-8 text-center">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                      <FileCheck className="w-6 h-6 text-primary" />
                    </div>
                    <h2 className="text-xl font-display font-bold text-foreground mb-2" data-testid="text-esign-heading">
                      E-Signature Sent
                    </h2>
                    <p className="text-muted-foreground mb-4" data-testid="text-esign-description">
                      Your Merchant Processing Agreement has been sent to{" "}
                      <span className="font-medium text-foreground">{ownerEmail || businessEmail}</span>{" "}
                      for electronic signature via GoHighLevel. Please check your email and sign the document to complete your application.
                    </p>
                  </CardContent>
                </Card>
              )}

              {esignStatus === "email_pending" && (
                <Card data-testid="card-esign-pending">
                  <CardContent className="p-6 sm:p-8 text-center">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                      <FileCheck className="w-6 h-6 text-primary" />
                    </div>
                    <h2 className="text-xl font-display font-bold text-foreground mb-2" data-testid="text-esign-pending-heading">
                      E-Signature Coming Soon
                    </h2>
                    <p className="text-muted-foreground mb-4" data-testid="text-esign-pending-description">
                      Your application has been submitted. Our team will send you a Merchant Processing Agreement 
                      for electronic signature shortly via email to{" "}
                      <span className="font-medium text-foreground">{ownerEmail || businessEmail}</span>.
                    </p>
                  </CardContent>
                </Card>
              )}

              <Card data-testid="card-success-details">
                <CardContent className="p-6 sm:p-8 text-center">
                  <h2 className="text-xl font-display font-bold text-foreground mb-3" data-testid="text-success-heading">
                    What Happens Next?
                  </h2>
                  <div className="space-y-3 text-left max-w-md mx-auto mb-6">
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-primary">1</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Sign your agreement</span> - Check your email for the Merchant Processing Agreement sent via GoHighLevel and complete the electronic signature.
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-primary">2</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Underwriting review</span> - Our team will review your application within 1-2 business days.
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-primary">3</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Get started</span> - Once approved, we'll set up your account and ship your equipment.
                      </p>
                    </div>
                  </div>
                  <p className="text-muted-foreground mb-6">
                    For questions, call us at <a href="tel:9542668214" className="text-primary font-medium">954-266-8214</a>.
                  </p>
                  <p className="text-xs text-muted-foreground border-t pt-4" data-testid="text-success-disclaimer">
                    Liberty Bancard is a registered ISO of [Bank Partner]. All applications are subject to underwriting approval. 
                    Eligibility, underwriting, card brand rules, and applicable laws apply.
                  </p>
                </CardContent>
              </Card>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    );
  }

  const renderSummaryRow = (label: string, value: string | number | boolean | null | undefined, testId: string) => {
    if (value === null || value === undefined || value === "") return null;
    const display = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
    return (
      <div className="flex justify-between gap-4 py-1.5" data-testid={testId}>
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-medium text-foreground text-right">{display}</span>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col font-body">
      <SEO
        title="Apply for Merchant Payment Processing"
        description="Complete your merchant application for payment processing with Liberty Bancard. Fast approval, competitive rates, modern terminals."
        path="/merchant-application"
      />
      <Navbar />
      <main className="flex-grow pt-28">
        <section className="relative overflow-hidden" data-testid="section-application-hero">
          <div className="absolute inset-0 bg-gradient-to-br from-[hsl(222,47%,11%)] via-[hsl(222,47%,15%)] to-[hsl(221,83%,25%)]" />
          <div className="glow-blob w-64 h-64 bg-sky-500 top-10 right-1/4" />
          <div className="relative max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20 text-center">
            <h1 className="text-3xl md:text-4xl font-display font-bold text-white mb-2" data-testid="text-application-heading">
              Merchant <span className="text-sky-400">Application</span>
            </h1>
            <p className="text-white/70" data-testid="text-application-subheadline">
              Complete your application in 6 simple steps. Most approvals within 1-2 business days.
            </p>
          </div>
        </section>

        <section className="bg-muted/30 py-12" data-testid="section-application-form">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
            {hasDraft && !draftDismissed && (
              <div
                className="mb-4 p-4 rounded-lg border border-primary/20 bg-primary/5 flex flex-col sm:flex-row items-start sm:items-center gap-3"
                data-testid="banner-draft-restore"
              >
                <ClipboardList className="w-5 h-5 text-primary shrink-0 mt-0.5 sm:mt-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">You have a saved draft</p>
                  {draftTime && (
                    <p className="text-xs text-muted-foreground">
                      Last saved {new Date(draftTime).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" onClick={restoreDraft} data-testid="button-restore-draft">
                    Continue Draft
                  </Button>
                  <Button size="sm" variant="ghost" onClick={discardDraft} data-testid="button-discard-draft">
                    Start Fresh
                  </Button>
                </div>
              </div>
            )}

            <div className="mb-2" data-testid="progress-bar">
              <div className="h-2 w-full bg-muted rounded-full">
                <div
                  className="h-2 bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                  data-testid="progress-bar-fill"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 mb-6">
              <p className="text-xs text-muted-foreground">
                Step {currentStep} of {TOTAL_STEPS}: <span className="font-medium text-foreground">{stepInfo[currentStep - 1].label}</span>
              </p>
              <div className="flex items-center gap-3">
                <span
                  className={`text-xs flex items-center gap-1 transition-opacity duration-500 ${showDraftSaved ? "opacity-100 text-emerald-600 dark:text-emerald-400" : "opacity-0"}`}
                  data-testid="text-draft-saved"
                  aria-live="polite"
                >
                  <Save className="w-3 h-3" />
                  Draft saved
                </span>
                <p className="text-xs text-muted-foreground">{progressPercent}% complete</p>
              </div>
            </div>

            <div className="hidden sm:flex justify-between mb-6 gap-1" data-testid="step-indicators">
              {stepInfo.map((step, i) => {
                const StepIcon = step.icon;
                const stepNum = i + 1;
                const isDone = stepNum < currentStep;
                const isCurrent = stepNum === currentStep;
                return (
                  <div
                    key={step.label}
                    className={`flex flex-col items-center gap-1 flex-1 ${isCurrent ? "opacity-100" : isDone ? "opacity-80" : "opacity-40"}`}
                    data-testid={`step-indicator-${stepNum}`}
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-colors ${
                      isDone ? "bg-emerald-500 border-emerald-500 text-white" : isCurrent ? "border-primary bg-primary/10 text-primary" : "border-muted-foreground/30 bg-muted"
                    }`}>
                      {isDone ? <CheckCircle className="w-3.5 h-3.5" /> : <StepIcon className="w-3.5 h-3.5" />}
                    </div>
                    <span className="text-[10px] text-center leading-tight max-w-[60px]">{step.label}</span>
                  </div>
                );
              })}
            </div>

            <Card data-testid="card-application-form">
              <CardContent className="p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-6">
                  {(() => {
                    const StepIcon = stepInfo[currentStep - 1].icon;
                    return (
                      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <StepIcon className="w-5 h-5 text-primary" />
                      </div>
                    );
                  })()}
                  <h2
                    ref={stepHeadingRef}
                    tabIndex={-1}
                    className="text-xl font-display font-bold text-foreground outline-none"
                    data-testid="text-step-heading"
                  >
                    {stepInfo[currentStep - 1].label}
                  </h2>
                </div>

                {currentStep === 1 && (
                  <div className="space-y-4" data-testid="step-business-info">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Legal Business Name *</label>
                        <Input
                          value={legalBusinessName}
                          onChange={(e) => setLegalBusinessName(e.target.value)}
                          placeholder="ABC Company LLC"
                          data-testid="input-legal-business-name"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">DBA (Doing Business As)</label>
                        <Input
                          value={dba}
                          onChange={(e) => setDba(e.target.value)}
                          placeholder="ABC Company"
                          data-testid="input-dba"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Business Type *</label>
                        <Select value={businessType} onValueChange={setBusinessType}>
                          <SelectTrigger data-testid="select-business-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            {BUSINESS_TYPES.map((type) => (
                              <SelectItem key={type} value={type} data-testid={`option-business-type-${type.toLowerCase().replace(/\s+/g, "-")}`}>
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">EIN *</label>
                        <Input
                          value={ein}
                          onChange={(e) => setEin(e.target.value)}
                          placeholder="XX-XXXXXXX"
                          data-testid="input-ein"
                        />
                        <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                          <Info className="w-3 h-3 shrink-0 mt-0.5" />
                          Your 9-digit Employer Identification Number (format: XX-XXXXXXX). Required for underwriting. Found on tax filings or IRS correspondence.
                        </p>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">Business Start Date</label>
                      <Input
                        value={businessStartDate}
                        onChange={(e) => setBusinessStartDate(e.target.value)}
                        placeholder="MM/DD/YYYY"
                        data-testid="input-business-start-date"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">Business Address *</label>
                      <Input
                        value={businessAddress}
                        onChange={(e) => setBusinessAddress(e.target.value)}
                        placeholder="123 Main St"
                        data-testid="input-business-address"
                      />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">City *</label>
                        <Input
                          value={businessCity}
                          onChange={(e) => setBusinessCity(e.target.value)}
                          placeholder="City"
                          data-testid="input-business-city"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">State *</label>
                        <Input
                          value={businessState}
                          onChange={(e) => setBusinessState(e.target.value)}
                          placeholder="FL"
                          data-testid="input-business-state"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">ZIP *</label>
                        <Input
                          value={businessZip}
                          onChange={(e) => setBusinessZip(e.target.value)}
                          placeholder="33301"
                          data-testid="input-business-zip"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Business Phone *</label>
                        <Input
                          value={businessPhone}
                          onChange={(e) => setBusinessPhone(e.target.value)}
                          placeholder="(954) 555-1234"
                          data-testid="input-business-phone"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Business Email *</label>
                        <Input
                          type="email"
                          value={businessEmail}
                          onChange={(e) => setBusinessEmail(e.target.value)}
                          placeholder="info@company.com"
                          data-testid="input-business-email"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">Website</label>
                      <Input
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                        placeholder="https://www.company.com"
                        data-testid="input-website"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">Business Vertical *</label>
                      <Select value={vertical} onValueChange={setVertical}>
                        <SelectTrigger data-testid="select-vertical">
                          <SelectValue placeholder="Select vertical" />
                        </SelectTrigger>
                        <SelectContent>
                          {VERTICALS.map((v) => (
                            <SelectItem key={v} value={v} data-testid={`option-vertical-${v.toLowerCase().replace(/[/\s]+/g, "-")}`}>
                              {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="space-y-4" data-testid="step-owner-info">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">First Name *</label>
                        <Input
                          value={ownerFirstName}
                          onChange={(e) => setOwnerFirstName(e.target.value)}
                          placeholder="John"
                          data-testid="input-owner-first-name"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Last Name *</label>
                        <Input
                          value={ownerLastName}
                          onChange={(e) => setOwnerLastName(e.target.value)}
                          placeholder="Smith"
                          data-testid="input-owner-last-name"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Email *</label>
                        <Input
                          type="email"
                          value={ownerEmail}
                          onChange={(e) => setOwnerEmail(e.target.value)}
                          placeholder="john@company.com"
                          data-testid="input-owner-email"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Phone *</label>
                        <Input
                          value={ownerPhone}
                          onChange={(e) => setOwnerPhone(e.target.value)}
                          placeholder="(954) 555-1234"
                          data-testid="input-owner-phone"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Date of Birth *</label>
                        <Input
                          value={ownerDob}
                          onChange={(e) => setOwnerDob(e.target.value)}
                          placeholder="MM/DD/YYYY"
                          data-testid="input-owner-dob"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">SSN *</label>
                        <Input
                          value={ownerSsn}
                          onChange={(e) => setOwnerSsn(maskSsn(e.target.value))}
                          placeholder="XXX-XX-XXXX"
                          data-testid="input-owner-ssn"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">Home Address *</label>
                      <Input
                        value={ownerAddress}
                        onChange={(e) => setOwnerAddress(e.target.value)}
                        placeholder="456 Oak Ave"
                        data-testid="input-owner-address"
                      />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">City *</label>
                        <Input
                          value={ownerCity}
                          onChange={(e) => setOwnerCity(e.target.value)}
                          placeholder="City"
                          data-testid="input-owner-city"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">State *</label>
                        <Input
                          value={ownerState}
                          onChange={(e) => setOwnerState(e.target.value)}
                          placeholder="FL"
                          data-testid="input-owner-state"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">ZIP *</label>
                        <Input
                          value={ownerZip}
                          onChange={(e) => setOwnerZip(e.target.value)}
                          placeholder="33301"
                          data-testid="input-owner-zip"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">Ownership Percentage *</label>
                      <Input
                        type="number"
                        value={ownershipPercent}
                        onChange={(e) => setOwnershipPercent(e.target.value)}
                        placeholder="100"
                        min="1"
                        max="100"
                        data-testid="input-ownership-percent"
                      />
                    </div>
                  </div>
                )}

                {currentStep === 3 && (
                  <div className="space-y-4" data-testid="step-bank-info">
                    <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 border" data-testid="bank-info-notice">
                      <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <p className="text-sm text-muted-foreground">
                        Your bank details are encrypted and used only for deposit settlement. We recommend having a voided check handy to verify your routing and account numbers.
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">Bank Name *</label>
                      <Input
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        placeholder="First National Bank"
                        data-testid="input-bank-name"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Routing Number *</label>
                        <Input
                          value={bankRoutingNumber}
                          onChange={(e) => setBankRoutingNumber(e.target.value)}
                          placeholder="XXXXXXXXX"
                          data-testid="input-routing-number"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Account Number *</label>
                        <Input
                          value={bankAccountNumber}
                          onChange={(e) => setBankAccountNumber(e.target.value)}
                          placeholder="XXXXXXXXXXXX"
                          data-testid="input-account-number"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">Account Type *</label>
                      <Select value={bankAccountType} onValueChange={setBankAccountType}>
                        <SelectTrigger data-testid="select-account-type">
                          <SelectValue placeholder="Select account type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Checking" data-testid="option-account-checking">Checking</SelectItem>
                          <SelectItem value="Savings" data-testid="option-account-savings">Savings</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {currentStep === 4 && (
                  <div className="space-y-4" data-testid="step-processing-details">
                    <p className="text-sm text-muted-foreground -mt-2 mb-2">
                      These figures help us match you to the right program and determine your rate. Use your most recent month's statement as a reference.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Est. Monthly Volume *</label>
                        <Input
                          value={estimatedMonthlyVolume}
                          onChange={(e) => setEstimatedMonthlyVolume(e.target.value)}
                          placeholder="$25,000"
                          data-testid="input-monthly-volume"
                        />
                        <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                          <Info className="w-3 h-3 shrink-0 mt-0.5" />
                          Total credit card sales per month (from your statement's "Total Sales" line)
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Average Ticket *</label>
                        <Input
                          value={estimatedAvgTicket}
                          onChange={(e) => setEstimatedAvgTicket(e.target.value)}
                          placeholder="$75"
                          data-testid="input-avg-ticket"
                        />
                        <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                          <Info className="w-3 h-3 shrink-0 mt-0.5" />
                          Typical transaction amount per customer visit
                        </p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Highest Ticket *</label>
                        <Input
                          value={highestTicket}
                          onChange={(e) => setHighestTicket(e.target.value)}
                          placeholder="$500"
                          data-testid="input-highest-ticket"
                        />
                        <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                          <Info className="w-3 h-3 shrink-0 mt-0.5" />
                          Largest single transaction you process (used for risk assessment)
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Current Processor</label>
                        <Input
                          value={currentProcessor}
                          onChange={(e) => setCurrentProcessor(e.target.value)}
                          placeholder="Optional"
                          data-testid="input-current-processor"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground mb-1 block">Current Rate</label>
                        <Input
                          value={currentRate}
                          onChange={(e) => setCurrentRate(e.target.value)}
                          placeholder="Optional (e.g., 2.9%)"
                          data-testid="input-current-rate"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">Card Types Accepted *</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {CARD_TYPES.map((type) => (
                          <label
                            key={type}
                            className="flex items-center gap-2 cursor-pointer"
                            data-testid={`checkbox-card-type-${type.toLowerCase()}`}
                          >
                            <Checkbox
                              checked={acceptedCardTypes.includes(type)}
                              onCheckedChange={() => toggleCardType(type)}
                            />
                            <span className="text-sm text-foreground">{type}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {currentStep === 5 && (
                  <div className="space-y-4" data-testid="step-equipment-program">
                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">Do you need a terminal? *</label>
                      <div className="grid grid-cols-2 gap-4">
                        <Button
                          variant={terminalNeeded === true ? "default" : "outline"}
                          onClick={() => setTerminalNeeded(true)}
                          data-testid="button-terminal-yes"
                        >
                          Yes
                        </Button>
                        <Button
                          variant={terminalNeeded === false ? "default" : "outline"}
                          onClick={() => setTerminalNeeded(false)}
                          data-testid="button-terminal-no"
                        >
                          No
                        </Button>
                      </div>
                    </div>
                    {terminalNeeded && (
                      <>
                        <div>
                          <label className="text-sm font-medium text-foreground mb-1 block">Terminal Type *</label>
                          <Select value={terminalType} onValueChange={setTerminalType}>
                            <SelectTrigger data-testid="select-terminal-type">
                              <SelectValue placeholder="Select terminal" />
                            </SelectTrigger>
                            <SelectContent>
                              {TERMINAL_TYPES.map((t) => (
                                <SelectItem key={t} value={t} data-testid={`option-terminal-${t.toLowerCase().replace(/\s+/g, "-")}`}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-foreground mb-1 block">Quantity *</label>
                          <Input
                            type="number"
                            value={terminalQuantity}
                            onChange={(e) => setTerminalQuantity(e.target.value)}
                            min="1"
                            placeholder="1"
                            data-testid="input-terminal-quantity"
                          />
                        </div>
                      </>
                    )}
                    <div>
                      <label className="text-sm font-medium text-foreground mb-2 block">Do you need e-commerce processing? *</label>
                      <div className="grid grid-cols-2 gap-4">
                        <Button
                          variant={ecommerceNeeded === true ? "default" : "outline"}
                          onClick={() => setEcommerceNeeded(true)}
                          data-testid="button-ecommerce-yes"
                        >
                          Yes
                        </Button>
                        <Button
                          variant={ecommerceNeeded === false ? "default" : "outline"}
                          onClick={() => setEcommerceNeeded(false)}
                          data-testid="button-ecommerce-no"
                        >
                          No
                        </Button>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-foreground mb-1 block">Preferred Program *</label>
                      <Select value={preferredProgram} onValueChange={setPreferredProgram}>
                        <SelectTrigger data-testid="select-preferred-program">
                          <SelectValue placeholder="Select program" />
                        </SelectTrigger>
                        <SelectContent>
                          {PREFERRED_PROGRAMS.map((p) => (
                            <SelectItem key={p} value={p} data-testid={`option-program-${p.toLowerCase().replace(/\s+/g, "-")}`}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {currentStep === 6 && (
                  <div className="space-y-6" data-testid="step-review-submit">
                    <p className="text-sm text-muted-foreground">
                      Please review your application details below before submitting.
                    </p>

                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-2 border-b pb-1">Business Information</h3>
                      {renderSummaryRow("Legal Name", legalBusinessName, "summary-legal-name")}
                      {renderSummaryRow("DBA", dba, "summary-dba")}
                      {renderSummaryRow("Business Type", businessType, "summary-business-type")}
                      {renderSummaryRow("EIN", ein, "summary-ein")}
                      {renderSummaryRow("Start Date", businessStartDate, "summary-start-date")}
                      {renderSummaryRow("Address", `${businessAddress}, ${businessCity}, ${businessState} ${businessZip}`, "summary-business-address")}
                      {renderSummaryRow("Phone", businessPhone, "summary-business-phone")}
                      {renderSummaryRow("Email", businessEmail, "summary-business-email")}
                      {renderSummaryRow("Website", website, "summary-website")}
                      {renderSummaryRow("Vertical", vertical, "summary-vertical")}
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-2 border-b pb-1">Owner Information</h3>
                      {renderSummaryRow("Name", `${ownerFirstName} ${ownerLastName}`, "summary-owner-name")}
                      {renderSummaryRow("Email", ownerEmail, "summary-owner-email")}
                      {renderSummaryRow("Phone", ownerPhone, "summary-owner-phone")}
                      {renderSummaryRow("DOB", ownerDob, "summary-owner-dob")}
                      {renderSummaryRow("SSN", "***-**-" + ownerSsn.replace(/\D/g, "").slice(-4), "summary-owner-ssn")}
                      {renderSummaryRow("Address", `${ownerAddress}, ${ownerCity}, ${ownerState} ${ownerZip}`, "summary-owner-address")}
                      {renderSummaryRow("Ownership", `${ownershipPercent}%`, "summary-ownership")}
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-2 border-b pb-1">Bank Information</h3>
                      {renderSummaryRow("Bank Name", bankName, "summary-bank-name")}
                      {renderSummaryRow("Routing", "****" + bankRoutingNumber.slice(-4), "summary-routing")}
                      {renderSummaryRow("Account", "****" + bankAccountNumber.slice(-4), "summary-account")}
                      {renderSummaryRow("Account Type", bankAccountType, "summary-account-type")}
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-2 border-b pb-1">Processing Details</h3>
                      {renderSummaryRow("Monthly Volume", estimatedMonthlyVolume, "summary-monthly-volume")}
                      {renderSummaryRow("Average Ticket", estimatedAvgTicket, "summary-avg-ticket")}
                      {renderSummaryRow("Highest Ticket", highestTicket, "summary-highest-ticket")}
                      {renderSummaryRow("Current Processor", currentProcessor, "summary-current-processor")}
                      {renderSummaryRow("Current Rate", currentRate, "summary-current-rate")}
                      {renderSummaryRow("Card Types", acceptedCardTypes.join(", "), "summary-card-types")}
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-foreground mb-2 border-b pb-1">Equipment & Program</h3>
                      {renderSummaryRow("Terminal Needed", terminalNeeded, "summary-terminal-needed")}
                      {terminalNeeded && renderSummaryRow("Terminal Type", terminalType, "summary-terminal-type")}
                      {terminalNeeded && renderSummaryRow("Quantity", terminalQuantity, "summary-terminal-qty")}
                      {renderSummaryRow("E-commerce", ecommerceNeeded, "summary-ecommerce")}
                      {renderSummaryRow("Preferred Program", preferredProgram, "summary-program")}
                    </div>

                    <div className="bg-muted/50 rounded-md p-4 space-y-3">
                      <p className="text-xs text-muted-foreground leading-relaxed" data-testid="text-compliance-disclaimer">
                        Liberty Bancard is a registered ISO of [Bank Partner]. All applications are subject to underwriting approval. 
                        Eligibility, underwriting, card brand rules, and applicable laws apply. By submitting this application, 
                        you consent to a background and credit check as part of the underwriting process.
                      </p>
                      <label className="flex items-start gap-3 cursor-pointer" data-testid="checkbox-review-confirm">
                        <Checkbox
                          checked={reviewConfirmed}
                          onCheckedChange={(checked) => setReviewConfirmed(checked === true)}
                          className="mt-0.5"
                        />
                        <span className="text-sm text-foreground leading-relaxed">
                          I confirm that all information provided is accurate and complete. I understand that a Merchant Processing 
                          Agreement will be sent to my email via GoHighLevel for electronic signature after submission.
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between gap-4 mt-8 pt-4 border-t">
                  {currentStep > 1 ? (
                    <Button
                      variant="outline"
                      onClick={handleBack}
                      className="gap-2"
                      data-testid="button-back"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Back
                    </Button>
                  ) : (
                    <div />
                  )}

                  {currentStep < TOTAL_STEPS ? (
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
                      data-testid="button-submit-application"
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {esignSending ? "Sending for E-Signature..." : "Submitting..."}
                        </>
                      ) : (
                        <>
                          <FileCheck className="w-4 h-4" />
                          Submit & Send for E-Signature
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col items-center gap-1.5 mt-6 py-4 border-t border-border" data-testid="section-no-lockin">
              <div className="inline-flex items-center gap-2 text-sm text-foreground font-semibold">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                Cancel Anytime. No Early Termination Fee. No Penalty.
              </div>
              <p className="text-xs text-muted-foreground text-center max-w-sm">
                We earn your business every month. No lock-in, no cancellation fees.{" "}
                <Link href="/terms" className="underline text-primary">See merchant terms →</Link>
              </p>
            </div>

            <p className="text-xs text-muted-foreground text-center mt-4" data-testid="text-footer-disclaimer">
              Your information is encrypted and secure. Liberty Bancard is a registered ISO of [Bank Partner]. 
              All applications are subject to underwriting approval.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
