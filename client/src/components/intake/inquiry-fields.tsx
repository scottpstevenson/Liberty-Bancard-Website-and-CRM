import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { PewcCheckbox } from "@/components/PewcCheckbox";
import { isPlausibleInquiryPhone } from "@shared/public-inquiry";
import { getStoredUTMParams } from "@/lib/utm";

/**
 * Shared building blocks for the W-C inquiry forms (terminal eligibility on /get-started and the general inquiry on
 * /about-contact). The forms use visible labels, inline errors tied to their fields with aria attributes, and `noValidate`
 * so one consistent error message appears instead of a native browser bubble.
 */

export const REQUIRED_ERROR = "Please complete this field.";
export const EMAIL_ERROR = "Enter a valid email address.";
export const PHONE_ERROR = "Enter a valid phone number, or leave it blank.";
export const PEWC_PHONE_ERROR = "Text-message permission needs a valid phone number.";

export interface InquiryPersonValue {
  businessName: string;
  name: string;
  email: string;
  phone: string;
  pewcConsent: boolean;
}

export const EMPTY_PERSON: InquiryPersonValue = { businessName: "", name: "", email: "", phone: "", pewcConsent: false };

export type InquiryErrors = Record<string, string>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePerson(value: InquiryPersonValue): InquiryErrors {
  const errors: InquiryErrors = {};
  if (!value.businessName.trim()) errors.businessName = REQUIRED_ERROR;
  if (!value.name.trim()) errors.name = REQUIRED_ERROR;
  if (!value.email.trim()) errors.email = REQUIRED_ERROR;
  else if (!EMAIL_PATTERN.test(value.email.trim())) errors.email = EMAIL_ERROR;
  const phone = value.phone.trim();
  if (phone && !isPlausibleInquiryPhone(phone)) errors.phone = PHONE_ERROR;
  // Text-message permission is only meaningful with a real number, and it is never required.
  if (value.pewcConsent && !(phone && isPlausibleInquiryPhone(phone))) errors.pewcConsent = PEWC_PHONE_ERROR;
  return errors;
}

/** The fields shared by every inquiry mode. A blank phone is omitted (never sent empty), and consent is only sent when true. */
export function personPayload(value: InquiryPersonValue) {
  const phone = value.phone.trim();
  return {
    businessName: value.businessName.trim(),
    name: value.name.trim(),
    email: value.email.trim(),
    ...(phone ? { phone } : {}),
    ...(value.pewcConsent ? { pewcConsent: true } : {}),
  };
}

const clamp = (value: string | undefined, max: number) => (value ? value.slice(0, max) : undefined);

/** Stored campaign context, clamped to the server's field limits so a long tracking value can never turn into a validation error. */
export function inquiryAttribution() {
  const stored = getStoredUTMParams();
  const referral = (() => { try { return localStorage.getItem("lb_ref_code") || undefined; } catch { return undefined; } })();
  const out: Record<string, string | boolean> = {};
  const set = (key: string, value: string | boolean | undefined) => { if (value !== undefined && value !== "") out[key] = value; };
  set("referralCode", clamp(referral, 120));
  set("utmSource", clamp(stored.utmSource, 200));
  set("utmMedium", clamp(stored.utmMedium, 200));
  set("utmCampaign", clamp(stored.utmCampaign, 200));
  set("utmContent", clamp(stored.utmContent, 200));
  set("utmTerm", clamp(stored.utmTerm, 200));
  set("landingPage", clamp(stored.landingPage, 1000));
  set("gclid", clamp(stored.gclid, 500));
  if (stored.gclidPresent) out.gclidPresent = true;
  if (stored.fbclidPresent) out.fbclidPresent = true;
  if (stored.msclkidPresent) out.msclkidPresent = true;
  return out;
}

/** Focus the first field with an error, so keyboard and screen-reader users land on the problem. */
export function focusFirstError(prefix: string, errors: InquiryErrors, order: string[]) {
  const first = order.find((key) => errors[key]);
  if (first) document.getElementById(`${prefix}-${first}`)?.focus();
}

