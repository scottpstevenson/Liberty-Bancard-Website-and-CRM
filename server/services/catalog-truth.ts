/**
 * Derived, read-only catalog contract (Stage 4A).
 *
 * Classification derives from real package pins (sfp_campaign_package_versions) and retired_at columns. It never
 * reads status or a name to decide whether an asset is current, retired or a template, and it never hard-codes
 * campaign or sequence ids. A failed read produces "unavailable", never an empty or zero catalog.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";
import { CRO07_PRODUCTION_CONNECTED } from "./cro07-release-authority";

import type { CatalogClass, ReadinessFact, CatalogReadiness, CatalogAsset, CatalogPackage, CatalogTruth } from "@shared/catalog-truth-contract";
export type { CatalogClass, ReadinessValue, ReadinessFact, CatalogReadiness, CatalogAsset, CatalogPackage, CatalogTruth } from "@shared/catalog-truth-contract";

export interface CatalogInput {
  packages: PackageVersionRow[];
  campaigns: AssetRow[];
  sequences: AssetRow[];
  /** Every package key the plan ever named (current and older taxonomy plans). */
  plannedPackageKeys?: string[];
  /** The package keys of the current program/taxonomy. A current package outside this set is not a selected current package. */
  currentProgramKeys?: string[];
  /** Read content/hash evidence per package version id. Missing = not read (never treated as verified). */
  evidence?: Record<string, PackageEvidence | null>;
  /** Runtime selection of the serving process for the sequences queue, when read. */
  runtime?: ReadinessFact;
  cr06GovernedArtifacts: number | null;
  globalPauseState: "paused" | "activating" | "unpaused" | "unavailable";
  statusActiveSequences: number | null;
  asOf?: string;
}

export interface PackageEvidence {
  /** Issues from the existing launch-content readiness check; null when the read failed. */
  contentIssues: string[] | null;
  pinnedHash: string | null;
  /** Hash recomputed from live campaign/sequence content; null when the read failed. */
  liveHash: string | null;
}

export interface PackageVersionRow {
  id: string; packageKey: string; vertical: string; campaignId: number; sequenceId: number;
  lifecycleState: "draft" | "current" | "superseded" | "retired" | string;
}
export interface AssetRow { id: number; name: string; status: string | null; retiredAt: string | null; stepCount?: number | null; approvedRevision?: number | null; contentRevision?: number | null }

function classOfPackage(state: string): CatalogClass {
  if (state === "current") return "current";
  if (state === "draft") return "template";
  return "historical"; // superseded, retired
}

// Higher rank wins when an asset is pinned by several package versions.
const RANK: Record<CatalogClass, number> = { current: 4, template: 3, historical: 2, uninstalled: 1, unresolved: 0 };

/** Shared pin-to-class rule for callers that only hold lifecycle states (no I/O). */
export function catalogClassForPins(pinLifecycleStates: string[], retired: boolean): CatalogClass {
  if (pinLifecycleStates.length === 0) return retired ? "historical" : "unresolved";
  const best = pinLifecycleStates.map(classOfPackage).sort((x, y) => RANK[y] - RANK[x])[0];
  if (best === "current" && retired) return "unresolved";
  return best;
}

function classifyAsset(kind: "campaign" | "sequence", a: AssetRow, packages: PackageVersionRow[]): CatalogAsset {
  const pins = packages.filter((p) => (kind === "campaign" ? p.campaignId === a.id : p.sequenceId === a.id));
  const pinnedBy = pins.map((p) => ({ packageVersionId: p.id, packageKey: p.packageKey, lifecycleState: p.lifecycleState }));
  const base = { kind, id: a.id, name: a.name, pinnedBy, retiredAt: a.retiredAt };
  if (pins.length === 0) {
    if (a.retiredAt) return { ...base, catalogClass: "historical", reason: "retired_at is set and no package pins it" };
    return { ...base, catalogClass: "unresolved", reason: "no package version owns this asset; it is not proven current, template or historical" };
  }
  const best = pins.map((p) => classOfPackage(p.lifecycleState)).sort((x, y) => RANK[y] - RANK[x])[0];
  if (best === "current" && a.retiredAt) {
    return { ...base, catalogClass: "unresolved", reason: "a current package pins an asset whose retired_at is set (pin conflict)" };
  }
  if (best === "current" && pins.filter((p) => p.lifecycleState === "current").length > 1) {
    return { ...base, catalogClass: "unresolved", reason: "more than one current package version pins this asset (duplicate selection)" };
  }
  const reasons: Record<CatalogClass, string> = {
    current: "pinned by the current package version",
    template: "pinned only by a draft package version",
    historical: "pinned only by superseded or retired package versions",
    uninstalled: "",
    unresolved: "",
  };
  return { ...base, catalogClass: best, reason: reasons[best] };
}

