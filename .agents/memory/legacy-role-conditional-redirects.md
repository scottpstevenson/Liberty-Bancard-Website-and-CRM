---
name: Legacy role-conditional redirect pattern
description: Consolidation redirects in App.tsx can still conditionally render the retired page for non-admin/manager roles; check every branch before assuming a page is dead.
---

Several `Legacy*Redirect` wrapper components in `client/src/App.tsx` (e.g. `LegacyLeadCommandCenterRedirect`,
`LegacyLeadIntelligenceRedirect`) were added when a page was consolidated into a newer, role-gated
replacement (e.g. Lead Ops, admin/manager-only). To preserve prior access for roles the new page excludes,
these wrappers branch: admin/manager get redirected to the new page, but every other role still renders the
**old, retired component directly** as a fallback.

**Why:** A task description or commit message that says "X now redirects to Y" is easy to read as "X is fully
dead code," but it may only be true for the roles that can reach Y. The old component can still be live for
other roles, including any UI bugs, false claims, or intentionally-disabled controls it contains.

**How to apply:** Before deleting or declaring "no longer routed to" any page that was part of a consolidation
like this, grep `client/src/App.tsx` for `Legacy.*Redirect` wrappers referencing it and read the full branch
logic, not just the default path. If a fallback branch still renders the old component, it is not deletable
without either fixing/replacing that fallback or extending the new page's access to the excluded roles.
