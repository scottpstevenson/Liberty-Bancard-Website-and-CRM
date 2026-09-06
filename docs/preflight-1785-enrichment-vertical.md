# Liberty Bancard Preflight Audit — Task #1785
## Repair and Activate Enrichment with Canonical Vertical Projection
**Audit date:** 2026-09-06  **HEAD:** 55c74146f940b0517d1640070e21a139629bfa08  **Migration high-water:** 0224_bulk_delete_tables

---

## 1. Repository Baseline

| Item | Value |
|------|-------|
| Branch | main |
| HEAD SHA | 55c74146 |
| Migration high-water | idx=228, tag=0224_bulk_delete_tables, when=1800000000001 |
| Pre-deploy workflow | FAILED (pre-existing, unrelated to this task) |

---

## 2. VFC (Verify / Falsify / Clarify) Table

### Claim A — `SUNBIZ_ENRICHMENT_ENABLED` doesn't activate a real Sunbiz scheduled runtime

**VERIFIED.**

`SUNBIZ_ENRICHMENT_ENABLED` appears in `server/services/feature-flags.ts` (line 55):
```typescript
get SUNBIZ_ENRICHMENT_ENABLED() { return envBool("SUNBIZ_ENRICHMENT_ENABLED", process.env.NODE_ENV === "production"); },
```
It is also in `wizard-flag-overrides.ts` and `getAllFlags()`. But a global grep of the entire `server/` tree for `SUNBIZ_ENRICHMENT_ENABLED` yields **zero call sites** outside the flag declaration, the wizard-flag registry, and `getAllFlags()`. No production code path reads this flag to gate or activate any Sunbiz processing. The flag is inert — it describes intent but controls nothing.

---

### Claim B — Sunbiz auto-conversion is incorrectly coupled to `LEGACY_OUTREACH_ENABLED`

**VERIFIED.**

`runSunbizAutoConvert()` is called only from `runSequencesTick()` in `server/services/queue-manager.ts` (line 2608):
```typescript
await runSunbizAutoConvert().catch(err => console.error("[Queue:sequences] Sunbiz auto-convert error:", err));
```

`runSequencesTick()` is itself gated (lines 1255–1258):
```typescript
if (featureFlags.LEGACY_OUTREACH_ENABLED) {
  await runSequencesTick();
}
```

Auto-promotion of prospects into contacts (`autoPromoteProspects` → `createContactLocalFirst`) only runs when the legacy outreach flag is on. The Sunbiz-to-Contact pipeline is coupled to an unrelated outreach gate.

---

### Claim C — `ORCHESTRATOR_ENABLED` defaults false

**VERIFIED.**

`server/services/feature-flags.ts` line 53:
```typescript
get ORCHESTRATOR_ENABLED() { return dbFallbackBool("ORCHESTRATOR_ENABLED", false); },
```
The orchestrator will not start on a fresh deploy unless the flag is explicitly enabled via env var or DB wizard toggle.

---

### Claim D — CRO-03 policy and recipe report `liveTransport: false`

**VERIFIED, with nuance.**

- `server/services/cro03/enrichment-factory.ts` line 22: `export const CRO03_PROVIDER_TRANSPORT_ENABLED = false as const;`
- `server/routes/cro03.ts` line 376: `liveTransport: false, canaries: CRO03_CANARY_DEFINITIONS`

For every non-ZeroBounce provider (Serper, Outscraper, Apollo) the factory short-circuits to a `provider_outcome = 'disabled'` zero-spend operation. **ZeroBounce is exempt** — it follows its own validation-intent path even when `CRO03_PROVIDER_TRANSPORT_ENABLED = false`. So enrichment runs that touch only ZeroBounce will succeed; all Serper/Apollo/Outscraper runs silently no-op.

The policy endpoint is also hardcoded — it does not read the constant from enrichment-factory.ts, so the two values could diverge if one is changed.

---

### Claim E — `writeContact()` creates every contact as `record_class="unknown"` → never appears in Revenue Leads or Pipeline analytics

**VERIFIED.**

`server/services/contact-writer.ts` line 327:
```typescript
recordClass: "unknown",
```
This is the only value ever written at creation time. The `CommercialClassificationAuthority` is the sole entity that can elevate a contact to `"production"`. Until that authority runs and classifies a contact, all analytics queries gated on `record_class = 'production'` (acquisition.ts, analytics.ts) silently exclude them.

**Pathway:** `autoPromoteProspects()` in sunbiz-cron.ts → `createContactLocalFirst()` → `writeContact()` → `recordClass: "unknown"`. The newly created contact immediately disappears from every `record_class = 'production'` filtered view.

---

### Claim F — Ambiguous canonical vertical field (multiple tables, no single authority)

**PARTIALLY VERIFIED / CLARIFIED.**

