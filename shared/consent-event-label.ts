/** Event labels are display-only; none of these grant channel permission. */
const LABELS: Readonly<Record<string, string>> = {
  opt_in: "Opt in",
  opt_out: "Opt out",
  global_dnc: "Global do not contact",
  pewc_opt_in: "Written consent recorded",
  block_auto_contact: "Automatic contact restricted",
  not_granted: "Consent not granted",
  unchecked: "Consent unchecked",
  canonical_fact: "Canonical consent fact",
  reachability_fact: "Reachability fact",
};
export function consentEventLabel(action: string | null | undefined): string {
  return action && LABELS[action] || "Other consent event";
}