/**
 * The single validity result shared by package class and package readiness: why a package's pins cannot be trusted
 * as one selected current package, or null. Assets use the same retired/duplicate rules in classifyAsset.
 */
function pinConflict(
  pkg: PackageVersionRow, campaign: AssetRow | undefined, sequence: AssetRow | undefined,
  currentByKey: number, currentByVertical: number,
): string | null {
  if (!campaign || !sequence) return "a pinned campaign or sequence row is missing";
  if (campaign.retiredAt) return "the pinned campaign is retired";
  if (sequence.retiredAt) return "the pinned sequence is retired (retired_at is set)";
  if (pkg.lifecycleState === "current") {
    if (currentByKey > 1) return `${currentByKey} current package versions share this package key`;
    if (currentByVertical > 1) return `${currentByVertical} current package versions for this vertical`;
  }
  return null;
}

function readinessFor(
  pkg: PackageVersionRow, campaign: AssetRow | undefined, sequence: AssetRow | undefined,
  input: CatalogInput, conflict: string | null,
): CatalogReadiness {
  const pinsResolved = !!campaign && !!sequence;
  const configured: ReadinessFact = pinsResolved
    ? { state: "yes", basis: "installed: the campaign and sequence pins resolve in their tables (installation only, not permission to launch)" }
    : { state: "no", basis: "a pinned campaign or sequence row is missing" };

  const programKeys = input.currentProgramKeys ?? input.plannedPackageKeys;
  let selected: ReadinessFact;
  if (pkg.lifecycleState !== "current") selected = { state: "no", basis: `package version is ${pkg.lifecycleState}, not current` };
  else if (conflict) selected = { state: "no", basis: conflict };
  else if (!programKeys) selected = { state: "unavailable", basis: "the current program package plan was not read" };
  else if (!programKeys.includes(pkg.packageKey)) selected = { state: "no", basis: `package key ${pkg.packageKey} is not part of the current program plan` };
  else selected = { state: "yes", basis: "the only current version of a package in the current program plan" };

  let contentVerified: ReadinessFact;
  const ev = input.evidence?.[pkg.id];
  if (pkg.lifecycleState !== "current") contentVerified = { state: "unavailable", basis: "content and hash are verified only for the selected current package" };
  else if (!pinsResolved) contentVerified = { state: "no", basis: "pins unresolved" };
  else if (!ev || ev.contentIssues == null) contentVerified = { state: "unavailable", basis: "launch-content readiness was not read" };
  else if (ev.contentIssues.length > 0) contentVerified = { state: "no", basis: `content issues: ${ev.contentIssues.slice(0, 3).join(", ")}${ev.contentIssues.length > 3 ? "…" : ""}` };
  else if (ev.liveHash == null || ev.pinnedHash == null) contentVerified = { state: "unavailable", basis: "the live or pinned content hash was not read" };
  else if (ev.liveHash !== ev.pinnedHash) contentVerified = { state: "no", basis: "the pinned content hash differs from the live content" };
  else contentVerified = { state: "yes", basis: "launch content passes its checks and the live hash equals the pinned hash" };

  let qualified: ReadinessFact;
  if (pkg.lifecycleState !== "current") qualified = { state: "no", basis: `package version is ${pkg.lifecycleState}, not current` };
  else if (!pinsResolved) qualified = { state: "no", basis: "pins unresolved" };
  else if (conflict) qualified = { state: "no", basis: conflict };
  else if (selected.state === "no") qualified = { state: "no", basis: selected.basis };
  else if (sequence!.stepCount == null || campaign!.approvedRevision === undefined) qualified = { state: "unavailable", basis: "step count or approval revision was not read" };
  else if ((sequence!.stepCount ?? 0) < 1) qualified = { state: "no", basis: "sequence has no steps" };
  else if (campaign!.approvedRevision == null || campaign!.approvedRevision !== campaign!.contentRevision) qualified = { state: "no", basis: "campaign content revision is not approved" };
  else if (contentVerified.state === "no") qualified = { state: "no", basis: contentVerified.basis };
  else if (selected.state === "unavailable" || contentVerified.state === "unavailable") qualified = { state: "unavailable", basis: `${selected.state === "unavailable" ? selected.basis : contentVerified.basis}` };
  else qualified = { state: "yes", basis: "selected current package, approved revision matches, content and hash verified" };

  const paused: ReadinessFact = !sequence ? { state: "unavailable", basis: "sequence row missing" }
    : sequence.status === "paused" ? { state: "yes", basis: "sequence status is paused" }
    : { state: "no", basis: `sequence status is ${sequence.status ?? "unknown"}` };

  const pause = input.globalPauseState;
  let statusActive: ReadinessFact;
  if (pause === "unavailable") statusActive = { state: "unavailable", basis: "global pause state could not be read" };
  else if (pause !== "unpaused") statusActive = { state: "no", basis: `global outbound state is ${pause}` };
  else if (sequence?.status === "active" && campaign?.status === "active") statusActive = { state: "yes", basis: "status only: global outbound unpaused and sequence and campaign status active (not proof of operation)" };
  else statusActive = { state: "no", basis: "sequence or campaign status is not active" };

  const runtimeSelected: ReadinessFact = input.runtime
    ?? { state: "unavailable", basis: "the runtime selection of the worker fleet was not read" };
  const operationalEvidence: ReadinessFact = { state: "unavailable", basis: "no send, delivery or reply receipt for this package is read by the catalog" };
  const nativeEffectVerified: ReadinessFact = CRO07_PRODUCTION_CONNECTED
    ? { state: "unavailable", basis: "no native-effect receipt reader is wired into this catalog" }
    : { state: "unavailable", basis: "no native-effect receipt exists for this path; the CRO-07 production transport is separately disconnected" };
  return { configured, selected, contentVerified, qualified, paused, statusActive, runtimeSelected, operationalEvidence, nativeEffectVerified };
}

