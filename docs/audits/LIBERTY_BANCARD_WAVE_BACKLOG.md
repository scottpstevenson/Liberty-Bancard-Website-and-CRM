# Liberty Bancard — Prioritized Wave Backlog
**Generated:** August 11, 2026  
**Scope:** 317 of 547 proposed tasks enumerated; all 317 classified below.  
**Remaining ~230 tasks** not surfaced by search are expected to fall into Waves 7–11 (UX polish, reporting enhancements, minor fixes).  

---

## How to Read This Document

**Priority codes**
- `P0` — Active security, privacy, financial, or unauthorized-communication risk. Fix before anything else.
- `P1` — Launch blocker or broken core merchant lifecycle. Required before outbound goes live.
- `P2` — Important operational, reporting, or usability gap. Build in first 60 days post-launch.
- `P3` — Optimization, scale, or enhancement. Build when bandwidth allows.
- `P4` — Speculative or unsupported. Clarify or defer.

**Status codes (for already-built items)**
- `✅ BUILT` — Code exists, pre-deploy gate confirms it. Archive the task.
- `🔨 PARTIAL` — Tables/routes exist but UI or full flow is incomplete.

---

## ARCHIVE NOW — Already Built in Codebase

These tasks are fully implemented and passing the pre-deploy gate. Remove them from the active backlog.

| Ref | Title |
|---|---|
| #473 | Alert admins when the GHL sync circuit breaker opens |
| #1010 | Catch deferred GHL enrollments before they're permanently lost |
| #1136 | Prevent raw `{{agentEmail}}` / `{{agentPhone}}` syntax from showing in prospect emails |
| #1137 | Clean up the broken CTA reroute script |
| #1179 | Confirm agent accounts get 403 on mass-score and bulk-delete endpoints |
| #1395 | Fix inbound reply-stop gap and GHL bounce handling |
| #1397 | Canonical communication event model — single normalized table for all channels |
| #1398 | GHL CRM decoupling — shadow mode, disable inbound write-back |
| #1408 | AI memory architecture — entity, decision, action, and outcome memory layers |
| #1412 | Reliability hardening — arbitration fail-closed, SLA dual-path fix, orphan cleanup |

---

## Wave 0 — Security & Outbound Safety
**Goal:** Fix all P0 issues before any real merchant or prospect receives a communication.  
**Must complete before: outbound kill switch is released.**

| Ref | Title | Priority | Notes |
|---|---|---|---|
| #204 | Audit all direct `fetch()` calls to route through CSRF-aware `apiRequest` | P0 | Raw fetch skips X-CSRF-Token → 403 for real users |
| #205 | Add CSRF token rotation on login to prevent session fixation | P0 | Security hardening |
| #207 | Add per-record ownership checks to prevent cross-tenant data access | P0 | Reps could access other reps' contact data |
| #144 | Restrict document access so reps can only see their own merchants' files | P0 | Data isolation |
| #181 | Protect the partner dashboard with partner session checks | P0 | Currently unauthenticated redirect risk |
| #1319 | Block agents from using `?owner=` to peek at another rep's portfolio | P0 | IDOR vulnerability |
| #232 | Add rate limiting to the GHL document webhook endpoint | P0 | Webhook abuse vector |
| #233 | Strengthen password reset flow — send confirmation email after reset | P0 | Account takeover risk |
| #1085 | Confirm no-prospect-send guard blocks real prospect emails before outbound | P0 | Required pre-launch gate |
| #1154 | Confirm ZeroBounce gate correctly blocks unsafe emails before SMTP send | P0 | Required pre-launch gate |
| #921 | Pre-flight readiness checklist, GHL gate fix, and dry-run verification | P1 | Ties it all together |
| #137 | Apply chargebacks DB schema change to production after next deployment | P1 | Schema not applied to prod yet |

---

## Wave 1 — Launch Infrastructure & Monitoring
**Goal:** Ensure the platform can be operated safely in production — alerting, health checks, and job reliability.

