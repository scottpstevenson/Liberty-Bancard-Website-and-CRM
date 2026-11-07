/**
 * Server-supported, rendered email-marketing disclosures for the website forms.
 *
 * The browser renders exactly this wording and submits only a boolean plus the disclosure id it rendered. The server
 * resolves the id against THIS registry; it never accepts client-supplied wording, hashes, timestamps, evidence ids or
 * contact ids. The hash recorded as consent evidence is computed on the server from this text (see
 * server/services/website-email-contracts.ts). Changing wording means adding a new version, never editing one in
 * place, so every recorded grant still points at the exact text the person saw.
 *
 * Email marketing consent is separate from, and never implied by: a phone or SMS consent box, cookie consent, giving
 * an email address, an estimate request, a statement upload, or asking for a free document.
 */

export const WEBSITE_EMAIL_DISCLOSURE_SURFACES = [
  "estimate_form",
  "get_started_form",
  "free_analysis",
  "newsletter_signup",
] as const;
export type WebsiteEmailDisclosureSurface = (typeof WEBSITE_EMAIL_DISCLOSURE_SURFACES)[number];

export interface WebsiteEmailDisclosure {
  /** Stable identity including version: `<key>@<version>`. */
  id: string;
  key: string;
  version: number;
  surfaces: readonly WebsiteEmailDisclosureSurface[];
  /** The checkbox label the visitor reads. */
  label: string;
  /** Short supporting line shown under the checkbox. */
  helper: string;
}

export const WEBSITE_EMAIL_DISCLOSURES: readonly WebsiteEmailDisclosure[] = [
  {
    id: "website_email_marketing@1",
    key: "website_email_marketing",
    version: 1,
    surfaces: ["estimate_form", "get_started_form", "free_analysis"],
    label:
      "Yes, email me occasional card-processing tips, savings guides and updates from Liberty Bancard.",
    helper:
      "Optional. Your request is handled whether or not you check this box. You can unsubscribe from any email at any time.",
  },
  {
    id: "newsletter_email_marketing@1",
    key: "newsletter_email_marketing",
    version: 1,
    surfaces: ["newsletter_signup"],
    label:
      "Send me the Liberty Bancard newsletter and occasional card-processing tips by email.",
    helper: "You can unsubscribe from any email at any time.",
  },
] as const;

export function disclosureForSurface(surface: string): WebsiteEmailDisclosure | null {
  return (
    WEBSITE_EMAIL_DISCLOSURES.filter((d) => (d.surfaces as readonly string[]).includes(surface))
      .sort((a, b) => b.version - a.version)[0] ?? null
  );
}

export function findDisclosure(id: unknown): WebsiteEmailDisclosure | null {
  if (typeof id !== "string") return null;
  return WEBSITE_EMAIL_DISCLOSURES.find((d) => d.id === id) ?? null;
}
