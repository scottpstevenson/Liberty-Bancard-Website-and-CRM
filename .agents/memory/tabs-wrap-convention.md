---
name: TabsList wrap/overlap convention
description: How mobile tab-bar overlap bugs happen in this codebase and the fix pattern used across pages.
---

The shared `TabsList` (client/src/components/ui/tabs.tsx) originally hardcoded a fixed `h-10` height with `items-center justify-center`. Any page that added `flex-wrap` for mobile (to avoid horizontal overflow on tab-heavy pages) but did NOT also override the height would get wrapped rows clipped/overlapping into the content above and below, because the flex box's claimed height (40px) stayed fixed while rendered content grew taller and overflowed symmetrically (items-center) both up and down.

**Why:** Several pages (BoardingTracker, GhlSequenceGuide, MarketingPlaybook, MerchantApplicationsList) already used the correct pattern `flex-wrap h-auto gap-1`, while others (SdrDashboard, OutreachCommand — with 17+ tabs, ActivationPanel, ContactDetail) either forgot `h-auto` or had no wrap classes at all, causing tabs to overlap headers/summary cards on mobile.

**How to apply:** Fixed at the shared level — `tabs.tsx` base class now uses `h-auto min-h-10` instead of fixed `h-10`, so any page-level `flex-wrap` addition is now safe by default. When adding tabs to a new tab-heavy page, use `className="flex-wrap h-auto gap-1"` on `TabsList` to match the established convention.
