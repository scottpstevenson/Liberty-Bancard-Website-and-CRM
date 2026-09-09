/**
 * Local email pre-filter service (Task #1835).
 *
 * Applies four sequential gates to a batch of email addresses:
 *   (a) syntax     — basic format check
 *   (b) placeholder — known placeholder/test patterns
 *   (c) mx          — DNS MX record check (domain-deduplicated, bounded concurrency)
 *   (d) disposable  — static domain allowlist
 *
 * Outcomes drive operation-result accounting only.
 * They are NEVER written back into quality_signal_codes.
 *
 * Kill lines:
 *  - EMAIL_NO_MX / EMAIL_DISPOSABLE are NOT quality signal codes and must never
 *    be written to contact_reconciliation_members.quality_signal_codes.
 *  - DNS SERVFAIL / timeout → `indeterminate`, never a permanent rejection.
 */

import dns from "dns";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isPlaceholderEmail as isPlaceholderQualityEmail } from "./contact-quality-signals";

const _dirname = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

// ──────────────────────────────────────────────────────────────────────────────
// Disposable-domain artifact
// ──────────────────────────────────────────────────────────────────────────────

let _disposableSet: Set<string> | null = null;

/**
 * Load the static disposable-domain list once.
 * Returns a Set<string> of lowercase domains.
 */
export function loadDisposableDomains(): Set<string> {
  if (_disposableSet) return _disposableSet;
  const filePath = path.join(_dirname, "../data/disposable-domains.txt");
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    // If the file is missing, return empty set (fail open — never reject contacts).
    _disposableSet = new Set();
    return _disposableSet;
  }
  const domains = new Set<string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim().toLowerCase();
    if (!trimmed || trimmed.startsWith("#")) continue;
    domains.add(trimmed);
  }
  _disposableSet = domains;
  return _disposableSet;
}

/** Parse disposable domains from a raw text string (used in tests). */
export function parseDisposableDomains(raw: string): Set<string> {
  const domains = new Set<string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim().toLowerCase();
    if (!trimmed || trimmed.startsWith("#")) continue;
    domains.add(trimmed);
  }
  return domains;
}

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type PreFilterGate =
  | "syntax"
  | "placeholder"
  | "mx"
  | "disposable"
  | "indeterminate"
  | "pass";

export interface PreFilterOutcome {
  contactId: number;
  email: string | null;
  gate: PreFilterGate;
  detail?: string;
}

export interface PreFilterResult {
  outcomes: PreFilterOutcome[];
  /** Per-gate counts */
  counts: {
    syntax_rejected: number;
    placeholder_rejected: number;
    no_mx_authoritative: number;
    disposable_rejected: number;
    dns_indeterminate: number;
    passed: number;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Syntax gate
// ──────────────────────────────────────────────────────────────────────────────

/** Permissive but sound email format check (same as contact-quality-signals.ts). */
const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function extractDomain(email: string): string | null {
  const atIdx = email.lastIndexOf("@");
  if (atIdx < 0) return null;
  const domain = email.slice(atIdx + 1).toLowerCase().trim();
  return domain || null;
}

// ──────────────────────────────────────────────────────────────────────────────
// MX check
// ──────────────────────────────────────────────────────────────────────────────

export type MxCheckResult = "ok" | "no_mx" | "nxdomain" | "indeterminate";

/**
 * Check whether a domain has MX records.
 * Distinguishes:
 *   "ok"           — NOERROR with ≥1 MX record
 *   "no_mx"        — NOERROR but zero MX records (authoritative no-MX)
 *   "nxdomain"     — NXDOMAIN (domain does not exist)
 *   "indeterminate"— SERVFAIL, timeout, ENOTFOUND (transient), or any other error
 *
 * A DNS timeout, SERVFAIL, or transient failure produces `indeterminate`.
 * It NEVER produces a permanent rejection.
 */
export function checkMxRecord(domain: string, timeoutMs = 3000): Promise<MxCheckResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("indeterminate"), timeoutMs);

