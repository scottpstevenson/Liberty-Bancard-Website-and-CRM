import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { InquiryTextField, focusFirstError } from "@/components/intake/inquiry-fields";
import { clearSubmissionKey, getSubmissionKey } from "@/lib/submission-key";
import { getCsrfToken } from "@/lib/queryClient";
import { PARTNER_INTRODUCTION_PERMISSION } from "@shared/partner-public-content";

interface IntroductionView {
  reference: string;
  businessName: string;
  submittedAt: string;
  status: "received" | "under_review" | "accepted" | "declined";
  nextStep: string;
}

interface FormValues {
  businessName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  context: string;
  permissionConfirmed: boolean;
}

const EMPTY: FormValues = { businessName: "", contactName: "", contactEmail: "", contactPhone: "", website: "", context: "", permissionConfirmed: false };
const PREFIX = "partner-intro";
const FIELD_ORDER = ["businessName", "contactName", "contactEmail", "contactPhone", "website", "context", "permissionConfirmed"];
const STATUS_LABEL: Record<IntroductionView["status"], string> = {
  received: "Received",
  under_review: "Under review",
  accepted: "Accepted",
  declined: "Not accepted",
};
const GENERIC_FAILURE = "We could not confirm that this introduction was saved. Your entries are still here. Press Submit again: it will not be duplicated.";

/** Same mailbox/phone/business for the same partner replays the same occurrence after a lost response or a reload. */
const keyIdentity = (partnerCode: string, v: FormValues) =>
  `${partnerCode}:${v.businessName}:${v.contactEmail || v.contactPhone}`.replace(/\s+/g, " ");

function localValidation(v: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!v.businessName.trim()) errors.businessName = "Business name is required.";
  if (!v.contactName.trim()) errors.contactName = "Contact name is required.";
  if (!v.contactEmail.trim() && !v.contactPhone.trim()) errors.contactEmail = "Enter a business email or a phone number so we can follow up.";
  else if (v.contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.contactEmail.trim())) errors.contactEmail = "Enter a valid email address.";
  if (!v.permissionConfirmed) errors.permissionConfirmed = "Confirm that this contact has agreed to an introduction.";
  return errors;
}

/**
 * Authenticated introduction form for an active partner. The partner is identified by the signed-in session on the
 * server; nothing in the request names a partner, a rate or an actor. The confirmation records the introducer's
 * statement that the contact agreed to be introduced. It is not the business's own marketing consent.
 */