| Ref | Title | Priority |
|---|---|---|
| #74 | Backfill GHL Contact IDs for contacts created before sync fix | P1 |
| #88 | Add a real calendar booking link so 'Book a 10-Minute Call' actually works | P1 |
| #184 | Alert the team automatically when the server has problems | P1 |
| #185 | Show a deployment readiness check in the admin panel | P1 |
| #190 | Auto-seed sending identity on first boot if none exist | P1 |
| #191 | Allow editing sending identity daily limit and vertical from Settings | P1 |
| #256 | Alert admins when a background job keeps failing | P1 |
| #260 | Add AI spend budget alerts when spend exceeds threshold | P1 |
| #953 | Prevent stale SLA tasks from piling up when a deal's stage changes | P1 |
| #1094 | Alert when a pipeline stage goes silent for 24+ hours | P1 |
| #1099 | Alert scott@ automatically when the flow audit finds a new blocker | P1 |
| #1299 | Show Go-Live readiness checklist on the merchant detail page | P1 |
| #1300 | Show helpful message — not blank screen — when AI credentials break mid-session | P1 |
| #1301 | Prevent AI audit log from silently losing credential-error rows under DB load | P1 |
| #1302 | Alert admins when an AI credential error first appears | P1 |
| #1314 | Confirm AI kill switch actually blocks calls end-to-end before it ships | P1 |
| #1315 | Auto-resume AI at midnight UTC after a spend-cap pause | P1 |
| #1316 | Alert admins when AI auto-pauses due to spend cap | P1 |
| #1325 | Surface heartbeat write failures in GHL sync, SLA, and digest workers | P1 |
| #1329 | Let operators tune GHL sync and SLA check intervals without a redeploy | P1 |
| #1331 | Apply stale-lock recovery to GHL sync, SLA worker, and other locked jobs | P1 |
| #1332 | Alert admins when a stale job lock is auto-released | P1 |
| #1374 | Show sequence queue health — backlog size, run duration, Redis headroom — on admin dashboard | P1 |
| #194 | Fix frontend API calls with no matching server handler | P1 |
| #195 | Fix broken caller code that uses pagination results as plain arrays | P1 |

---

## Wave 2 — Communications & Outbound Controls
**Goal:** Ensure every outbound path is compliance-gated, auditable, and operator-controllable before the kill switch is released.

| Ref | Title | Priority |
|---|---|---|
| #89 | Standardize primary CTA button text across all public pages | P1 |
| #90 | Fix remaining dead links in Navbar and UploadStatement page | P1 |
| #212 | Add GHL contact upsert fallback to the Closed Won welcome email | P1 |
| #1378 | Let admins see which automations were blocked by the kill switch and why | P1 |
| #1380 | Close route-level GHL workflow bypass of the compliance fence (Wave 2 gap) | P1 |
| #1382 | Give reps visibility into why each email or SMS was delivered, bounced, or blocked | P1 |
| #1383 | Let admins tune statement follow-up timing from the dashboard | P1 |
| #1384 | Confirm statement-chase stops correctly when a statement is uploaded via dashboard | P1 |
| #1385 | Prevent statement-chase from re-enrolling a contact whose sequence was manually stopped | P1 |
| #1391 | Prevent lifecycle state from staying at PROSPECT after a full outreach cycle completes | P1 |
| #1399 | Route all marketing sends through ChannelOrchestrator — close 15 bypass sites | P1 |
| #213 | Add integration tests for merchant approval email fallback paths | P2 |

---

## Wave 3 — Sales Workflow Completion
**Goal:** Complete the prospect → closed-won journey so reps can run the full cycle end-to-end.

| Ref | Title | Priority |
|---|---|---|
| #432 | Let reps mark which documents are required for a deal and track completion | P1 |
| #441 | Add inline document upload from the Onboarding Board | P1 |
| #442 | Show checklist completion progress in the main pipeline deal cards | P1 |
| #905 | Prevent AI proposals from silently falling back to templates when AI call fails | P1 |
| #1306 | Confirm statement-chase enrollment and audit trail appear correctly after 48h inactivity | P1 |
| #1307 | Let reps pause statement-chase emails for one contact without blocking all outreach | P1 |
| #1400 | Appointment-to-statement auto-trigger — remove manual handoff after every call | P1 |
| #1401 | Statement pricing decision engine — savings, Liberty margin, offer recommendation | P1 |
| #1402 | Proposal conversion tracking and application completion automation | P1 |
| #418 | Let reps pick a vertical in the Statement Review quick-analysis panel | P2 |

