import { Checkbox } from "@/components/ui/checkbox";
import { disclosureForSurface, type WebsiteEmailDisclosureSurface } from "@shared/website-email-disclosures";

interface EmailMarketingCheckboxProps {
  surface: WebsiteEmailDisclosureSurface;
  checked: boolean;
  onCheckedChange: (val: boolean) => void;
  id?: string;
  /** The newsletter signup IS the email subscription, so the box is required there; everywhere else it is optional. */
  required?: boolean;
}

/**
 * Email-marketing consent, separate from the phone/SMS box and from the request itself. It renders the exact wording the
 * server holds for this surface; the form submits only the boolean and the disclosure id it rendered, and the server
 * resolves the wording and hash. Leaving it unchecked records nothing, neither a grant nor a withdrawal.
 */
export function EmailMarketingCheckbox({ surface, checked, onCheckedChange, id = `email-marketing-${surface}`, required = false }: EmailMarketingCheckboxProps) {
  const disclosure = disclosureForSurface(surface);
  if (!disclosure) return null;
  return (
    <div className="flex min-h-11 items-start gap-3 pt-2" data-testid="container-email-marketing-consent">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        required={required}
        aria-required={required || undefined}
        data-testid="checkbox-email-marketing-consent"
        className="mt-0.5 shrink-0"
      />
      <label htmlFor={id} className="text-xs text-muted-foreground leading-relaxed cursor-pointer select-none">
        {required ? null : <><span className="font-medium text-foreground/80">(Optional)</span>{" "}</>}
        {disclosure.label}
        <span className="block mt-0.5">{disclosure.helper}</span>
      </label>
    </div>
  );
}

/** The fields a form adds to its payload. Nothing is added when the box is unchecked. */
export function emailConsentPayload(surface: WebsiteEmailDisclosureSurface, checked: boolean): { emailMarketingOptIn?: true; emailDisclosureId?: string } {
  if (!checked) return {};
  const disclosure = disclosureForSurface(surface);
  return disclosure ? { emailMarketingOptIn: true, emailDisclosureId: disclosure.id } : {};
}

export type EmailConsentOutcome = "recorded" | "not_recorded" | "unavailable";

/**
 * Reads ONLY the email-consent state from a saved-request response. The request receipt and every other field stay
 * opaque to the page: the return value is one of three states or undefined, never the body.
 */
export async function readEmailConsentState(res: Response): Promise<EmailConsentOutcome | undefined> {
  try {
    const value = (await res.json())?.emailConsent;
    return value === "recorded" || value === "not_recorded" || value === "unavailable" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Shown only when the visitor checked the box and the server did not record it; the request itself was still saved. */
export function emailConsentNotice(outcome: EmailConsentOutcome | undefined, wasChecked: boolean): string | null {
  if (!wasChecked || outcome === "recorded") return null;
  return outcome === "not_recorded"
    ? "Your request was saved, but your email-updates choice was not recorded, so we will not add you to marketing email."
    : "Your request was saved, but we could not record your email-updates choice right now, so we will not add you to marketing email.";
}
