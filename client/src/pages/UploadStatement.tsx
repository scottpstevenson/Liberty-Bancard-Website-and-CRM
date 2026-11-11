import { useEffect, useRef, useState } from "react";
import { trackStatementUploadStarted, trackStatementUploadFailed } from "@/lib/tracking";
import { useFormAbandonment } from "@/hooks/use-form-abandonment";
import { usePublicStatementUpload } from "@/hooks/use-public-intake";
import { useAnchorTarget } from "@/hooks/use-anchor-target";
import { STATEMENT_REJECTION_COPY } from "@/lib/public-intake";
import { SEO, getServiceSchema } from "@/components/SEO";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import {
  FreeStatementReviewIntro,
  FreeStatementReviewSubmitGuidance,
  FreeStatementReviewDetails,
} from "@/components/FreeStatementReviewExplainer";
import {
  FSR_DELIVERABLE,
  FSR_FAQ,
  FSR_FORM,
  FSR_HERO,
  FSR_META,
  FSR_NEXT_NOTE,
  FSR_PROCESS,
  FSR_REVIEW_CARD_FOOTNOTE,
} from "@shared/free-statement-review-content";
import { STATEMENT_UPLOAD_HELPER, STATEMENT_UPLOAD_LIMITS } from "@shared/statement-upload-limits";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PewcCheckbox } from "@/components/PewcCheckbox";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { trackStatementUploadCompleted, trackFormSubmission } from "@/lib/tracking";
import { PHONE_TEL, PHONE_NUMBER } from "@/lib/constants";
import { trackConversion, trackPhoneCallClick } from "@/lib/analytics";
import {
  EMPTY_PERSON,
  InquiryTextField,
  focusFirstError,
  inquiryAttribution,
  validatePerson,
  type InquiryErrors,
} from "@/components/intake/inquiry-fields";
import { AlertCircle, CheckCircle2, Loader2, Lock, Phone, Upload, X } from "lucide-react";

const PREFIX = "statement";
const FIELD_ORDER = ["businessName", "contactName", "email", "mobile", "pewcConsent", "file"];
const ALLOWED_EXTENSIONS = /\.(pdf|png|jpe?g)$/i;

/**
 * Code-native sample of the review layout (LB-A02): headings and dashes only. It never shows an amount, a saving or a
 * customer, and it is labelled as an illustration wherever it appears.
 */
function SampleWorksheet({ testId }: { testId: string }) {
  return (
    <figure className="rounded-2xl border border-gray-200 bg-white p-4 text-gray-700 shadow-sm" data-testid={testId}>
      <table className="w-full border-separate border-spacing-y-1 text-left text-xs">
        <caption className="sr-only">Illustrative statement review layout with headings only</caption>
        <tbody>
          {FSR_DELIVERABLE.sampleHeadings.map((heading) => (
            <tr key={heading}>
              <th scope="row" className="w-2/3 rounded-l-md bg-gray-50 px-3 py-2 font-medium text-gray-700">{heading}</th>
              <td className="rounded-r-md bg-gray-50 px-3 py-2 text-gray-500" aria-label="No value shown">—</td>
            </tr>
          ))}
        </tbody>
      </table>
      <figcaption className="mt-2 text-[11px] text-gray-500">{FSR_DELIVERABLE.sampleLabel}</figcaption>
    </figure>
  );
}

const STATEMENT_FORM_ANCHORS = ["statement-review-form", "upload-form"] as const;