    dns.resolveMx(domain, (err, addresses) => {
      clearTimeout(timer);
      if (!err) {
        // NOERROR response
        resolve(addresses && addresses.length > 0 ? "ok" : "no_mx");
        return;
      }
      // Map error codes
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (code === "ENODATA" || code === "ENOTFOUND" && err.message?.includes("NXDOMAIN")) {
        // No MX data at all for an existing domain
        resolve("no_mx");
        return;
      }
      if (code === "ENOTFOUND") {
        // Could be NXDOMAIN or DNS failure; treat as indeterminate to be safe
        resolve("indeterminate");
        return;
      }
      if (code === "ENODATA") {
        resolve("no_mx");
        return;
      }
      if (code === "ETIMEOUT" || code === "ESERVFAIL" || code === "ECONNREFUSED") {
        resolve("indeterminate");
        return;
      }
      // Any other error: treat as indeterminate (never permanent rejection)
      resolve("indeterminate");
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Main pre-filter
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Run the four-gate pre-filter over a set of contacts.
 *
 * @param contacts  Array of { contactId, email } tuples to filter.
 * @param options   Optional overrides for concurrency, timeouts, and test domain sets.
 */
export async function runEmailPreFilter(
  contacts: Array<{ contactId: number; email: string | null }>,
  options: {
    mxConcurrency?: number;
    mxTimeoutMs?: number;
    disposableDomains?: Set<string>;
  } = {},
): Promise<PreFilterResult> {
  const {
    mxConcurrency = 10,
    mxTimeoutMs = 3000,
    disposableDomains = loadDisposableDomains(),
  } = options;

  const outcomes: PreFilterOutcome[] = [];

  // Phase 1 & 2: syntax + placeholder (synchronous, no IO)
  const needsMx: Array<{ contactId: number; email: string; domain: string }> = [];

  for (const { contactId, email } of contacts) {
    if (!email || email.trim() === "") {
      outcomes.push({ contactId, email, gate: "syntax", detail: "empty" });
      continue;
    }
    const lower = email.trim().toLowerCase();

    // (a) Syntax
    if (!EMAIL_FORMAT_RE.test(lower)) {
      outcomes.push({ contactId, email, gate: "syntax", detail: "format" });
      continue;
    }

    // (b) Placeholder
    if (isPlaceholderQualityEmail(lower)) {
      outcomes.push({ contactId, email, gate: "placeholder", detail: "pattern" });
      continue;
    }

    // Also block known placeholder domains from disposable list at placeholder gate
    const domain = extractDomain(lower);
    if (!domain) {
      outcomes.push({ contactId, email, gate: "syntax", detail: "no_domain" });
      continue;
    }

    // (d) Disposable — check before MX to avoid spending DNS budget
    if (disposableDomains.has(domain)) {
      outcomes.push({ contactId, email, gate: "disposable", detail: domain });
      continue;
    }

    needsMx.push({ contactId, email: lower, domain });
  }

  // Phase 3: MX checks — deduplicate domains, run with bounded concurrency
  const domainCache = new Map<string, MxCheckResult>();
  const uniqueDomains = [...new Set(needsMx.map((c) => c.domain))];

  // Process unique domains with bounded concurrency
  const semaphore = new Array(mxConcurrency).fill(null);
  let domainIdx = 0;

  async function worker(): Promise<void> {
    while (domainIdx < uniqueDomains.length) {
      const domain = uniqueDomains[domainIdx++];
      if (!domain) continue;
      const result = await checkMxRecord(domain, mxTimeoutMs);
      domainCache.set(domain, result);
    }
  }

  await Promise.all(semaphore.map(() => worker()));

  // Assign MX outcomes to contacts
  for (const { contactId, email, domain } of needsMx) {
    const mxResult = domainCache.get(domain) ?? "indeterminate";
    if (mxResult === "ok") {
      outcomes.push({ contactId, email, gate: "pass" });
    } else if (mxResult === "no_mx" || mxResult === "nxdomain") {
      outcomes.push({ contactId, email, gate: "mx", detail: mxResult });
    } else {
      // "indeterminate" — transient DNS failure, never a permanent rejection
      outcomes.push({ contactId, email, gate: "indeterminate", detail: "dns_transient" });
    }
  }

  // Compute counts
  const counts = {
    syntax_rejected: 0,
    placeholder_rejected: 0,
    no_mx_authoritative: 0,
    disposable_rejected: 0,
    dns_indeterminate: 0,
    passed: 0,
  };
  for (const o of outcomes) {
    if (o.gate === "syntax") counts.syntax_rejected++;
    else if (o.gate === "placeholder") counts.placeholder_rejected++;
    else if (o.gate === "mx") counts.no_mx_authoritative++;
    else if (o.gate === "disposable") counts.disposable_rejected++;
    else if (o.gate === "indeterminate") counts.dns_indeterminate++;
    else if (o.gate === "pass") counts.passed++;
  }

  return { outcomes, counts };
}
