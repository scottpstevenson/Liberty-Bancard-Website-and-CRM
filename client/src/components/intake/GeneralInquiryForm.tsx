import { useState } from "react";
import { CheckCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePublicIntake } from "@/hooks/use-public-intake";
import { PublicIntakeNotice } from "@/components/PublicIntakeNotice";
import { trackConversion, trackFormSubmission } from "@/lib/tracking";
import { trackConversion as trackConversionV2 } from "@/lib/analytics";
import { INQUIRY_GENERAL_INTENTS, INQUIRY_NOTE_MAX } from "@shared/public-inquiry";
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

const PREFIX = "inquiry";
const FIELD_ORDER = ["businessName", "name", "email", "phone", "pewcConsent", "intent", "note"];

const SUCCESS_COPY = "We’ve received your inquiry. Our team will review the details and contact you using the information you provided.";
const PENDING_COPY = "Your inquiry is saved and follow-up is pending review. We can’t say when someone will reach you.";

/**
 * The short general and new-business inquiry on /about-contact#inquiry. It needs no statement, EIN, bank detail or
 * underwriting evidence to start a conversation, and it is not an application: someone who is ready to apply is pointed
 * to the secure application as the next stage.
 */
export function GeneralInquiryForm() {
  const intake = usePublicIntake("general_inquiry", "/api/public/get-started");
  const [person, setPerson] = useState(EMPTY_PERSON);
  const [intent, setIntent] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<InquiryErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const buildPayload = () => ({
    mode: "general_inquiry" as const,
    ...personPayload(person),
    intent,
    ...(note.trim() ? { note: note.trim() } : {}),
    ...inquiryAttribution(),
  });

  const submit = async () => {
    setSubmitError(null);
    const next = validatePerson(person);
    if (!intent) next.intent = REQUIRED_ERROR;
    setErrors(next);
    if (Object.keys(next).length) {
      focusFirstError(PREFIX, next, FIELD_ORDER);
      return;
    }
    const outcome = await intake.submit(buildPayload());
    if (outcome.kind === "saved") {
      trackFormSubmission("general_inquiry_submission");
      trackConversion("general_inquiry_submission");
      trackConversionV2("general_inquiry_submission");
    } else if (outcome.kind === "rejected") {
      if (outcome.fieldErrors) {
        setErrors(outcome.fieldErrors);
        focusFirstError(PREFIX, outcome.fieldErrors, FIELD_ORDER);
      }
      setSubmitError("We couldn’t send your inquiry. Please check your details and try again. If the problem continues, call or email us.");
    }
  };

  if (intake.state.phase === "saved") {
    const reference = intake.state.receipt.replace(/-/g, "").slice(0, 8).toUpperCase();
    return (
      <div className="public-card border-2 border-emerald-200 bg-card p-6 text-center text-foreground" role="status" data-testid="inquiry-success">
        <CheckCircle className="mx-auto mb-3 h-10 w-10 text-emerald-600" aria-hidden="true" />
        <h3 className="public-h3 mb-2" data-testid="inquiry-success-title">Inquiry received</h3>
        <p className="public-body public-secondary mb-3" data-testid="inquiry-success-detail">{intake.state.pendingReview ? PENDING_COPY : SUCCESS_COPY}</p>
        {reference ? (
          <p className="mb-3 text-sm text-muted-foreground" data-testid="inquiry-success-reference">
            Reference <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{reference}</code>. Keep it if you call us about this inquiry.
          </p>
        ) : null}
        <Button variant="outline" onClick={intake.acknowledgeSaved} data-testid="inquiry-start-another">Send another inquiry</Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => { event.preventDefault(); void submit(); }}
      className="public-card space-y-4 bg-card p-5 text-foreground sm:p-6"
      data-testid="form-general-inquiry"
    >
      <h3 className="public-h3" data-testid="inquiry-form-heading">Send us a short inquiry</h3>
      <p className="public-body public-secondary">No statement, bank detail or application is needed to start a conversation.</p>

      <InquiryPersonFields prefix={PREFIX} value={person} onChange={setPerson} errors={errors} />
      <InquirySelectField prefix={PREFIX} name="intent" label="What would you like to discuss?" required value={intent} onChange={setIntent} error={errors.intent}
        options={INQUIRY_GENERAL_INTENTS.map((option) => ({ value: option.code, label: option.label }))} />
      <div>
        <Label htmlFor={`${PREFIX}-note`} className="public-small mb-1.5 block font-medium">Anything else we should know? (optional)</Label>
        <Textarea id={`${PREFIX}-note`} value={note} maxLength={INQUIRY_NOTE_MAX} rows={4} onChange={(event) => setNote(event.target.value)}
          aria-describedby={errors.note ? `${PREFIX}-note-error` : undefined} aria-invalid={Boolean(errors.note)} data-testid={`${PREFIX}-input-note`} />
        {errors.note ? <p id={`${PREFIX}-note-error`} role="alert" className="mt-1 text-sm text-destructive" data-testid={`${PREFIX}-note-error`}>{errors.note}</p> : null}
        <p className="mt-1 text-xs text-muted-foreground">Please don’t include card numbers, bank details or other sensitive information. To send a statement, use the secure <Link href="/upload-statement#statement-review-form" className="underline">statement review form</Link>.</p>
      </div>

      <p className="text-xs text-muted-foreground">We use your details to respond to this inquiry. See our <a href="/privacy-policy" className="underline">Privacy Policy</a>.</p>

      <PublicIntakeNotice
        state={intake.state}
        testIdPrefix="inquiry-intake"
        checking={intake.checking}
        checkNote={intake.checkNote}
        onCheck={intake.check}
        onRetry={() => { void submit(); }}
        onDismiss={intake.dismiss}
      />

      {submitError ? <p role="alert" className="text-sm text-destructive" data-testid="inquiry-submit-error">{submitError}</p> : null}

      <Button type="submit" size="lg" className="public-cta w-full" disabled={intake.submitting} data-testid="button-inquiry-submit">
        {intake.submitting ? "Sending your inquiry…" : "Send inquiry"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Ready to apply? <Link href="/merchant-application" className="underline" data-testid="link-inquiry-application">Start the secure application</Link>.
      </p>
    </form>
  );
}
