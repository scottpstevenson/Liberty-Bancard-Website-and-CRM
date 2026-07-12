/**
 * Shared readiness type definitions and display constants.
 * Kept here (alongside schema.ts) so both the server scoring engine and
 * the client UI import from a single location.
 */

export const READINESS_REASON_LABELS: Record<string, string> = {
  missing_email: "Email is missing",
  invalid_email: "Email address is invalid or a placeholder",
  missing_company: "Company name is missing",
  placeholder_company: "Company name appears to be a placeholder",
  missing_vertical: "Business vertical is missing",
  non_canonical_vertical: "Business vertical is not a recognized category",
  missing_phone: "Phone number is missing",
  invalid_phone_type: "Phone type is flagged as invalid or unverified landline",
  missing_first_name: "First name is missing",
  missing_city: "City is missing",
  missing_state: "State is missing or not a valid 2-letter code",
  missing_website: "Website is missing",
  invalid_website: "Website URL appears malformed",
  missing_last_name: "Last name is missing",
};

/**
 * Convert a snake_case reason code to a human-readable label.
 * Returns a known label when available, otherwise title-cases the key as a fallback.
 * Never throws for unknown future codes.
 */
export function humanizeReasonCode(code: string): string {
  if (READINESS_REASON_LABELS[code]) return READINESS_REASON_LABELS[code];
  return code
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export type ReadinessComponentKey =
  | "email"
  | "companyName"
  | "vertical"
  | "phone"
  | "city"
  | "state"
  | "firstName"
  | "lastName"
  | "website";

export type ReadinessComponentEntry = {
  maxPoints: number;
  earnedPoints: number;
  status: string;
  reasonCode: string | null;
};

export type ReadinessBreakdownShape = {
  version: number;
  components: Partial<Record<ReadinessComponentKey, ReadinessComponentEntry>>;
  missingReasons: string[];
};

/** Display metadata for each scored component. */
export const READINESS_COMPONENT_META: Array<{
  key: ReadinessComponentKey;
  label: string;
  group: "email" | "company" | "vertical" | "phone" | "geo" | "name";
}> = [
  { key: "email",       label: "Email",       group: "email" },
  { key: "companyName", label: "Company",      group: "company" },
  { key: "vertical",    label: "Vertical",     group: "vertical" },
  { key: "phone",       label: "Phone",        group: "phone" },
  { key: "city",        label: "City",         group: "geo" },
  { key: "state",       label: "State",        group: "geo" },
  { key: "firstName",   label: "First Name",   group: "name" },
  { key: "lastName",    label: "Last Name",    group: "name" },
  { key: "website",     label: "Website",      group: "name" },
];
