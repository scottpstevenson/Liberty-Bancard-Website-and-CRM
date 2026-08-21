# Liberty Bancard — Full App Audit & Gap Analysis
**Date:** August 10, 2026  
**Scope:** Code · CRM · Website · Automations · Sender Matrix · Sequences · Reporting · Merchant Data · Demo Data · Go-Live Readiness

---

## SECTION 1 — OUTBOUND SENDER MATRIX

### Global Delivery Policy
- **SMTP direct** (`server/services/smtp-email.ts:sendSmtpEmail`): transactional path; resolves From/Reply-To via `sender-policy.ts`; no automatic CAN-SPAM footer; ZeroBounce not called here — caller's responsibility.
- **ChannelOrchestrator** (`server/services/channel-orchestrator.ts`): the main sequence/SDR/onboarding send path; checks global-pause → communication arbitration → contactability (DNC/consent/STOP/quiet-hours) → transport. SMS has no From policy.
- **GHL transports** (`ghl-email-transport.ts`, `ghl-sms-transport.ts`): provider adapters; rely on orchestrator for all compliance.

### Sender Policy Registry (`server/services/sender-policy.ts`)
| Category | From address |
|---|---|
| cold_outreach | Scott@mail.libertybancard.com |
| support | support@libertybancard.com |
| onboarding | onboarding@libertybancard.com |
| security | security@libertybancard.com |
| partners | partners@libertybancard.com |
| accounts | accounts@libertybancard.com |
| internal_ops | accounts@libertybancard.com |

### Outbound Send Sites
| Trigger | File | Category | Recipient | ZeroBounce | Suppression | CAN-SPAM Footer | Cooldown |
|---|---|---|---|---|---|---|---|
| Sequence job tick (BullMQ) | sequence-worker.ts | sequence / cold | enrolled contact/lead | ✅ lazy per-send | ✅ arbitration | ❌ not injected | ✅ enrollment+step scheduling |
| Campaign execution | campaign-engine.ts | campaign / cold | campaign prospect | ❌ not called | ✅ contactability | ❌ not injected | ✅ pacing/state |
| GHL enrollment recovery | ghl-enrollment-recovery-worker.ts | onboarding | pending contact | ❌ | ✅ suppression flag | ❌ | ❌ no cooldown found |
| Onboarding reminder | onboarding-reminder-worker.ts | onboarding | new merchant | ❌ | ✅ isAuthenticated | ❌ | ❌ no cooldown found |
| Weekly digest | digest-worker.ts | digest | admin/manager | ❌ | n/a (internal) | ❌ | ⚠ in-memory only (loses on restart) |
| Executive snapshot | executive-snapshot-worker.ts | internal_ops | admin recipients | ❌ | n/a | ❌ | ⚠ in-memory only |
| Health monitor critical alert | health-monitor.ts | internal_ops | accounts@ | ❌ | n/a | ❌ | ✅ now in-memory + DB dual cooldown |
| Health monitor recovery | health-monitor.ts | internal_ops | accounts@ | ❌ | n/a | ❌ | ✅ 15-min cooldown |
| GHL circuit alert | ghl-sync.ts | internal_ops | accounts@ | ❌ | n/a | ❌ | ✅ persisted to system_settings |
| Partner welcome | partner-welcome (smtp) | onboarding | new partner org user | ❌ | ❌ no guard if SMTP down | ❌ | ❌ |
| ZeroBounce validation result | zerobounce.ts | transactional | admin | ❌ | n/a | ❌ | ❌ |
| Proposal follow-up | proposal-followup-worker.ts | cold_outreach | prospect | ✅ | ✅ arbitration | ❌ | ✅ arbitration |
| Call follow-up | call-follow-up.ts | sequence | contact | ❌ | ✅ arbitration | ❌ | ❌ |
| AI system audit | system-audit-engine.ts | internal_ops | Slack (not email) | ❌ | n/a | n/a | ✅ per-run |
| SMS (all paths above) | channel-orchestrator / GHL | various | contact | n/a | ✅ STOP/DNC | n/a | ✅ contactability |

