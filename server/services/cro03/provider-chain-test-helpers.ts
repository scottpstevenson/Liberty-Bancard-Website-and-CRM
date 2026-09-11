/**
 * MI-05 Provider Chain Test Helpers
 *
 * These exports exist ONLY for use in contract test scripts (zero live calls).
 * They replicate the exact executor logic in a form that does not require the
 * full CRO-03C authority gate (DB state, Redis, attestation).
 *
 * Do NOT import this module from production code paths.
 */

import { isEmailCandidateAccepted } from "./candidate-selector";
import type { ApolloRevealResult } from "../sdr/apollo";

// ── Inline replica of extractSerperBusinessEmails (keep in sync with executor) ──
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

export function extractSerperBusinessEmailsForTest(data: any): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];

  function scan(text: string | null | undefined) {
    if (!text) return;
    const matches = text.match(EMAIL_RE) ?? [];
    for (const m of matches) {
      const lower = m.toLowerCase();
      if (!seen.has(lower) && isEmailCandidateAccepted(lower, "business")) {
        seen.add(lower);
        candidates.push(lower);
      }
    }
  }

  const kg = data?.knowledgeGraph;
  if (kg) {
    scan(kg.email);
    const attrs = kg.attributes ?? {};
    for (const v of Object.values(attrs)) scan(String(v));
  }

  for (const organic of (data?.organic ?? [])) {
    scan(organic.snippet);
    scan(organic.title);
  }

  return candidates;
}

export interface RevealProcessResult {
  candidateAccepted: boolean;
  /** True when the result is quarantined (medium confidence). */
  quarantined: boolean;
  /** The email value, present only when candidateAccepted === true. */
  email: string | null;
  /** The match_confidence value from the reveal response. */
  matchConfidence: string | undefined;
  credits: number;
}

/**
 * Apply the same outcome-dispatching logic the Apollo executor uses when it
 * processes a reveal result. Used in contract tests to prove that the correct
 * disposition is assigned for each confidence level without requiring the full
 * authority gate.
 */
export function processRevealResultForTest(result: ApolloRevealResult): RevealProcessResult {
  const credits = result.billing.creditedUnits ?? 0;

  if (result.outcome === "quarantine") {
    return {
      candidateAccepted: false,
      quarantined: true,
      email: null,
      matchConfidence: "matchConfidence" in result ? (result as any).matchConfidence : undefined,
      credits,
    };
  }

  if (result.outcome === "no_result") {
    return {
      candidateAccepted: false,
      quarantined: false,
      email: null,
      matchConfidence: "matchConfidence" in result ? (result as any).matchConfidence : undefined,
      credits,
    };
  }

  // accepted
  if ("email" in result && result.email) {
    const email = result.email;
    const accepted = isEmailCandidateAccepted(email, "person");
    return {
      candidateAccepted: accepted,
      quarantined: false,
      email: accepted ? email : null,
      matchConfidence: (result as any).matchConfidence,
      credits,
    };
  }

  return { candidateAccepted: false, quarantined: false, email: null, matchConfidence: undefined, credits };
}

/**
 * Simulate the Outscraper candidate extraction + selector filter in one call.
 * Mirrors the executor: emails are filtered through isEmailCandidateAccepted('business'),
 * capped at 3.
 */
export function filterOutscraperBusinessEmailsForTest(rawEmails: string[]): string[] {
  return rawEmails
    .filter((e) => isEmailCandidateAccepted(e, "business"))
    .slice(0, 3);
}

/** Build a minimal fake ApolloRevealResult for test scenarios. */
export function fakeRevealResult(opts: {
  outcome: "accepted" | "quarantine" | "no_result";
  email?: string;
  matchConfidence?: "high" | "medium" | "low" | "none";
  creditedUnits?: number;
  certainty?: "exact" | "unknown";
}): ApolloRevealResult {
  const billing = {
    certainty: (opts.certainty ?? "exact") as "exact" | "unknown",
    creditedUnits: opts.certainty === "unknown" ? undefined : (opts.creditedUnits ?? 1),
  };

  if (opts.outcome === "accepted" && opts.email) {
    return { outcome: "accepted", email: opts.email, matchConfidence: opts.matchConfidence ?? "high", billing } as ApolloRevealResult;
  }
  if (opts.outcome === "quarantine") {
    return { outcome: "quarantine", matchConfidence: opts.matchConfidence ?? "medium", billing } as ApolloRevealResult;
  }
  return { outcome: "no_result", matchConfidence: opts.matchConfidence, billing } as ApolloRevealResult;
}
