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
import * as ts from "typescript";
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

/**
 * Blanks out block and line comments before URL-marker matching, so a
 * comment that merely mentions a provider host (e.g. documenting which file
 * owns real network I/O) never counts as an unguarded reference.
 *
 * This must never blank text inside string or template literals — a real
 * unguarded provider URL can legitimately start with a protocol-relative
 * double slash inside a string, and a naive line-comment regex would mistake
 * that for a comment and silently defeat the guard. Using the TypeScript
 * scanner's own tokenizer (the same lexer the compiler uses) to walk real
 * tokens is the only reliable way to tell a comment slash from a string
 * slash — a regex can approximate it but not guarantee it across every
 * string, template, and regex-literal edge case.
 */
function stripComments(text: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, /* skipTrivia */ false, ts.LanguageVariant.Standard, text);
  const chars = text.split("");
  scanner.setOnError(() => {}); // tolerate malformed fragments; still tokenizes best-effort

  // Template literals need explicit rescanning: after a `${` interpolation,
  // scan() alone cannot tell "the `}` that closes this interpolation" from
  // "an ordinary closing brace of a nested block/object inside it", and it
  // cannot resume lexing the template *tail* text as a string instead of
  // as fresh source (which is exactly how a real URL sitting after `${...}`
  // in a template tail, e.g. `` `${host}//api.example.com` ``, would get
  // misread as a `//` line comment and blanked). Track the brace depth each
  // TemplateHead was opened at; when a CloseBraceToken appears back at that
  // exact depth, call reScanTemplateToken() instead of scan() so the lexer
  // correctly resumes inside the template as TemplateMiddle/TemplateTail.
  const templateHeadBraceDepths: number[] = [];
  let braceDepth = 0;

  let token = scanner.scan();
  while (token !== ts.SyntaxKind.EndOfFileToken) {
    if (token === ts.SyntaxKind.TemplateHead) {
      templateHeadBraceDepths.push(braceDepth);
    } else if (token === ts.SyntaxKind.OpenBraceToken) {
      braceDepth++;
    } else if (token === ts.SyntaxKind.CloseBraceToken) {
      const top = templateHeadBraceDepths[templateHeadBraceDepths.length - 1];
      if (top !== undefined && braceDepth === top) {
        token = scanner.reScanTemplateToken(false);
        if (token === ts.SyntaxKind.TemplateTail) templateHeadBraceDepths.pop();
        continue; // already have the next real token; skip the trailing scan() below
      }
      braceDepth--;
    } else if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) {
      const start = scanner.getTokenStart();
      const end = scanner.getTokenEnd();
      for (let i = start; i < end; i++) {
        if (chars[i] !== "\n") chars[i] = " ";
      }
    }
    token = scanner.scan();
  }
  return chars.join("");
}

const errors: string[] = [];
const sfpAdapterPath = "server/services/cro03/sfp-live-provider-adapters.ts";
const sfpAdapter = readFileSync(join(ROOT, sfpAdapterPath), "utf8");
for (const sourceId of ["outscraper", "apollo", "openai_classification"] as const) {
  const row = PROVIDER_SOURCE_MANIFEST.find((candidate) => candidate.id === sourceId);
  if (!row?.approvedAdapters.includes(sfpAdapterPath)) {
    errors.push(`${sfpAdapterPath}: ${sourceId} SFP transport wrapper is not an approved adapter`);
  }
  if (!row?.approvedCallers.includes(sfpAdapterPath)) {
    errors.push(`${sfpAdapterPath}: ${sourceId} SFP transport wrapper is not an approved caller`);
  }
  const operation = sourceId === "openai_classification"
    ? "performOpenAiClassification"
    : sourceId === "outscraper" ? "performOutscraperSearch" : "performApolloSearch";
  if (!sfpAdapter.includes(`sourceId: "${sourceId}"`) || !sfpAdapter.includes(operation)) {
    errors.push(`${sfpAdapterPath}: ${sourceId} wrapper must gate and delegate to ${operation}`);
  }
}

for (const file of sourceFiles(SCAN_ROOT)) {
  const filePath = normalizePath(file);
  if (filePath === THIS_FILE) continue;
  const text = stripComments(readFileSync(file, "utf8"));
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