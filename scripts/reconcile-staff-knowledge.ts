import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Pool } from "pg";

const trainingFile = path.resolve(process.cwd(), "client/src/pages/dashboard/Training.tsx");
const trainingText = fs.readFileSync(trainingFile, "utf8");
const salesPrepFile = path.resolve(process.cwd(), "server/services/sales-prep.ts");
const salesPrepText = fs.readFileSync(salesPrepFile, "utf8");

function moduleContent(key: string): string {
  const marker = `key: "${key}"`;
  const start = trainingText.indexOf(marker);
  if (start < 0) throw new Error(`Training module not found: ${key}`);
  const contentStart = trainingText.indexOf("content: `", start);
  const end = trainingText.indexOf("`,", contentStart + 10);
  if (contentStart < 0 || end < 0) throw new Error(`Training content not found: ${key}`);
  return trainingText.slice(contentStart + 10, end);
}

const promptStart = salesPrepText.indexOf("const prompt = `");
const promptEnd = salesPrepText.indexOf("`;", promptStart + 15);
if (promptStart < 0 || promptEnd < 0) throw new Error("Sales prep prompt not found");
const salesPrepPrompt = salesPrepText.slice(promptStart + "const prompt = `".length, promptEnd);

const STAFF_SOURCES = [
  { provenanceKey: "sales-prep:prompt-v1", title: "Sales Prep System Prompt", content: salesPrepPrompt, originFile: "server/services/sales-prep.ts" },
  { provenanceKey: "training:prospecting", title: "Prospecting Module", content: moduleContent("prospecting"), originFile: "client/src/pages/dashboard/Training.tsx" },
  { provenanceKey: "training:how-to-sell", title: "How to Sell Module", content: moduleContent("how-to-sell"), originFile: "client/src/pages/dashboard/Training.tsx" },
  { provenanceKey: "training:statement-review", title: "Statement Review Module", content: moduleContent("statement-review"), originFile: "client/src/pages/dashboard/Training.tsx" },
  { provenanceKey: "training:closing", title: "Closing Module", content: moduleContent("closing"), originFile: "client/src/pages/dashboard/Training.tsx" },
  { provenanceKey: "training:onboarding-compliance", title: "Onboarding & Compliance Module", content: moduleContent("onboarding"), originFile: "client/src/pages/dashboard/Training.tsx" },
  { provenanceKey: "training:agent-quick-start", title: "Agent Quick-Start Module", content: moduleContent("quick-start"), originFile: "client/src/pages/dashboard/Training.tsx" },
].map((source) => ({
  ...source,
  audience: "staff",
  claimRiskPatterns: source.content.match(/guaranteed|15\.30%|up to.*%.*savings/gi) ?? [],
}));

async function main() {
  const importing = process.argv.includes("--import");
  const pool = new Pool({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  });
  const results: string[][] = [];
  try {
    for (const source of STAFF_SOURCES) {
      const hash = crypto.createHash("sha256").update(source.content).digest("hex");
      const existing = await pool.query(
        "SELECT id, metadata, content FROM knowledge_sources WHERE metadata->>'provenance_key' = $1 LIMIT 1",
        [source.provenanceKey],
      );
      const row = existing.rows[0];
      const oldHash = row?.metadata?.content_hash;
      const risk = source.claimRiskPatterns.length ? "CLAIM_RISK" : "";
      if (row && oldHash === hash) {
        results.push([source.provenanceKey, "UNCHANGED", risk]);
      } else if (row) {
        if (importing) {
          await pool.query(
            "UPDATE knowledge_sources SET content=$1, metadata=$2, updated_at=NOW() WHERE id=$3",
            [source.content, JSON.stringify({ provenance_key: source.provenanceKey, origin_file: source.originFile, content_hash: hash, claim_risk_patterns: source.claimRiskPatterns }), row.id],
          );
        }
        results.push([source.provenanceKey, importing ? "UPDATED" : "UPDATE_PENDING", risk]);
      } else {
        if (importing) {
          await pool.query(
            "INSERT INTO knowledge_sources (title, source_type, status, audience, content, metadata) VALUES ($1, $2, 'draft', 'staff', $3, $4)",
            [source.title, "text_block", source.content, JSON.stringify({ provenance_key: source.provenanceKey, origin_file: source.originFile, content_hash: hash, claim_risk_patterns: source.claimRiskPatterns })],
          );
        }
        results.push([source.provenanceKey, importing ? "CREATED" : "CREATE_PENDING", risk]);
      }
    }
    console.log(`Mode: ${importing ? "IMPORT" : "PREVIEW"}`);
    console.log(["provenance_key", "result", "claim_risk"].join("\t"));
    for (const result of results) console.log(result.join("\t"));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});