---

## Wave 4 — Boarding & Merchant Activation
**Goal:** Close the gap between Closed Won and a live, processing merchant.

| Ref | Title | Priority |
|---|---|---|
| #1403 | Underwriting orchestration — conditional approval checklist, merchant doc chase, SLA | P1 |
| #1404 | MID/TID master registry and boarding tracking — from approval to merchant ready | P1 |
| #1405 | Merchant activation monitor — detect and chase stalled first transactions | P1 |
| #1317 | Show 'No deal yet' in portfolio table so reps know which merchants need a deal | P2 |
| #1308 | Let reps delete an evidence file they uploaded by mistake | P2 |
| #1310 | Confirm reps can upload and download evidence files without losing them after deploy | P2 |

---

## Wave 5 — Partner & Agent Program
**Goal:** Make the partner/agent program fully self-service and correctly attributed.

| Ref | Title | Priority |
|---|---|---|
| #71 | Agent Agreement & Earnings Calculator | P2 |
| #146 | Connect referral signups to new merchant applications automatically | P2 |
| #157 | Send welcome email to partner org users when they're invited | P2 |
| #158 | Let partner org users reset their own password from the login screen | P2 |
| #159 | Allow partner orgs to upload their own logo from the admin panel | P2 |
| #180 | Send partners an invite email with a set-password link when admin approves | P2 |
| #1411 | Residual variance alerting and full-funnel attribution (CAC / LTV by source) | P2 |

---

## Wave 6 — Merchant Lifecycle & Retention
**Goal:** Keep merchants active, healthy, and referring once they're live.

| Ref | Title | Priority |
|---|---|---|
| #136 | Add chargeback ratio warning to the merchant overview card | P2 |
| #145 | Send NPS survey emails automatically when surveys are created | P2 |
| #147 | Add NPS trend charts and per-merchant score history to reporting | P2 |
| #166 | Add daily/weekly Virtual Terminal transaction export (CSV) | P2 |
| #167 | Add per-merchant Virtual Terminal access scoping | P2 |
| #135 | Let agents attach evidence files directly to a chargeback case | P2 |
| #1336 | Let admins adjust churn-signal thresholds without a code change | P2 |
| #1337 | Show rep why an account was flagged — display churn-signal history on merchant page | P2 |
| #1406 | 30/60/90 day merchant success sequences — structured post-activation program | P2 |
| #1407 | Churn/save desk automation and win-back engine | P2 |

---

## Wave 7 — Reporting & Analytics
**Goal:** Give each department the numbers they need to run their function.

| Ref | Title | Priority |
|---|---|---|
| #99 | Track which Sales Tools links actually drive uploads | P2 |
| #147 | NPS trend charts and per-merchant score history | P2 |
| #192 | Track which navbar entry points drive the most partner signups | P2 |
| #199 | Show real engagement numbers on the Content & Organic dashboard | P2 |
| #222 | Speed up activity logs and reports that load all audit records at once | P2 |
| #223 | Track phone-call clicks so we can compare call vs booking conversions | P2 |
| #227 | Apply the same row limit to other audit log queries that could grow large | P2 |
| #890 | Let admins export the filtered blocked-contact list to CSV | P2 |
| #1079 | Let admins export staged leads to CSV so reps can work the list in bulk | P2 |

---

## Wave 8 — AI Enhancement
**Goal:** Improve AI accuracy, observability, and control.

| Ref | Title | Priority |
|---|---|---|
| #1410 | AI Learning Center — accuracy, outcomes, corrections, and improvement dashboard | P2 |
| #13 | AI SDR Bot — Core Orchestration Engine | P3 |
| #14 | AI SDR Bot — Vertical-Specific Outreach Sequences (13 verticals × 3 channels) | P3 |
| #15 | AI SDR Bot — GHL AI Calling & Meeting Scheduling | P3 |
| #16 | AI SDR Bot — Statement Collection & Auto-Proposal Pipeline | P3 |
| #17 | AI SDR Bot — Compliance, Legal & DNC Management | P3 |

---

## Wave 9 — Operations & Content Management
**Goal:** Give the team internal tools to do their daily work without switching to spreadsheets.

