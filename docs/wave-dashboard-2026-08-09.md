# Liberty Bancard — Wave Dashboard
**Updated:** August 9, 2026 | **Pre-Deploy Gate:** 27/27 ✅

---

## ✅ COMPLETED WAVES (All Merged)

### Foundation (Waves 1–4)
| Task | What |
|------|------|
| #571 | Wave 1A — Contactability Engine + Lifecycle State Machine |
| #1361 | Wave 1A — GHL Audit & Channel Orchestrator |
| #596 | Wave 5 — Offer Router + AI Lead Qualification |
| #573 | Wave 3 — High-Converting Landing Page Rebuild |
| #574 | Wave 4 — SEO + Programmatic Page Quality |

### SDR & Sequences (Waves 5–7)
| Task | What |
|------|------|
| #601 | Wave 6 — Compliant SDR Sequence Architecture |
| #607 | Admin Activation Checklist Modal (Wave 6) |
| #759 | Background Job Hardening (tick isolation + GHL sync dedupe) |
| #1355 | Sequence Worker Scalability |

### Intelligence & Analytics (Wave 8)
| Task | What |
|------|------|
| #918 | SLA Task Idempotency + Controlled Task Cleanup |
| #1165 | Fix Unsigned Outbound Webhook |
| #1169 | Rate-limit partner login, bulk-op admin restriction |

### Operator Platform (Wave 9)
| Task | What |
|------|------|
| #623 | Wave 9 — Operator Command Center (Lifecycle, SDR, Channel Safety, Launch Readiness) |
| #1054 | Full CRM Launch-Readiness Audit Panel (25 subsystems) |
| #1057 | Unified CRM Operating Console |
| #1058 | Launch Control Dashboard + Deliverability Controls |
| #1032 | Setup & Activation Wizard — Live-Fire Test Suite |

### Merchant Onboarding (Wave 10)
| Task | What |
|------|------|
| #639 | Wave 10 — Merchant Application + Onboarding Conversion |
| #1061 | Merchant Onboarding Checklist, Retention, Partner Pipeline |
| #900 | Go-Live Journey Verification & Activation |
| #1122 | Go-Live Production Readiness Audit & Fix |

### Revenue & Partners (Wave 11)
| Task | What |
|------|------|
| #1199 | Agent & Partner Commission Calculations from Residual Imports |
| #1335 | 30-Day VAS Upsell Automation |
| #1368 | Statement Chase Automation (auto-enroll → stop on upload) |

### QA & Safety (Wave 12)
| Task | What |
|------|------|
| #663 | Wave 12 — Release QA + Go-Live Safety (7 scripts) |

### Post-Wave 12 (Built this session)
| Task | What |
|------|------|
| Wave A2 | Outbound Preflight UI (/dashboard/outbound-preflight) |
| Wave A3 | Communication Events Model (migration 0119) |
| Wave C1 | Appointment-to-Statement Auto-Trigger |
| Wave R1 | Data Health UI (/dashboard/data-health) |
| Task #1413 | Contact Communication Timeline Tab (Cancelled — covered by Wave A3) |

---

## 🔴 SPRINT 1 — Critical / Do Now
*Gate open issues + production safety before any live traffic*

| Task | What | Why Now |
|------|------|---------|
| #1412 | Reliability hardening — arbitration fail-closed, SLA dual-path fix, orphan cleanup | Pre-deploy safety; arbitration was fail-open |
| #1380 | Complete Wave 2: GHL workflow triggers bypass compliance fence | Kill Line #3 — only remaining KL unfixed |
| #1395 | Fix inbound reply-stop gap and GHL bounce handling | Inbound STOP/bounces not fully processed |
| #1389 | Run lifecycle state backfill on production | Existing contacts have NULL lifecycle_state |
| #1379 | Prevent SDR orchestrator global pause from resetting on server restart | In-memory state lost on deploy |

---

## 🟠 SPRINT 2 — Architecture / Comms Infrastructure
*Before cohort launch is safe to flip on*

| Task | What | Why |
|------|------|-----|
| #1397 | Canonical communication event model — single normalized table for all channels | Replaces scattered send-site logging; Wave A3 foundation |
| #1398 | GHL CRM decoupling — shadow mode, disable inbound write-back, retire workflow enrollment | Full GHL = transport only; removes last write-back leak |
| #1396 | Outbound controlled cohort launch — pre-flight, monitoring, kill switch | Safe first-live-send gate |
| #1376 | Confirm sequence enrollment index is used on live DB after first deploy | Silent query plan regression risk |
| #1377 | Catch automations that skip the global pause (static scan coverage) | Compliance fence completeness |

---

## 🟡 SPRINT 3 — Rep Visibility & Statement Quality
*Reps need to see why things happen*