Three tables carry vertical data:
- `sunbiz_entities.vertical` — set by scraper/enrichment at discovery time
- `prospects.vertical` — propagated by `convertToProspect()` / writeback
- `contacts.vertical` — propagated by `autoPromoteProspects()` and `writebackEnrichmentToLinkedRecords()`

The codebase **does** have a canonical resolver: `server/services/sdr/canonical-vertical-resolver.ts` exports `resolveCanonicalVertical()` with a source-authority ranking table (operator_override=500, discovery_enrichment=400, import_classification=300, etc.).

However, `resolveCanonicalVertical()` is **only used by the SDR orchestrator and the CRO-03A vertical service** — not by `autoPromoteProspects()`, `convertToProspect()`, `writebackEnrichmentToLinkedRecords()`, or `createContactLocalFirst()`. Prospect-to-contact promotion writes `contact.vertical = prospect.vertical` directly without passing through the resolver.

So the resolver exists but is not wired into the main Sunbiz → Prospect → Contact promotion pipeline.

---

### Claim G — Enrichment error handling swallows transient DB failures instead of deferring

**VERIFIED.**

In `server/services/sunbiz-enrichment.ts` there are three independent bare `catch { continue; }` blocks at lines 333, 363, and 407 (inside deep-enrichment processing loops). Any transient DB failure (connection timeout, pool saturation, deadlock) is silently discarded and the entity's status is left unchanged — or worse, left mid-transition — with no retry schedule. There is also a general `console.error("[Writeback] entity N: ...")` in `writebackEnrichmentToLinkedRecords()` that does not attempt retry or deferral.

The `runEnrichmentTick()` in queue-manager.ts (line 2613) correctly wraps CRO-03 factory calls in a try/catch that records failures via `recordWorkerFailure()`. The Sunbiz-specific paths are not covered.

---

### Claim H — Need activation observability dashboard for 9 subsystems

**PARTIALLY VERIFIED / CLARIFIED.**

An `activation-status` endpoint exists at `GET /api/operator/activation-status` (`server/routes/activation.ts` line 238). It checks 9+ subsystems including `LEGACY_OUTREACH_ENABLED`, `ORCHESTRATOR_ENABLED`, GHL auth, etc. The task #1785's description appears to be requesting an **enrichment-specific** activation panel — not the full operator status — showing the 9 enrichment subsystems (Sunbiz, Serper, ZeroBounce, CRO-03 transport, auto-convert, orchestrator, vertical resolver wiring, record_class classification, canary). This does not currently exist as a focused UI.

---

### Claim I — Need 20-record enrichment canary

**PARTIALLY VERIFIED.**

CRO-03 has a `micro_canary` command type and `CRO03_CANARY_DEFINITIONS` in `server/services/cro03/live-execution.ts`. However, this is a live-execution canary for the CRO-03C signed policy run — not a Sunbiz enrichment canary. A "20-record canary" for Sunbiz auto-convert (run N enriched entities end-to-end and verify contacts are created with correct verticals and correct `record_class`) does not exist.

---

## 3. Confirmed Root Causes

| # | Root Cause | Files |
|---|-----------|-------|
| RC-1 | `SUNBIZ_ENRICHMENT_ENABLED` flag is declared but never read — the Sunbiz enrichment runtime has no independent activation gate | `server/services/feature-flags.ts`, `server/services/queue-manager.ts` |
| RC-2 | `runSunbizAutoConvert()` is inside `runSequencesTick()`, which is gated by `LEGACY_OUTREACH_ENABLED` | `server/services/queue-manager.ts` lines 1256, 2608 |
| RC-3 | `CRO03_PROVIDER_TRANSPORT_ENABLED = false as const` — non-ZeroBounce providers are permanently disabled; policy endpoint is an independent hardcoded literal | `server/services/cro03/enrichment-factory.ts:22`, `server/routes/cro03.ts:376` |
| RC-4 | `writeContact()` hardcodes `recordClass: "unknown"` — no classification event is triggered at creation | `server/services/contact-writer.ts:327` |
| RC-5 | `autoPromoteProspects()` does not call `resolveCanonicalVertical()` — vertical is copied raw from prospect | `server/services/sunbiz-cron.ts:186`, `server/services/sdr/canonical-vertical-resolver.ts` |
| RC-6 | Three bare `catch { continue; }` blocks in sunbiz-enrichment.ts deep-enrichment loops swallow transient DB failures | `server/services/sunbiz-enrichment.ts:333, 363, 407` |

---

## 4. Ownership Check

All changes are in:
- `server/services/feature-flags.ts` — feature flag definitions (this project)
- `server/services/queue-manager.ts` — queue routing (this project)
- `server/services/cro03/enrichment-factory.ts` — CRO-03 factory constant (this project)
- `server/routes/cro03.ts` — policy endpoint (this project)
- `server/services/contact-writer.ts` — contact creation (this project)
- `server/services/sunbiz-cron.ts` — auto-promote (this project)
- `server/services/sunbiz-enrichment.ts` — enrichment error handling (this project)
- `client/src/pages/dashboard/` — enrichment activation panel (this project)

