#!/usr/bin/env node
/**
 * Builds the machine-readable per-suite roster reconciliation (TASK_2162_ROSTER_RECONCILIATION.json).
 *
 *   node docs/partner-program/build-roster-reconciliation.mjs \
 *     --final=<launcher log of the whole roster on the final artifact> \
 *     --base-dir=<directory of single-suite launcher logs, one per failing suite, run on the pre-repair export> \
 *     --rerun-dir=<directory of single-suite launcher logs rerun on the final-tree export> \
 *     --meta=<json: baseSha, finalSha, finalInputHash, startedAt, finishedAt, rosterExit, notes> \
 *     [--notes=<json: { "<script>": { "disposition": "...", "note": "..." } } reviewed overrides>] \
 *     --out=docs/partner-program/TASK_2162_ROSTER_RECONCILIATION.json
 *
 * Input is the plain text the disposable launcher prints. Each suite starts at "══ Isolated suite: <script> ══" and
 * carries its own result line "✓|✗|○ <name> (executed_pass|executed_fail|skipped_opt_in)". A suite is PASS only when its own
 * block says executed_pass; a suite the roster marks skipped_opt_in is "not_run_opt_in" (the launcher still counts it as
 * a child failure); anything else is FAIL. Nothing is inferred from a missing line.
 *
 * Failure evidence of a failing suite is taken only from that suite's own output (between its "▶" line and its
 * "exit=" line): strong lines (assertion/error/FAIL lines, each with its first stack frame and, when it ends in ":",
 * the next line), or, when there are none, every output line that is not launcher chatter (a line that also appears in at least COMMON_MIN other suite logs). Launcher bookkeeping, environment advisories
 * (missing keys, fail-closed or fail-fast notices) and slow-query JSON are removed first. Digits, hex ids, ports and
 * disposable database names are masked before comparing.
 *
 * Disposition, one per non-passing suite:
 *   matched baseline        the pre-repair export also fails and every evidence line of the final failure is also in
 *                           the baseline's evidence (a final failure with a line the baseline lacks never matches)
 *   environment-transient   failed in the roster run, passed when the same suite was rerun alone on the final tree
 *   explicit opt-in         the roster does not run it (skipped_opt_in); the explicit-run result is recorded as rerun
 *   unclassified            anything else
 * A reviewed note (--notes) can set the disposition and must say why; the report copies it next to the evidence.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback = "") => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const mask = (line) =>
  line
    .replace(/\/(?:tmp\/[^/\s]+|home\/runner\/workspace)\//g, "/ROOT/")
    .replace(/test_sfp2060_[a-z0-9_]+/gi, "DB")
    .replace(/\b[a-z0-9._-]*\d{6,}[a-z0-9._@-]*\b/gi, "ID")
    .replace(/\b[0-9a-f]{8,}\b/gi, "H")
    .replace(/:\d{4,5}\b/g, ":P")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);

const STRONG = /^(AssertionError[^:]*:|[A-Za-z]*Error:|TypeError:|Test run crashed:|UI condition not reached|FAIL\b|\[[^\]]+\] FAIL|SFP disposable certification FAILED|release-artifact-gate: FAIL|✗ (?!exit=|scripts\/|[^\n]*→|[^\n]*\(exit \d+\)\s*$|[^\n]*\(executed_fail\))|throw new Error\()/;
const NOISE = /(\(executed_(fail|pass)\)|\(exit \d+\)\s*$|child-exit=|✗ exit=|✓ exit=|PRE-DEPLOY GATE|Fix all failures|Suites:|fail-closed|fail-fast|FAILFAST|Fail-fast|db:slow_query|^\{"event":|Pause state|External config|provider config|NOT test failures|delegated\/unverified|\[watcher\]|DeprecationWarning|trace-deprecation|^Node\.js v|^\^$|^\s*at (async |node:|ModuleJob|Object\.|process\.|file:))/;

function splitBlocks(text) {
  const hits = [...text.matchAll(/^══ Isolated suite: (\S+) ══\s*$/gm)];
  return hits.map((m, i) => ({ script: m[1], body: text.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : text.length) }));
}
const clean = (body) => body.split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim()).filter(Boolean);
function segment(lines) {
  const start = lines.findIndex((l) => /^▶/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^[✗✓] exit=/.test(l));
  return start >= 0 ? lines.slice(start + 1, end >= 0 ? end : undefined) : lines;
}
function strongLines(lines) {
  const out = [];
  lines.forEach((l, k) => {
    if (!STRONG.test(l) || NOISE.test(l)) return;
    let sig = l.slice(0, 300);
    if (/:$/.test(l) && lines[k + 1]) sig += ` ${lines[k + 1].slice(0, 160)}`;
    if (/^(AssertionError|[A-Za-z]*Error:|TypeError:|Test run crashed:)/.test(l)) {
      for (let j = k + 1; j < Math.min(lines.length, k + 12); j++) {
        const frame = lines[j].match(/^at .*?\(?(?:[^\s()]*\/)?((?:scripts|server|shared|client|script)\/[^\s():]+:\d+:\d+)\)?$/);
        if (frame) { sig += ` @ ${frame[1]}`; break; }
      }
    }
    out.push(sig);
  });
  return out;
}
const COMMON_MIN = 8;
let common = new Set();
function buildCommon(texts) {
  const seen = new Map();
  for (const text of texts) {
    for (const block of splitBlocks(text)) {
      for (const k of new Set(clean(block.body).map(mask))) seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }
  common = new Set([...seen].filter(([, n]) => n >= COMMON_MIN).map(([k]) => k));
}
function judge(block) {
  const body = block.body;
  const base = { logSha256: sha256(body), logBytes: Buffer.byteLength(body), childExit: Number((body.match(/child-exit=(\d+)/) ?? [])[1] ?? NaN) };
  if (Number.isNaN(base.childExit)) base.childExit = null;
  if (/\(skipped_opt_in\)/.test(body) && !/\(executed_fail\)/.test(body)) return { result: "not_run_opt_in", evidenceKind: null, evidence: [], firstError: null, ...base };
  const pass = /\(executed_pass\)/.test(body) && !/\(executed_fail\)/.test(body);
  if (pass) return { result: "pass", ...base };
  // Strong lines are searched in the whole block (a single-suite log keeps the child's stderr after its stdout).
  // Without strong lines, the evidence is every line of the block that is not launcher chatter, where chatter is any
  // line (after masking) that also appears in at least COMMON_MIN different suite logs.
  const cleaned = clean(body);
  const firstRun = cleaned.findIndex((l) => /^▶/.test(l));
  const lines = (firstRun >= 0 ? cleaned.slice(firstRun + 1) : cleaned).filter((l) => !NOISE.test(l));
  const strong = strongLines(lines);
  const own = [...new Set(lines.filter((l) => !common.has(mask(l))).map((l) => l.slice(0, 240)))];
  const evidence = strong.length ? strong.slice(0, 40) : own.slice(-300);
  return { result: "fail", evidenceKind: strong.length ? "strong-lines" : "suite-specific-output", firstError: evidence[0] ?? null, evidence, ...base };
}
function readDir(dir) {
  const out = new Map();
  if (!dir || !existsSync(dir)) return out;
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".log")) continue;
    const blocks = splitBlocks(readFileSync(path.join(dir, file), "utf8"));
    if (blocks[0]) out.set(blocks[0].script, { file, ...judge(blocks[0]) });
  }
  return out;
}
const receipt = (j, sha) => (j ? { sha, result: j.result, firstError: j.firstError ?? null, evidenceKind: j.evidenceKind ?? null, evidence: j.evidence?.slice(-12) ?? [], logSha256: j.logSha256, logBytes: j.logBytes } : null);

const finalText = readFileSync(arg("final"), "utf8");
const dirTexts = (dir) => (dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".log")).map((f) => readFileSync(path.join(dir, f), "utf8")) : []);
buildCommon([finalText, ...dirTexts(arg("base-dir")), ...dirTexts(arg("rerun-dir"))]);
const meta = JSON.parse(readFileSync(arg("meta"), "utf8"));
const notes = arg("notes") && existsSync(arg("notes")) ? JSON.parse(readFileSync(arg("notes"), "utf8")) : {};
const base = readDir(arg("base-dir"));
const rerun = readDir(arg("rerun-dir"));

const suites = splitBlocks(finalText).map((block) => {
  const final = judge(block);
  if (final.result === "pass") return { script: block.script, final, base: null, rerun: null, disposition: "passed", note: null };
  const b = base.get(block.script) ?? null;
  const r = rerun.get(block.script) ?? null;
  const baseKeys = new Set((b?.evidence ?? []).map(mask));
  const covered = final.evidence.length > 0 && final.evidence.every((e) => baseKeys.has(mask(e)));
  let disposition = "unclassified";
  if (final.result === "not_run_opt_in") disposition = "explicit opt-in";
  else if (b?.result === "fail" && covered) disposition = "matched baseline";
  else if (r?.result === "pass") disposition = "environment-transient";
  const reviewed = notes[block.script] ?? null;
  if (reviewed?.disposition) disposition = reviewed.disposition;
  return {
    script: block.script,
    final,
    launcherCountedAsFailure: true,
    base: receipt(b, meta.baseSha),
    rerun: receipt(r, meta.rerunSha ?? meta.finalSha),
    disposition,
    note: reviewed?.note ?? null,
    ...(reviewed?.extra ? { extra: reviewed.extra } : {}),
  };
});

const count = (fn) => suites.filter(fn).length;
const report = {
  generatedAt: new Date().toISOString(),
  method: meta.method ?? "One launcher run of the whole roster on the final artifact; each non-passing suite then run alone on a pre-repair export (base) and, where the first comparison did not settle it, again on a final-tree export (rerun). Receipts are the SHA-256 of each suite's log block plus its failure evidence lines; full logs were kept outside the repository.",
  baseSha: meta.baseSha,
  finalSha: meta.finalSha,
  rerunSha: meta.rerunSha ?? null,
  roster: { startedAt: meta.startedAt, finishedAt: meta.finishedAt, launcherExit: meta.rosterExit, suitesRun: suites.length },
  totals: {
    passed: count((s) => s.final.result === "pass"),
    failed: count((s) => s.final.result === "fail"),
    notRunOptIn: count((s) => s.final.result === "not_run_opt_in"),
    byDisposition: Object.fromEntries([...new Set(suites.map((s) => s.disposition))].sort().map((d) => [d, count((s) => s.disposition === d)])),
  },
  limits: meta.limits ?? [],
  suites,
};
writeFileSync(arg("out"), JSON.stringify(report, null, 1) + "\n");
console.log(JSON.stringify(report.totals));
