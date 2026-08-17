# Task #1572 — Serper Quota Investigation
**Produced:** 2026-08-17T22:00Z  
**Method:** Read-only. Zero Serper API calls initiated. Zero config changes made.  
**Data sources:** `system_settings.serper_usage`, Drizzle schema, `sdr_lead_events`, `sdr_merchants`, `audit_logs`, static code analysis of `server/services/serper.ts`, `server/services/enrichment.ts`, `server/services/sunbiz-enrichment.ts`, `server/services/sdr/serper-enrichment.ts`, `server/services/queue-manager.ts`.

---

## 1. T0 and T+5 Readings

| Field | T0 (21:50:29Z) | T+6:08 (21:56:37Z) | Δ |
|---|---|---|---|
| totalCalls | 45,862 | 45,991 | **+129** |
| successfulCalls | 2,440 | 2,440 | **+0** |
| failedCalls | 43,422 | 43,551 | **+129** |
| websitesFound | 1,352 | 1,352 | 0 |
| emailsFound | 180 | 180 | 0 |
| phonesFound | 998 | 998 | 0 |
| remainingCalls | 4,138 | 4,009 | **−129** |
| lastCallAt | 21:50:27Z | 21:56:36Z | advanced |
| resetAt | 2026-07-04T00:00:15.927Z | (unchanged) | — |
| monthlyQuota | 50,000 | 50,000 | — |

**Active enrichment run at T+5:** `enrichment_progress = {status:"running", total:200, processed:6, emailsFound:1, phonesFound:6}` — a 200-prospect enrichment batch was in flight during the observation window.

**Observed call rate:** 129 calls / 368 seconds = **21.0 calls/minute**  
**Success rate in window:** **0%** — 129 attempts, 0 successes, 0 new data found.

---

## 2. Interval Delta Confirmation

The prior evidence packet noted `+11,565 totalCalls, +0 successfulCalls, +11,565 failedCalls` for an earlier interval. The current observation window confirms the same pattern at a lower instantaneous rate:

> **In 6 minutes and 8 seconds: +129 total, +0 successful, +129 failed. No new websites, emails, or phones extracted.**

The call rate difference between sessions is explained by an enrichment job being earlier in its batch (only 6/200 processed at T0). The failure pattern is identical — 100% failure rate — independent of rate.

---

## 3. When Does `failedCalls` Increment — Code Analysis

All tracking flows through a single function in `server/services/serper.ts`:

```typescript
async function trackSerperCall(
  success: boolean,
  results?: { website?: boolean; email?: boolean; phone?: boolean }
)
```

This function reads `serper_usage` from `system_settings`, increments counters, and writes back. It is called from two places:

### A. In `serperSearch()` — the HTTP wrapper

| Condition | Increments |
|---|---|
| `!response.ok` (any non-2xx HTTP response) | **failedCalls** |
| Exception thrown — network, `AbortError` from 10-second timeout, JSON parse error | **failedCalls** |
| 200 OK — normal return (no trackSerperCall here; caller handles it) | neither |

### B. In the three exported search functions (`searchBusiness`, `searchBusinessEmail`, `searchBusinessContacts`)

| Condition | Increments |
|---|---|
| `serperSearch()` returned null (HTTP error or exception) — function returns early | *(tracked already by serperSearch; caller does not call trackSerperCall)* |
| 200 OK response, processing complete — always | **successfulCalls** |
| 200 OK, website found | additionally websitesFound++ |
| 200 OK, email found in snippets | additionally emailsFound++ |
| 200 OK, phone found in snippets | additionally phonesFound++ |
| 200 OK, **zero search results** (empty organic array) | **successfulCalls** — NOT failedCalls |
| 200 OK, results found but **no email/phone/website extracted** | **successfulCalls** — NOT failedCalls |

### What does NOT increment failedCalls

| Scenario | Counter behavior |
|---|---|
| Valid 200 OK with zero organic results | successfulCalls++ |
| 200 OK but no email/phone in any snippet | successfulCalls++ |
| Calls from `server/services/sdr/serper-enrichment.ts` | **Neither counter** — raw fetch, bypasses tracking entirely |
| Calls from the Places API endpoint `/places` | **Neither counter** — only `/search` endpoint is wrapped by trackSerperCall |

### Summary: `failedCalls` reflects genuine HTTP-level failures

All 43,551 `failedCalls` represent actual HTTP failures (non-2xx responses) or network/timeout errors. A 200 OK that finds nothing still counts as a success.

---

## 4. Failure Breakdown by Category

No `serper_call_failed` audit log entries exist (Serper tracking writes only to `system_settings`, not to `audit_logs`). Per-call HTTP status codes are not persisted. The following is derived from code analysis and the observable failure pattern.

### Taxonomy of possible failure types (code-derived)

