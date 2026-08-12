# UX Audit Report — Liberty Bancard Dashboard

**Generated:** 2026-08-12  
**Scope:** 12 highest-traffic dashboard pages  
**Scoring:** Information Hierarchy · Responsive Completeness · Action Clarity (each 1–10)  
**Method:** Manual JSX structural audit (AI API call attempted but fell back to manual analysis due to SSL config)

---

## Per-Page Scores

| Page | Info Hierarchy | Responsive | Action Clarity | Avg |
|------|---------------|------------|----------------|-----|
| Overview | 7/10 | 5/10 | 7/10 | **6.3** |
| Pipeline | 8/10 | 6/10 | 8/10 | **7.3** |
| Contacts/Leads | 7/10 | 6/10 | 7/10 | **6.7** |
| SalesRepHome (My Day) | 8/10 | 5/10 | 8/10 | **7.0** |
| MerchantHealth | 7/10 | 7/10 | 7/10 | **7.0** |
| OutboundCenter | 7/10 | 7/10 | 6/10 | **6.7** |
| Leaderboard | 7/10 | 5/10 | 7/10 | **6.3** |
| OperatorDashboard | 8/10 | 6/10 | 7/10 | **7.0** |
| ReportingHub | 7/10 | 6/10 | 7/10 | **6.7** |
| CommsHub | 7/10 | 6/10 | 7/10 | **6.7** |
| TasksAppointments | 7/10 | 6/10 | 7/10 | **6.7** |
| DocumentVault | 7/10 | 7/10 | 7/10 | **7.0** |

---

## Page-by-Page Findings

### Overview

- **Information Hierarchy:** 7/10
- **Responsive Completeness:** 5/10
- **Action Clarity:** 7/10

**Issues found:**
- KPI grid uses `grid-cols-1 sm:grid-cols-2 lg:grid-cols-6` — jumps from 2 columns at sm to 6 at lg with no md step
- Middle 3-column section (`lg:grid-cols-3`) has no md breakpoint (1→3 jump on tablet)
- AI Copilot card is always expanded; no collapse affordance on small screens
- Section headers use inconsistent styling (`text-sm font-semibold uppercase` vs no section headers on other pages)
- `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` comparative section also missing md breakpoint

### Pipeline

- **Information Hierarchy:** 8/10
- **Responsive Completeness:** 6/10
- **Action Clarity:** 8/10

**Issues found:**
- Kanban board has no mobile-optimised layout (relies purely on horizontal scroll)
- Filter chip row can overflow viewport on narrow widths with no wrap
- Action toolbar (Export, AI Auto-Progress, Configure Stages, New Deal) overflows on tablet without wrapping
- List view mode doesn't have an explicit card layout at ≤md

### Contacts/Leads

- **Information Hierarchy:** 7/10
- **Responsive Completeness:** 6/10
- **Action Clarity:** 7/10

**Issues found:**
- TabsList on the Contacts tab wraps correctly but inner table has no mobile card stack
- "No contacts" empty state is a raw text string with no icon or CTA
- Bulk-action bar appears above the table with no visual separator

### SalesRepHome (My Day)

- **Information Hierarchy:** 8/10
- **Responsive Completeness:** 5/10
- **Action Clarity:** 8/10

**Issues found:**
- Main content grid uses `xl:grid-cols-3` with no lg breakpoint — jumps from 1-col to 3-col at 1280px
- Quick-stats row uses `grid-cols-2 sm:grid-cols-4` — fine, but no md step
- Header uses ad-hoc flex layout instead of shared PageHeader component
- Save Cases panel has no empty state graphic when there are no open cases

### MerchantHealth

- **Information Hierarchy:** 7/10
- **Responsive Completeness:** 7/10
- **Action Clarity:** 7/10

**Issues found:**
- Header h1/p uses an ad-hoc `<div>` instead of the shared PageHeader component
- Settings tab content has no visual CTA when thresholds are at defaults
- Risk filters (Critical / High / Medium / Low / All) wrap awkwardly at 360px viewport width

### OutboundCenter

- **Information Hierarchy:** 7/10
- **Responsive Completeness:** 7/10
- **Action Clarity:** 6/10

**Issues found:**
- No Prospects (ColdLeads) tab — users must navigate to a separate route
- Analytics tab uses AcquisitionHub placeholder instead of OutreachAnalytics
- No page title / subtitle visible above the tabs — shell provides no context on first load
- Tab strip wraps correctly (`h-auto flex-wrap`) but is otherwise unlabelled by section

### Leaderboard

- **Information Hierarchy:** 7/10
- **Responsive Completeness:** 5/10
- **Action Clarity:** 7/10

**Issues found:**
- Metric selector TabsList (`TabsList` no wrap class) overflows on narrow screens when all 7 tabs are enabled
- Header uses ad-hoc flex layout instead of shared PageHeader component
- Rank entry rows have a tight right-side metric column that can clip on 375px viewports
- Settings card does not indicate which metrics are currently hidden

### OperatorDashboard

- **Information Hierarchy:** 8/10
- **Responsive Completeness:** 6/10
- **Action Clarity:** 7/10

**Issues found:**
- Left-rail nav items can be too long for the 240px rail on very small laptop screens
- Command Center landing card has no visual indication of current system health (all green vs warnings)
- Nav rail has no `sticky` positioning inside the scrollable content area on very long views

### ReportingHub

