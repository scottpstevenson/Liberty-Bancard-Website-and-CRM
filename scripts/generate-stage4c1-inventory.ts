/**
 * Builds docs/certification/stage4-c1/asset-inventory.json and asset-disposition.md from Appendix A of the Stage 4C1
 * specification. Pure file transform (no database, network or provider). Appendix A is the October 31 production admin
 * snapshot recorded in the specification; this tool does not read production.
 *
 *   npx tsx scripts/generate-stage4c1-inventory.ts           write both artifacts
 *   npx tsx scripts/generate-stage4c1-inventory.ts --check   exit 1 if the committed artifacts differ
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

export const SPEC_PATH = "attached_assets/Liberty-Stage4C1-Master-Preflight-and-Build-2026-10-31_1793469717746.md";
export const OUT_DIR = "docs/certification/stage4-c1";

export const DISPOSITIONS = ["keep_current", "reuse_reviewed_library", "service_lifecycle", "historical_read_only", "diagnostic_review", "unresolved"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

const BY_CODE: Record<string, { disposition: Disposition; action: string }> = {
  S: { disposition: "keep_current", action: "Primary experience. Pins are resolved at runtime from the live package authority; content changes only through a versioned draft and an explicit package publication." },
  H: { disposition: "historical_read_only", action: "Retired package history. Read-only; not offered for selection, enrollment or edit." },
  L: { disposition: "reuse_reviewed_library", action: "Sales/education library candidate. Reuse only after the reviewed draft process; no activation, retirement or deletion by name." },
  M: { disposition: "service_lifecycle", action: "Merchant/service lifecycle content. Keep its event, purpose and account-relationship CTA; no cold-sales wording." },
  T: { disposition: "diagnostic_review", action: "Test-labelled. Trace dependencies (enrollments, sends, references) first; nothing is deleted or retired by name." },
};

/** Stored templates and workflows carry free-text dispositions in the specification; the class is assigned here by purpose. */
const TEMPLATE_CLASS: Record<number, Disposition> = { 1: "reuse_reviewed_library", 2: "reuse_reviewed_library", 3: "service_lifecycle", 4: "service_lifecycle", 5: "reuse_reviewed_library", 6: "reuse_reviewed_library", 7: "reuse_reviewed_library", 8: "service_lifecycle" };
const WORKFLOW_CLASS = (id: number): Disposition => (id >= 3 && id <= 6 ? "reuse_reviewed_library" : "service_lifecycle");

type Row = Record<string, string>;

function table(lines: string[], heading: string): Row[] {
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start < 0) throw new Error(`Section not found: ${heading}`);
  const rows: Row[] = [];
  let head: string[] | null = null;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("### ") || line.startsWith("## ")) break;
    if (!line.startsWith("|")) { if (head && rows.length) break; continue; }
    const cells = line.replace(/^\|\s*/, "").replace(/\s*\|$/, "").split(/\s\|\s/);
    if (!head) { head = cells; continue; }
    if (cells[0].startsWith("---") || cells[0].startsWith(":--")) continue;
    rows.push(Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""])));
  }
  return rows;
}

export function build(md: string) {
  const lines = md.split("\n");
  const campaigns = table(lines, "### A1.").map((r) => {
    const code = r["Recommendation"].trim(); const m = BY_CODE[code];
    if (!m) throw new Error(`Unknown campaign code ${code}`);
    return { assetType: "campaign", id: Number(r["ID"]), name: r["Name"], status: r["Status"], steps: Number(r["Steps"]), code, disposition: m.disposition, fourC1Action: m.action };
  });
  const sequences = table(lines, "### A2.").map((r) => {
    const sr = r["Status / recommendation"]; const code = sr.split("/").pop()!.trim(); const m = BY_CODE[code];
    if (!m) throw new Error(`Unknown sequence code ${code}`);
    const name = r["Name"];
    return {
      assetType: "sequence", id: Number(r["ID"]), name, nameAbbreviatedInSource: /…|\.\.\./.test(name), status: sr.split("/")[0].trim(), steps: Number(r["Steps"]),
      code, disposition: m.disposition, fourC1Action: m.action,
    };
  });
  const templates = table(lines, "### A3.").map((r) => ({
    assetType: "template", id: Number(r["ID"]), name: r["Name"], channel: r["Channel"], liveVersion: Number(r["Live version"]),
    disposition: TEMPLATE_CLASS[Number(r["ID"])] ?? "unresolved", requiredWork: r["Required disposition"],
    fourC1Action: "Contract fixes are in code (token alias, deal.topCostDrivers, no estimatedSavings value, duration/retired-link publication checks). Any wording change is a versioned draft that an operator publishes; nothing was published, activated or sent.",
  }));
  const workflows = table(lines, "### A4.").map((r) => ({
    assetType: "workflow", id: Number(r["ID"]), name: r["Name"], directEmailSms: r["Direct email / SMS steps"],
    disposition: WORKFLOW_CLASS(Number(r["ID"])), requiredWork: r["Disposition"],
    fourC1Action: "Seed wording corrected for the unverified duration claim and the retired /apply link; native workflow install and execution stay 4C2. No workflow was enabled, disabled or run.",
  }));
  return { campaigns, sequences, templates, workflows };
}

