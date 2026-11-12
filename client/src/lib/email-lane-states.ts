/**
 * Email-lane readiness vocabulary (Phase 6 CRM-15).
 *
 * "Configured", "active" and "has enrollments" are not "send-ready". Eight facts are shown separately and none implies
 * another. Every fact comes from an existing authority: the sequence/campaign row, the derived catalog (package pins,
 * approval revision, content hash, runtime selection) and the enrollment records. A fact that is not read is
 * "unknown", never a quiet yes. No state here is permission to send, and nothing here enrolls, releases or resumes
 * anyone: the global pause, release and per-recipient suppression still decide.
 */
import type { CatalogAsset, CatalogPackage, CatalogTruth, ReadinessFact } from "@shared/catalog-truth-contract";

export const LANE_KEYS = ["configuration", "content", "history", "eligibility", "worker", "suppression", "pause", "release"] as const;
export type LaneKey = typeof LANE_KEYS[number];
export type LaneTone = "ok" | "blocked" | "unknown" | "neutral";

export interface LaneState {
  key: LaneKey;
  label: string;
  tone: LaneTone;
  /** Plain-language reading, short enough for a row. */
  summary: string;
  /** Why, from the authority that decided it. */
  basis: string;
  href?: string;
}

export const LANE_LABELS: Record<LaneKey, string> = {
  configuration: "Configuration",
  content: "Content approval",
  history: "Enrollment history",
  eligibility: "Current eligibility",
  worker: "Worker selection",
  suppression: "Suppression",
  pause: "Pause",
  release: "Release",
};

export type CatalogReadStatus = "ready" | "loading" | "denied" | "unavailable";
export interface CatalogRead { status: CatalogReadStatus; catalog: CatalogTruth | null }

const OUTBOUND_READINESS = "/dashboard/outbound-readiness";
const SFP_POPULATION = "/dashboard/lead-ops?tab=sfp";

const unreadReason = (status: CatalogReadStatus) =>
  status === "loading" ? "The package catalog is still loading."
  : status === "denied" ? "The package catalog is not readable for your role, so this is unknown rather than no."
  : "The package catalog could not be read, so this is unknown rather than no.";

const fromFact = (key: LaneKey, fact: ReadinessFact, yes: string, no: string): LaneState => ({
  key, label: LANE_LABELS[key],
  tone: fact.state === "yes" ? "ok" : fact.state === "no" ? "blocked" : "unknown",
  summary: fact.state === "yes" ? yes : fact.state === "no" ? no : "Not read",
  basis: fact.basis,
});

const unknownState = (key: LaneKey, read: CatalogRead): LaneState => ({
  key, label: LANE_LABELS[key], tone: "unknown", summary: "Not read", basis: unreadReason(read.status),
});

const SUPPRESSION: LaneState = {
  key: "suppression", label: LANE_LABELS.suppression, tone: "neutral", summary: "Checked per recipient at send time",
  basis: "Consent, unsubscribe, bounce, email validation and sender-policy suppression are decided for each recipient by the send gate. There is no sequence-level suppression state, so none is shown or implied.",
};

const RELEASE: LaneState = {
  key: "release", label: LANE_LABELS.release, tone: "neutral", summary: "Separate admin action",
  basis: "Releasing held recipients is a separate, capped admin action. Nothing on this page releases, enrolls or resumes anyone, and an empty or full list here says nothing about the held population.",
  href: OUTBOUND_READINESS,
};

export interface EnrollmentLike { status?: string | null }

function historyState(enrollments: readonly EnrollmentLike[] | null | undefined): LaneState {
  const base = { key: "history" as const, label: LANE_LABELS.history };
  if (!enrollments) {
    return { ...base, tone: "unknown", summary: "Not read", basis: "Enrollment records could not be read, so no count is shown and none is assumed to be zero." };
  }
  const count = (status: string) => enrollments.filter(e => e.status === status).length;
  const active = count("active"), completed = count("completed");
  const other = enrollments.length - active - completed;
  return {
    ...base, tone: "neutral",
    summary: `${active} active · ${completed} completed${other > 0 ? ` · ${other} other` : ""}`,
    basis: "Enrollments are history. A past or active enrollment is not current eligibility, and it does not restart or wake because a page was redesigned or a filter changed.",
  };
}

