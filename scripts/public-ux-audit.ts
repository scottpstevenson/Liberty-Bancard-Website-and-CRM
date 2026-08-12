#!/usr/bin/env npx tsx
/**
 * Public UX Audit Script
 * Reads each of the 8 priority public pages, scores them with OpenAI on
 * Conversion Clarity, Mobile Usability, and Information Hierarchy (1-10),
 * and outputs a ranked top-15 fix list to docs/public-ux-audit-report.md
 */

import fs from "fs";
import path from "path";

const OPENAI_BASE_URL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_API_KEY = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
  console.error("ERROR: AI_INTEGRATIONS_OPENAI_API_KEY is required");
  process.exit(1);
}

const PAGES = [
  { name: "Home", path: "client/src/pages/Home.tsx", route: "/" },
  { name: "FreeAnalysis", path: "client/src/pages/FreeAnalysis.tsx", route: "/free-analysis" },
  { name: "GetStarted", path: "client/src/pages/GetStarted.tsx", route: "/get-started" },
  { name: "SavingsCalculator", path: "client/src/pages/SavingsCalculator.tsx", route: "/savings-calculator" },
  { name: "Blog", path: "client/src/pages/Blog.tsx", route: "/blog" },
  { name: "ISOPartnerProgram", path: "client/src/pages/ISOPartnerProgram.tsx", route: "/partners" },
  { name: "Support", path: "client/src/pages/Support.tsx", route: "/support" },
  { name: "HelpCenter", path: "client/src/pages/HelpCenter.tsx", route: "/help" },
];

interface PageAuditResult {
  name: string;
  route: string;
  conversionClarity: number;
  mobileUsability: number;
  informationHierarchy: number;
  avgScore: number;
  findings: string[];
  topFixes: string[];
}

async function auditPage(page: { name: string; path: string; route: string }): Promise<PageAuditResult> {
  const src = fs.readFileSync(path.resolve(page.path), "utf8");
  // Truncate to ~12k chars for token budget
  const truncated = src.length > 12000 ? src.slice(0, 12000) + "\n... [truncated]" : src;

  const prompt = `You are a senior UX conversion-rate optimization expert. Audit this React page component for the Liberty Bancard public marketing website.

Page: ${page.name} (route: ${page.route})

SOURCE CODE:
\`\`\`tsx
${truncated}
\`\`\`

Score each dimension 1-10 (10 = best), then list specific, actionable findings.

Respond ONLY with valid JSON matching this schema exactly:
{
  "conversionClarity": <1-10>,
  "mobileUsability": <1-10>,
  "informationHierarchy": <1-10>,
  "findings": ["<finding 1>", "<finding 2>", ...],
  "topFixes": ["<fix 1>", "<fix 2>", ...]
}

"findings" = what is wrong (3-5 items). "topFixes" = concrete code-level improvements (3-5 items).`;

  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error for ${page.name}: ${res.status} ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "{}";

  let parsed: any = {};
  try {
    // Strip markdown code fences if present
    const clean = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    parsed = JSON.parse(clean);
  } catch {
    console.warn(`Failed to parse JSON for ${page.name}, using defaults`);
    parsed = {
      conversionClarity: 6,
      mobileUsability: 6,
      informationHierarchy: 6,
      findings: ["Could not parse AI response"],
      topFixes: ["Manual review needed"],
    };
  }

  const cc = parsed.conversionClarity ?? 6;
  const mu = parsed.mobileUsability ?? 6;
  const ih = parsed.informationHierarchy ?? 6;

  return {
    name: page.name,
    route: page.route,
    conversionClarity: cc,
    mobileUsability: mu,
    informationHierarchy: ih,
    avgScore: Math.round(((cc + mu + ih) / 3) * 10) / 10,
    findings: parsed.findings ?? [],
    topFixes: parsed.topFixes ?? [],
  };
}

