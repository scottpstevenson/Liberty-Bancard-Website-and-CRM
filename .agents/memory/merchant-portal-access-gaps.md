---
name: Merchant portal access gaps
description: Routes and redirects that must allow merchant-role users to self-serve without exposing CRM data.
---

## ProtectedRoute redirect

`client/src/App.tsx` `ProtectedRoute` must redirect `merchant` role to `/dashboard/merchant-portal` before the generic CRM dashboard renders. Pattern:

```ts
if ((user as any).role === "merchant" && location !== "/dashboard/merchant-portal") {
  return <Redirect to="/dashboard/merchant-portal" />;
}
```

Without this, merchants land on `/dashboard` (CRM overview), see the staff sidebar, and their API calls fail with 403.

## API routes that merchants need read access to

These routes used `isDashboardUser` (blocks merchant) but the MerchantPortal page calls them:

| Route | Fix |
|---|---|
| `GET /api/onboarding-steps/deal/:dealId` | `isAuthenticated` + merchant ownership check (`profile.dealId === dealId`) |
| `GET /api/deals/:id/onboarding-checklist` | `isAuthenticated` + merchant ownership check |

Pattern: fetch `storage.getMerchantProfileByUser(user.id)` and compare the merchant's `dealId`; return 403 if it doesn't match.

**Why:** The merchant portal Onboarding tab silently returns empty arrays when these return 403 — no visible error, just missing data. Always audit `isDashboardUser` usage when adding new portal tabs.

## GHL companies API

GHL `/companies` POST returns 404 at this integration tier. Treat 404 from `syncCompanyToGhl` as a skip (not a circuit-breaker failure) and mark the company ID as synced to stop retrying every tick.