/** Pure derivation: no I/O, so each state is testable. */
export function buildCatalogTruth(input: CatalogInput): CatalogTruth {
  const campaignsById = new Map(input.campaigns.map((c) => [c.id, c]));
  const sequencesById = new Map(input.sequences.map((s) => [s.id, s]));
  const currentByVertical = new Map<string, number>();
  const currentByKey = new Map<string, number>();
  for (const p of input.packages) {
    if (p.lifecycleState !== "current") continue;
    currentByVertical.set(p.vertical, (currentByVertical.get(p.vertical) ?? 0) + 1);
    currentByKey.set(p.packageKey, (currentByKey.get(p.packageKey) ?? 0) + 1);
  }

  const packages: CatalogPackage[] = input.packages.map((p) => {
    const campaign = campaignsById.get(p.campaignId);
    const sequence = sequencesById.get(p.sequenceId);
    const conflict = pinConflict(p, campaign, sequence, currentByKey.get(p.packageKey) ?? 0, currentByVertical.get(p.vertical) ?? 0);
    const baseClass = classOfPackage(p.lifecycleState);
    // A current package whose pins conflict is unresolved, exactly as its assets are.
    const catalogClass: CatalogClass = baseClass === "current" && conflict ? "unresolved" : baseClass;
    return {
      packageKey: p.packageKey, vertical: p.vertical, packageVersionId: p.id, lifecycleState: p.lifecycleState,
      catalogClass, classReason: catalogClass === "unresolved" && conflict ? conflict : `package version lifecycle is ${p.lifecycleState}`,
      campaignId: p.campaignId, sequenceId: p.sequenceId,
      pinsResolved: !!campaign && !!sequence,
      readiness: readinessFor(p, campaign, sequence, input, conflict),
    };
  });
  const campaigns = input.campaigns.map((c) => classifyAsset("campaign", c, input.packages));
  const sequences = input.sequences.map((s) => classifyAsset("sequence", s, input.packages));
  const installedKeys = new Set(input.packages.map((p) => p.packageKey));
  const uninstalledPackageKeys = (input.plannedPackageKeys ?? []).filter((k) => !installedKeys.has(k));

  const counts: Record<CatalogClass, number> = { current: 0, template: 0, historical: 0, uninstalled: uninstalledPackageKeys.length, unresolved: 0 };
  for (const a of [...campaigns, ...sequences]) counts[a.catalogClass]++;

  const cr06 = input.cr06GovernedArtifacts == null
    ? { governedArtifacts: null, state: "unavailable" as const, note: "CR-06 artifact count could not be read" }
    : input.cr06GovernedArtifacts === 0
      ? { governedArtifacts: 0, state: "empty" as const, note: "No CR-06 governed artifacts exist. Verified current SFP packages are not legacy because of that." }
      : { governedArtifacts: input.cr06GovernedArtifacts, state: "populated" as const, note: "CR-06 governed artifacts exist." };

  return {
    asOf: input.asOf ?? new Date().toISOString(),
    scope: "full_catalog_whole_population",
    available: true,
    unavailableReason: null,
    packages, campaigns, sequences, uninstalledPackageKeys, counts, cr06,
    cro07: {
      productionConnected: CRO07_PRODUCTION_CONNECTED,
      note: CRO07_PRODUCTION_CONNECTED ? "CRO-07 production transport is connected." : "CRO-07 production transport is disconnected; this stays scoped and is not a catalog defect.",
    },
    statusActiveSequences: {
      count: input.statusActiveSequences,
      note: "Raw count of sequences with status 'active'. Status is not readiness proof; use the package readiness states.",
    },
  };
}