export default function UploadStatement() {
  const containerRef = useScrollReveal();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [person, setPerson] = useState({ ...EMPTY_PERSON });
  const [errors, setErrors] = useState<InquiryErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // One stable intent per submission: the server's answer (not a timer) decides what the visitor is told.
  const intake = usePublicStatementUpload();
  // Both fragments mean the form. The page is lazy, so the browser's own fragment scroll misses it; this aligns the form
  // under the fixed header and focuses its heading after mount, on hash changes and on Back/Forward.
  const anchor = useAnchorTarget({ aliases: STATEMENT_FORM_ANCHORS, regionId: "statement-review-form", focusId: "statement-form-heading" });
  const uploadSucceeded = intake.state.phase === "saved";
  const isUploading = intake.busy;
  const trackedReceipt = useRef<string | null>(null);

  useEffect(() => {
    const current = intake.state;
    if (current.phase !== "saved" || !current.fresh || trackedReceipt.current === current.receipt) return;
    trackedReceipt.current = current.receipt;
    trackStatementUploadCompleted({ page: "/upload-statement", ctaLocation: "form" });
    trackFormSubmission("statement_upload");
    trackConversion("statement_upload");
  }, [intake.state]);

  // Compatible entry points: `?terminal=yes` and `?interest0=yes` carry context into the review request. They are never
  // asked as extra questions, and neither one is required to get a review.
  const params = new URLSearchParams(window.location.search);
  const preTerminal = params.get("terminal") === "yes";
  const preInterest0 = params.get("interest0") === "yes";

  const { data: authUser } = useQuery<{ email?: string; firstName?: string; lastName?: string; id?: string } | null>({
    queryKey: ["/api/auth/user"],
    queryFn: async () => {
      const res = await fetch("/api/auth/user", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data: merchantProfile } = useQuery<{ businessName?: string | null; contactId?: number } | null>({
    queryKey: ["/api/merchant-profile"],
    queryFn: async () => {
      const res = await fetch("/api/merchant-profile", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!authUser,
    staleTime: 1000 * 60 * 5,
  });

  const formIsDirty = Boolean(person.businessName || person.name || person.email || person.phone || selectedFile);
  useFormAbandonment("upload_statement", formIsDirty && !uploadSucceeded);

  // Signed-in visitors get their own details filled in once, and only into blank fields.
  useEffect(() => {
    if (!authUser) return;
    const fullName = [authUser.firstName, authUser.lastName].filter(Boolean).join(" ");
    setPerson((current) => ({
      ...current,
      name: current.name || fullName,
      email: current.email || authUser.email || "",
      businessName: current.businessName || merchantProfile?.businessName || "",
    }));
  }, [authUser, merchantProfile]);

  const reject = (message: string, field?: string) => {
    setSubmitError(message);
    if (field) {
      const next = { [field]: message };
      setErrors((current) => ({ ...current, ...next }));
      focusFirstError(PREFIX, next, [field]);
    }
  };

  const chooseFile = (file: File | null) => {
    setSelectedFile(file);
    setSubmitError(null);
    setErrors((current) => { const { file: _removed, ...rest } = current; return rest; });
    if (!file) return;
    // The server re-checks the real bytes; this only avoids sending a file it would certainly refuse.
    if (file.size > STATEMENT_UPLOAD_LIMITS.maxBytes) setSubmitError(STATEMENT_REJECTION_COPY.file_too_large);
    else if (!ALLOWED_EXTENSIONS.test(file.name)) setSubmitError(STATEMENT_REJECTION_COPY.file_type_unsupported);
  };

  const removeFile = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    chooseFile(null);
  };

  const onSubmit = async () => {
    // Guard double-click: an upload is already in flight.
    if (intake.busy) return;
    setSubmitError(null);
    const found = validatePerson(person);
    const next: InquiryErrors = {};
    if (found.businessName) next.businessName = found.businessName;
    if (found.name) next.contactName = found.name;
    if (found.email) next.email = found.email;
    if (found.phone) next.mobile = found.phone;
    if (found.pewcConsent) next.pewcConsent = found.pewcConsent;
    setErrors(next);
    if (Object.keys(next).length) {
      focusFirstError(PREFIX, next, FIELD_ORDER);
      return;
    }
    if (!selectedFile) {
      reject(STATEMENT_REJECTION_COPY.file_required);
      document.getElementById("statement-choose-file")?.focus();
      return;
    }
    if (selectedFile.size > STATEMENT_UPLOAD_LIMITS.maxBytes) {
      reject(STATEMENT_REJECTION_COPY.file_too_large);
      return;
    }
    if (!ALLOWED_EXTENSIONS.test(selectedFile.name)) {
      reject(STATEMENT_REJECTION_COPY.file_type_unsupported);
      return;
    }
    trackStatementUploadStarted({ page: "/upload-statement", ctaLocation: "form" });
    const phone = person.phone.trim();
    const fields: Record<string, string> = {
      businessName: person.businessName.trim(),
      contactName: person.name.trim(),
      email: person.email.trim(),
      ...(phone ? { mobile: phone } : {}),
      ...(preInterest0 ? { interestedIn0Percent: "true" } : {}),
      ...(preTerminal ? { needTerminal: "true" } : {}),
      ...(person.pewcConsent && phone ? { pewcConsent: "true" } : {}),
    };
    for (const [key, value] of Object.entries(inquiryAttribution())) {
      if (value !== "" && value !== false) fields[key] = String(value);
    }
    const gclidFromUrl = params.get("gclid");
    if (gclidFromUrl) fields.gclid = gclidFromUrl.slice(0, 500);
    const outcome = await intake.submit(fields, selectedFile);
    if (outcome.kind === "rejected") {
      trackStatementUploadFailed({ page: "/upload-statement", errorMessage: outcome.code });
      if (outcome.fieldErrors) {
        setErrors(outcome.fieldErrors);
        focusFirstError(PREFIX, outcome.fieldErrors, FIELD_ORDER);
      }
    } else if (outcome.kind === "unresolved") {
      trackStatementUploadFailed({ page: "/upload-statement", errorMessage: outcome.reason });
    }
  };

  const unresolvedMessage = (reason: string): string => {
    if (reason === "restored") return "A previous request in this browser session was not confirmed, and it may have been saved. Choose the same statement and press Request my review again to finish it. It will not create a duplicate. Prefer to check first? Call us at 954-266-8214.";
    if (reason === "different_request_pending") return "An earlier request from this session was not confirmed, and it may have been saved. Your changed details or file were not sent. Check the earlier request, call us at 954-266-8214, or start a new request on purpose.";
    if (reason === "mismatch") return "We could not match this browser to the earlier request, so we cannot say whether it was saved. Call us at 954-266-8214 to confirm, or start a new request on purpose.";
    if (reason === "rate_limited") return "Too many submissions — please wait a few minutes and try again.";
    if (reason === "network") return "We couldn't confirm your request. Check your connection and press Request my review again. It will not create a duplicate.";
    return "We couldn't confirm that your statement was saved. Press Request my review again to finish it (it will not create a duplicate), or call us at 954-266-8214.";
  };

  const rejectedMessage = (): string | null => {
    if (intake.state.phase !== "rejected") return null;
    return intake.state.message;
  };

  const showBanner = Boolean(submitError) || intake.state.phase === "rejected" || intake.state.phase === "unresolved";
  const bannerText = submitError ?? rejectedMessage() ?? (intake.state.phase === "unresolved" ? unresolvedMessage(intake.state.reason) : "");

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <SEO
        title={FSR_META.title}
        brandSuffix={false}
        description={FSR_META.description}
        path="/upload-statement"
        keywords={FSR_META.keywords}
        breadcrumbs={[{ name: "Upload Statement", path: "/upload-statement" }]}
        structuredData={[getServiceSchema("Free Statement Review", FSR_META.serviceDescription, "/upload-statement")]}
      />
      <Navbar />

      <main className="flex-grow pt-20" ref={containerRef}>
        {/* HERO — copy and button first; the sample layout sits beside it on desktop and follows the form on mobile. */}
        <section className="relative overflow-hidden bg-[#0d1b2e] px-5 pt-10 pb-12" data-testid="section-upload-hero">
          <div
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
            aria-hidden="true"
          />
          <div className="relative mx-auto grid max-w-5xl items-center gap-10 lg:grid-cols-2">
            <div>
              <p className="mb-4 text-xs font-bold uppercase tracking-widest text-sky-300" data-testid="text-upload-eyebrow">{FSR_HERO.badge}</p>
              <h1 className="public-h1 public-h1--page mb-4 text-[34px] font-extrabold tracking-tight text-white" data-testid="text-upload-heading">
                {FSR_HERO.heading}
              </h1>
              <p className="mb-6 text-[15px] leading-relaxed text-white/75" data-testid="text-upload-subheadline">{FSR_HERO.sub}</p>
              <a
                href="#statement-review-form"
                onClick={anchor.onAnchorClick}
                data-testid="link-hero-scroll-cta"
                className="mb-4 flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-white text-base font-extrabold text-[#0d1b2e] shadow-xl transition-all hover:bg-white/95 active:scale-[0.98] sm:max-w-xs"
              >
                <Upload className="h-5 w-5 shrink-0" aria-hidden="true" />
                {FSR_HERO.button}
              </a>
              <p className="text-sm text-white/70" data-testid="text-upload-support">{FSR_HERO.support}</p>
            </div>
            <div className="hidden lg:block">
              <SampleWorksheet testId="sample-review-hero" />
            </div>
          </div>
        </section>

        {/* FORM — directly after the hero. #upload-form is kept as a compatible alias of #statement-review-form. */}
        <section id="statement-review-form" className="scroll-mt-24 bg-white px-5 pt-8 pb-10" data-testid="section-upload-form" aria-labelledby="statement-form-heading">
          <span id="upload-form" aria-hidden="true" />
          <div className="mx-auto max-w-xl">
            {uploadSucceeded ? (
              <div className="space-y-5 py-10 text-center" data-testid="section-upload-success" role="status">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                  <CheckCircle2 className="h-9 w-9 text-green-600" aria-hidden="true" />
                </div>
                <h2 id="statement-form-heading" tabIndex={-1} className="text-2xl font-bold text-gray-900 focus:outline-none" data-testid="text-success-heading">Request received</h2>
                {intake.state.phase === "saved" && (
                  <>
                    <p className="mx-auto max-w-md text-sm leading-relaxed text-gray-600" data-testid="text-success-body">{FSR_FORM.success}</p>
                    <p className="mx-auto max-w-md text-sm leading-relaxed text-gray-600">
                      Your reference is <strong className="text-gray-900" data-testid="text-upload-reference">{intake.state.reference}</strong>. Keep it if you call us about this request.
                    </p>
                    {intake.state.processing === "deferred" && (
                      <p className="mx-auto max-w-md text-sm leading-relaxed text-gray-600" data-testid="text-processing-deferred">
                        Automatic processing is running behind, so your advisor will handle this one directly. You do not need to upload it again.
                      </p>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className="text-sm text-gray-600 underline underline-offset-2"
                  onClick={() => { removeFile(); setPerson({ ...EMPTY_PERSON }); setErrors({}); intake.dismiss(); }}
                  data-testid="button-upload-another"
                >
                  Send a different statement
                </button>
              </div>
            ) : (
              <form
                noValidate
                onSubmit={(event) => { event.preventDefault(); void onSubmit(); }}
                className="space-y-4"
                data-testid="form-upload-statement"
                aria-labelledby="statement-form-heading"
              >
                <div className="mb-2">
                  <h2 id="statement-form-heading" tabIndex={-1} className="text-2xl font-bold text-gray-900 focus:outline-none" data-testid="text-form-title">{FSR_FORM.heading}</h2>
                  <p className="mt-1 text-sm text-gray-600">{FSR_FORM.intro}</p>
                </div>

                <InquiryTextField prefix={PREFIX} name="businessName" label="Business name" required value={person.businessName} testId="input-business-name"
                  onChange={(v) => setPerson({ ...person, businessName: v })} error={errors.businessName} autoComplete="organization" maxLength={160} />
                <InquiryTextField prefix={PREFIX} name="contactName" label="Your name" required value={person.name} testId="input-contact-name"
                  onChange={(v) => setPerson({ ...person, name: v })} error={errors.contactName} autoComplete="name" maxLength={120} />
                <InquiryTextField prefix={PREFIX} name="email" label="Email" required type="email" value={person.email} testId="input-email"
                  onChange={(v) => setPerson({ ...person, email: v })} error={errors.email} autoComplete="email" maxLength={160} />
                <InquiryTextField prefix={PREFIX} name="mobile" label="Phone" optional type="tel" value={person.phone} testId="input-mobile"
                  onChange={(v) => setPerson({ ...person, phone: v })} error={errors.mobile} autoComplete="tel" maxLength={40} />

                {/* Statement file: a visible Choose file button over a real file input, never drag-and-drop only. */}
                <div>
                  <label htmlFor="statement-choose-file" className="mb-1.5 block text-sm font-medium text-gray-800" data-testid="label-file-upload">
                    {FSR_FORM.fileLabel}*
                  </label>
                  <input
                    ref={fileInputRef}
                    id="statement-file"
                    type="file"
                    accept={STATEMENT_UPLOAD_LIMITS.accept}
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                    data-testid="input-file"
                    onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
                  />
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3">
                    <Button
                      id="statement-choose-file"
                      type="button"
                      variant="outline"
                      className="public-form-field"
                      onClick={() => fileInputRef.current?.click()}
                      aria-describedby="statement-file-help"
                      data-testid="button-choose-file"
                    >
                      <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                      {selectedFile ? "Choose a different file" : "Choose file"}
                    </Button>
                    {selectedFile ? (
                      <span className="flex min-w-0 items-center gap-2 text-sm text-gray-800" data-testid="text-selected-file">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-sky-600" aria-hidden="true" />
                        <span className="break-all">{selectedFile.name}</span>
                        <button type="button" onClick={removeFile} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-gray-600 hover:text-gray-900" aria-label={`Remove ${selectedFile.name}`} data-testid="button-remove-file">
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </span>
                    ) : (
                      <span className="text-sm text-gray-600">No file chosen</span>
                    )}
                  </div>
                  <p id="statement-file-help" className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-600" data-testid="text-secure-upload">
                    <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {STATEMENT_UPLOAD_HELPER}. {FSR_HERO.uploadNote}
                  </p>
                  <p className="mt-1 text-xs text-gray-600">{FSR_REVIEW_CARD_FOOTNOTE}</p>
                </div>

                {/* Separate, optional and unchecked: a review never requires phone or text-message permission. */}
                <div>
                  <PewcCheckbox id="statement-pewcConsent" checked={person.pewcConsent} onCheckedChange={(checked) => setPerson({ ...person, pewcConsent: checked })} />
                  {errors.pewcConsent ? <p role="alert" className="mt-1 text-sm text-destructive" data-testid="statement-pewcConsent-error">{errors.pewcConsent}</p> : null}
                </div>

                {showBanner && bannerText && (
                  <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3" data-testid="alert-submit-error" role="alert">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
                    <div className="space-y-2">
                      <p className="text-sm text-red-800" data-testid="text-submit-error">{bannerText}</p>
                      {intake.state.phase === "unresolved" && intake.state.receipt && (
                        <button
                          type="button"
                          className="min-h-11 text-sm font-semibold text-red-800 underline underline-offset-2 disabled:opacity-60"
                          onClick={() => { void intake.check(); }}
                          disabled={intake.checking}
                          data-testid="button-check-upload-status"
                        >
                          {intake.checking ? "Checking…" : "Check whether it was saved"}
                        </button>
                      )}
                      {intake.state.phase === "unresolved" && (intake.state.restored || intake.state.reason === "different_request_pending" || intake.state.reason === "mismatch") && (
                        <button
                          type="button"
                          className="ml-0 min-h-11 text-sm font-semibold text-red-800 underline underline-offset-2"
                          onClick={() => { intake.dismiss(); }}
                          data-testid="button-start-new-upload"
                        >
                          Start a new request
                        </button>
                      )}
                      {intake.checkNote && <p className="text-xs text-red-800" data-testid="text-upload-check-note">{intake.checkNote}</p>}
                    </div>
                  </div>
                )}

                {isUploading && (
                  <div className="space-y-2 rounded-xl border border-gray-100 bg-gray-50 px-4 py-4" data-testid="upload-progress-container" role="status" aria-label="Upload in progress">
                    {intake.state.phase === "uploading" ? (
                      <>
                        <div className="flex items-center justify-between text-xs text-gray-600">
                          <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" aria-hidden="true" />Uploading your statement…</span>
                          <span data-testid="text-upload-progress-percent" className="font-semibold">{intake.state.percent}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200" data-testid="upload-progress-bar-track">
                          <div className="h-full rounded-full bg-sky-500 transition-all duration-200" style={{ width: `${intake.state.percent}%` }} data-testid="upload-progress-bar-fill" />
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-gray-700" data-testid="upload-confirming">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" aria-hidden="true" />
                        Upload complete. Saving your request…
                      </div>
                    )}
                  </div>
                )}

                <Button
                  type="submit"
                  className="public-form-action w-full rounded-2xl bg-[#0d1b2e] text-base font-bold text-white shadow-lg shadow-gray-900/20 transition-all hover:bg-[#162840] active:scale-[0.98]"
                  disabled={isUploading}
                  data-testid="button-upload-submit"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                      {FSR_FORM.pending}
                    </>
                  ) : (
                    FSR_FORM.submit
                  )}
                </Button>

                <p className="text-center text-sm text-gray-700" data-testid="text-form-helper">
                  {FSR_FORM.helper}{" "}
                  <Link href={FSR_FORM.helperHref} className="underline underline-offset-2" data-testid="link-form-help">{FSR_FORM.helperLink}</Link>
                </p>

                <p className="text-center text-xs leading-snug text-gray-600" data-testid="text-compliance-microcopy">
                  We use these details to respond to your request and review your statement. See our{" "}
                  <a href="/privacy-policy" className="underline">Privacy Policy</a>. Eligibility, underwriting, card brand rules, and applicable laws apply. No savings claims without statement review.
                </p>
              </form>
            )}
          </div>
        </section>

        {/* LB-SR-02 — what the review gives you, with the sample layout following the form on mobile. */}
        <section className="bg-gray-50 px-5 py-10" data-testid="section-what-we-review" aria-labelledby="deliverable-heading">
          <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-2 lg:items-start">
            <div>
              <h2 id="deliverable-heading" className="mb-4 text-2xl font-bold text-gray-900" data-testid="text-deliverable-heading">{FSR_DELIVERABLE.heading}</h2>
              <ol className="space-y-3" data-testid="list-deliverable">
                {FSR_DELIVERABLE.rows.map((row, index) => (
                  <li key={row} className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0d1b2e] text-sm font-bold text-white" aria-hidden="true">{index + 1}</span>
                    <p className="text-sm text-gray-800">{row}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <div className="lg:hidden">
                <details data-testid="sample-review-details">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-gray-900">See the review layout</summary>
                  <SampleWorksheet testId="sample-review-mobile" />
                </details>
              </div>
              <div className="hidden lg:block">
                <SampleWorksheet testId="sample-review-desktop" />
              </div>
            </div>
          </div>
        </section>

        <FreeStatementReviewIntro />
        <FreeStatementReviewSubmitGuidance />
        <FreeStatementReviewDetails />

        {/* LB-SR-03 — three steps, with no countdown and no promised response time. */}
        <section className="bg-white px-5 py-10" data-testid="section-what-happens-next" aria-labelledby="process-heading">
          <div className="reveal mx-auto max-w-5xl">
            <h2 id="process-heading" className="mb-6 text-2xl font-bold text-gray-900" data-testid="text-what-happens-next">{FSR_PROCESS.heading}</h2>
            <ol className="grid gap-3 md:grid-cols-3">
              {FSR_PROCESS.steps.map((step, index) => (
                <li key={step} className="flex items-start gap-4 rounded-2xl border border-gray-100 bg-white px-4 py-4 shadow-sm" data-testid={`card-step-${index + 1}`}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0d1b2e] text-sm font-bold text-white" aria-hidden="true">{index + 1}</span>
                  <p className="text-sm text-gray-800">{step}</p>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-sm text-gray-600" data-testid="text-what-happens-next-note">{FSR_PROCESS.support} {FSR_NEXT_NOTE}</p>
          </div>
        </section>

        {/* LB-SR-05 — the three questions. */}
        <section className="bg-gray-50 px-5 py-10" data-testid="section-statement-faq" aria-labelledby="faq-heading">
          <div className="mx-auto max-w-3xl">
            <h2 id="faq-heading" className="mb-4 text-2xl font-bold text-gray-900" data-testid="text-faq-heading">{FSR_FAQ.heading}</h2>
            <Accordion type="multiple" className="rounded-2xl border border-gray-200 bg-white px-4" data-testid="accordion-statement-faq">
              {FSR_FAQ.items.map((item, index) => (
                <AccordionItem key={item.question} value={`faq-${index}`} data-testid={`faq-item-${index + 1}`}>
                  <AccordionTrigger className="min-h-11 text-left text-base font-semibold text-gray-900">{item.question}</AccordionTrigger>
                  <AccordionContent className="text-sm text-gray-700">
                    {item.answer}
                    {"link" in item && item.link ? (
                      <>
                        {" "}
                        <Link href={item.link.href} className="underline underline-offset-2" data-testid="link-faq-discuss">{item.link.label}</Link>.
                      </>
                    ) : null}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>

        {/* Closing prompt. */}
        <section className="bg-[#0d1b2e] px-5 py-10" data-testid="section-upload-closing">
          <div className="mx-auto max-w-lg space-y-4 text-center">
            <h2 className="text-2xl font-extrabold leading-tight text-white">{FSR_HERO.heading}</h2>
            <a
              href="#statement-review-form"
              onClick={anchor.onAnchorClick}
              className="mx-auto flex h-14 w-full max-w-xs items-center justify-center gap-2.5 rounded-2xl bg-white text-base font-extrabold text-[#0d1b2e] shadow-xl transition-all hover:bg-white/95 active:scale-[0.98]"
              data-testid="link-closing-cta"
            >
              <Upload className="h-5 w-5 shrink-0" aria-hidden="true" />
              {FSR_HERO.button}
            </a>
            <a
              href={PHONE_TEL}
              aria-label={`Call Liberty Bancard at ${PHONE_NUMBER}`}
              data-testid="link-upload-hero-phone"
              className="public-tap inline-flex items-center gap-2 text-sm text-white/80 transition-colors hover:text-white"
              onClick={() => trackPhoneCallClick({ sourcePage: "/upload-statement" })}
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              Or call {PHONE_NUMBER}
            </a>
            <p className="text-[11px] leading-snug text-white/70">Eligibility, underwriting, card brand rules, and applicable laws apply.</p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