export function PartnerIntroductionsTab({ partnerCode, partnerActive }: { partnerCode: string; partnerActive: boolean }) {
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<IntroductionView | null>(null);
  const [list, setList] = useState<IntroductionView[] | null>(null);
  const [listError, setListError] = useState(false);
  const summaryRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef<HTMLHeadingElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  const set = <K extends keyof FormValues>(key: K, next: FormValues[K]) => setValues((current) => ({ ...current, [key]: next }));

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/partners/me/introductions", { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setList(Array.isArray(data.introductions) ? data.introductions : []);
      setListError(false);
    } catch {
      setListError(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (saved) savedRef.current?.focus(); }, [saved]);
  useEffect(() => { if (focusRequest > 0) summaryRef.current?.focus(); }, [focusRequest]);

  const errorKeys = FIELD_ORDER.filter((key) => errors[key]).concat(errors.form ? ["form"] : []);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setNotice(null);
    const found = localValidation(values);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setFocusRequest((n) => n + 1);
      return;
    }
    setErrors({});
    setSubmitting(true);
    const identity = keyIdentity(partnerCode, values);
    const key = getSubmissionKey("partner_introduction", identity);
    try {
      const csrf = getCsrfToken();
      const res = await fetch("/api/partners/me/introductions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key, ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
        body: JSON.stringify({
          businessName: values.businessName.trim(),
          contactName: values.contactName.trim(),
          ...(values.contactEmail.trim() ? { contactEmail: values.contactEmail.trim() } : {}),
          ...(values.contactPhone.trim() ? { contactPhone: values.contactPhone.trim() } : {}),
          ...(values.website.trim() ? { website: values.website.trim() } : {}),
          ...(values.context.trim() ? { context: values.context.trim() } : {}),
          permissionConfirmed: true,
          permissionVersion: PARTNER_INTRODUCTION_PERMISSION.version,
        }),
      });
      const data = await res.json().catch(() => null);
      if ((res.status === 200 || res.status === 201) && data?.reference) {
        clearSubmissionKey("partner_introduction", identity);
        setSaved(data as IntroductionView);
        setValues(EMPTY);
        void load();
        return;
      }
      if (res.status === 400 && data?.code === "VALIDATION_FAILED" && Array.isArray(data.issues)) {
        clearSubmissionKey("partner_introduction", identity);
        const next: Record<string, string> = {};
        for (const issue of data.issues as { field: string; message: string }[]) if (!next[issue.field]) next[issue.field] = issue.message;
        setErrors(next);
      } else if (res.status === 403 && data?.code === "PARTNER_NOT_ACTIVE") {
        setNotice("Your partner account is not active, so introductions cannot be submitted right now.");
      } else if (res.status === 409) {
        clearSubmissionKey("partner_introduction", identity);
        setNotice("This introduction was already submitted with different details. Check your entries and submit again.");
      } else if (res.status === 401) {
        setNotice("Your session has ended. Sign in again, then submit this introduction.");
      } else {
        setNotice(GENERIC_FAILURE);
      }
    } catch {
      setNotice(GENERIC_FAILURE);
    } finally {
      setSubmitting(false);
      setFocusRequest((n) => n + 1);
    }
  };

  return (
    <div className="space-y-6" data-testid="partner-introductions">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Introduce a business</CardTitle>
          <p className="text-sm text-muted-foreground">
            Submit a business only after its owner or decision-maker has agreed to hear from Liberty Bancard. Our team reviews each introduction.
            Submitting one does not sign the business up for marketing and does not create an agreement or a payment.
          </p>
        </CardHeader>
        <CardContent>
          {!partnerActive ? (
            <p className="text-sm text-muted-foreground" data-testid={`${PREFIX}-inactive`}>
              Introductions open when your partner account is active.
            </p>
          ) : saved ? (
            <div className="space-y-3 py-2" role="status" data-testid={`${PREFIX}-success`}>
              <CheckCircle className="h-8 w-8 text-emerald-600" aria-hidden="true" />
              <h3 ref={savedRef} tabIndex={-1} className="text-base font-semibold text-foreground outline-none" data-testid={`${PREFIX}-success-heading`}>
                Introduction received
              </h3>
              <p className="text-sm text-muted-foreground">
                We saved the introduction for {saved.businessName}. {saved.nextStep} Status updates appear in the list below.
              </p>
              <Button variant="outline" className="min-h-11" onClick={() => setSaved(null)} data-testid={`${PREFIX}-another`}>Introduce another business</Button>
            </div>
          ) : (
            <form noValidate onSubmit={onSubmit} className="space-y-4" aria-busy={submitting || undefined} data-testid={`${PREFIX}-form`}>
              {(errorKeys.length > 0 || notice) ? (
                <div ref={summaryRef} tabIndex={-1} role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm outline-none" data-testid={`${PREFIX}-error-summary`}>
                  {notice ? <p className="text-foreground">{notice}</p> : null}
                  {errorKeys.length > 0 ? (
                    <>
                      <p className="font-medium text-foreground">Please fix the following before submitting:</p>
                      <ul className="mt-2 list-disc pl-5">
                        {errorKeys.map((key) => (
                          <li key={key}>
                            {key === "form" ? <span>{errors.form}</span> : (
                              <a href={`#${PREFIX}-${key}`} className="underline" onClick={(e) => { e.preventDefault(); focusFirstError(PREFIX, { [key]: errors[key] }, [key]); }}>
                                {errors[key]}
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              ) : null}
              <InquiryTextField prefix={PREFIX} name="businessName" label="Business name" required value={values.businessName} onChange={(v) => set("businessName", v)} error={errors.businessName} maxLength={200} />
              <InquiryTextField prefix={PREFIX} name="contactName" label="Contact name" required value={values.contactName} onChange={(v) => set("contactName", v)} error={errors.contactName} maxLength={200} />
              <InquiryTextField prefix={PREFIX} name="contactEmail" label="Business email" type="email" value={values.contactEmail} onChange={(v) => set("contactEmail", v)} error={errors.contactEmail} maxLength={254} help="Enter an email, a phone number, or both." />
              <InquiryTextField prefix={PREFIX} name="contactPhone" label="Business phone" type="tel" optional value={values.contactPhone} onChange={(v) => set("contactPhone", v)} error={errors.contactPhone} maxLength={30} />
              <InquiryTextField prefix={PREFIX} name="website" label="Website" optional value={values.website} onChange={(v) => set("website", v)} error={errors.website} maxLength={300} />
              <div>
                <label htmlFor={`${PREFIX}-context`} className="mb-1.5 block text-sm font-medium text-foreground">Context (optional)</label>
                <Textarea id={`${PREFIX}-context`} rows={3} maxLength={1000} value={values.context} onChange={(e) => set("context", e.target.value)}
                  aria-invalid={Boolean(errors.context)} aria-describedby={errors.context ? `${PREFIX}-context-error` : undefined} data-testid={`${PREFIX}-context-input`} />
                {errors.context ? <p id={`${PREFIX}-context-error`} role="alert" className="mt-1 text-sm text-destructive">{errors.context}</p> : null}
              </div>
              <div className="flex items-start gap-3">
                <Checkbox id={`${PREFIX}-permissionConfirmed`} checked={values.permissionConfirmed} onCheckedChange={(checked) => set("permissionConfirmed", checked === true)}
                  aria-required="true" aria-invalid={Boolean(errors.permissionConfirmed)} aria-describedby={errors.permissionConfirmed ? `${PREFIX}-permissionConfirmed-error` : undefined}
                  className="mt-1 h-5 w-5" data-testid={`${PREFIX}-permission-checkbox`} />
                <div>
                  <label htmlFor={`${PREFIX}-permissionConfirmed`} className="text-sm text-foreground">{PARTNER_INTRODUCTION_PERMISSION.text}*</label>
                  {errors.permissionConfirmed ? <p id={`${PREFIX}-permissionConfirmed-error`} role="alert" className="mt-1 text-sm text-destructive" data-testid={`${PREFIX}-permission-error`}>{errors.permissionConfirmed}</p> : null}
                </div>
              </div>
              <Button type="submit" disabled={submitting} className="min-h-11" data-testid={`${PREFIX}-submit`}>
                {submitting ? "Submitting..." : "Submit introduction"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Your introductions</CardTitle></CardHeader>
        <CardContent>
          {listError ? (
            <p className="text-sm text-muted-foreground" role="status" data-testid={`${PREFIX}-list-error`}>
              We could not load your introductions. <button type="button" className="underline" onClick={() => void load()}>Try again</button>
            </p>
          ) : list === null ? (
            <p className="text-sm text-muted-foreground" role="status">Loading...</p>
          ) : list.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid={`${PREFIX}-empty`}>No introductions yet.</p>
          ) : (
            <ul className="divide-y divide-border" data-testid={`${PREFIX}-list`}>
              {list.map((item) => (
                <li key={item.reference} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{item.businessName}</p>
                    <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-foreground">{STATUS_LABEL[item.status]}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Submitted {new Date(item.submittedAt).toLocaleDateString()}</p>
                  <p className="text-sm text-muted-foreground">{item.nextStep}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