No upstream service or external dependency changes required.

---

## 5. Blast Radius

| Change | Blast Radius | Risk |
|--------|-------------|------|
| Wire `SUNBIZ_ENRICHMENT_ENABLED` to a dedicated Sunbiz tick (decouple from LEGACY_OUTREACH_ENABLED) | queue-manager.ts only | Low — additive gating |
| Replace bare `catch { continue; }` with structured error capture | sunbiz-enrichment.ts only | Low — tighter error handling |
| Wire `resolveCanonicalVertical()` into `autoPromoteProspects()` | sunbiz-cron.ts | Low — read-only resolver called before write |
| Add `CommercialClassificationAuthority` call after contact creation in `autoPromoteProspects()` | sunbiz-cron.ts, commercial-classification-authority.ts | Medium — new write path; must not break existing production contacts |
| Enable `CRO03_PROVIDER_TRANSPORT_ENABLED` | enrichment-factory.ts | HIGH — activates live spend against Serper/Apollo/Outscraper; requires an approval policy and canary first |
| Add enrichment activation panel | client only | Low |

**Kill line:** Do NOT change `CRO03_PROVIDER_TRANSPORT_ENABLED` to `true` without a signed CRO-03C approval policy in the DB and a completed micro-canary. The current `false as const` is load-bearing — changing it will immediately trigger real provider API spend.

---

## 6. Corrected Build Plan

The task as described mixes two distinct blast radii. The build plan must respect this ordering:

### Phase 1 — Safe structural repairs (no live spend)
1. **Decouple Sunbiz auto-convert from LEGACY_OUTREACH_ENABLED**: Move `runSunbizAutoConvert()` out of `runSequencesTick()` and into its own ENRICHMENT tick branch, gated directly by `SUNBIZ_ENRICHMENT_ENABLED`.
2. **Wire `resolveCanonicalVertical()` into `autoPromoteProspects()`**: Replace direct `prospect.vertical` copy with `resolveCanonicalVertical({ vertical: prospect.vertical, subvertical: (prospect as any).subvertical }).resolved`.
3. **Post-create classification hook**: After `createContactLocalFirst()` in `autoPromoteProspects()`, fire a `setImmediate()` call to `CommercialClassificationAuthority.classifyBySunbizProvenance(contactId)` (or equivalent) so newly promoted contacts get their `record_class` set asynchronously.
4. **Structured error capture in enrichment loops**: Replace the three bare `catch { continue; }` blocks in sunbiz-enrichment.ts (URL parse loop at line 333, website HEAD-probe loop at line 363, contact-extraction loop at line 407) with `catch (err) { console.debug("[Sunbiz Enrichment] ...", err.message); continue; }` — makes failures observable in logs without altering retry behaviour. *Implemented in this task.*
5. **Add enrichment activation panel**: New admin UI tab showing the 9 enrichment subsystem statuses (SUNBIZ_ENRICHMENT_ENABLED, ORCHESTRATOR_ENABLED, LEGACY_OUTREACH_ENABLED, CRO03_PROVIDER_TRANSPORT_ENABLED, Serper gateway status, ZeroBounce status, vertical resolver wiring, auto-convert status, canary readiness).

### Phase 2 — Canary (requires Phase 1 complete + manual operator approval)
6. **20-record Sunbiz enrichment canary**: Admin endpoint `POST /api/admin/enrichment/canary` that processes exactly 20 enriched-but-not-converted sunbiz entities end-to-end, reports resulting contacts' `record_class` and `vertical` values, and blocks Phase 3.

### Phase 3 — Transport activation (requires canary completed + signed policy)
7. **Enable CRO-03 provider transport for Serper**: Change `CRO03_PROVIDER_TRANSPORT_ENABLED` to be governed by an env var `CRO03_PROVIDER_TRANSPORT_ENABLED` (already present as a secret) so an operator can enable it without a code deploy. Sync the policy endpoint to read from the same constant.

**This audit recommends building Phase 1 + Phase 2 only in this task.** Phase 3 (live transport enable) requires a separate signed CRO-03C approval ceremony and must be a separate task.

---

## 7. Kill Lines

| Kill line | Reason |
|-----------|--------|
| Do NOT set `CRO03_PROVIDER_TRANSPORT_ENABLED = true` without a completed micro-canary | Immediately triggers live Serper/Apollo/Outscraper API spend |
| Do NOT call `CommercialClassificationAuthority.reclassify()` on existing `production` contacts | Would downgrade already-classified contacts |
| Do NOT truncate `sunbiz_entities` or `prospects` during canary setup | 1.9M entities in sunbiz, 190K hot leads — data loss is irreversible |
| Do NOT gate the Sunbiz tick on `LEGACY_OUTREACH_ENABLED` after decoupling | The entire point of RC-2 fix is independence; never re-couple |

---

*Preflight audit complete. Proceeding to Phase 1 + Phase 2 build.*