| Category | HTTP status | Code path | Evidence of occurrence |
|---|---|---|---|
| **Quota exhausted** | 429 | `!response.ok` → `trackSerperCall(false)` | Most likely — 94.7% failure rate, 100% in current window |
| **Authentication error** | 401 | `!response.ok` → `trackSerperCall(false)` | Possible if key expired |
| **Rate limit (per-second)** | 429 | Same | Would cause partial failures, not 94.7% |
| **Network/DNS** | n/a (exception) | `catch` → `trackSerperCall(false)` | Unlikely to dominate |
| **Timeout** | n/a (AbortError) | 10s timeout → `catch` → `trackSerperCall(false)` | Unlikely to dominate at 100% |
| **Server error** | 5xx | `!response.ok` → `trackSerperCall(false)` | Unlikely sustained |

### Most probable root cause

The lifetime pattern — **2,440 successes early, then 43,551 consecutive failures** — is characteristic of a quota-exhausted provider account. Serper returns a 429 or equivalent non-2xx error on every request once the monthly or account quota is depleted. Workers have no gate checking the actual provider balance, so they continue calling and accumulating `failedCalls`.

**The observation-window confirmation:** 129 calls, 0 successes, 0 new data, Δ=0 on every enrichment field — this is the signature of a provider returning a uniform error on all requests.

### Query-type breakdown (approximate, from search function usage)

| Query type | Function called | Source |
|---|---|---|
| Business lookup (`<name> <location>`) | `searchBusiness` | enrichment.ts, sunbiz-enrichment.ts |
| Email search (`"<name>" "<domain>" email contact`) | `searchBusinessEmail` | enrichment.ts, sunbiz-enrichment.ts |
| Contact search (`"<name>" <location> phone email`) | `searchBusinessContacts` | sunbiz-enrichment.ts |
| Places API (`/places` endpoint) | `serper-enrichment.ts` (direct fetch, **untracked**) | serper-enrichment.ts |

---

## 5. `resetAt` Explanation

### Where it is initialized

In `server/services/serper.ts`, `defaultUsageStats()`:

```typescript
function defaultUsageStats(): SerperUsageStats {
  return {
    ...
    resetAt: new Date().toISOString(),   // ← set once, at first write
    monthlyQuota: SERPER_MONTHLY_QUOTA,  // hardcoded 50,000
    remainingCalls: SERPER_MONTHLY_QUOTA,
  };
}
```

The value `2026-07-04T00:00:15.927Z` is the exact timestamp when the `serper_usage` record was **first created** in `system_settings` — July 4, 2026 at midnight UTC.

### Whether code automatically rolls it monthly

**No.** There is no code anywhere that:
- Reads `resetAt`
- Compares it to the current date
- Resets `totalCalls`, `failedCalls`, `successfulCalls` to 0 when a new month starts
- Advances `resetAt` to the next month

`resetAt` is written once at initialization and never updated by any scheduled job, any worker, or any admin endpoint (except `resetSerperUsage()` which resets everything to defaults — not scheduled).

### Whether `remainingCalls` reflects provider balance

**No — it is a local counter only:**

```typescript
stats.remainingCalls = Math.max(0, (stats.monthlyQuota || SERPER_MONTHLY_QUOTA) - stats.totalCalls);
```

This is pure arithmetic: `50,000 − totalCalls`. It has no connection to the provider's actual remaining quota. If Serper reset its quota on August 4 (a plausible monthly reset) and issued a fresh 50,000 credits, the local counter would still show `50,000 − 45,991 = 4,009` — reflecting calls since July 4, not since August 4.

### Whether the provider console agrees with the local counter

Cannot confirm from here (no provider console access). The 100% failure rate in the current window strongly suggests the provider balance is **at or near 0**, regardless of what the local counter shows.

---

## 6. Duplicate / Retry Analysis

### Main enrichment.ts (prospects)

`enrichProspect()` is called for records where `enrichedAt IS NULL AND status != 'do_not_contact'`. Once a prospect is enriched (`enrichedAt` is set), it is not re-queried. **No duplication problem in this path.**

### Sunbiz enrichment (sunbiz-enrichment.ts)

`enrichSunbizEntity()` updates `enrichmentStatus` to `"enriched"` on completion. However, there is a re-entry risk for entities whose enrichment fails midway (status stays `"pending"`). Gated by `SUNBIZ_ENRICHMENT_ENABLED` env var. Low duplication risk if the gate is working.

### `serper-enrichment.ts` — `runSerperEnrichmentBatch()` — **critical duplication problem**

```typescript
const merchantsToEnrich = await db
  .select()
  .from(sdrMerchants)
  .where(
    and(
      sql`(${sdrMerchants.website} IS NULL OR ${sdrMerchants.mainPhone} IS NULL OR ${sdrMerchants.mainEmail} IS NULL)`,
      sql`${sdrMerchants.doNotContactFlag} IS NOT TRUE`
    )
  )
  .limit(limit);
```

**Findings:**

| Metric | Value |
|---|---|
| Eligible merchants (do_not_contact=false) | 251 |
| With `website = NULL` | 251 (100%) |
| With `mainPhone = NULL` | 251 (100%) |
| With `mainEmail = NULL` | 175 (70%) |
| `sdr_lead_events` of type `serper_enrichment` | **0 total ever** |

