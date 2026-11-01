/**
 * Reconciles the Appendix A register (docs/certification/stage4-c1/asset-inventory.json) with a dated, read-only production
 * snapshot (docs/certification/stage4-c1/production-snapshot-<date>.json, taken with read-only SQL; it stores hashes, lengths,
 * link and token lists, never message wording). Pure file transform: no database, network or provider.
 *
 *   npx tsx scripts/generate-stage4c1-production-reconciliation.ts           write both artifacts
 *   npx tsx scripts/generate-stage4c1-production-reconciliation.ts --check   exit 1 if the committed artifacts differ
 */
import { readFileSync, writeFileSync } from "node:fs";

const DIR = "docs/certification/stage4-c1";
const SNAPSHOT = `${DIR}/production-snapshot-2026-11-01.json`;

type Kind = "booking" | "secure_upload" | "application" | "partner_portal" | "unsubscribe" | "ghl_widget" | "site_other" | "retired_first_party" | "token" | "other";

export function classifyLink(raw: string): Kind {
  const s = raw.trim();
  if (/^\{\{.*\}\}$/.test(s)) return /calendarLink|booking_link/.test(s) ? "booking" : "token";
  if (/leadconnectorhq\.com|msgsndr\.com/i.test(s)) return "ghl_widget";
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?libertybancard\.com(\/[^?#\s]*)?/i);
  if (!m) return "other";
  const path = (m[1] ?? "/").replace(/\/+$/, "") || "/";
  if (path === "/book") return "booking";
  if (path === "/upload-statement") return "secure_upload";
  if (path === "/merchant-application") return "application";
  if (path === "/partner-portal") return "partner_portal";
  if (path === "/unsubscribe") return "unsubscribe";
  if (["/upload", "/apply", "/terminals", "/refer", "/partners/portal"].includes(path)) return "retired_first_party";
  return "site_other";
}

interface SnapStep { links: string[]; tokens: string[]; channel?: string }
const summarize = (steps: SnapStep[]) => {
  const kinds: Record<string, number> = {};
  const tokens = new Set<string>();
  for (const st of steps) {
    for (const l of st.links ?? []) kinds[classifyLink(l)] = (kinds[classifyLink(l)] ?? 0) + 1;
    for (const t of st.tokens ?? []) tokens.add(t);
  }
  return {
    linkKinds: kinds,
    tokens: [...tokens].sort(),
    flags: {
      retiredFirstPartyLink: (kinds.retired_first_party ?? 0) > 0,
      ghlWidgetLink: (kinds.ghl_widget ?? 0) > 0,
      estimatedSavingsToken: tokens.has("{{estimatedSavings}}"),
    },
  };
};

export function render() {
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const inv = JSON.parse(readFileSync(`${DIR}/asset-inventory.json`, "utf8"));
  const pinnedSeq = new Set<number>(snap.currentPackagePins.map((p: any) => p.sequence_id));
  const pinnedCamp = new Set<number>(snap.currentPackagePins.map((p: any) => p.campaign_id));
  const aCamp = new Map<number, any>(inv.campaigns.map((c: any) => [c.id, c]));
  const aSeq = new Map<number, any>(inv.sequences.map((c: any) => [c.id, c]));
  const aTpl = new Map<number, any>(inv.templates.map((c: any) => [c.id, c]));
  const aWf = new Map<number, any>(inv.workflows.map((c: any) => [c.id, c]));
  const nameOk = (a: string, b: string) => a === b || (a.endsWith("…") && b.startsWith(a.slice(0, -1))) || (a.endsWith("...") && b.startsWith(a.slice(0, -3)));

  const reconcile = (a: any, name: string, pinned: boolean) =>
    !a ? { match: "new_since_appendix_a", disposition: pinned ? "keep_current" : "unresolved" }
       : nameOk(a.name, name) ? { match: "matched", disposition: a.disposition }
       : { match: "name_differs", disposition: a.disposition, appendixName: a.name };

  const campaigns = snap.campaigns.map((c: any) => ({
    assetType: "campaign", id: c.id, name: c.name, status: c.status, steps: c.steps.length, aiPersonalization: c.ai_personalization,
    contentRevision: c.content_revision, approvedRevision: c.approved_revision, currentPackagePin: pinnedCamp.has(c.id),
    ...reconcile(aCamp.get(c.id), c.name, pinnedCamp.has(c.id)), ...summarize(c.steps),
  }));
  const sequences = snap.sequences.map((s: any) => ({
    assetType: "sequence", id: s.id, name: s.name, status: s.status, retired: s.retired, family: s.family, category: s.category,
    version: s.version, steps: s.steps.length, enrollments: s.enrollments, currentPackagePin: pinnedSeq.has(s.id),
    ...reconcile(aSeq.get(s.id), s.name, pinnedSeq.has(s.id)), ...summarize(s.steps),
  }));
  const templates = snap.templates.map((t: any) => ({
    assetType: "template", id: t.id, name: t.name, channel: t.channel, active: t.is_active, liveVersion: t.content_version,
    ...reconcile(aTpl.get(t.id), t.name, false), ...summarize([{ links: t.links, tokens: t.tokens }]),
  }));
  const workflows = snap.workflows.map((w: any) => ({
    assetType: "workflow", id: w.id, name: w.name, enabled: w.enabled, version: w.version, retired: w.retired,
    messageActions: w.actions.filter((a: any) => a.channel).length,
    ...reconcile(aWf.get(w.id), w.name, false), ...summarize(w.actions.filter((a: any) => a.channel)),
  }));

  const absent = (appendix: Map<number, any>, now: Array<{ id: number }>) => [...appendix.values()].filter((a) => !now.some((n) => n.id === a.id)).map((a) => ({ assetType: a.assetType, id: a.id, name: a.name }));
  const absentFromProduction = [...absent(aCamp, campaigns), ...absent(aSeq, sequences), ...absent(aTpl, templates), ...absent(aWf, workflows)];
  const all = [...campaigns, ...sequences, ...templates, ...workflows];
  const count = (f: (a: any) => boolean) => all.filter(f).length;
  const totals = {
    campaigns: campaigns.length, campaignSteps: campaigns.reduce((n: number, c: any) => n + c.steps, 0),
    sequences: sequences.length, sequenceSteps: sequences.reduce((n: number, c: any) => n + c.steps, 0),
    templates: templates.length, workflows: workflows.length,
  };
  const census: Record<string, number> = {};
  for (const a of all) for (const [k, n] of Object.entries(a.linkKinds as Record<string, number>)) census[k] = (census[k] ?? 0) + n;
  const flagged = (flag: string) => all.filter((a) => (a.flags as any)[flag]).map((a) => `${a.assetType} ${a.id}`);

  const json = JSON.stringify({
    source: "Read-only production snapshot reconciled with Appendix A",
    snapshot: { file: SNAPSHOT.split("/").pop(), readAt: snap.readAt, servedBuild: snap.servedBuild, environment: snap.environment },
    productionRead: true, deletionOrRetirementAuthorized: false,
    totals, appendixATotals: inv.totals, linkCensus: census,
    reconciliation: {
      matched: count((a) => a.match === "matched"), nameDiffers: count((a) => a.match === "name_differs"),
      newSinceAppendixA: count((a) => a.match === "new_since_appendix_a"), absentFromProduction,
    },
    flags: { retiredFirstPartyLink: flagged("retiredFirstPartyLink"), ghlWidgetLink: flagged("ghlWidgetLink"), estimatedSavingsToken: flagged("estimatedSavingsToken") },
    campaigns, sequences, templates, workflows,
  }, null, 2) + "\n";

  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "none");
  const md = `# Stage 4C1 production reconciliation

Read-only production snapshot taken ${snap.readAt} (served build \`${snap.servedBuild}\`), reconciled with the Appendix A register by
\`scripts/generate-stage4c1-production-reconciliation.ts\`. The snapshot stores hashes, lengths, link and token lists only. Nothing was
changed in production, and no asset is deleted, retired, activated or renamed by this register.

| | Appendix A | Production now |
| --- | ---: | ---: |
| Campaigns | ${inv.totals.campaigns} | ${totals.campaigns} |
| Campaign steps | ${inv.totals.campaignSteps} | ${totals.campaignSteps} |
| Sequences | ${inv.totals.sequences} | ${totals.sequences} |
| Sequence steps | ${inv.totals.sequenceSteps} | ${totals.sequenceSteps} |
| Stored templates | ${inv.totals.templates} | ${totals.templates} |
| Workflows | ${inv.totals.workflows} | ${totals.workflows} |

## Identity reconciliation

- Matched by id and name: ${count((a) => a.match === "matched")}
- Same id, different name: ${count((a) => a.match === "name_differs")}${all.filter((a) => a.match === "name_differs").map((a) => `\n  - ${a.assetType} ${a.id}: "${a.appendixName}" -> "${a.name}"`).join("")}
- In production, not in Appendix A: ${count((a) => a.match === "new_since_appendix_a")}${all.filter((a) => a.match === "new_since_appendix_a").map((a) => `\n  - ${a.assetType} ${a.id}: ${a.name}`).join("")}
- In Appendix A, not in production now: ${absentFromProduction.length}${absentFromProduction.map((a) => `\n  - ${a.assetType} ${a.id}: ${a.name}`).join("")}

This register records that these rows are absent. It does not explain why; the cause was not investigated here.

## Link census (all message steps)

| Kind | Links |
| --- | ---: |
${Object.entries(census).sort().map(([k, n]) => `| ${k} | ${n} |`).join("\n")}

## Open findings in installed wording

- Retired first-party link present: ${list(flagged("retiredFirstPartyLink"))}
- GoHighLevel booking-widget link present (not the first-party /book address): ${list(flagged("ghlWidgetLink"))}
- \`{{estimatedSavings}}\` still used: ${list(flagged("estimatedSavingsToken"))}

Installed rows only change through the guarded owners (versioned template/workflow convergence, plan-hash-bound sequence adoption,
package publication). Any row listed above that the adoption plan does not cover is a decision for the owner, not an automatic edit.
`;
  return { json, md };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { json, md } = render();
  if (process.argv.includes("--check")) {
    const same = readFileSync(`${DIR}/asset-inventory-production.json`, "utf8") === json && readFileSync(`${DIR}/asset-reconciliation.md`, "utf8") === md;
    if (!same) { console.error("DRIFT: committed production reconciliation differs from its inputs"); process.exit(1); }
    console.log("Production reconciliation artifacts match their inputs");
  } else {
    writeFileSync(`${DIR}/asset-inventory-production.json`, json);
    writeFileSync(`${DIR}/asset-reconciliation.md`, md);
    console.log(`Wrote ${DIR}/asset-inventory-production.json and asset-reconciliation.md`);
  }
}