- **Information Hierarchy:** 7/10
- **Responsive Completeness:** 6/10
- **Action Clarity:** 7/10

**Issues found:**
- TabsList can overflow horizontally on tablet without wrapping
- Financial Hub is a separate nav entry rather than a tab within Reports — confuses information architecture
- Date range selectors repeat on every sub-tab rather than being hoisted to the hub level

### CommsHub

- **Information Hierarchy:** 7/10
- **Responsive Completeness:** 6/10
- **Action Clarity:** 7/10

**Issues found:**
- TabsList does not flex-wrap — overflows on mobile when Live Chat + SMS + Email + Notifications are all present
- No unified search/filter across tabs
- Message list items have no card boundary on mobile (rely on border-b dividers that are hard to tap)

### TasksAppointments

- **Information Hierarchy:** 7/10
- **Responsive Completeness:** 6/10
- **Action Clarity:** 7/10

**Issues found:**
- Calendar view has no mobile fallback — renders a fixed-width grid that overflows at 375px
- "No tasks" empty state is a raw text string with no icon or CTA
- Filter bar (All / Overdue / Today / This Week) wraps below the action button on narrow screens

### DocumentVault

- **Information Hierarchy:** 7/10
- **Responsive Completeness:** 7/10
- **Action Clarity:** 7/10

**Issues found:**
- Document list table has no mobile card-stack variant
- Already uses PageHeader ✅
- Upload button placement (top-right) is correct but doesn't persist as a sticky FAB on mobile scroll

---

## Top 20 Actionable UX Improvements

Items marked ✅ were applied in this task. Items marked ⏳ require backend changes or are deferred to a follow-on task.

1. **[Overview]** KPI grid missing `md:grid-cols-3` — jumps 2→6 with no tablet step — *✅ Applied (added `md:grid-cols-3`)*
2. **[Overview]** 3-col mid section (`lg:grid-cols-3`) missing `md:grid-cols-2` tablet step — *✅ Applied (added `md:grid-cols-2`)*
3. **[SalesRepHome]** Main layout uses `xl:grid-cols-3` with no lg breakpoint (1→3 column jump) — *✅ Applied (added `lg:grid-cols-2`)*
4. **[OutboundCenter]** Prospects (ColdLeads) not in OutboundCenter tabs — users required separate route — *✅ Applied (added Prospects tab with ColdLeads component)*
5. **[OutboundCenter]** Analytics tab used AcquisitionHub placeholder not OutreachAnalytics — *✅ Applied (wired OutreachAnalytics as Analytics tab)*
6. **[DashboardLayout]** 35-item sidebar with duplicate entries fragments navigation above ≤20 target — *✅ Applied (consolidated to 20 visible items for admin/manager)*
7. **[DashboardLayout]** OutreachHub and OutboundCenter both exist as separate nav entries / routes — *✅ Applied (OutreachHub route now redirects to OutboundCenter)*
8. **[DashboardLayout]** Onboarding + Onboarding Kickoff appear as two separate nav items — *✅ Applied (merged into single "Onboarding" entry)*
9. **[DashboardLayout]** Referral Program + Partner Orgs visible at top level inflate item count — *✅ Applied (moved to collapsible Partners section)*
10. **[All pages]** Ad-hoc page title layouts on every page — no consistent heading pattern — *✅ Applied (shared PageHeader component created and applied to 5 pages)*
11. **[All pages]** Empty states use raw text strings with no icon, heading, or CTA — *✅ Applied (EmptyState component created in `client/src/components/ui/empty-state.tsx`)*
12. **[Leaderboard]** Metric TabsList has no flex-wrap — overflows when all 7 metric tabs are enabled — *✅ Applied (added `h-auto flex-wrap gap-1` to TabsList)*
13. **[MerchantHealth]** Header uses ad-hoc `<div><h1>` instead of shared PageHeader — *✅ Applied (replaced with PageHeader component)*
14. **[SalesRepHome]** Header uses ad-hoc flex layout instead of shared PageHeader — *✅ Applied (replaced with PageHeader component)*
15. **[Leaderboard]** Header uses ad-hoc flex layout instead of shared PageHeader — *✅ Applied (replaced with PageHeader component)*
16. **[ReportingHub]** Financial Hub in separate sidebar nav entry confuses info architecture — *✅ Applied (FinancialHub added as "Financial" tab in ReportingHub; sidebar shows single "Reports" entry)*
17. **[CommsHub]** TabsList does not flex-wrap, overflows on mobile — *⏳ Deferred — audit reveals the TabsList may already handle wrapping; needs visual verification*
18. **[Pipeline]** Kanban board has no 2-column mobile fallback, relies on horizontal scroll only — *⏳ Deferred — kanban DnD library constraints make column reflow risky without full redesign*
19. **[TasksAppointments]** Calendar view overflows at 375px with no mobile fallback — *⏳ Deferred — calendar library does not support responsive column collapse*
20. **[DocumentVault]** Document list table has no mobile card-stack variant — *⏳ Deferred — requires significant table-to-card refactor outside this task's scope*

---

## Summary

- **Average score across all pages:** 6.8/10
- **Lowest-scoring dimension:** Responsive Completeness (most pages lacked explicit `md` tablet breakpoints)
- **Total issues identified:** 40+ across 12 pages
- **Applied in this task:** 15 front-end-only fixes
- **Deferred (backend required or out of scope):** 5 items noted above; remainder tracked for follow-on wave