**Every one of the 251 eligible merchants is re-queried on every batch run** because:
1. The Places API has returned null for all of them (no `result` → no `enrichMerchantWithSerper` update → fields stay NULL)
2. There is no `lastSerperCheckedAt` column, no `serperAttempts` counter, no cooldown marker, no skip-after-N-failures flag
3. The `sdr_lead_events` write (the only record that a merchant was enriched) only fires on success — so permanently-unfindable merchants have zero protection against infinite re-querying

These 251 merchants are queried against the Places API (via serper-enrichment.ts's direct fetch — **not tracked in serper_usage**). Their call volume is invisible to the counter but consumes real provider quota.

---

## 7. Current Quota and Estimated Exhaustion

### Local counter (unreliable)

| Metric | Value |
|---|---|
| monthlyQuota (hardcoded) | 50,000 |
| totalCalls | 45,991 |
| remainingCalls (local arithmetic) | **4,009** |
| failureFraction | 94.7% (43,551 / 45,991) |
| Observed rate | 21.0 calls/min |
| Local exhaustion at 21.0/min | 4,009 / 21 ≈ **191 min ≈ 3.2 hours** from T0 (~01:00Z Aug 18) |

### Provider balance (inferred)

The 100% failure rate in the observation window is the key signal. **The provider quota is almost certainly already at 0.** The local counter's 4,009 remaining is meaningless:

- `resetAt` = 2026-07-04 → counter has not reset since July 4
- Serper's actual billing cycle likely reset around August 4 (30 days)
- If a fresh 50,000 were issued August 4 and have since been consumed, the local counter (measuring from July 4) shows 4,009 remaining while the provider has 0
- Alternatively, the July 4 cohort of 50,000 was exhausted long ago and the local counter didn't track the reset

**Operational reality:** The enrichment workers are consuming provider quota at zero yield. Every call returns an error. Each failed call counts against `totalCalls`, burning down the local counter with no data extraction.

---

## 8. Recommended Immediate Operational Gate

**Five-minute delta verdict: quota decreasing with zero successes — CONFIRMED.**  
Per the investigation instructions, the existing operational control is identified and presented without making any change.

### Existing controls, per code

| Control | What it gates | Where |
|---|---|---|
| `SUNBIZ_ENRICHMENT_ENABLED` env var | All Serper calls from `sunbiz-enrichment.ts` — `searchBusiness`, `searchBusinessEmail`, `searchBusinessContacts` for Sunbiz entities | `server/services/sunbiz-enrichment.ts` |
| Enrichment job admin UI / queue stop | Stops `enrichProspect()` calls in the `ENRICHMENT` BullMQ queue (runs every 10 min) | Admin → Enrichment Jobs |
| `resetSerperUsage()` admin call | Resets the local counter to 0 | `server/routes/admin.ts` (check endpoint) |

**There is no single "pause all Serper calls" toggle.** The two main tracked paths (enrichment.ts and sunbiz-enrichment.ts) must be paused separately:
1. Set `SUNBIZ_ENRICHMENT_ENABLED=false` → stops sunbiz enrichment Serper calls
2. Pause/drain the `ENRICHMENT` queue → stops `enrichProspect()` calls

**The `serper-enrichment.ts` Places API path (251-merchant re-query loop) has no existing gate** — it is called from `runSerperEnrichmentBatch()` which is invoked from somewhere in the queue or admin routes. Identifying and gating that caller is a separate action.

**Neither action should be taken until approved.** The above are the exact existing controls, not a recommendation to change configuration.

---

## Root Cause Summary

| Finding | Detail |
|---|---|
| **Failure rate** | 94.7% lifetime (43,551 / 45,991); 100% in current 6-minute window |
| **Root cause** | Provider quota almost certainly exhausted; Serper returns non-2xx on all requests |
| **resetAt** | Snapshot of first-write timestamp (2026-07-04); never auto-advanced; purely cosmetic |
| **remainingCalls** | Local arithmetic (`50,000 − totalCalls`), not provider balance; unreliable |
| **successfulCalls** counts | HTTP 200 OK — NOT "found useful data"; zero-result 200s inflate success counter |
| **Invisible call path** | `serper-enrichment.ts` uses direct raw fetch to Places API, bypasses `trackSerperCall` entirely |
| **Worst duplication** | 251 SDR merchants all re-queried on every serper-enrichment batch with no cooldown or deduplication marker; 0 successful enrichments ever logged |
| **Workers currently consuming quota** | `ENRICHMENT` queue (10-min repeating) + sunbiz worker (gated by `SUNBIZ_ENRICHMENT_ENABLED`) + serper-enrichment batch (ungated, untracked) |
| **Estimated local exhaustion** | ~3.2 hours from T0 if rate holds — but provider is likely already at 0 |
| **Zero-yield confirmation** | Observation window: Δ websitesFound=0, emailsFound=0, phonesFound=0 against 129 calls |

---

*No writes, provider calls, config changes, GHL mutations, queue mutations, or contact modifications were made during this investigation.*
