/**
 * Read-only content workspace overview: live campaigns and sequences grouped for operators.
 *
 *   current_sfp        resolved at request time from sfp_campaign_package_versions (lifecycle_state = 'current'); no pin is
 *                      hardcoded anywhere.
 *   history            members of non-current package versions, and sequences with a retired_at.
 *   diagnostics        test-labelled rows, shown with live dependency evidence. Nothing here deletes or retires.
 *   merchant_lifecycle editorial rule on the name (see LIFECYCLE_NAME_RE); sales_library is everything else.
 *
 * Grouping is editorial, not ownership: it never changes a row. Every count comes from the rows themselves at request time.
 * Nothing in this module writes, activates, enqueues, sends or books.
 */
import { pool } from "../db";

export const WORKSPACE_GROUPS = ["current_sfp", "sales_library", "merchant_lifecycle", "history", "diagnostics"] as const;
export type WorkspaceGroup = (typeof WORKSPACE_GROUPS)[number];

export const TEST_NAME_RE = /\btest\b|\bcert\b|\bfixture\b|\bsmoke\b|\bqa\b/i;
export const LIFECYCLE_NAME_RE = /onboard|merchant|customer|retention|churn|win-?back|renewal|referral|go-live|support|review request|welcome/i;

export interface WorkspaceRow {
  assetType: "campaign" | "sequence";
  id: number; name: string; status: string | null; steps: number; group: WorkspaceGroup;
  /** Why this row is in its group (the rule that matched), so the grouping is explainable. */
  reason: string;
  enrollments?: { total: number; active: number; started: number };
  packageKey?: string | null;
}

export interface WorkspaceOverview {
  capturedAt: string;
  rules: Record<string, string>;
  currentPackages: Array<{
    packageKey: string; vertical: string; campaignId: number; sequenceId: number; contentHash: string; effectiveAt: string | null;
    campaignName: string; sequenceName: string; steps: number; stepDays: number[];
    /** Journeys that already started on this sequence: content replacement must not change what they were promised. */
    startedJourneys: number; activeEnrollments: number;
  }>;
  groups: Record<WorkspaceGroup, WorkspaceRow[]>;
  counts: Record<WorkspaceGroup, number> & { campaigns: number; sequences: number; campaignSteps: number; sequenceSteps: number };
}

const num = (v: unknown) => Number(v ?? 0);

export function classify(
  row: { assetType: "campaign" | "sequence"; name: string; retiredAt?: Date | string | null },
  pkg: { current: boolean; nonCurrent: boolean },
): { group: WorkspaceGroup; reason: string } {
  if (pkg.current) return { group: "current_sfp", reason: "member of a current SFP package version" };
  if (TEST_NAME_RE.test(row.name)) return { group: "diagnostics", reason: "test-labelled name; trace dependencies before any action" };
  if (pkg.nonCurrent || row.retiredAt) return { group: "history", reason: row.retiredAt ? "retired (retired_at is set)" : "member of a superseded SFP package version" };
  if (LIFECYCLE_NAME_RE.test(row.name)) return { group: "merchant_lifecycle", reason: "name matches the merchant/service lifecycle rule" };
  return { group: "sales_library", reason: "default: reusable sales/education content" };
}

