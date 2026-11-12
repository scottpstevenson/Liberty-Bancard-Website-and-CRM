/**
 * Count contract (Phase 6 CRM-12).
 *
 * Different denominators are all valid, so they are never forced to agree. Instead each count says what it counts (unit),
 * over what (scope), what it leaves out (exclusions), when it was read (as-of), whether the read was whole (completeness)
 * and which authority produced it. A source that failed is "unavailable" and never becomes 0, and a total that no longer
 * describes the present is labelled historical.
 */
export type CountAvailability = "available" | "unavailable";
export type CountCompleteness = "complete" | "partial" | "unknown";
export type CountTemporal = "current" | "historical";

export interface CountContract {
  unit: string;
  scope: string;
  exclusions: string;
  /** ISO time the number was read, or null when the source does not say. */
  asOf: string | null;
  completeness: CountCompleteness;
  authority: string;
  temporal: CountTemporal;
}

export interface CountReading {
  value: number | null;
  availability: CountAvailability;
  contract: CountContract;
}

/** A value is available only when the source says so AND it is a finite, non-negative number. */
export function readCount(value: unknown, available: boolean | undefined, contract: CountContract): CountReading {
  const finite = typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (available !== true || !finite) return { value: null, availability: "unavailable", contract };
  return { value, availability: "available", contract };
}

const numberFormat = new Intl.NumberFormat("en-US");

/** The headline text for a count. Unavailable is words, never "0" or "—" that could read as zero. */
export function countHeadline(reading: CountReading): string {
  return reading.availability === "available" && reading.value !== null ? numberFormat.format(reading.value) : "Unavailable";
}

export function asOfLabel(asOf: string | null | undefined): string {
  if (!asOf) return "as-of time not reported";
  const time = Date.parse(asOf);
  if (!Number.isFinite(time)) return "as-of time not reported";
  return `as of ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(time))}`;
}

const COMPLETENESS_TEXT: Record<CountCompleteness, string> = {
  complete: "Whole population read",
  partial: "Partial: not every record was read",
  unknown: "Completeness not reported",
};

/** One readable sentence per field, in a fixed order, so every count can be compared on the same terms. */
export function contractLines(contract: CountContract, availability: CountAvailability = "available"): Array<{ label: string; text: string }> {
  return [
    { label: "Unit", text: contract.unit },
    { label: "Scope", text: contract.scope },
    { label: "Leaves out", text: contract.exclusions },
    { label: "When", text: `${contract.temporal === "historical" ? "Historical total. " : ""}${asOfLabel(contract.asOf)}` },
    { label: "Completeness", text: availability === "unavailable" ? "Not read; the source failed or did not answer" : COMPLETENESS_TEXT[contract.completeness] },
    { label: "Authority", text: contract.authority },
  ];
}

export type PopulationStageKey = "discovered" | "linked" | "classified" | "selected" | "validated" | "prepared_held" | "admitted" | "sent";

export interface PopulationStage {
  key: PopulationStageKey;
  term: string;
  /** What a rep should understand by this word. */
  meaning: string;
  unit: string;
  /** What it does not mean. */
  notThis: string;
  authority: string;
  owner: { label: string; href: string };
}

/**
 * The eight words reps hear about the South Florida population, each owned by exactly one screen. The numbers live on the
 * owner so that the card, its drill-down and its definition cannot drift apart; this list never adds them together.
 */
export const POPULATION_STAGES: readonly PopulationStage[] = [
  { key: "discovered", term: "Discovered", unit: "free-discovery candidates",
    meaning: "A possible business found by free discovery and kept as a candidate, counted by what happened to it (staged, admitted, suppressed, stalled).",
    notThis: "Not a business, not a linked contact and not a recipient. A business can be found more than once.",
    authority: "Free-discovery candidate dispositions", owner: { label: "Program Health, candidate pipeline", href: "/dashboard/lead-ops?tab=health" } },
  { key: "linked", term: "Linked", unit: "contacts and businesses",
    meaning: "A contact independently linked to a business by evidence other than the provider import that brought it in.",
    notThis: "Not classified, not selected and not validated. Directory and government domains need ownership evidence before they count.",
    authority: "Canonical enrichment backlog, supported business links", owner: { label: "Canonical Enrichment, backlog funnel", href: "/dashboard/canonical-enrichment?view=backlog" } },
  { key: "classified", term: "Classified", unit: "businesses",
    meaning: "A business whose vertical is accepted under the current classification policy.",
    notThis: "Not a recipient. Classification does not select, validate or release anyone.",
    authority: "Canonical enrichment backlog, current accepted verticals", owner: { label: "Canonical Enrichment, backlog funnel", href: "/dashboard/canonical-enrichment?view=backlog" } },
  { key: "selected", term: "Selected", unit: "recipients",
    meaning: "A recipient chosen by recipient preparation from the classified, linked population.",
    notThis: "Not validated and not released. Selection is a plan, not a send.",
    authority: "Recipient preparation", owner: { label: "Canonical Enrichment, backlog funnel", href: "/dashboard/canonical-enrichment?view=backlog" } },
  { key: "validated", term: "Validated", unit: "recipients",
    meaning: "A selected recipient whose email has a provider answer inside the validity window. Recipients still waiting for an answer are counted as pending validation.",
    notThis: "A stale or undated answer is not validation. A validated address is still not permission to send.",
    authority: "Launch inventory (re-checked on every read)", owner: { label: "Canonical Enrichment, launch inventory", href: "/dashboard/canonical-enrichment?view=backlog" } },
  { key: "prepared_held", term: "Prepared, held", unit: "recipients",
    meaning: "A validated recipient that is fully prepared and waiting in a paused membership.",
    notThis: "Held means not sent. Releasing a held recipient is a separate, capped admin action.",
    authority: "Launch inventory, ready-held population", owner: { label: "Outbound Readiness, release", href: "/dashboard/outbound-readiness" } },
  { key: "admitted", term: "Admitted", unit: "free-discovery candidates",
    meaning: "A discovery candidate admitted to email validation (pending the validation provider).",
    notThis: "Admitted to validation, not admitted to send, and not the same people as the selected recipients above.",
    authority: "Free-discovery candidate dispositions", owner: { label: "Program Health, candidate pipeline", href: "/dashboard/lead-ops?tab=health" } },
  { key: "sent", term: "Sent", unit: "recorded messages",
    meaning: "A message the platform recorded as sent. Counted per campaign or sequence from its own send records.",
    notThis: "Not a projection. Sending authority is held until an operator releases recipients, so a held population has sent nothing.",
    authority: "Campaign and sequence send records", owner: { label: "Campaigns, per-campaign totals", href: "/dashboard/campaigns" } },
];

/**
 * Why a People total can differ between screens. Both screens now use the production record class by default, so a
 * difference means the filter or the read time differs; the note names exactly that.
 */
export const PEOPLE_TOTAL_NOTE =
  "People totals count production records only. Test, demo, synthetic and unclassified records are counted separately and appear only when the Record class filter on the desktop People view includes them. Two screens agree when they use the same record class and filters and were read at the same time.";
