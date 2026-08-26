/**
 * Static guard for #1669 paid HTTP providers.
 *
 * It deliberately scans source text only: it does not import an adapter, read
 * secrets, or make a provider call. OpenAI is not included here because the
 * shared SDK is used by unrelated, non-source features; its classification
 * adapter/caller boundary is enforced by provider-manifest.ts instead.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { PROVIDER_SOURCE_MANIFEST, type ProviderSourceId } from "../server/services/provider-manifest";

const ROOT = resolve(process.cwd());
const SCAN_ROOT = join(ROOT, "server");
const THIS_FILE = "scripts/scan-paid-provider-adapters.ts";

const URL_MARKERS: Partial<Record<ProviderSourceId, readonly string[]>> = {
  zerobounce: ["api.zerobounce.net"],
  serper: [["google", "serper", "dev"].join(".")],
  outscraper: ["api.app.outscraper.com"],
  apify: ["api.apify.com"],
  apollo: ["api.apollo.io"],
  proxycurl: ["nubela.co/proxycurl"],
};

const SDK_IMPORTS: Partial<Record<ProviderSourceId, readonly RegExp[]>> = {
  zerobounce: [/\bfrom\s*["']zerobounce(?:["'/])/],
  serper: [/\bfrom\s*["'](?:serper|serper-sdk)(?:["'/])/],
  outscraper: [/\bfrom\s*["']outscraper(?:["'/])/],
  apify: [/\bfrom\s*["'](?:apify-client|@apify\/sdk)(?:["'/])/],
  apollo: [/\bfrom\s*["']apollo(?:["'/])/],
  proxycurl: [/\bfrom\s*["']proxycurl(?:["'/])/],
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });
}

function normalizePath(path: string): string {
  return relative(ROOT, path).replaceAll("\\", "/");
}

const errors: string[] = [];
for (const file of sourceFiles(SCAN_ROOT)) {
  const filePath = normalizePath(file);
  if (filePath === THIS_FILE) continue;
  const text = readFileSync(file, "utf8");
  for (const [sourceId, markers] of Object.entries(URL_MARKERS) as [ProviderSourceId, readonly string[]][]) {
    const hasProviderReference =
      markers.some((marker) => text.includes(marker)) ||
      (SDK_IMPORTS[sourceId] ?? []).some((pattern) => pattern.test(text));
    if (!hasProviderReference) continue;
    const row = PROVIDER_SOURCE_MANIFEST.find((candidate) => candidate.id === sourceId);
    if (!row) {
      errors.push(`${filePath}: ${sourceId} has a URL marker but no manifest row`);
      continue;
    }
    if (!row.approvedAdapters.includes(filePath)) {
      errors.push(`${filePath}: ${sourceId} URL marker is outside approved adapters (${row.approvedAdapters.join(", ")})`);
    }
  }
}

if (errors.length > 0) {
  console.error("Paid provider adapter scan failed:");
  for (const error of errors.sort()) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Paid provider adapter scan passed.");
}