function pauseState(sequenceStatus: string | null | undefined, pkg: CatalogPackage | undefined): LaneState {
  const base = { key: "pause" as const, label: LANE_LABELS.pause, href: OUTBOUND_READINESS };
  const globalNote = " The global outbound pause also applies to every send and is read on Outbound Readiness.";
  if (pkg) {
    const paused = pkg.readiness.paused;
    if (paused.state === "yes") return { ...base, tone: "blocked", summary: "Sequence paused", basis: `${paused.basis}.${globalNote}` };
    if (paused.state === "no") return { ...base, tone: "unknown", summary: "Sequence not paused", basis: `${pkg.readiness.statusActive.basis}.${globalNote}` };
    return { ...base, tone: "unknown", summary: "Not read", basis: `${paused.basis}.${globalNote}` };
  }
  if (sequenceStatus === "paused") return { ...base, tone: "blocked", summary: "Sequence paused", basis: `Sequence status is paused.${globalNote}` };
  return { ...base, tone: "unknown", summary: sequenceStatus ? `Status ${sequenceStatus}; global pause not read here` : "Not read", basis: `Status is a setting, not proof of operation.${globalNote}` };
}

export interface SequenceLaneInput {
  sequence: { id: number; status?: string | null; totalSteps?: number | null; retiredAt?: string | null };
  catalog: CatalogRead;
  enrollments: readonly EnrollmentLike[] | null | undefined;
}

export function sequencePackage(catalog: CatalogTruth | null, sequenceId: number): CatalogPackage | undefined {
  return catalog?.packages.find(p => p.sequenceId === sequenceId);
}
export function sequenceAsset(catalog: CatalogTruth | null, sequenceId: number): CatalogAsset | undefined {
  return catalog?.sequences.find(s => s.id === sequenceId);
}
export function campaignPackage(catalog: CatalogTruth | null, campaignId: number): CatalogPackage | undefined {
  return catalog?.packages.find(p => p.campaignId === campaignId);
}
export function campaignAsset(catalog: CatalogTruth | null, campaignId: number): CatalogAsset | undefined {
  return catalog?.campaigns.find(c => c.id === campaignId);
}

function configurationState(
  row: { status?: string | null; totalSteps?: number | null; retiredAt?: string | null }, pkg: CatalogPackage | undefined,
): LaneState {
  const base = { key: "configuration" as const, label: LANE_LABELS.configuration };
  const status = row.retiredAt ? "retired" : (row.status ?? "unknown");
  const steps = row.totalSteps == null ? null : Number(row.totalSteps);
  const stepsText = steps == null ? "steps not read" : `${steps} ${steps === 1 ? "step" : "steps"}`;
  const note = "Status and installation only; neither is permission to send.";
  if (row.retiredAt) return { ...base, tone: "blocked", summary: `Retired · ${stepsText}`, basis: `Retired; history is kept. ${note}` };
  if (steps === 0) return { ...base, tone: "blocked", summary: `${status} · no steps`, basis: `No steps are defined, so nothing can execute. ${note}` };
  if (pkg && pkg.readiness.configured.state === "no") return { ...base, tone: "blocked", summary: `${status} · ${stepsText}`, basis: `${pkg.readiness.configured.basis}. ${note}` };
  return { ...base, tone: "neutral", summary: `${status} · ${stepsText}`, basis: note };
}

/** Eight separate states for one sequence row. */
export function sequenceLaneStates(input: SequenceLaneInput): LaneState[] {
  const { sequence, catalog: read } = input;
  const catalog = read.status === "ready" ? read.catalog : null;
  const pkg = sequencePackage(catalog, sequence.id);
  const asset = sequenceAsset(catalog, sequence.id);
  const configuration = configurationState(sequence, pkg);
  const history = historyState(input.enrollments);
  const pause = pauseState(sequence.status, pkg);

  if (!catalog) {
    return [configuration, unknownState("content", read), history, unknownState("eligibility", read), unknownState("worker", read), SUPPRESSION, pause, RELEASE];
  }
  if (!pkg) {
    const cls = asset?.catalogClass ?? "unresolved";
    const reason = asset?.reason ?? "The catalog has no record of this sequence.";
    return [
      configuration,
      { key: "content", label: LANE_LABELS.content, tone: "neutral", summary: "Verified only for the current package",
        basis: "Content approval and hash are checked only for the selected current package. This sequence is not part of one, so no approval is claimed." },
      history,
      { key: "eligibility", label: LANE_LABELS.eligibility, tone: "blocked", summary: cls === "historical" ? "Historical, not selected" : `Not in the current package (${cls})`, basis: reason, href: SFP_POPULATION },
      { key: "worker", label: LANE_LABELS.worker, tone: "unknown", summary: "Not read", basis: "Worker selection is read only for current-package sequences." },
      SUPPRESSION, pause, RELEASE,
    ];
  }
  const r = pkg.readiness;
  const content = r.selected.state === "yes" ? r.qualified : r.contentVerified;
  return [
    configuration,
    fromFact("content", content, "Approved and verified", "Not approved or not verified"),
    history,
    { ...fromFact("eligibility", r.selected, "Selected current package", "Not the selected current package"), href: SFP_POPULATION },
    fromFact("worker", r.runtimeSelected, "Selected by the serving profile", "Not selected by the serving profile"),
    SUPPRESSION, pause, RELEASE,
  ];
}