export async function getContentWorkspaceOverview(): Promise<WorkspaceOverview> {
  const sqls = [
    `SELECT package_key, vertical, campaign_id, campaign_name, sequence_id, sequence_name, content_hash, lifecycle_state, effective_at FROM sfp_campaign_package_versions`,
    `SELECT id, name, status FROM campaigns ORDER BY id`,
    `SELECT id, name, status, retired_at FROM follow_up_sequences ORDER BY id`,
    `SELECT campaign_id, count(*)::int AS n FROM campaign_steps GROUP BY campaign_id`,
    `SELECT sequence_id, count(*)::int AS n FROM sequence_steps GROUP BY sequence_id`,
    `SELECT sequence_id, count(*)::int AS total,
            count(*) FILTER (WHERE status = 'active')::int AS active,
            count(*) FILTER (WHERE coalesce(current_step, 0) > 0)::int AS started
     FROM sequence_enrollments GROUP BY sequence_id`,
    `SELECT sequence_id, array_agg(delay_days ORDER BY step_order) AS days FROM sequence_steps GROUP BY sequence_id`,
  ];
  // Sequential on purpose: one pooled connection at a time keeps this read-only view cheap under load.
  const results: Array<{ rows: any[] }> = [];
  for (const q of sqls) results.push(await pool.query(q));
  const [pkgs, camps, seqs, cSteps, sSteps, enr, seqDays] = results;
  const stepsByCampaign = new Map<number, number>(cSteps.rows.map((r: any) => [num(r.campaign_id), num(r.n)]));
  const stepsBySeq = new Map<number, number>(sSteps.rows.map((r: any) => [num(r.sequence_id), num(r.n)]));
  const enrBySeq = new Map<number, { total: number; active: number; started: number }>(enr.rows.map((r: any) => [num(r.sequence_id), { total: num(r.total), active: num(r.active), started: num(r.started) }]));
  const daysBySeq = new Map<number, number[]>(seqDays.rows.map((r: any) => [num(r.sequence_id), (r.days as number[]).map(num)]));

  const curC = new Map<number, string>(), curS = new Map<number, string>(), oldC = new Map<number, string>(), oldS = new Map<number, string>();
  for (const p of pkgs.rows) {
    const [c, s] = p.lifecycle_state === "current" ? [curC, curS] : [oldC, oldS];
    c.set(num(p.campaign_id), p.package_key); s.set(num(p.sequence_id), p.package_key);
  }

  const groups = Object.fromEntries(WORKSPACE_GROUPS.map((g) => [g, [] as WorkspaceRow[]])) as Record<WorkspaceGroup, WorkspaceRow[]>;
  for (const c of camps.rows) {
    const id = num(c.id);
    const { group, reason } = classify({ assetType: "campaign", name: c.name }, { current: curC.has(id), nonCurrent: oldC.has(id) });
    groups[group].push({ assetType: "campaign", id, name: c.name, status: c.status, steps: stepsByCampaign.get(id) ?? 0, group, reason, packageKey: curC.get(id) ?? oldC.get(id) ?? null });
  }
  for (const s of seqs.rows) {
    const id = num(s.id);
    const { group, reason } = classify({ assetType: "sequence", name: s.name, retiredAt: s.retired_at }, { current: curS.has(id), nonCurrent: oldS.has(id) });
    groups[group].push({ assetType: "sequence", id, name: s.name, status: s.status, steps: stepsBySeq.get(id) ?? 0, group, reason, enrollments: enrBySeq.get(id) ?? { total: 0, active: 0, started: 0 }, packageKey: curS.get(id) ?? oldS.get(id) ?? null });
  }

  const currentPackages = pkgs.rows.filter((p: any) => p.lifecycle_state === "current").map((p: any) => {
    const e = enrBySeq.get(num(p.sequence_id)) ?? { total: 0, active: 0, started: 0 };
    return {
      packageKey: p.package_key, vertical: p.vertical, campaignId: num(p.campaign_id), sequenceId: num(p.sequence_id), contentHash: p.content_hash,
      effectiveAt: p.effective_at ? new Date(p.effective_at).toISOString() : null, campaignName: p.campaign_name, sequenceName: p.sequence_name,
      steps: stepsBySeq.get(num(p.sequence_id)) ?? 0, stepDays: daysBySeq.get(num(p.sequence_id)) ?? [], startedJourneys: e.started, activeEnrollments: e.active,
    };
  });

  const all = Object.values(groups).flat();
  return {
    capturedAt: new Date().toISOString(),
    rules: {
      current_sfp: "Resolved from sfp_campaign_package_versions (lifecycle_state = current) at request time.",
      history: "Superseded package versions, and sequences with retired_at.",
      diagnostics: `Name matches ${TEST_NAME_RE}. Dependencies are shown; nothing is deleted or retired by name.`,
      merchant_lifecycle: `Editorial name rule ${LIFECYCLE_NAME_RE}.`,
      sales_library: "Everything else.",
    },
    currentPackages, groups,
    counts: {
      ...(Object.fromEntries(WORKSPACE_GROUPS.map((g) => [g, groups[g].length])) as Record<WorkspaceGroup, number>),
      campaigns: all.filter((r) => r.assetType === "campaign").length, sequences: all.filter((r) => r.assetType === "sequence").length,
      campaignSteps: all.filter((r) => r.assetType === "campaign").reduce((n, r) => n + r.steps, 0),
      sequenceSteps: all.filter((r) => r.assetType === "sequence").reduce((n, r) => n + r.steps, 0),
    },
  };
}
