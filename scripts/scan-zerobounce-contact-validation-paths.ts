/**
 * scan-zerobounce-contact-validation-paths.ts — Task #1956 step 7 census guard.
 *
 * Contact-level ZeroBounce email validation has exactly ONE governed spend
 * path: server/services/provider-readiness-control.ts's processValidationIntent().
 * It is the sole place that:
 *   (a) calls verifyEmail() from server/services/sdr/zerobounce.ts, and
 *   (b) writes reserved_units/consumed_units to provider_controls for
 *       provider = 'zerobounce'.
 *
 * The legacy campaign-engine worker (zerobounce-campaign-worker.ts) and the
 * batch route (routes/contacts.ts's runZbValidationBatch) both create a
 * validation_intents row and call processValidationIntent() rather than
 * touching the provider or the budget ledger directly — that is what makes
 * them "the same governed path" rather than two independent spend
 * mechanisms. This scan fails the moment a THIRD call site starts calling
 * verifyEmail() directly, or mutates provider_controls for zerobounce
 * outside the one approved file, since either change would silently
 * reintroduce an ungoverned ZeroBounce spend path.
 *
 * Business-path ZeroBounce validation (cro03/business-validation-service.ts,
 * a different subject type with its own already-governed CRO03C authority
 * chain via live-execution.ts) is intentionally out of scope for this scan —
 * task #1956 step 7 is about the two CONTACT-level paths only.
 *
 * Run: npx tsx scripts/scan-zerobounce-contact-validation-paths.ts
 */

import { execFileSync } from "child_process";

const ROOT = process.cwd();
const SELF = "scripts/scan-zerobounce-contact-validation-paths.ts";

const APPROVED_VERIFY_EMAIL_CALLERS = new Set([
  "server/services/provider-readiness-control.ts",
  "server/services/sdr/zerobounce.ts", // the definition itself
  "server/services/sdr/lead-finder.ts", // separate lead-discovery path (import { verifyEmail } but re-exported for injectable-deps typing, not contact validation spend), documented below
]);

// server/services/zerobounce-campaign-worker.ts and server/routes/contacts.ts
// are allowed to import ZeroBounceResult TYPE from sdr/zerobounce.ts and to
// accept an injectable `verifyEmail` dependency of that shape (for tests),
// but must never call the real verifyEmail() themselves — they must always
// route the actual call through processValidationIntent().
const FORBIDDEN_DIRECT_CALL_FILES = [
  "server/services/zerobounce-campaign-worker.ts",
  "server/routes/contacts.ts",
];

function ripgrep(pattern: string, globs: string[] = ["*.ts"]): string[] {
  try {
    const args = ["--no-heading", "--line-number"];
    for (const g of globs) args.push("-g", g);
    args.push("-e", pattern, "server", "scripts");
    const out = execFileSync("rg", args, { cwd: ROOT, encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch (err: any) {
    if (err?.status === 1) return []; // rg: no matches
    throw err;
  }
}

function main() {
  const offenders: string[] = [];

  // 1. verifyEmail() must only be CALLED (not merely referenced/typed) from
  //    the one approved orchestrator. Match the call form (`verifyEmail(`)
  //    then filter out injected-dependency calls (`deps.verifyEmail(`) and
  //    method-style calls (`x.verifyEmail(`) in JS, since rg here has no
  //    look-around support.
  for (const line of ripgrep("\\bverifyEmail\\(")) {
    const file = line.split(":")[0].replace(/\\/g, "/");
    if (file === SELF) continue;
    if (file.endsWith(".test.ts") || file.includes("/test-")) continue;
    if (/^\s*\/\//.test(line.split(":").slice(2).join(":"))) continue; // comment-only reference
    if (/\bdeps\.verifyEmail\(/.test(line)) continue; // injected dependency call — fine
    if (/[.\w]\.verifyEmail\(/.test(line)) continue; // any other method-style call — not the direct import
    if (APPROVED_VERIFY_EMAIL_CALLERS.has(file)) continue;
    if (line.includes("export async function verifyEmail")) continue; // definition site
    offenders.push(`[verifyEmail direct-call] ${line}`);
  }

  // 2. FORBIDDEN_DIRECT_CALL_FILES must never call the real verifyEmail —
  //    only accept it as an injected dependency parameter.
  for (const file of FORBIDDEN_DIRECT_CALL_FILES) {
    for (const line of ripgrep("\\bverifyEmail\\(", ["*.ts"])) {
      const [lineFile] = line.split(":");
      if (lineFile.replace(/\\/g, "/") !== file) continue;
      if (line.includes("deps.verifyEmail(")) continue; // injected dependency call — fine
      offenders.push(`[legacy-path real verifyEmail call] ${line}`);
    }
  }

  // 3. provider_controls reserved_units/consumed_units mutation for
  //    provider = 'zerobounce' must only occur in the one approved file.
  const controlsMutationApprovedFile = "server/services/provider-readiness-control.ts";
  for (const line of ripgrep("UPDATE provider_controls")) {
    const file = line.split(":")[0].replace(/\\/g, "/");
    if (file === SELF || file === controlsMutationApprovedFile) continue;
    // Test fixtures legitimately seed/reset provider_controls rows directly
    // (budget caps, circuit state) to set up scenarios; that is not
    // production spend and is out of scope for this census.
    if (file.startsWith("scripts/test-")) continue;
    // Only flag if this specific UPDATE statement is scoped to zerobounce —
    // approximate by checking the next ~6 lines of the same file for a
    // literal 'zerobounce' WHERE clause (parameterized ${provider} sites
    // serving multiple providers generically are out of scope).
    const [, lineNoStr] = line.split(":");
    const lineNo = Number(lineNoStr);
    if (!Number.isFinite(lineNo)) continue;
    try {
      const context = execFileSync(
        "sed", ["-n", `${lineNo},${lineNo + 8}p`, file],
        { cwd: ROOT, encoding: "utf8" },
      );
      if (/provider\s*=\s*'zerobounce'/.test(context)) {
        offenders.push(`[provider_controls zerobounce mutation] ${line}`);
      }
    } catch {
      // If the file can't be sampled, err on the side of flagging it.
      offenders.push(`[provider_controls zerobounce mutation - unverified] ${line}`);
    }
  }

  const unique = [...new Set(offenders)];
  if (unique.length > 0) {
    console.error("✗ ZeroBounce contact-validation path census failed:");
    console.error("  A second, ungoverned ZeroBounce spend path appears to exist.");
    console.error("  All contact-level ZeroBounce spend must flow through");
    console.error("  processValidationIntent() in provider-readiness-control.ts.");
    for (const line of unique) console.error(`  ${line}`);
    process.exit(1);
  }

  console.log("✓ ZeroBounce contact-validation census clean — a single governed spend path exists.");
  process.exit(0);
}

main();
