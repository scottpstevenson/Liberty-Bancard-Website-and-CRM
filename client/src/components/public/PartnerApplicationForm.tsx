import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { InquirySelectField, InquiryTextField, focusFirstError } from "@/components/intake/inquiry-fields";
import { EmailMarketingCheckbox } from "@/components/EmailMarketingCheckbox";
import { PARTNER_APPLICATION_CONSENT } from "@shared/partner-application";
import {
  PARTNER_CONTACT_PREFERENCES,
  PARTNER_INTRO_VOLUME_BANDS,
  PARTNER_LEAD_SOURCE_INTERESTS,
  PARTNER_NOT_ACCEPTED_ONLINE,
  PARTNER_PROFESSIONS,
  PARTNER_RECOVERABLE_FAILURE,
  PARTNER_REVIEW_DISCLOSURE,
  PARTNER_ROUTES,
  PARTNER_SUCCESS_COPY,
  isPartnerProfession,
  type PartnerPathId,
} from "@shared/partner-public-content";
import {
  EMPTY_PARTNER_FORM,
  PARTNER_FIELD_ORDER,
  buildPartnerPayload,
  partnerReference,
  submitPartnerApplication,
  validatePartnerPayload,
  type PartnerFormValues,
} from "@/lib/partner-application-client";
import { trackPartnerEvent } from "@/lib/tracking";

interface PartnerApplicationFormProps {
  path: PartnerPathId;
  /** The page the form is on; only allowlisted partner pages are ever sent. */
  sourcePage: string;
  /** Preselected profession from `?profession=` on the referral page; ignored unless it is an allowlisted value. */
  initialProfession?: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  fullName: "Full name", email: "Work email", phone: "Phone", company: "Company", profession: "Profession or business type",
  professionOther: "Profession detail", referralNetwork: "Referral network", expectedIntroductions: "Expected introductions",
  region: "Region", contactPreference: "Contact preference", background: "Background", experience: "Payments or sales experience",
  prospectingApproach: "Prospecting approach", leadSourceInterest: "Lead-source interest", contactPermission: "Permission to contact you",
};

function TextAreaField({ id, label, value, onChange, error, required, optional, maxLength, help }: {
  id: string; label: string; value: string; onChange: (v: string) => void; error?: string; required?: boolean; optional?: boolean; maxLength: number; help?: ReactNode;
}) {
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy = [error ? errorId : null, help ? helpId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="public-small mb-1.5 block font-medium text-foreground">
        {label}{required ? "*" : ""}{optional ? " (optional)" : ""}
      </label>
      <Textarea id={id} name={id} rows={4} value={value} maxLength={maxLength} className="public-form-field" data-testid={`${id}-input`}
        aria-invalid={Boolean(error)} aria-describedby={describedBy} aria-required={required ? true : undefined}
        onChange={(event) => onChange(event.target.value)} />
      {help ? <p id={helpId} className="mt-1 text-xs text-muted-foreground">{help}</p> : null}
      {error ? <p id={errorId} role="alert" className="mt-1 text-sm text-destructive" data-testid={`${id}-error`}>{error}</p> : null}
    </div>
  );
}

/**
 * Public partner application. One component for both paths so the consent, validation, receipt and failure behavior
 * cannot drift between them. It creates no account and asks for no password; the server answers one uniform message for
 * every refusal. Entries are kept on any failure, and a retry reuses the same idempotency key.
 */
