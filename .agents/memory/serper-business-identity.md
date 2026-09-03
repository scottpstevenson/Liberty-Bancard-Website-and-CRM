---
name: Serper business identity lookup
description: Governed Places-first waterfall for structured business-identity lookup; keeps generic web-evidence callers unchanged; no email collection.
---

# Serper Business Identity Lookup

## The rule
`lookupBusinessIdentity()` in `server/services/serper-business-identity.ts` is the ONLY entry point for structured business-identity enrichment. Generic web-evidence callers (`searchBusiness` in `serper.ts`, `lead-finder.ts` discovery path, `ad-detector.ts`, `processor-detector.ts`) must NOT be changed to use this function.

**Why:** Task #1768 required a strict separation between identity lookup (Places-first + scoring) and generic web evidence (unchanged). Mixing them would change ad/processor-detection semantics.

## Key constants
- `MIN_IDENTITY_SCORE = 0.50` — minimum score (0–1) for acceptance; 0.60 from name similarity alone can pass without geo
- `MIN_MARGIN_OVER_RUNNER_UP = 0.10` — margin between top and second candidate to avoid ambiguous promotion
- `MAX_REQUESTS_PER_LOOKUP = 4` — hard cap on Serper requests per `lookupBusinessIdentity()` call

## Name normalizer
`normalizeBusinessName()` strips ONLY terminal legal designators (LLC, Inc, Corp, Ltd, LP, LLP, PLLC, PA, PC) including punctuation variants. Does NOT strip: Company, Group, Services, Solutions, International, Partners, Associates, "of Florida" (when mid-name). Uses `/[,.\s]*/` as prefix (not `[,.\s]+`) so standalone suffixes like "LLC" alone reduce to empty → `{ invalid: true }`.

## Waterfall strategy order
1. DBA/primary name via `/places` + ZIP in query + city/state location param
2. Legal name via `/places` (only when different from business name)
3. `/search` fallback (when both Places strategies yield no acceptable candidate)
4. Officer-hint combined with name+geography via `/search` (only if officerSurname provided)

## Kill lines enforced
- Officer/agent surname NEVER used as standalone acceptance evidence (not in scoreCandidate formula)
- Email addresses never collected from snippets (searchSerperForEmail permanently returns null)
- All calls flow through SerperGateway (approved caller added to provider-manifest.ts)
- Raw query/response/PII never in logs or telemetry (correlation hash only)

## Telemetry
Migration `0222_serper_lookup_attempts` adds `serper_lookup_attempts` table. One row per strategy attempt. `recordAttemptTelemetry()` is fire-and-forget (never throws, never blocks enrichment path).

## Wired callers
- `server/services/sdr/serper-enrichment.ts` — replaces old index-0-only Places call with `lookupBusinessIdentity()`; email search stub permanently returns null
- CRO-03 `live-execution.ts` — NOT yet fully wired (see task #1775); `deriveCro03cProviderInput` still uses raw /search

## Canary
`scripts/canary-serper-lookup.ts` — operator-only, NOT in CI. `--plan` freezes 500-entity cohort, zero API calls. `--execute --cohort-id <uuid> --confirm-paid-serper` runs shadow mode (real Serper spend, zero production writes). Release target: unusable < 40%, precision ≥ 95%.