export interface CampaignLaneInput {
  campaign: { id: number; status?: string | null; totalSteps?: number | null; totalSent?: number | null };
  catalog: CatalogRead;
}

/** Same eight states for one campaign; its history is the recorded send total, not an enrollment count. */
export function campaignLaneStates(input: CampaignLaneInput): LaneState[] {
  const { campaign, catalog: read } = input;
  const catalog = read.status === "ready" ? read.catalog : null;
  const pkg = campaignPackage(catalog, campaign.id);
  const asset = campaignAsset(catalog, campaign.id);
  const configuration = configurationState({ status: campaign.status, totalSteps: campaign.totalSteps ?? null }, pkg);
  const sent = campaign.totalSent == null ? null : Number(campaign.totalSent);
  const history: LaneState = {
    key: "history", label: LANE_LABELS.history,
    tone: sent == null ? "unknown" : "neutral",
    summary: sent == null ? "Not read" : `${sent} sent in total`,
    basis: "Recorded sends are history. They are not current eligibility, and this page cannot resume or repeat them.",
  };
  const pause: LaneState = pkg ? pauseState(null, pkg) : {
    key: "pause", label: LANE_LABELS.pause, tone: "unknown", summary: campaign.status ? `Status ${campaign.status}; pause not read here` : "Not read",
    basis: "Status is a setting, not proof of operation. The global outbound pause applies to every send and is read on Outbound Readiness.", href: OUTBOUND_READINESS,
  };
  if (!catalog) {
    return [configuration, unknownState("content", read), history, unknownState("eligibility", read), unknownState("worker", read), SUPPRESSION, pause, RELEASE];
  }
  if (!pkg) {
    const cls = asset?.catalogClass ?? "unresolved";
    return [
      configuration,
      { key: "content", label: LANE_LABELS.content, tone: "neutral", summary: "Verified only for the current package",
        basis: "Content approval and hash are checked only for the selected current package. This campaign is not part of one, so no approval is claimed." },
      history,
      { key: "eligibility", label: LANE_LABELS.eligibility, tone: "blocked", summary: cls === "historical" ? "Historical, not selected" : `Not in the current package (${cls})`,
        basis: asset?.reason ?? "The catalog has no record of this campaign.", href: SFP_POPULATION },
      { key: "worker", label: LANE_LABELS.worker, tone: "unknown", summary: "Not read", basis: "Worker selection is read only for current-package campaigns." },
      SUPPRESSION, pause, RELEASE,
    ];
  }
  const r = pkg.readiness;
  const content = r.selected.state === "yes" ? r.qualified : r.contentVerified;
  return [
    configuration,
    fromFact("content", content, "Approved and verified", "Not approved or not verified"),
    history,
    { ...fromFact("eligibility", r.selected, "Selected current package", "Not the selected current package"), href: SFP_POPULATION },
    fromFact("worker", r.runtimeSelected, "Selected by the serving profile", "Not selected by the serving profile"),
    SUPPRESSION, pause, RELEASE,
  ];
}

export interface LaneVerdict {
  kind: "blocked" | "not_proven" | "no_blocker_read";
  text: string;
}

/**
 * One sentence an operator can read without opening the details. It names the first blocking state; with no blocker it
 * still never says "ready": unread states are named and the permission boundary is restated.
 */
export function laneVerdict(states: readonly LaneState[]): LaneVerdict {
  const blocked = states.find(s => s.tone === "blocked");
  if (blocked) return { kind: "blocked", text: `Will not advance: ${blocked.label.toLowerCase()} — ${blocked.summary.toLowerCase()}.` };
  const unknown = states.filter(s => s.tone === "unknown");
  if (unknown.length > 0) {
    return { kind: "not_proven", text: `Not proven send-ready: ${unknown.map(s => s.label.toLowerCase()).join(", ")} not read.` };
  }
  return { kind: "no_blocker_read", text: "No blocking state was read. This is not permission to send: the global pause, release and per-recipient suppression still decide." };
}

export type PackageScope = "current" | "historical" | "other";

/** Production/current-package grouping from the catalog authority only; null when the catalog is not read. */
export function packageScopeOf(
  catalog: CatalogRead, kind: "sequence" | "campaign", id: number,
): PackageScope | null {
  if (catalog.status !== "ready" || !catalog.catalog) return null;
  const asset = kind === "sequence" ? sequenceAsset(catalog.catalog, id) : campaignAsset(catalog.catalog, id);
  if (asset?.catalogClass === "current") return "current";
  if (asset?.catalogClass === "historical") return "historical";
  return "other";
}