export function PartnerApplicationForm({ path, sourcePage, initialProfession }: PartnerApplicationFormProps) {
  const prefix = `partner-${path === "referral" ? "referral" : "agent"}`;
  const [values, setValues] = useState<PartnerFormValues>(() => ({
    ...EMPTY_PARTNER_FORM,
    profession: path === "referral" && isPartnerProfession(initialProfession) ? initialProfession : "",
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<{ receipt: string | null } | null>(null);
  const startedReported = useRef(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  const set = <K extends keyof PartnerFormValues>(key: K, next: PartnerFormValues[K]) => setValues((current) => ({ ...current, [key]: next }));

  const reportStarted = () => {
    if (startedReported.current) return;
    startedReported.current = true;
    trackPartnerEvent("partner_application_started", { path, source_page: sourcePage });
  };

  useEffect(() => {
    if (saved) successRef.current?.focus();
  }, [saved]);

  useEffect(() => {
    if (focusRequest > 0) summaryRef.current?.focus();
  }, [focusRequest]);

  const order = PARTNER_FIELD_ORDER[path];
  const errorKeys = useMemo(() => order.filter((key) => errors[key]).concat(errors.form ? ["form"] : []), [errors, order]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setNotice(null);
    const payload = buildPartnerPayload(path, values, { sourcePage, search: typeof window === "undefined" ? "" : window.location.search });
    const found = validatePartnerPayload(path, payload);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setFocusRequest((n) => n + 1);
      return;
    }
    setErrors({});
    setSubmitting(true);
    const outcome = await submitPartnerApplication(path, payload);
    setSubmitting(false);
    if (outcome.kind === "saved") {
      trackPartnerEvent("partner_application_submitted", { path, profession: path === "referral" ? values.profession : undefined, source_page: sourcePage });
      setSaved({ receipt: outcome.receipt });
      return;
    }
    if (outcome.kind === "invalid") {
      setErrors(outcome.errors);
      setFocusRequest((n) => n + 1);
      return;
    }
    // Entries are kept in every failure state below.
    setNotice(
      outcome.kind === "not_accepted" ? PARTNER_NOT_ACCEPTED_ONLINE
        : outcome.kind === "rate_limited" ? "There have been a lot of submissions from this connection. Please wait a few minutes and try again; your entries are still here."
          : PARTNER_RECOVERABLE_FAILURE,
    );
    setFocusRequest((n) => n + 1);
  };

  if (saved) {
    const copy = PARTNER_SUCCESS_COPY[path];
    const reference = partnerReference(saved.receipt);
    return (
      <div className="space-y-3 py-4" role="status" data-testid={`${prefix}-success`}>
        <CheckCircle className="h-10 w-10 text-emerald-600" aria-hidden="true" />
        <h2 ref={successRef} tabIndex={-1} className="public-h2 text-foreground outline-none" data-testid={`${prefix}-success-heading`}>{copy.heading}</h2>
        <p className="public-body public-secondary" data-testid={`${prefix}-success-body`}>{copy.body}</p>
        {reference ? (
          <p className="text-sm text-muted-foreground" data-testid={`${prefix}-success-reference`}>
            Reference <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{reference}</code>. Keep it if you contact us about this application.
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          <Link href={PARTNER_ROUTES.hub} className="underline">Back to partnerships</Link>
        </p>
      </div>
    );
  }

  const phoneRequired = path === "sales_agent";
  // The label is the stored consent wording verbatim; only the words "Privacy Notice" become a link.
  const [consentBefore, consentAfter] = PARTNER_APPLICATION_CONSENT.text.split("Privacy Notice");

  return (
    <form noValidate onSubmit={onSubmit} onFocusCapture={reportStarted} className="space-y-5" data-testid={`${prefix}-form`} aria-busy={submitting || undefined}>
      {(errorKeys.length > 0 || notice) ? (
        <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm outline-none" data-testid={`${prefix}-error-summary`}>
          {notice ? (
            <p className="text-foreground">
              {notice}{" "}
              <Link href={PARTNER_ROUTES.contact} className="underline" data-testid={`${prefix}-contact-link`}>Contact us</Link>
            </p>
          ) : null}
          {errorKeys.length > 0 ? (
            <>
              <p className="font-medium text-foreground">Please fix the following before submitting:</p>
              <ul className="mt-2 list-disc pl-5">
                {errorKeys.map((key) => (
                  <li key={key}>
                    {key === "form" ? (
                      <span>{errors.form}</span>
                    ) : (
                      <a href={`#${prefix}-${key}`} className="underline" onClick={(e) => { e.preventDefault(); focusFirstError(prefix, { [key]: errors[key] }, [key]); }}>
                        {FIELD_LABELS[key] ?? key}: {errors[key]}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      <InquiryTextField prefix={prefix} name="fullName" label="Full name" required value={values.fullName} onChange={(v) => set("fullName", v)} error={errors.fullName} autoComplete="name" maxLength={200} />
      <InquiryTextField prefix={prefix} name="email" label="Work email" required type="email" value={values.email} onChange={(v) => set("email", v)} error={errors.email} autoComplete="email" maxLength={254} />
      <InquiryTextField prefix={prefix} name="phone" label="Phone" required={phoneRequired} optional={!phoneRequired} type="tel" value={values.phone} onChange={(v) => set("phone", v)} error={errors.phone} autoComplete="tel" maxLength={30} />
      <InquiryTextField prefix={prefix} name="company" label="Company" optional value={values.company} onChange={(v) => set("company", v)} error={errors.company} autoComplete="organization" maxLength={200} />

      {path === "referral" ? (
        <>
          <InquirySelectField prefix={prefix} name="profession" label="Profession or business type" required value={values.profession} onChange={(v) => set("profession", v)} error={errors.profession}
            options={PARTNER_PROFESSIONS.map((p) => ({ value: p.id, label: p.label }))} />
          {values.profession === "other" ? (
            <InquiryTextField prefix={prefix} name="professionOther" label="Tell us what you do" optional value={values.professionOther} onChange={(v) => set("professionOther", v)} error={errors.professionOther} maxLength={200} />
          ) : null}
          <TextAreaField id={`${prefix}-referralNetwork`} label="Who would you introduce?" required value={values.referralNetwork} onChange={(v) => set("referralNetwork", v)} error={errors.referralNetwork} maxLength={2000}
            help="Describe the kinds of businesses you work with. Do not include any person’s contact details here." />
          <InquirySelectField prefix={prefix} name="expectedIntroductions" label="Introductions you expect to make" value={values.expectedIntroductions} onChange={(v) => set("expectedIntroductions", v)} error={errors.expectedIntroductions}
            options={PARTNER_INTRO_VOLUME_BANDS.map((b) => ({ value: b.id, label: b.label }))} placeholder="Prefer not to say" />
          <InquiryTextField prefix={prefix} name="region" label="Region" optional value={values.region} onChange={(v) => set("region", v)} error={errors.region} maxLength={100} />
        </>
      ) : (
        <>
          <InquiryTextField prefix={prefix} name="region" label="Region" required value={values.region} onChange={(v) => set("region", v)} error={errors.region} maxLength={100} />
          <TextAreaField id={`${prefix}-experience`} label="Payments or sales experience" required value={values.experience} onChange={(v) => set("experience", v)} error={errors.experience} maxLength={2000} />
          <TextAreaField id={`${prefix}-prospectingApproach`} label="How do you find and approach businesses?" required value={values.prospectingApproach} onChange={(v) => set("prospectingApproach", v)} error={errors.prospectingApproach} maxLength={2000} />
          <InquirySelectField prefix={prefix} name="leadSourceInterest" label="Lead-source interest" required value={values.leadSourceInterest} onChange={(v) => set("leadSourceInterest", v)} error={errors.leadSourceInterest}
            options={PARTNER_LEAD_SOURCE_INTERESTS.map((i) => ({ value: i.id, label: i.label }))} />
        </>
      )}

      <InquirySelectField prefix={prefix} name="contactPreference" label="Preferred way to reach you" value={values.contactPreference} onChange={(v) => set("contactPreference", v)} error={errors.contactPreference}
        options={PARTNER_CONTACT_PREFERENCES.map((p) => ({ value: p.id, label: p.label }))} placeholder="Choose one" />
      <TextAreaField id={`${prefix}-background`} label="Anything else we should know?" optional value={values.background} onChange={(v) => set("background", v)} error={errors.background} maxLength={2000} />

      <div>
        <div className="flex min-h-11 items-start gap-3 pt-2" data-testid={`${prefix}-contact-permission`}>
          <Checkbox id={`${prefix}-contactPermission`} checked={values.contactPermission} onCheckedChange={(v) => set("contactPermission", v === true)} className="mt-0.5 shrink-0"
            aria-required aria-invalid={Boolean(errors.contactPermission)} aria-describedby={errors.contactPermission ? `${prefix}-contactPermission-error` : undefined}
            data-testid={`${prefix}-checkbox-contact-permission`} />
          <label htmlFor={`${prefix}-contactPermission`} className="text-sm text-foreground leading-relaxed cursor-pointer select-none">
            {consentBefore}<a href={PARTNER_ROUTES.privacy} className="underline" target="_blank" rel="noopener noreferrer">Privacy Notice</a>{consentAfter}*
          </label>
        </div>
        {errors.contactPermission ? <p id={`${prefix}-contactPermission-error`} role="alert" className="mt-1 text-sm text-destructive" data-testid={`${prefix}-contactPermission-error`}>{errors.contactPermission}</p> : null}
        <EmailMarketingCheckbox surface="partner_application" id={`${prefix}-marketing`} checked={values.marketingOptIn} onCheckedChange={(v) => set("marketingOptIn", v)} />
      </div>

      <p className="text-xs text-muted-foreground" data-testid={`${prefix}-review-disclosure`}>{PARTNER_REVIEW_DISCLOSURE}</p>

      <Button type="submit" disabled={submitting} className="min-h-11 w-full sm:w-auto" data-testid={`${prefix}-submit`}>
        {submitting ? "Sending…" : path === "referral" ? "Submit referral application" : "Submit sales-agent application"}
      </Button>
    </form>
  );
}