interface FieldShellProps {
  id: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  error?: string;
  help?: ReactNode;
  children: (aria: { id: string; "aria-invalid": boolean; "aria-describedby"?: string; "aria-required"?: boolean }) => ReactNode;
}

function FieldShell({ id, label, required, optional, error, help, children }: FieldShellProps) {
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy = [error ? errorId : null, help ? helpId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="public-small mb-1.5 block font-medium text-foreground">
        {label}{required ? "*" : ""}{optional ? " (optional)" : ""}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy, "aria-required": required ? true : undefined })}
      {help ? <p id={helpId} className="mt-1 text-xs text-muted-foreground">{help}</p> : null}
      {error ? <p id={errorId} role="alert" className="mt-1 text-sm text-destructive" data-testid={`${id}-error`}>{error}</p> : null}
    </div>
  );
}

interface TextFieldProps {
  prefix: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  optional?: boolean;
  type?: "text" | "email" | "tel";
  autoComplete?: string;
  help?: ReactNode;
  maxLength?: number;
  /** Overrides the default `${prefix}-input-${name}` test id so established page test ids can be kept. */
  testId?: string;
}

export function InquiryTextField({ prefix, name, label, value, onChange, error, required, optional, type = "text", autoComplete, help, maxLength, testId }: TextFieldProps) {
  return (
    <FieldShell id={`${prefix}-${name}`} label={label} required={required} optional={optional} error={error} help={help}>
      {(aria) => (
        <Input {...aria} name={name} type={type} value={value} autoComplete={autoComplete} maxLength={maxLength} data-testid={testId ?? `${prefix}-input-${name}`}
          onChange={(event) => onChange(event.target.value)} />
      )}
    </FieldShell>
  );
}

interface SelectFieldProps {
  prefix: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  error?: string;
  required?: boolean;
  placeholder?: string;
}

/** A native select: reliable on mobile pickers and with assistive technology. */
export function InquirySelectField({ prefix, name, label, value, onChange, options, error, required, placeholder = "Select one" }: SelectFieldProps) {
  return (
    <FieldShell id={`${prefix}-${name}`} label={label} required={required} error={error}>
      {(aria) => (
        <select {...aria} name={name} value={value} data-testid={`${prefix}-select-${name}`}
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm"
          onChange={(event) => onChange(event.target.value)}>
          <option value="">{placeholder}</option>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </FieldShell>
  );
}

interface PersonFieldsProps {
  prefix: string;
  value: InquiryPersonValue;
  onChange: (next: InquiryPersonValue) => void;
  errors: InquiryErrors;
}

/** Business name*, Your name*, Email*, Phone (optional) and the separate, unchecked, optional text-message permission. */
export function InquiryPersonFields({ prefix, value, onChange, errors }: PersonFieldsProps) {
  const set = <K extends keyof InquiryPersonValue>(key: K, next: InquiryPersonValue[K]) => onChange({ ...value, [key]: next });
  return (
    <>
      <InquiryTextField prefix={prefix} name="businessName" label="Business name" required value={value.businessName} onChange={(v) => set("businessName", v)} error={errors.businessName} autoComplete="organization" maxLength={160} />
      <InquiryTextField prefix={prefix} name="name" label="Your name" required value={value.name} onChange={(v) => set("name", v)} error={errors.name} autoComplete="name" maxLength={120} />
      <InquiryTextField prefix={prefix} name="email" label="Email" required type="email" value={value.email} onChange={(v) => set("email", v)} error={errors.email} autoComplete="email" maxLength={160} />
      <InquiryTextField prefix={prefix} name="phone" label="Phone" optional type="tel" value={value.phone} onChange={(v) => set("phone", v)} error={errors.phone} autoComplete="tel" maxLength={40} />
      <div>
        <PewcCheckbox id={`${prefix}-pewcConsent`} checked={value.pewcConsent} onCheckedChange={(checked) => set("pewcConsent", checked)} />
        {errors.pewcConsent ? <p role="alert" className="mt-1 text-sm text-destructive" data-testid={`${prefix}-pewcConsent-error`}>{errors.pewcConsent}</p> : null}
      </div>
    </>
  );
}
