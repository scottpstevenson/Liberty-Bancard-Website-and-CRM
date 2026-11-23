import { useEffect, useRef, useState } from "react";
import {
  trackStatementUploadStarted,
  trackStatementUploadFailed,
} from "@/lib/tracking";
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
  FSR_DELIVERABLE,
  FSR_WHAT_IT_IS,
  FSR_WHAT_YOU_RECEIVE,
  FSR_COST,
  FSR_HANDLING,
  FSR_WHO_QUALIFIES,
  FSR_FUNDING_NOTE,
  FSR_DISCLOSURE,
  FSR_FAQ,
  FSR_FORM,
  FSR_HERO,
  FSR_META,
  FSR_NEXT_NOTE,
  FSR_PROCESS,
  FSR_REVIEW_CARD_FOOTNOTE,
} from "@shared/free-statement-review-content";
import {
  STATEMENT_UPLOAD_HELPER,
  STATEMENT_UPLOAD_LIMITS,
} from "@shared/statement-upload-limits";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PewcCheckbox } from "@/components/PewcCheckbox";
import "@/styles/statement-review.css";
import {
  trackStatementUploadCompleted,
  trackFormSubmission,
} from "@/lib/tracking";
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
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  FileText,
  Layers3,
  Loader2,
  Lock,
  Phone,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";

const PREFIX = "statement";
const FIELD_ORDER = [
  "businessName",
  "contactName",
  "email",
  "mobile",
  "pewcConsent",
  "file",
];
const ALLOWED_EXTENSIONS = /\.(pdf|png|jpe?g)$/i;

const STATEMENT_FORM_ANCHORS = [
  "statement-review-form",
  "upload-form",
] as const;