### Gaps — Sender Matrix
1. **CAN-SPAM footer missing on all cold/sequence/campaign emails** — legally required for commercial email; no path universally injects it.
2. **ZeroBounce not called in campaign-engine** — cold campaign emails skip validation.
3. **GHL enrollment recovery and onboarding reminders have no send cooldown** — can fire repeatedly on restart.
4. **Digest and executive-snapshot cooldowns are in-memory only** — reset on process restart; could double-send after deploy.
5. **Partner welcome email has no guard when SMTP is down** (tracked as task #1249).
6. **SMS has no From/identity policy** — GHL sends from the configured GHL number; no policy enforcement.
7. **`outbound_sequence` category not in sender-policy.ts type** — channel-orchestrator default category may not resolve correctly.

---

## SECTION 2 — AUTOMATION & WORKER AUDIT

### BullMQ Queues & Workers
| Queue | Worker file | Repeat interval | Kill switch | Idempotent | Error handling |
|---|---|---|---|---|---|
| ghl-sync | queue-manager.ts | 30s (env override) | ✅ outboundGlobalPaused + circuit breaker | ⚠ not fully (identity conflicts counted as failures) | ✅ retry + skip logic |
| sla-checks | queue-manager.ts | 2min (env override) | ✅ | ✅ partial-index dedup | ✅ |
| enrichment | queue-manager.ts | continuous | ✅ SUNBIZ_ENRICHMENT_ENABLED | ⚠ re-entrancy flags added, OOM risk remains at scale | ⚠ OOM on large entity sets |
| discovery | queue-manager.ts | continuous | ✅ | ⚠ zombie job #5477/5491 stale lock | ✅ 3 attempts |
| sequence-worker | queue-manager.ts | continuous | ✅ outboundGlobalPaused + automation_registry | ✅ enrollment dedup | ✅ |
| campaign-engine | queue-manager.ts | continuous | ✅ outboundGlobalPaused | ✅ | ✅ |
| proposal-followup | queue-manager.ts | continuous | ✅ | ✅ | ✅ |
| digests | queue-manager.ts | weekly | ✅ | ⚠ in-memory lastSentWeek | ⚠ loses on restart |
| executive-snapshot | queue-manager.ts | daily | ✅ | ⚠ in-memory | ⚠ loses on restart |
| system-audit | queue-manager.ts | configured | ✅ | ✅ | ✅ |
| onboarding-reminder | queue-manager.ts | continuous | ✅ | ❌ no dedup | ⚠ can double-send |
| ghl-enrollment-recovery | queue-manager.ts | continuous | ✅ | ❌ no dedup | ⚠ |
| db-backup | queue-manager.ts | daily | ✅ | ✅ | ✅ |

### GHL Webhook Handlers
- `server/routes/webhooks/ghl.ts`: processes contact.created, contact.updated, opportunity.created/updated, appointment events. Missing authentication — no signature verification on the GHL webhook endpoint.
- `server/routes/sdr.ts:700,717`: contact-updated and message-received webhooks — also missing auth/rate limit.

### NBA Engine & ChannelOrchestrator
- NBA engine: `server/services/nba-service.ts` — computes next-best-action per contact; persists to `nba_recommendations` table; now wired to record AI decisions.
- ChannelOrchestrator: `server/services/channel-orchestrator.ts` — compliance fence before every outbound send; checks global-pause, arbitration, contactability.

### Automation Registry
- 19 entries seeded on startup; automation_registry table in DB; kill-switch pattern functional.

### Scheduler (setInterval / cron outside BullMQ)
- Periodic scoring (10 contacts/tick) via setInterval in scoring service.
- WizardFlags hydration: 5-min interval (fixed from 30s).
- Health monitor: 5-min setInterval.

### Automation Gaps
1. **Zombie discovery job #5477/5491** — stale BullMQ lock; blocks discovery queue from processing new jobs.
2. **GHL webhook has no signature/secret validation** — any caller can POST to it.
3. **Onboarding reminders and enrollment recovery have no deduplication** — can fire multiple times for same contact.
4. **Digest/snapshot idempotency is process-local** — cross-restart double-send risk.
5. **Enrichment OOM risk** — batch size not capped against available memory at scale.
6. **Checklist auto-init not wired** — task #440 proposes this but it's not yet built.

---

## SECTION 3 — CRM DATA MODEL AUDIT

### Contacts Schema (key columns)
`id, email, firstName, lastName, phone, companyName, businessName, address, city, state, zip, website, vertical, supportedVerticals, lifecycle_state, lifecycleStage (legacy), lead_score, churn_score, churn_risk_tier, email_status, ghlContactId, partnerOrgId, assignedTo, source, import_source, pewcConsentedAt, pewcConsentedPhone, disclosureVersion, dnc, dncSource, suppressionReason, suppressedAt, notes, tags, lastContactedAt, lastGhlSyncAt, createdAt, updatedAt`

### Lifecycle State Machine (27 states)
Forward-only by default. Known backward-transition gaps:
- `HEALTHY → AT_RISK` is impossible (AT_RISK is at a lower index than HEALTHY in the ordering logic).
- `CHURNED → RETENTION/ACTIVE` recovery path is blocked.
- `lifecycleStage` (legacy string field) duplicates `lifecycle_state` (enum); not always kept in sync.

### Deals / Pipeline
- Full financial analysis, risk/health, statement/proposal/application/KYC/boarding/equipment/go-live fields in schema.
- `partnerOrgId` on deals has no FK constraint.
- Stage-change side effects (lifecycle transition, GHL opportunity sync) are wired.

### GHL Sync (bidirectional)
- **Push:** contact updates → GHL via ContactWriter; deal stage changes → GHL opportunity.
- **Pull:** GHL webhooks → local contact/deal updates.
- **Conflict resolution:** identity-conflict contacts skipped (not a failure); "no GHL contact linked" deals skipped (not a failure) — ✅ fixed.
- **Test orphans:** 4 contacts with `ghlContactId LIKE 'wh-test-ghl-%'` still in DB (task #1422 in progress).
- **Identity conflict flood:** GHL ID `1dZ7Hu9x7Axgq3lGL3M7` linked to contact 107 conflicts with ~20 test contacts (168003–168018) — these are also test orphans.

### Lead Scoring / Churn Scoring
- Lead score: computed in `server/services/lead-scoring.ts`; stored on contact.
- Churn score: `server/services/churn-score.ts`; stores `churn_score`, `churn_risk_tier`; fires `save_cases` at High/Critical; now wired to AI memory.
- Periodic re-scoring: 10 contacts/tick via setInterval — no priority ordering; at-risk contacts not scored more frequently.

### Intake Provenance
- 9 public forms + manual CRM + GHL sync + CSV + Sunbiz all route through `writeContact()` canonical writer.
- `import_executions` and `contact_source_events` tables track import history.

### CRM Gaps
1. **Lifecycle state machine backward transitions blocked** — merchants that recover from CHURNED can't be moved back to ACTIVE without a manual override.
2. **`lifecycleStage` legacy field not always in sync with `lifecycle_state`** — dual fields cause UI inconsistency.
3. **`supportedVerticals` column exists in schema but vertical tagging UI is absent** (task #411 proposed).
4. **`partnerOrgId` FK missing on deals** — referential integrity not enforced.
5. **Churn scoring not prioritized** — at-risk contacts scored same frequency as healthy ones.
6. **No "best identifier" logic on Onboarding pipeline board** (task #932 proposed).
7. **Contact detail missing ZeroBounce validation history** (task #1153 proposed).

---

## SECTION 4 — API ROUTES & SECURITY

### Coverage Stats
- 1,041 server handlers across 70+ route files.
- Global CSRF active on all `/api` non-safe methods except explicitly exempt paths.
- Exempt (intentional): `/api/public/*`, `/api/webhooks/*`, `/api/nps/*`, `/api/review-requests/*`, auth/login/signup/reset, `/api/contacts/public`, `/api/statements/upload`, `/api/equipment-order`.

### Critical Security Gaps
| Route | Issue |
|---|---|
| GET `/api/ghl/status` | **No auth** — exposes integration config to anonymous callers |
| GET `/api/ghl/calendar-url` | **No auth** — exposes GHL calendar endpoint |
| POST `/api/webhooks/ghl` | **No signature verification, no rate limit** — anyone can forge GHL events |
| POST `/api/webhooks/sdr` (contact-updated, message-received) | **No auth, no rate limit** |
| POST `/api/outbound/webhook` | No auth, no rate limit |
| POST `/api/analytics/noop` | Public unauthenticated mutator, no rate limit |
| Chat assistant routes (history/feedback/handoff) | Missing auth in some variants |
| Mass-score, bulk-delete endpoints | Agent role can access (task #1179 proposed) |

### 11 Pre-existing Client/Server Mismatches (tracked #194)
`/api/admin/ghl-workflows/${...}`, `/api/lead-intelligence/full`, `/api/public/co-branded-proposal`, `/api/public/proposal`, `/api/sdr/discovery/nightly/${...}`, `/api/sdr/merchants`, `/api/sms-inbox/thread`, `/api/underwriting/deals/:param/approve`, `/api/underwriting/deals/:param/reject`, `/api/wizard/test-send/:param`, `/api/wizard/test-statement`

---

## SECTION 5 — PUBLIC WEBSITE AUDIT

### Pages Confirmed Live (421 routes, SEO audit: 0 failed, 12 warnings)
Homepage, /get-started, /upload-statement, /free-analysis, /free-analysis-guaranteed, /0-percent-processing, /beat-square-stripe, /about-contact, /estimate, /support, /savings-calculator, /compare-rates, /blog, /faq, /affiliate, /why-liberty-bancard, /shop, /case-studies, /testimonials, /testimonials/submit, /integrations, /compare/square, /compare/stripe, /compare/clover, /compare/toast, /compare/paypal, /merchant-application, /partners (CPA, bookkeeper, insurance), /help, /sales-tools, industry pages, 200+ city×vertical location pages.

### Website Gaps
1. **Sticky CTA and chat widget overlap on mobile** — offset not enforced for all screen sizes.
2. **/sales-tools page has `noindex`** — description length advisory, verify intent.
3. **Blog listing** — real content present; article-to-newsletter-signup tracking not wired (task #364).
4. **Phone-click tracking absent** — `/api/analytics/phone-click` not confirmed wired (task #223).
5. **/shop page** — physical product store; Shopify integration status unknown; needs verification that checkout is live.
6. **Sitemap.xml returns 200** ✅; robots.txt needs verification.
7. **No explicit lorem ipsum detected** ✅ — copy appears real.
8. **/testimonials/submit form** — confirm backend endpoint is live and SPAM-protected.
9. **OG images** — meta og:image tags present but image asset hosting needs verification.

---

## SECTION 6 — REPORTING & ANALYTICS

### What's Wired
- `analytics_events` table (migration 0040); `recordAnalyticsEvent()` single write path.
- `ALL_CANONICAL_EVENTS` set defines valid event types.
- System audit engine: 7 subsystems probed weekly; GPT narrative generated; admin UI at `/dashboard/system-audit`.
- MerchantHealth: churn signals, attrition thresholds configurable via Signal Settings tab.
- Pipeline silence thresholds: configurable per stage in OperatorDashboard.

### Reporting Gaps
1. **SystemAudit narrative failing in production** — `401 Incorrect API key` for OpenAI (Serper credits also exhausted). Score stuck at 42%.
2. **Serper credits exhausted** — enrichment, discovery, and reporting steps that rely on Serper fail silently with "Not enough credits."
3. **Phone-click analytics not tracked** — `/api/analytics/phone-click` endpoint missing or not wired (task #223).
4. **Blog-to-newsletter attribution not tracked** (task #364).
5. **Per-source outreach breakdown absent from Outreach Command page** (task #955).
6. **Sequence performance reports** — metrics shown but per-sequence tier breakdown toggle untested (task #613).
7. **Residual/commission reporting** — schema exists; display accuracy after live import unconfirmed (task #1285).
8. **Export: blocked-contact CSV export missing** (task #890).
9. **Campaign conversion funnel** — sent/opened/clicked/converted stages not all tracked end-to-end.

---

## SECTION 7 — MERCHANT DATA MODEL & PORTAL

### Schema
`merchants` table: id, userId, businessName, dba, ein, address, phone, email, processingVolume, vertical, status (pending/active/suspended/terminated), partnerOrgId, ghlContactId, activatedAt, createdAt, updatedAt + many onboarding/boarding/equipment/go-live fields via deals.

### Merchant Onboarding Flow
1. Merchant applies (public form `/merchant-application` or agent manual create)
2. Contact created via `writeContact()`; deal created in onboarding pipeline
3. Checklist auto-init **not yet wired** (task #440)
4. Underwriting review → approve/reject
5. Boarding documents uploaded; statement uploaded
6. Agent activates → `activatedAt` stamped; GHL opportunity updated
7. Merchant receives portal access

### Merchant Portal (`/dashboard/merchant-portal`)
- Protected by `ProtectedRoute` → merchant role required.
- Shows: account status, documents, statements, onboarding progress.
- **Gaps:** notification center present in schema/design but wired partially; document resubmission flow exists but approval notification to merchant is absent.

### Merchant Data Gaps
1. **Checklist auto-init not wired** — merchants moved into onboarding pipeline don't get a checklist automatically (task #440).
2. **"Unnamed contact" on onboarding board** — best-identifier logic missing (task #932).
3. **Merchant notification center** — wired for creation but not for document approval/rejection events.
4. **Residual/commission display** — schema and import exist; display accuracy unconfirmed.
5. **30/60/90-day success sequences** not built (task #1406).
6. **Multi-location** — partnerOrgId exists on merchants/contacts/deals but UI for switching between locations is minimal.

---

## SECTION 8 — DEMO DATA & GO-LIVE READINESS

### Demo/Seed Data Sources Found
| Source | What it creates | Cleanup needed? |
|---|---|---|
| `server/db/seed.ts` | KB knowledge sources (16 items, checked before insert) | ✅ idempotent — safe |
| `server/db/seed-sequences.ts` | Sequence templates (coldOutreach, warmLead, etc.) | ✅ idempotent — safe |
| `scripts/smoke-golive-gate.ts` | Test contacts (IDs 168040–168043), test deals | ❌ **NOT cleaned up — in DB now** |
| `ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD` env vars | Admin user on startup | ✅ preserved on restart (force-update gated) |
| `server/data/seeds/sequences.json` | Sequence step templates | ✅ idempotent |

### Active Demo/Test Contamination in DB
- **4 contacts with fake GHL IDs** (`wh-test-ghl-1786308958286-*`, IDs 168040–168043) — tripping GHL circuit breaker on every sync tick.
- **~15 contacts** (IDs 168003–168018) with GHL ID `1dZ7Hu9x7Axgq3lGL3M7` conflicting with real contact 107 — these are also test artifacts from webhook smoke tests.
- **Test deals** associated with above contacts.

### Hardcoded Test Patterns in Code
- `scripts/smoke-golive-gate.ts`: GHL ID prefix `wh-test-ghl-{timestamp}-{random}`, deal prefix `ghl-deal-test-*`.
- `ADMIN_SEED_EMAIL` defaults to `scott@libertybancard.com` — real email; acceptable for prod admin.

### Feature Flags / Demo-Mode Behavior
- `GHL_TRANSPORT_FAILFAST=true` is set by the run-pre-deploy.sh wrapper for isolation; never needed in production (no GHL calls are made by the gate).
- `SUNBIZ_ENRICHMENT_ENABLED` — defaults to false in prod; must be explicitly enabled.
- `outboundGlobalPaused` system_setting — **must be set to false before going live**.

### Go-Live Blockers (must fix before first real merchant)
1. ❌ **Test contacts 168040–168043 tripping GHL circuit breaker** (task #1422 in progress).
2. ❌ **`outboundGlobalPaused` must be set to `false`** — currently `true` in dev; verify prod value.
3. ❌ **OpenAI API key producing 401** — system-audit narrative broken; AI advisors likely broken too.
4. ❌ **Serper credits exhausted** — enrichment and discovery degraded.
5. ❌ **GHL webhook missing signature verification** — security gap before live traffic.
6. ⚠ **Production DB ETIMEDOUT** — connection pool/plan limits; infrastructure issue.
7. ⚠ **Digest/snapshot double-send risk after deploy** — in-memory idempotency.

---

## GAP PRIORITY SUMMARY

### P0 — Must Fix Before Any Live Merchant
| # | Gap | Current State | Fix |
|---|---|---|---|
| 1 | Test contacts tripping GHL circuit breaker | Active in DB | Task #1422 (in progress) |
| 2 | `outboundGlobalPaused` must be OFF in production | Unknown prod value | Admin toggle + verify |
| 3 | GHL webhook has no signature verification | Open to spoofing | Add `X-GHL-Signature` HMAC check |
| 4 | OpenAI API key 401 | AI features broken | Rotate/replace key |
| 5 | Serper credits exhausted | Enrichment degraded | Recharge or swap provider |
| 6 | GHL `/api/ghl/status` and `/api/ghl/calendar-url` are unauthenticated | Security | Add `isAuthenticated` |

### P1 — Fix Within First Week Live
| # | Gap | Fix |
|---|---|---|
| 7 | CAN-SPAM footer not injected on cold/sequence/campaign email | Universal footer middleware in sendSmtpEmail + GHL transport |
| 8 | Campaign-engine skips ZeroBounce validation | Add lazy ZB check same as sequence-worker |
| 9 | Lifecycle state machine can't go backward (CHURNED→ACTIVE) | Add explicit allowed backward transitions |
| 10 | Checklist auto-init not wired to onboarding pipeline move | Task #440 |
| 11 | Digest/snapshot cooldown resets on restart | Persist last-sent to system_settings |
| 12 | Zombie discovery BullMQ job stalling queue | Startup cleanup of stale locks |

### P2 — Before Full Launch
| # | Gap |
|---|---|
| 13 | ZeroBounce history on contact detail (task #1153) |
| 14 | Vertical tagging UI on contact edit form (task #411) |
| 15 | Phone-click analytics tracking (task #223) |
| 16 | Blog-to-newsletter attribution (task #364) |
| 17 | Blocked-contact CSV export (task #890) |
| 18 | Outreach Command per-source breakdown (task #955) |
| 19 | 30/60/90-day merchant success sequences (task #1406) |
| 20 | GHL circuit breaker alert email (task #473) |
| 21 | Churn-signal threshold admin UI (task #1336) |
| 22 | Partner welcome email SMTP guard (task #1249) |

---

*Raw subagent findings preserved in individual sections above.*