| Task | What |
|------|------|
| #1390 | Show lifecycle stage + transition history on contact detail page |
| #1382 | Give reps visibility into why each email/SMS was blocked or bounced |
| #1153 | Show ZeroBounce validation history on contact detail page |
| #1384 | Confirm statement-chase stops when statement uploaded via dashboard |
| #1385 | Prevent statement-chase re-enrolling when rep manually stopped sequence |

---

## 🟡 SPRINT 4 — Operator Controls & Health
*Tuning without redeploys + heartbeat visibility*

| Task | What |
|------|------|
| #1329 | Let operators tune GHL sync + SLA intervals without redeploy |
| #1325 | Surface heartbeat write failures in GHL sync, SLA, digest workers |
| #1326 | Prevent failed heartbeat from looking like a worker that never ran |
| #1320 | Run portfolio scoping check automatically on every deploy |
| #1297 | Confirm Go-Live gate can't be bypassed from mobile / deal-stage drop-downs |
| #1253 | Per-stage silence thresholds (fast-moving stages alert sooner) |

---

## 🔵 SPRINT 5 — Merchant Lifecycle & Boarding
*From approval to live merchant — structured*

| Task | What |
|------|------|
| #1403 | Underwriting orchestration — conditional approval checklist, doc chase, SLA |
| #1404 | MID/TID master registry and boarding tracking — approval → merchant ready |
| #1336 | Let admins adjust churn-signal thresholds without a code change |
| #1338 | Confirm attrition monitor won't re-alert same merchant every month |
| #1407 | Churn/save desk automation and win-back engine |

---

## 🔵 SPRINT 6 — AI Intelligence Layer
*Once data model (Sprint 2) is stable*

| Task | What |
|------|------|
| #1408 | AI memory architecture — entity, decision, action, outcome memory layers |
| #1409 | Human correction loop, prompt versioning, golden evaluation dataset |
| #1410 | AI Learning Center — accuracy, outcomes, corrections, improvement dashboard |

---

## ⚪ POLISH / BACKLOG (Low urgency, do when sprint capacity allows)

| Task | What |
|------|------|
| #1330 | Confirm sequences worker healthy after live interval change |
| #1322 | Let reps remove follow-up date without opening calendar |
| #772  | Prevent enrichment/sequence ticks from masking repeated failures |
| #609  | Automated tests for Wave 6 enrollment guard edge cases |
| #1249 | Prevent partner welcome emails going out when SMTP is down |
| #1285 | Confirm residual transaction counts after live import |
| #1010 | Catch deferred GHL enrollments before permanently lost |
| #1137 | Clean up broken CTA reroute script |
| #473  | Alert admins when GHL circuit breaker opens |
| #890  | Export filtered blocked-contact list to CSV |
| #440  | Auto-initialize checklist when deal moves to onboarding pipeline |
| #932  | Best identifier on onboarding board (Unnamed contact fix) |
| #1136 | Prevent raw {{agentEmail}} template syntax in prospect emails |
| #1179 | Confirm agent accounts get 403 on mass-score / bulk-delete |
| #411  | Add supported verticals to contact edit form |
| #955  | Per-source breakdown on Outreach Command page |
| #303  | Co-branded proposal engagement alerts in CRM pipeline |
| #613  | E2E test for Tier Breakdown toggle on sequence cards |
| #285  | Chargeback evidence packets directly to card brands |
| #364  | Track which blog articles drive newsletter signups |
| #223  | Track phone-call clicks (call vs booking conversions) |

---

## ❌ CANCEL — Old Proposals (Superseded by Merged Work)

These existed before the wave plan was formalized. The work is done under different task numbers:

| Task Range | Why Cancel |
|-----------|-----------|
| #13–#17   | Old AI SDR Bot proposals — replaced by #18–#21 (merged) |
| #71, #74  | Agent calculator, GHL backfill — superseded |
| #88–#101  | Website polish micro-tasks — absorbed into Wave 3 (#573) |
| #135–#147 | Chargeback/document micro-tasks — individual polish items |
| #157–#167 | Partner portal email/logo micro-tasks — absorbed into Wave 11 |
| #180–#211 | Auth, security, layout micro-tasks — absorbed into merged sprints |
| #212–#234 | Welcome email, audit, pagination micro-tasks — absorbed |

---

## Summary

| Status | Count |
|--------|-------|
| ✅ Done (Merged) | 536 |
| 🔴 Sprint 1 (Critical) | 5 |
| 🟠 Sprint 2 (Infrastructure) | 5 |
| 🟡 Sprint 3 (Rep Visibility) | 5 |
| 🟡 Sprint 4 (Operator Controls) | 6 |
| 🔵 Sprint 5 (Boarding/Churn) | 5 |
| 🔵 Sprint 6 (AI Layer) | 3 |
| ⚪ Polish/Backlog | 21 |
| ❌ Recommend Cancel | ~100+ old micro-tasks |
