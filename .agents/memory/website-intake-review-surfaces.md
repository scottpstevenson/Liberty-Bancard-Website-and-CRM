---
name: Website intake review surfaces and links
description: Where staff find website requests, the single notification, canonical deal links, and receipt-preview logo display
---
Staff find a website request through existing surfaces only: Tasks, Notifications and Lead Ops "Inbound Operations" (short-reference lookup via `?ref=`, 4-8 hex). No sidebar entry was added. The management notification (admin/manager) carries no statement or financial content and links to `/dashboard/lead-ops?tab=pipeline&ref=<SHORT>`; deals open at `/dashboard/pipeline?id=`. The list/summary routes are admin/manager; retry is admin-only and CSRF-protected.
Receipt previews inline the brand logo for display only because the iframe sandbox and CORP/CSP block the remote image; the sent HTML and the empty sandbox are unchanged.
**Why:** a parallel task, notification or receipt authority would fork ownership; stale deal links produced blank screens.
**How to apply:** add new request kinds to the same list and notification authority; never inline anything but the logo into previews.
Messaging Inbox "Site" is chat only and says so, linking to Inbound Operations; a failed source is shown as not-an-all-clear with Retry.