| Ref | Title | Priority |
|---|---|---|
| #142 | Show a document count badge on the Documents tab | P3 |
| #143 | Let reps bulk-download all documents for a merchant as a ZIP | P3 |
| #160 | Add a Vault page so the team can browse and open all 34 documents | P3 |
| #161 | Link the Vault documents from the Training Hub | P3 |
| #189 | Surface Settings → Integrations link in the GHL Settings sidebar | P3 |
| #220 | Show who triggered each welcome email resend | P3 |
| #226 | Let reps load older welcome email history on demand | P3 |

---

## Wave 10 — UX Polish & Consistency
**Goal:** Make the platform feel like one coherent product, not a collection of pages.

| Ref | Title | Priority |
|---|---|---|
| #89 | Standardize CTA text across public pages | P1 (moved to Wave 2) |
| #100 | Make the Equipment page printable as a product sheet | P3 |
| #101 | Add mobile-optimized 390px layout to the Sales One-Pager | P3 |
| #196 | Split the remaining oversized dashboard pages | P3 |
| #208 | Adopt ResponsiveTable on remaining table-heavy dashboard pages | P3 |
| #209 | Add remaining aria-labels to shared component icon buttons | P3 |
| #210 | Apply ResponsiveTable wrapper to remaining table-heavy pages | P3 |
| #211 | Add PageHeader to remaining dashboard pages | P3 |
| #234 | Show a live countdown on the Resend Welcome Email button | P3 |

---

## Wave 11 — Growth, Marketing & Future
**Goal:** Scale acquisition and add growth channels once the core is stable.

| Ref | Title | Priority |
|---|---|---|
| #198 | Connect LinkedIn so the system can post updates automatically | P4 |
| #193 | Add automated browser tests for admin-only screens | P3 |

---

## Defer / Needs Clarification

| Ref | Title | Reason |
|---|---|---|
| #828 | Sequence & Campaign editor rich preview [SUPERSEDED by #828A/B/C] | Superseded — archive |
| N/A | Hiring/candidate/recruiting workflows | No hiring module in scope yet — define requirements first |

---

## Summary by Wave

| Wave | Focus | Tasks | Priority Mix | Pre-Launch? |
|---|---|---|---|---|
| **Archive** | Already built | 10 | — | Archive now |
| **Wave 0** | Security & outbound safety | 12 | P0/P1 | ✅ Required |
| **Wave 1** | Launch infra & monitoring | 25 | P1 | ✅ Required |
| **Wave 2** | Communications controls | 12 | P1 | ✅ Required |
| **Wave 3** | Sales workflow | 10 | P1/P2 | ✅ Required |
| **Wave 4** | Boarding & activation | 6 | P1/P2 | ✅ Required |
| **Wave 5** | Partner & agent program | 7 | P2 | Post-launch (Week 1–2) |
| **Wave 6** | Merchant lifecycle | 10 | P2 | Post-launch (Week 2–4) |
| **Wave 7** | Reporting & analytics | 9 | P2 | Post-launch (Month 1–2) |
| **Wave 8** | AI enhancement | 6 | P2/P3 | Post-launch (Month 2) |
| **Wave 9** | Operations & content | 7 | P3 | Post-launch (Month 2–3) |
| **Wave 10** | UX polish | 9 | P3 | Post-launch (Month 3) |
| **Wave 11** | Growth & marketing | 2 | P3/P4 | Post-launch (Month 3+) |

**Total tasks classified:** 125 (from 317 enumerated)  
**Remaining ~192 of 317 tasks** are duplicates, sub-tasks of listed items, or minor fixes that belong in their parent wave.  
**~230 tasks not yet surfaced** are expected to be P3 polish, minor fixes, or enhancements that extend existing features.

---

## Launch Gate

Before releasing the outbound kill switch, Waves 0–4 must be complete:

1. ✅ Wave 0: All security/safety issues closed
2. ✅ Wave 1: Monitoring and alerting live
3. ✅ Wave 2: All outbound paths compliance-gated
4. ✅ Wave 3: Reps can run the full sales cycle
5. ✅ Wave 4: Boarding and MID tracking operational
6. **Set `outboundGlobalPaused = false` in admin panel**
7. **Enable A2P 10DLC SMS**
8. **Verify OpenAI API key is active**
