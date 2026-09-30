#!/usr/bin/env npx tsx
import fs from "node:fs";
import path from "node:path";

let failed = 0;

function check(condition: boolean, label: string, detail = "") {
  if (condition) {
    console.log(`PASS: ${label}`);
  } else {
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function collectSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(entryPath);
    return /\.(tsx|ts)$/.test(entry.name) ? [entryPath] : [];
  });
}

const sourceFiles = collectSourceFiles(path.join(process.cwd(), "client/src"));
const bankPlaceholderMatches = sourceFiles.filter((file) =>
  fs.readFileSync(file, "utf8").includes("[Bank Partner]"),
);
check(
  bankPlaceholderMatches.length === 0,
  "No [Bank Partner] placeholders remain in client/src TypeScript files",
  bankPlaceholderMatches.join(", "),
);

const oldUniversalClaim = "Cancel Anytime. No Early Termination Fee. No Penalty.";
for (const file of [
  "client/src/pages/GetStarted.tsx",
  "client/src/pages/MerchantApplication.tsx",
]) {
  check(
    !fs.readFileSync(file, "utf8").includes(oldUniversalClaim),
    `${file} does not contain the blanket cancellation claim`,
  );
}

const home = fs.readFileSync("client/src/pages/Home.tsx", "utf8");
check(
  !/useCountUp\(\s*10\s*,\s*2000\s*,\s*"\+"\s*\)/.test(home),
  "Home.tsx does not hard-code the 10-year count-up",
);
check(
  !/useCountUp\(\s*5000\s*,\s*2000\s*,\s*"\+"\s*\)/.test(home),
  "Home.tsx does not hard-code the 5,000-merchant count-up",
);

console.log(`\nClaim authority checks: ${failed === 0 ? "all passed" : `${failed} failed`}.`);
if (failed > 0) process.exit(1);