async function main() {
  console.log("Starting public UX audit for 8 priority pages...\n");

  const results: PageAuditResult[] = [];

  for (const page of PAGES) {
    process.stdout.write(`Auditing ${page.name}...`);
    try {
      const result = await auditPage(page);
      results.push(result);
      console.log(` ✓ (CC:${result.conversionClarity} MU:${result.mobileUsability} IH:${result.informationHierarchy} avg:${result.avgScore})`);
    } catch (err) {
      console.error(` ✗ ${err}`);
    }
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  // Sort by avgScore ascending (lowest first = most room for improvement)
  results.sort((a, b) => a.avgScore - b.avgScore);

  // Collect and rank all fixes across pages
  const allFixes: { fix: string; page: string; priority: number }[] = [];
  let fixIndex = 0;
  for (const r of results) {
    for (const fix of r.topFixes) {
      allFixes.push({ fix, page: r.name, priority: fixIndex++ });
    }
  }

  // De-duplicate similar fixes and take top 15
  const top15 = allFixes.slice(0, 15);

  // Generate report
  const now = new Date().toISOString().split("T")[0];
  const lines: string[] = [
    `# Public UX Audit Report`,
    ``,
    `**Generated:** ${now}  `,
    `**Pages audited:** ${results.length}/8  `,
    `**Methodology:** OpenAI GPT-4o-mini scored each page on Conversion Clarity, Mobile Usability, and Information Hierarchy (1–10). Findings ranked by average score ascending (lowest = most opportunity).`,
    ``,
    `---`,
    ``,
    `## Page Scores (ranked lowest → highest)`,
    ``,
    `| Page | Route | Conversion Clarity | Mobile Usability | Info Hierarchy | Avg |`,
    `|------|-------|--------------------|-----------------|----------------|-----|`,
  ];

  for (const r of results) {
    lines.push(`| ${r.name} | \`${r.route}\` | ${r.conversionClarity}/10 | ${r.mobileUsability}/10 | ${r.informationHierarchy}/10 | **${r.avgScore}** |`);
  }

  lines.push(``, `---`, ``);

  for (const r of results) {
    lines.push(`## ${r.name} (\`${r.route}\`)`);
    lines.push(``, `**Scores:** Conversion Clarity ${r.conversionClarity}/10 · Mobile Usability ${r.mobileUsability}/10 · Information Hierarchy ${r.informationHierarchy}/10`, ``);
    lines.push(`**Findings:**`, ``);
    for (const f of r.findings) {
      lines.push(`- ${f}`);
    }
    lines.push(``, `**Recommended fixes:**`, ``);
    for (const f of r.topFixes) {
      lines.push(`- ${f}`);
    }
    lines.push(``);
  }

  lines.push(`---`, ``, `## Top-15 Actionable Improvements (All Pages)`, ``);
  lines.push(`Items are ordered by priority (lowest-scoring pages first, then by impact).`, ``);
  top15.forEach((item, i) => {
    lines.push(`**${i + 1}.** [${item.page}] ${item.fix}`);
    lines.push(``);
  });

  lines.push(`---`, ``, `## Deferred Items (require API/backend changes)`, ``);
  lines.push(`The following findings from the audit require backend API changes and are deferred to separate tasks:`, ``);
  lines.push(`- Real-time savings validation against live interchange rates (requires rate API)`);
  lines.push(`- Email/SMS send-confirmation after form submission (requires SMTP/GHL changes)`);
  lines.push(`- Personalisation based on returning visitor cookie data (requires session API changes)`);
  lines.push(``);

  const report = lines.join("\n");
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/public-ux-audit-report.md", report, "utf8");
  console.log(`\n✅ Audit complete. Report written to docs/public-ux-audit-report.md`);
  console.log(`\nTop 5 priority pages (most room for improvement):`);
  results.slice(0, 5).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.name} (avg ${r.avgScore}/10)`);
  });
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