export function renderArtifacts(md: string) {
  const inv = build(md);
  const all = [...inv.campaigns, ...inv.sequences, ...inv.templates, ...inv.workflows] as Array<{ assetType: string; disposition: Disposition }>;
  const counts = Object.fromEntries(DISPOSITIONS.map((d) => [d, all.filter((a) => a.disposition === d).length]));
  const json = JSON.stringify({
    source: "Appendix A of the Stage 4C1 specification (October 31 production admin snapshot recorded by the author of the specification)",
    productionRead: false,
    totals: { campaigns: inv.campaigns.length, sequences: inv.sequences.length, templates: inv.templates.length, workflows: inv.workflows.length, campaignSteps: inv.campaigns.reduce((n, c) => n + c.steps, 0), sequenceSteps: inv.sequences.reduce((n, s) => n + s.steps, 0) },
    dispositionCounts: counts,
    deletionOrRetirementAuthorized: false,
    ...inv,
  }, null, 2) + "\n";
  const md2 = `# Stage 4C1 asset disposition

Generated from Appendix A of the Stage 4C1 specification (\`scripts/generate-stage4c1-inventory.ts\`). The machine-readable
register is \`asset-inventory.json\`. Appendix A is the October 31 production snapshot recorded in the specification; this
register was **not** re-read from production, and the development database holds different counts (see the preflight report).

No asset is deleted, retired, activated or renamed by this register. A "test-labelled" row is a diagnostic-review item until its
dependencies are traced.

| Disposition | Rows |
| --- | ---: |
${DISPOSITIONS.map((d) => `| ${d} | ${counts[d]} |`).join("\n")}
| **Total** | **${all.length}** |

Totals: ${inv.campaigns.length} campaigns (${inv.campaigns.reduce((n, c) => n + c.steps, 0)} steps), ${inv.sequences.length} sequences (${inv.sequences.reduce((n, s) => n + s.steps, 0)} steps), ${inv.templates.length} stored templates, ${inv.workflows.length} workflows.

## Rules by class

${DISPOSITIONS.filter((d) => d !== "unresolved").map((d) => {
    const code = Object.entries(BY_CODE).find(([, v]) => v.disposition === d)?.[1].action;
    return `- **${d}**: ${code ?? (d === "service_lifecycle" ? "Keep event, purpose and service CTA; no cold-sales wording." : "Reuse only after the reviewed draft process; no activation.")}`;
  }).join("\n")}
- **unresolved**: ${counts.unresolved === 0 ? "none after this pass" : "needs an owner decision"}.

## Template and workflow classes

| Asset | Class |
| --- | --- |
${inv.templates.map((t) => `| Template ${t.id}: ${t.name} | ${t.disposition} |`).join("\n")}
${inv.workflows.map((w) => `| Workflow ${w.id}: ${w.name} | ${w.disposition} |`).join("\n")}

Template/workflow classes are assigned by purpose in the generator (sales and booking wording reusable after review; event and
account-relationship wording stays with its lifecycle).
`;
  return { json, md: md2 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { json, md } = renderArtifacts(readFileSync(SPEC_PATH, "utf8"));
  if (process.argv.includes("--check")) {
    const same = readFileSync(`${OUT_DIR}/asset-inventory.json`, "utf8") === json && readFileSync(`${OUT_DIR}/asset-disposition.md`, "utf8") === md;
    if (!same) { console.error("DRIFT: committed inventory differs from the specification"); process.exit(1); }
    console.log("Inventory artifacts match the specification");
  } else {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(`${OUT_DIR}/asset-inventory.json`, json);
    writeFileSync(`${OUT_DIR}/asset-disposition.md`, md);
    console.log(`Wrote ${OUT_DIR}/asset-inventory.json and asset-disposition.md`);
  }
}
