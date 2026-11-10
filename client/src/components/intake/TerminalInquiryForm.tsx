import { useState } from "react";
import { CheckCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { usePublicIntake } from "@/hooks/use-public-intake";
import { PublicIntakeNotice } from "@/components/PublicIntakeNotice";
import { trackConversion, trackFormSubmission } from "@/lib/tracking";
import { trackConversion as trackConversionV2 } from "@/lib/analytics";
import {
  INQUIRY_BUSINESS_TYPES,
  INQUIRY_LEASE_ANSWERS,
  INQUIRY_VOLUME_BANDS,
  leaseAnswerLabel,
  volumeBandLabel,
} from "@shared/public-inquiry";
import { FST_EQUIPMENT_TERMS_DISCLOSURE, FST_STATEMENT_REVIEW_PATH } from "@shared/free-smart-terminal-content";
import {
  EMPTY_PERSON,
  InquiryPersonFields,
  InquirySelectField,
  REQUIRED_ERROR,
  focusFirstError,
  inquiryAttribution,
  personPayload,
  validatePerson,
  type InquiryErrors,
} from "./inquiry-fields";

const PREFIX = "terminal";
const FIELD_ORDER = ["businessName", "name", "email", "phone", "pewcConsent", "businessType", "volumeBand", "currentlyLeasing"];

const SUCCESS_COPY = "We’ve received your terminal inquiry. Our team will review the details and contact you about eligibility and next steps.";
const PENDING_COPY = "Your terminal inquiry is saved and follow-up is pending review. We can’t say when someone will reach you.";

/**
 * The terminal-specific eligibility inquiry: the offer-specific mode of the existing /get-started intake. Intake bands here
 * are questions for staff review, never approval thresholds. No statement is required, and nothing here promises equipment.
 */
export function TerminalInquiryForm({ offer }: { offer: "free-terminal" | null }) {
  const intake = usePublicIntake("equipment_inquiry", "/api/public/get-started");
  const [person, setPerson] = useState(EMPTY_PERSON);
  const [businessType, setBusinessType] = useState("");
  const [volumeBand, setVolumeBand] = useState("");
  const [currentlyLeasing, setCurrentlyLeasing] = useState("");
  const [errors, setErrors] = useState<InquiryErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The confirmed answers, held only for the accepted view's recap (never read back from storage).
  const [recap, setRecap] = useState<{ volumeBand: string; currentlyLeasing: string; businessType: string } | null>(null);

  const buildPayload = () => ({
    mode: "equipment_inquiry" as const,
    ...(offer ? { offer } : {}),
    ...personPayload(person),
    businessType,
    volumeBand,
    currentlyLeasing,
    ...inquiryAttribution(),
  });

  const validate = (): InquiryErrors => {
    const next = validatePerson(person);
    if (!businessType) next.businessType = REQUIRED_ERROR;
    if (!volumeBand) next.volumeBand = REQUIRED_ERROR;
    if (!currentlyLeasing) next.currentlyLeasing = REQUIRED_ERROR;
    return next;
  };

  const submit = async () => {
    setSubmitError(null);
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) {
      focusFirstError(PREFIX, next, FIELD_ORDER);
      return;
    }
    const outcome = await intake.submit(buildPayload());
    if (outcome.kind === "saved") {
      setRecap({ volumeBand, currentlyLeasing, businessType });
      // Conversion fires only after a confirmed save, never for a pending, unreadable or failed response, and once per saved request.
      if (outcome.fresh !== false) {
        trackFormSubmission("terminal_inquiry_submission");
        trackConversion("terminal_inquiry_submission");
        trackConversionV2("terminal_inquiry_submission");
      }
    } else if (outcome.kind === "rejected") {
      if (outcome.fieldErrors) {
        setErrors(outcome.fieldErrors);
        focusFirstError(PREFIX, outcome.fieldErrors, FIELD_ORDER);
      }
      setSubmitError("We couldn’t send your request. Please check your details and try again. If the problem continues, contact Liberty Bancard.");
    }
  };

  if (intake.state.phase === "saved") {
    const reference = intake.state.receipt.replace(/-/g, "").slice(0, 8).toUpperCase();
    return (
      <div className="public-card border-2 border-emerald-200 bg-card p-6 text-center text-foreground sm:p-8" role="status" data-testid="terminal-success">
        <CheckCircle className="mx-auto mb-4 h-12 w-12 text-emerald-600" aria-hidden="true" />
        <h2 className="public-h3 mb-2" data-testid="terminal-success-title">Inquiry received</h2>
        <p className="public-body public-secondary mb-3" data-testid="terminal-success-detail">{intake.state.pendingReview ? PENDING_COPY : SUCCESS_COPY}</p>
        {reference ? (
          <p className="text-sm text-muted-foreground mb-3" data-testid="terminal-success-reference">
            Reference <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{reference}</code>. Keep it if you call us about this inquiry.
          </p>
        ) : null}
        {recap ? (
          <dl className="mx-auto mb-4 max-w-sm text-left text-sm" data-testid="terminal-success-recap">
            <div className="flex justify-between gap-4 py-1"><dt className="text-muted-foreground">Business type</dt><dd>{recap.businessType}</dd></div>
            <div className="flex justify-between gap-4 py-1"><dt className="text-muted-foreground">Monthly card volume</dt><dd>{volumeBandLabel(recap.volumeBand)}</dd></div>
            <div className="flex justify-between gap-4 py-1"><dt className="text-muted-foreground">Currently leasing a terminal</dt><dd>{leaseAnswerLabel(recap.currentlyLeasing)}</dd></div>
          </dl>
        ) : null}
        <p className="text-xs text-muted-foreground">This inquiry is a request for review. It is not an application or an approval.</p>
        <div className="mt-4">
          <Button variant="outline" onClick={intake.acknowledgeSaved} data-testid="terminal-start-another">Send another inquiry</Button>
        </div>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
      className="public-card space-y-4 bg-card p-5 text-foreground sm:p-6"
      data-testid="form-terminal-inquiry"
      aria-describedby="terminal-terms"
    >
      <InquiryPersonFields prefix={PREFIX} value={person} onChange={setPerson} errors={errors} />
      <InquirySelectField prefix={PREFIX} name="businessType" label="Business type" required value={businessType} onChange={setBusinessType} error={errors.businessType}
        options={INQUIRY_BUSINESS_TYPES.map((type) => ({ value: type, label: type }))} />
      <InquirySelectField prefix={PREFIX} name="volumeBand" label="Monthly card-processing volume" required value={volumeBand} onChange={setVolumeBand} error={errors.volumeBand}
        options={INQUIRY_VOLUME_BANDS.map((band) => ({ value: band.code, label: band.label }))} />
      <InquirySelectField prefix={PREFIX} name="currentlyLeasing" label="Do you currently lease your terminal?" required value={currentlyLeasing} onChange={setCurrentlyLeasing} error={errors.currentlyLeasing}
        options={INQUIRY_LEASE_ANSWERS.map((answer) => ({ value: answer.code, label: answer.label }))} />

      <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground" id="terminal-terms" data-testid="terminal-terms">
        <p className="mb-1 font-medium text-foreground">Before you send this</p>
        <p>{FST_EQUIPMENT_TERMS_DISCLOSURE}</p>
        <p className="mt-2">These answers are intake bands for our team’s review. They are not approval thresholds, and sending this does not apply for or guarantee equipment.</p>
        <p className="mt-2">We use your details to respond to this inquiry. See our <a href="/privacy-policy" className="underline">Privacy Policy</a>.</p>
      </div>

      <PublicIntakeNotice
        state={intake.state}
        testIdPrefix="terminal-intake"
        checking={intake.checking}
        checkNote={intake.checkNote}
        onCheck={intake.check}
        onRetry={() => { void submit(); }}
        onDismiss={intake.dismiss}
      />

      {submitError ? <p role="alert" className="text-sm text-destructive" data-testid="terminal-submit-error">{submitError}</p> : null}

      <Button type="submit" size="lg" className="public-cta public-form-action w-full" disabled={intake.submitting} data-testid="button-terminal-submit">
        {intake.submitting ? "Sending your request…" : "Discuss my setup"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already accepting cards?{" "}
        <Link href={FST_STATEMENT_REVIEW_PATH} className="underline" data-testid="link-terminal-statement-review">Get a statement review.</Link>
      </p>
    </form>
  );
}