const rows = (r: any): any[] => r?.rows ?? r ?? [];

/** Reads the catalog from the tables. Any failed read yields an explicit unavailable result. */
export async function loadCatalogTruth(): Promise<CatalogTruth> {
  const asOf = new Date().toISOString();
  const unavailable = (reason: string): CatalogTruth => ({
    asOf, scope: "full_catalog_whole_population", available: false, unavailableReason: reason,
    packages: [], campaigns: [], sequences: [], uninstalledPackageKeys: [], counts: null,
    cr06: { governedArtifacts: null, state: "unavailable", note: "not read" },
    cro07: { productionConnected: CRO07_PRODUCTION_CONNECTED, note: "not read" },
    statusActiveSequences: { count: null, note: "not read" },
  });
  try {
    const [pk, camps, seqs, steps] = await Promise.all([
      db.execute(sql`SELECT id::text AS id, package_key, vertical, campaign_id, sequence_id, lifecycle_state, content_hash FROM sfp_campaign_package_versions ORDER BY created_at, id`),
      db.execute(sql`SELECT id, name, status, approved_revision, content_revision FROM campaigns ORDER BY id`),
      db.execute(sql`SELECT id, name, status, retired_at FROM follow_up_sequences ORDER BY id`),
      // Grouped step totals: never the stale total_steps column.
      db.execute(sql`SELECT sequence_id, COUNT(*)::int AS n FROM sequence_steps GROUP BY sequence_id`),
    ]);
    const stepCounts = new Map<number, number>(rows(steps).map((r) => [Number(r.sequence_id), Number(r.n)]));
    let cr06: number | null = null;
    try {
      cr06 = Number(rows(await db.execute(sql`SELECT COUNT(*)::int AS n FROM cr06_artifacts WHERE retired_at IS NULL`))[0]?.n ?? 0);
    } catch { cr06 = null; }
    let pause: CatalogInput["globalPauseState"] = "unavailable";
    try {
      const { getPauseState } = await import("./outbound-pause-authority");
      const st = await getPauseState();
      pause = st.source === "database" ? st.state : "unavailable";
    } catch { pause = "unavailable"; }
    // Content/hash evidence is read only for the current package versions (the selection that matters), through the
    // existing read-only launch-content helpers. A failed read is null (unavailable), never an assumed pass.
    const evidence: Record<string, PackageEvidence | null> = {};
    try {
      const { checkPackageContentReadiness } = await import("./cro03/sfp-launch-content");
      const { computeLivePackageContentHash } = await import("./cro03/sfp-campaign-packages");
      for (const r of rows(pk).filter((x) => x.lifecycle_state === "current")) {
        try {
          const content = await checkPackageContentReadiness(db, Number(r.campaign_id), Number(r.sequence_id));
          const liveHash = await computeLivePackageContentHash(db, Number(r.campaign_id), Number(r.sequence_id));
          evidence[String(r.id)] = { contentIssues: content.issues, pinnedHash: r.content_hash ?? null, liveHash };
        } catch { evidence[String(r.id)] = { contentIssues: null, pinnedHash: r.content_hash ?? null, liveHash: null }; }
      }
    } catch { /* helpers unavailable: evidence stays unread */ }
    let runtime: ReadinessFact | undefined;
    try {
      const { isQueueSelectedByBackgroundProfile, getBackgroundProfile } = await import("./background-profile");
      const profile = getBackgroundProfile();
      runtime = isQueueSelectedByBackgroundProfile("sequences")
        ? { state: "yes", basis: `the serving process profile '${profile}' selects the sequences queue (worker activity is a separate fact and is not read here)` }
        : { state: "no", basis: `the serving process profile '${profile}' does not select the sequences queue (a separate worker host may differ and is not read here)` };
    } catch { runtime = undefined; }
    let planned: string[] | undefined;
    let programKeys: string[] | undefined;
    try {
      const mod = await import("./cro03/sfp-campaign-packages");
      planned = [...((mod as any).SFP_PACKAGE_KEYS ?? []), ...mod.SFP_PACKAGE_KEYS_V2];
      programKeys = [...mod.SFP_PACKAGE_KEYS_V2];
    } catch { planned = undefined; programKeys = undefined; }
    const activeCount = rows(await db.execute(sql`SELECT COUNT(*)::int AS n FROM follow_up_sequences WHERE status = 'active'`))[0]?.n;
    return buildCatalogTruth({
      packages: rows(pk).map((r) => ({
        id: String(r.id), packageKey: String(r.package_key), vertical: String(r.vertical),
        campaignId: Number(r.campaign_id), sequenceId: Number(r.sequence_id), lifecycleState: String(r.lifecycle_state),
      })),
      campaigns: rows(camps).map((r) => ({
        id: Number(r.id), name: String(r.name), status: r.status ?? null, retiredAt: null,
        approvedRevision: r.approved_revision == null ? null : Number(r.approved_revision), contentRevision: Number(r.content_revision),
      })),
      sequences: rows(seqs).map((r) => ({
        id: Number(r.id), name: String(r.name), status: r.status ?? null,
        retiredAt: r.retired_at ? new Date(r.retired_at).toISOString() : null, stepCount: stepCounts.get(Number(r.id)) ?? 0,
      })),
      plannedPackageKeys: planned,
      currentProgramKeys: programKeys,
      evidence,
      runtime,
      cr06GovernedArtifacts: cr06,
      globalPauseState: pause,
      statusActiveSequences: activeCount == null ? null : Number(activeCount),
      asOf,
    });
  } catch (err: any) {
    return unavailable(String(err?.code ?? err?.message ?? "catalog_read_failed").slice(0, 120));
  }
}