export default function UploadStatement() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [person, setPerson] = useState({ ...EMPTY_PERSON });
  const [errors, setErrors] = useState<InquiryErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // One stable intent per submission: the server's answer (not a timer) decides what the visitor is told.
  const intake = usePublicStatementUpload();
  // Both fragments mean the form. The page is lazy, so the browser's own fragment scroll misses it; this aligns the form
  // under the fixed header and focuses its heading after mount, on hash changes and on Back/Forward.
  const anchor = useAnchorTarget({
    aliases: STATEMENT_FORM_ANCHORS,
    regionId: "statement-review-form",
    focusId: "statement-form-heading",
  });
  const uploadSucceeded = intake.state.phase === "saved";
  const isUploading = intake.busy;
  const trackedReceipt = useRef<string | null>(null);

  useEffect(() => {
    const current = intake.state;
    if (
      current.phase !== "saved" ||
      !current.fresh ||
      trackedReceipt.current === current.receipt
    )
      return;
    trackedReceipt.current = current.receipt;
    trackStatementUploadCompleted({
      page: "/upload-statement",
      ctaLocation: "form",
    });
    trackFormSubmission("statement_upload");
    trackConversion("statement_upload", { receipt: current.receipt });
  }, [intake.state]);

  // Compatible entry points: `?terminal=yes` and `?interest0=yes` carry context into the review request. They are never
  // asked as extra questions, and neither one is required to get a review.
  const params = new URLSearchParams(window.location.search);
  const preTerminal = params.get("terminal") === "yes";
  const preInterest0 = params.get("interest0") === "yes";

  const { data: authUser } = useQuery<{
    email?: string;
    firstName?: string;
    lastName?: string;
    id?: string;
  } | null>({
    queryKey: ["/api/auth/user"],
    queryFn: async () => {
      const res = await fetch("/api/auth/user", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data: merchantProfile } = useQuery<{
    businessName?: string | null;
    contactId?: number;
  } | null>({
    queryKey: ["/api/merchant-profile"],
    queryFn: async () => {
      const res = await fetch("/api/merchant-profile", {
        credentials: "include",
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!authUser,
    staleTime: 1000 * 60 * 5,
  });

  const formIsDirty = Boolean(
    person.businessName ||
      person.name ||
      person.email ||
      person.phone ||
      selectedFile,
  );
  useFormAbandonment("upload_statement", formIsDirty && !uploadSucceeded);

  // Signed-in visitors get their own details filled in once, and only into blank fields.
  useEffect(() => {
    if (!authUser) return;
    const fullName = [authUser.firstName, authUser.lastName]
      .filter(Boolean)
      .join(" ");
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
    setErrors((current) => {
      const { file: _removed, ...rest } = current;
      return rest;
    });
    if (!file) return;
    // The server re-checks the real bytes; this only avoids sending a file it would certainly refuse.
    if (file.size > STATEMENT_UPLOAD_LIMITS.maxBytes)
      setSubmitError(STATEMENT_REJECTION_COPY.file_too_large);
    else if (!ALLOWED_EXTENSIONS.test(file.name))
      setSubmitError(STATEMENT_REJECTION_COPY.file_type_unsupported);
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
    trackStatementUploadStarted({
      page: "/upload-statement",
      ctaLocation: "form",
    });
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
    const outcome = await intake.submit(fields, selectedFile);
    if (outcome.kind === "rejected") {
      trackStatementUploadFailed({
        page: "/upload-statement",
        errorMessage: outcome.code,
      });
      if (outcome.fieldErrors) {
        setErrors(outcome.fieldErrors);
        focusFirstError(PREFIX, outcome.fieldErrors, FIELD_ORDER);
      }
    } else if (outcome.kind === "unresolved") {
      trackStatementUploadFailed({
        page: "/upload-statement",
        errorMessage: outcome.reason,
      });
    }
  };

  const unresolvedMessage = (reason: string): string => {
    if (reason === "restored")
      return "A previous request in this browser session was not confirmed, and it may have been saved. Choose the same statement and press Request my review again to finish it. It will not create a duplicate. Prefer to check first? Call us at 954-266-8214.";
    if (reason === "different_request_pending")
      return "An earlier request from this session was not confirmed, and it may have been saved. Your changed details or file were not sent. Check the earlier request, call us at 954-266-8214, or start a new request on purpose.";
    if (reason === "mismatch")
      return "We could not match this browser to the earlier request, so we cannot say whether it was saved. Call us at 954-266-8214 to confirm, or start a new request on purpose.";
    if (reason === "rate_limited")
      return "Too many submissions — please wait a few minutes and try again.";
    if (reason === "network")
      return "We couldn't confirm your request. Check your connection and press Request my review again. It will not create a duplicate.";
    return "We couldn't confirm that your statement was saved. Press Request my review again to finish it (it will not create a duplicate), or call us at 954-266-8214.";
  };

  const rejectedMessage = (): string | null => {
    if (intake.state.phase !== "rejected") return null;
    return intake.state.message;
  };

  const showBanner =
    Boolean(submitError) ||
    intake.state.phase === "rejected" ||
    intake.state.phase === "unresolved";
  const bannerText =
    submitError ??
    rejectedMessage() ??
    (intake.state.phase === "unresolved"
      ? unresolvedMessage(intake.state.reason)
      : "");

  return (
    <div className="statement-page min-h-screen flex flex-col">
      <SEO
        title={FSR_META.title}
        brandSuffix={false}
        description={FSR_META.description}
        path="/upload-statement"
        keywords={FSR_META.keywords}
        breadcrumbs={[{ name: "Upload Statement", path: "/upload-statement" }]}
        structuredData={[
          getServiceSchema(
            "Free Statement Review",
            FSR_META.serviceDescription,
            "/upload-statement",
          ),
        ]}
      />
      <Navbar />

      <main className="flex-grow pt-20">
        <section
          className="statement-hero"
          data-testid="section-upload-hero"
          aria-labelledby="statement-page-heading"
        >
          <div className="statement-hero-accent" aria-hidden="true" />
          <div className="statement-container statement-hero-grid">
            <div className="statement-hero-copy">
              <p
                className="statement-eyebrow"
                data-testid="text-upload-eyebrow"
              >
                <span />
                {FSR_HERO.badge}
              </p>
              <h1 id="statement-page-heading" data-testid="text-upload-heading">
                {FSR_HERO.headingLines[0]}
                <br />
                {FSR_HERO.headingLines[1]}
                <br />
                <em>{FSR_HERO.headingLines[2]}</em>
              </h1>
              <p
                className="statement-hero-description"
                data-testid="text-upload-subheadline"
              >
                {FSR_HERO.sub}
              </p>
              <div className="statement-hero-actions">
                <a
                  href="#statement-review-form"
                  onClick={anchor.onAnchorClick}
                  className="statement-text-link"
                  data-testid="link-hero-scroll-cta"
                >
                  {FSR_HERO.button}
                  <ArrowUpRight size={19} aria-hidden="true" />
                </a>
                <span>Free. No obligation to switch.</span>
              </div>
              <div
                className="statement-fee-map"
                data-testid="statement-fee-map"
                aria-label="The four fee categories your review explains"
              >
                <div className="statement-fee-map-heading">
                  <Layers3 size={18} aria-hidden="true" />
                  <span>Every charge, put in context.</span>
                </div>
                <ol>
                  {[
                    "Interchange",
                    "Network fees",
                    "Processor charges",
                    "Equipment & gateway",
                  ].map((label, i) => (
                    <li key={label}>
                      <span>0{i + 1}</span>
                      {label}
                      <Check size={15} aria-hidden="true" />
                    </li>
                  ))}
                </ol>
                <p>
                  We identify the charges and explain who sets them. Unknown
                  fees stay identified as unknown.
                </p>
              </div>
              <div className="statement-trust">
                <ShieldCheck size={20} aria-hidden="true" />
                <p>
                  Encrypted upload. No processor login needed.
                  <br />
                  <a href="#document-handling">
                    See how your documents are handled
                  </a>
                </p>
              </div>
            </div>
            <div
              id="statement-review-form"
              className="statement-form-panel scroll-mt-24"
              data-testid="section-upload-form"
            >
              <div className="statement-form-inner">
                {uploadSucceeded ? (
                  <div
                    className="space-y-5 py-10 text-center"
                    data-testid="section-upload-success"
                    role="status"
                  >
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                      <CheckCircle2
                        className="h-9 w-9 text-green-600"
                        aria-hidden="true"
                      />
                    </div>
                    <h2
                      id="statement-form-heading"
                      tabIndex={-1}
                      className="text-2xl font-bold text-gray-900 focus:outline-none"
                      data-testid="text-success-heading"
                    >
                      Request received
                    </h2>
                    {intake.state.phase === "saved" && (
                      <>
                        <p
                          className="mx-auto max-w-md text-sm leading-relaxed text-gray-600"
                          data-testid="text-success-body"
                        >
                          {FSR_FORM.success}
                        </p>
                        <p className="mx-auto max-w-md text-sm leading-relaxed text-gray-600">
                          Your reference is{" "}
                          <strong
                            className="text-gray-900"
                            data-testid="text-upload-reference"
                          >
                            {intake.state.reference}
                          </strong>
                          . Keep it if you call us about this request.
                        </p>
                        {intake.state.processing === "deferred" && (
                          <p
                            className="mx-auto max-w-md text-sm leading-relaxed text-gray-600"
                            data-testid="text-processing-deferred"
                          >
                            Automatic processing is running behind, so your
                            advisor will handle this one directly. You do not
                            need to upload it again.
                          </p>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      className="text-sm text-gray-600 underline underline-offset-2"
                      onClick={() => {
                        removeFile();
                        setPerson({ ...EMPTY_PERSON });
                        setErrors({});
                        intake.dismiss();
                      }}
                      data-testid="button-upload-another"
                    >
                      Send a different statement
                    </button>
                  </div>
                ) : (
                  <form
                    noValidate
                    onSubmit={(event) => {
                      event.preventDefault();
                      void onSubmit();
                    }}
                    className="space-y-4"
                    data-testid="form-upload-statement"
                    aria-labelledby="statement-form-heading"
                  >
                    <div className="mb-2">
                      <h2
                        id="statement-form-heading"
                        tabIndex={-1}
                        className="text-2xl font-bold text-gray-900 focus:outline-none"
                        data-testid="text-form-title"
                      >
                        {FSR_FORM.heading}
                      </h2>
                      <p className="mt-1 text-sm text-gray-600">
                        {FSR_FORM.intro}
                      </p>
                    </div>

                    <div className="statement-person-fields">
                      <InquiryTextField
                        prefix={PREFIX}
                        name="businessName"
                        label="Business name"
                        required
                        value={person.businessName}
                        testId="input-business-name"
                        onChange={(v) =>
                          setPerson({ ...person, businessName: v })
                        }
                        error={errors.businessName}
                        autoComplete="organization"
                        maxLength={160}
                      />
                      <InquiryTextField
                        prefix={PREFIX}
                        name="contactName"
                        label="Your name"
                        required
                        value={person.name}
                        testId="input-contact-name"
                        onChange={(v) => setPerson({ ...person, name: v })}
                        error={errors.contactName}
                        autoComplete="name"
                        maxLength={120}
                      />
                      <InquiryTextField
                        prefix={PREFIX}
                        name="email"
                        label="Email"
                        required
                        type="email"
                        value={person.email}
                        testId="input-email"
                        onChange={(v) => setPerson({ ...person, email: v })}
                        error={errors.email}
                        autoComplete="email"
                        maxLength={160}
                      />
                      <InquiryTextField
                        prefix={PREFIX}
                        name="mobile"
                        label="Phone"
                        optional
                        type="tel"
                        value={person.phone}
                        testId="input-mobile"
                        onChange={(v) => setPerson({ ...person, phone: v })}
                        error={errors.mobile}
                        autoComplete="tel"
                        maxLength={40}
                      />
                    </div>

                    {/* Statement file: a visible Choose file button over a real file input, never drag-and-drop only. */}
                    <div>
                      <label
                        htmlFor="statement-choose-file"
                        className="mb-1.5 block text-sm font-medium text-gray-800"
                        data-testid="label-file-upload"
                      >
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
                        onChange={(event) =>
                          chooseFile(event.target.files?.[0] ?? null)
                        }
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
                          {selectedFile
                            ? "Choose a different file"
                            : "Choose file"}
                        </Button>
                        {selectedFile ? (
                          <span
                            className="flex min-w-0 items-center gap-2 text-sm text-gray-800"
                            data-testid="text-selected-file"
                          >
                            <CheckCircle2
                              className="h-4 w-4 shrink-0 text-sky-600"
                              aria-hidden="true"
                            />
                            <span className="break-all">
                              {selectedFile.name}
                            </span>
                            <button
                              type="button"
                              onClick={removeFile}
                              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-gray-600 hover:text-gray-900"
                              aria-label={`Remove ${selectedFile.name}`}
                              data-testid="button-remove-file"
                            >
                              <X className="h-4 w-4" aria-hidden="true" />
                            </button>
                          </span>
                        ) : (
                          <span className="text-sm text-gray-600">
                            No file chosen
                          </span>
                        )}
                      </div>
                      <p
                        id="statement-file-help"
                        className="mt-1.5 flex items-center gap-1.5 text-xs text-gray-600"
                        data-testid="text-secure-upload"
                      >
                        <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                        {STATEMENT_UPLOAD_HELPER}. {FSR_HERO.uploadNote}
                      </p>
                      <p className="mt-1 text-xs text-gray-600">
                        {FSR_REVIEW_CARD_FOOTNOTE}
                      </p>
                    </div>

                    {/* Separate, optional and unchecked: a review never requires phone or text-message permission. */}
                    <div>
                      <PewcCheckbox
                        id="statement-pewcConsent"
                        checked={person.pewcConsent}
                        onCheckedChange={(checked) =>
                          setPerson({ ...person, pewcConsent: checked })
                        }
                      />
                      {errors.pewcConsent ? (
                        <p
                          role="alert"
                          className="mt-1 text-sm text-destructive"
                          data-testid="statement-pewcConsent-error"
                        >
                          {errors.pewcConsent}
                        </p>
                      ) : null}
                    </div>

                    {showBanner && bannerText && (
                      <div
                        className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3"
                        data-testid="alert-submit-error"
                        role="alert"
                      >
                        <AlertCircle
                          className="mt-0.5 h-4 w-4 shrink-0 text-red-700"
                          aria-hidden="true"
                        />
                        <div className="space-y-2">
                          <p
                            className="text-sm text-red-800"
                            data-testid="text-submit-error"
                          >
                            {bannerText}
                          </p>
                          {intake.state.phase === "unresolved" &&
                            intake.state.receipt && (
                              <button
                                type="button"
                                className="min-h-11 text-sm font-semibold text-red-800 underline underline-offset-2 disabled:opacity-60"
                                onClick={() => {
                                  void intake.check();
                                }}
                                disabled={intake.checking}
                                data-testid="button-check-upload-status"
                              >
                                {intake.checking
                                  ? "Checking…"
                                  : "Check whether it was saved"}
                              </button>
                            )}
                          {intake.state.phase === "unresolved" &&
                            (intake.state.restored ||
                              intake.state.reason ===
                                "different_request_pending" ||
                              intake.state.reason === "mismatch") && (
                              <button
                                type="button"
                                className="ml-0 min-h-11 text-sm font-semibold text-red-800 underline underline-offset-2"
                                onClick={() => {
                                  intake.dismiss();
                                }}
                                data-testid="button-start-new-upload"
                              >
                                Start a new request
                              </button>
                            )}
                          {intake.checkNote && (
                            <p
                              className="text-xs text-red-800"
                              data-testid="text-upload-check-note"
                            >
                              {intake.checkNote}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {isUploading && (
                      <div
                        className="space-y-2 rounded-xl border border-gray-100 bg-gray-50 px-4 py-4"
                        data-testid="upload-progress-container"
                        role="status"
                        aria-label="Upload in progress"
                      >
                        {intake.state.phase === "uploading" ? (
                          <>
                            <div className="flex items-center justify-between text-xs text-gray-600">
                              <span className="flex items-center gap-1.5">
                                <Loader2
                                  className="h-3.5 w-3.5 animate-spin text-sky-600"
                                  aria-hidden="true"
                                />
                                Uploading your statement…
                              </span>
                              <span
                                data-testid="text-upload-progress-percent"
                                className="font-semibold"
                              >
                                {intake.state.percent}%
                              </span>
                            </div>
                            <div
                              className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
                              data-testid="upload-progress-bar-track"
                            >
                              <div
                                className="h-full rounded-full bg-sky-500 transition-all duration-200"
                                style={{ width: `${intake.state.percent}%` }}
                                data-testid="upload-progress-bar-fill"
                              />
                            </div>
                          </>
                        ) : (
                          <div
                            className="flex items-center gap-1.5 text-xs text-gray-700"
                            data-testid="upload-confirming"
                          >
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin text-sky-600"
                              aria-hidden="true"
                            />
                            Upload complete. Saving your request…
                          </div>
                        )}
                      </div>
                    )}

                    <Button
                      type="submit"
                      className="public-form-action statement-submit w-full text-base font-bold"
                      style={{ minHeight: "var(--public-action-height, 3.25rem)" }}
                      disabled={isUploading}
                      data-testid="button-upload-submit"
                    >
                      {isUploading ? (
                        <>
                          <Loader2
                            className="mr-2 h-5 w-5 animate-spin"
                            aria-hidden="true"
                          />
                          {FSR_FORM.pending}
                        </>
                      ) : (
                        FSR_FORM.submit
                      )}
                    </Button>

                    <p
                      className="text-center text-sm text-gray-700"
                      data-testid="text-form-helper"
                    >
                      {FSR_FORM.helper}{" "}
                      <Link
                        href={FSR_FORM.helperHref}
                        className="underline underline-offset-2"
                        data-testid="link-form-help"
                      >
                        {FSR_FORM.helperLink}
                      </Link>
                    </p>

                    <p
                      className="text-center text-xs leading-snug text-gray-600"
                      data-testid="text-compliance-microcopy"
                    >
                      We use these details to respond to your request and review
                      your statement. See our{" "}
                      <a href="/privacy-policy" className="underline">
                        Privacy Policy
                      </a>
                      . Eligibility, underwriting, card brand rules, and
                      applicable laws apply. No savings claims without statement
                      review.
                    </p>
                  </form>
                )}
              </div>
            </div>
          </div>
        </section>

        <section
          id="free-statement-review"
          className="statement-section statement-overview"
          data-testid="section-free-statement-review"
          aria-labelledby="deliverable-heading"
        >
          <div className="statement-container statement-overview-grid">
            <div>
              <p className="statement-kicker">A clearer picture</p>
              <h2
                id="deliverable-heading"
                data-testid="text-deliverable-heading"
              >
                Your statement.
                <br />
                Explained line by line.
              </h2>
              <p>{FSR_WHAT_YOU_RECEIVE.text}</p>
              <p className="statement-cost-note" data-testid="block-fsr-cost">
                <CheckCircle2 size={18} aria-hidden="true" />
                {FSR_COST.text}
              </p>
            </div>
            <div
              className="statement-deliverables"
              data-testid="section-what-we-review"
            >
              <ol data-testid="list-deliverable">
                {FSR_DELIVERABLE.rows.map((row, i) => (
                  <li key={row}>
                    <span>0{i + 1}</span>
                    <p>{row}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div
            className="statement-container statement-fee-definitions"
            data-testid="block-fsr-what-it-is"
          >
            {FSR_WHAT_IT_IS.parts.map((part, i) => (
              <article key={part.term}>
                <span>0{i + 1}</span>
                <h3>{part.term}</h3>
                <p>{part.text}</p>
              </article>
            ))}
          </div>
          <p className="statement-container statement-method-note">
            {FSR_WHAT_IT_IS.outro}
          </p>
        </section>

        <section
          id="document-handling"
          className="statement-section statement-security"
          data-testid="section-fsr-details"
          aria-labelledby="handling-heading"
        >
          <div className="statement-container statement-security-grid">
            <div>
              <p className="statement-kicker">
                Your documents, handled with care
              </p>
              <h2 id="handling-heading">
                A secure start.
                <br />A human conversation.
              </h2>
              <p data-testid="block-fsr-handling">{FSR_HANDLING.text}</p>
            </div>
            <div
              className="statement-submission-guide"
              data-testid="section-fsr-what-to-submit"
            >
              <div className="statement-guide-title">
                <FileText size={24} aria-hidden="true" />
                <h3>Before you upload</h3>
              </div>
              <ul>
                <li>
                  <Check size={18} aria-hidden="true" />
                  Your most recent processing statement
                </li>
                <li>
                  <Check size={18} aria-hidden="true" />
                  {STATEMENT_UPLOAD_HELPER}
                </li>
                <li>
                  <Check size={18} aria-hidden="true" />
                  Account numbers may be redacted; keep fee lines and totals
                  visible
                </li>
              </ul>
              <p>
                Please use this form for financial documents. Don’t send them by
                email, text or social media.
              </p>
              <a href="/privacy-policy" className="statement-text-link">
                Read our Privacy Policy
                <ArrowUpRight size={17} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section
          className="statement-section statement-process"
          data-testid="section-what-happens-next"
          aria-labelledby="process-heading"
        >
          <div className="statement-container">
            <div className="statement-section-title">
              <p className="statement-kicker">What happens next</p>
              <h2 id="process-heading" data-testid="text-what-happens-next">
                {FSR_PROCESS.heading}
              </h2>
            </div>
            <ol>
              {FSR_PROCESS.steps.map((step, i) => (
                <li key={step} data-testid={`card-step-${i + 1}`}>
                  <span>0{i + 1}</span>
                  <h3>
                    {
                      [
                        "Share your statement",
                        "We review the charges",
                        "Talk through your options",
                      ][i]
                    }
                  </h3>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
            <p
              className="statement-process-note"
              data-testid="text-what-happens-next-note"
            >
              {FSR_PROCESS.support} {FSR_NEXT_NOTE}
            </p>
          </div>
        </section>

        <section
          className="statement-section statement-faq"
          data-testid="section-statement-faq"
          aria-labelledby="faq-heading"
        >
          <div className="statement-container statement-faq-grid">
            <div>
              <p className="statement-kicker">Good questions</p>
              <h2 id="faq-heading" data-testid="text-faq-heading">
                Before you send
                <br />
                your statement.
              </h2>
              <a
                href={PHONE_TEL}
                className="statement-contact-link"
                onClick={() =>
                  trackPhoneCallClick({ sourcePage: "/upload-statement" })
                }
              >
                <Phone size={17} aria-hidden="true" />
                {PHONE_NUMBER}
              </a>
            </div>
            <Accordion type="multiple" data-testid="accordion-statement-faq">
              {FSR_FAQ.items.map((item, i) => (
                <AccordionItem
                  key={item.question}
                  value={`faq-${i}`}
                  data-testid={`faq-item-${i + 1}`}
                >
                  <AccordionTrigger className="min-h-14 text-left font-semibold">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="leading-relaxed">
                    {item.answer}
                    {"link" in item && item.link ? (
                      <>
                        {" "}
                        <Link
                          href={item.link.href}
                          className="underline underline-offset-2"
                          data-testid="link-faq-discuss"
                        >
                          {item.link.label}
                        </Link>
                        .
                      </>
                    ) : null}
                  </AccordionContent>
                </AccordionItem>
              ))}
              <AccordionItem value="eligibility">
                <AccordionTrigger className="min-h-14 text-left font-semibold">
                  Who can request a review?
                </AccordionTrigger>
                <AccordionContent>{FSR_WHO_QUALIFIES.text}</AccordionContent>
              </AccordionItem>
              <AccordionItem value="funding">
                <AccordionTrigger className="min-h-14 text-left font-semibold">
                  What should I know about funding?
                </AccordionTrigger>
                <AccordionContent>{FSR_FUNDING_NOTE.text}</AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </section>
        <section
          className="statement-closing"
          data-testid="section-upload-closing"
        >
          <div className="statement-container">
            <div>
              <p className="statement-kicker">Start with clarity</p>
              <h2>
                Make your next move
                <br />
                an informed one.
              </h2>
            </div>
            <a
              href="#statement-review-form"
              onClick={anchor.onAnchorClick}
              className="statement-closing-action"
              data-testid="link-closing-cta"
            >
              {FSR_HERO.button}
              <ArrowUpRight size={20} aria-hidden="true" />
            </a>
          </div>
          <p
            className="statement-container statement-disclosure"
            data-testid="text-fsr-disclosure"
          >
            {FSR_DISCLOSURE} Eligibility, underwriting, card brand rules, and
            applicable laws apply.
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
}
