---
name: Hardening audit patterns
description: Recurring bug classes found during the Aug 2026 code hardening audit; check these first on any new route/service.
---

## Recurring bug classes in this codebase

### Security
- `isAuthenticated` alone on PII routes is insufficient — always use `isDashboardUser` for dashboard endpoints that return contact/deal/merchant data. Merchants must not read other merchants' data.
- `/api/merchant-applications/user/:userId` — URL param userId must be verified against `req.user.id` unless caller is admin/manager (IDOR).
- `/api/contacts/:id/detail` — upgraded from `isAuthenticated` → `isDashboardUser`.
- File uploads (multer) had no MIME allowlist — only a size limit. Added `fileFilter` to `upload` in `server/routes/helpers.ts` enforcing PDF/image/CSV/Excel only.

### Async / unhandled promises
- `setInterval(async () => { await ... })` without try/catch causes unhandled rejections on failure. Pattern fix: use `setInterval(() => { fn().catch(err => console.error(...)) })`.
- `.catch(() => {})` is never acceptable on compliance-critical paths (consent records, audit logs, sequence state). Always at minimum log: `.catch((err: Error) => console.error("[X] Y failed:", err.message))`.
- Fire-and-forget `db.insert(...)` in error-path code (ai-audit-logger.ts) — intentional best-effort, acceptable only with an attached `.catch(logErr => console.error(...))`.

### Sub-component `useToast` scope
- Sub-components defined in the same file as the main page component (e.g. `ContentEditorForm` in `ContentEditor.tsx`) need their OWN `const { toast } = useToast()` call — they don't inherit the parent component's destructure. TypeScript error is "Cannot find name 'toast'" at call site.

### Duplicate imports (lucide-react / others)
- Task merges can inject a second `import { ... } from "lucide-react"` block. The fix is to merge both icon sets into one line. Always run `npx tsc --noEmit` after merges to catch these.

### Missing `await` on storage writes in route handlers
- `saveSubscription` and `removeSubscription` in push.ts were fire-and-forget; 201 was returned before DB insert settled. Pattern: always `await` storage writes before sending the response.

### Notification ownership
- `markNotificationRead(id)` had no userId scope — any authenticated user could mark any notification read. Fixed: pass optional `userId` to the storage method; WHERE clause scopes to `recipientId = userId OR recipientId IS NULL`.
- `clearAllNotifications(userId)` only deleted personal rows; system-wide (recipientId IS NULL) notifications were never cleared. Fixed: also mark system-wide ones read (can't delete per-user since they're shared).

### Non-existent POST endpoint called from client
- `CaseStudyIntake.tsx` was POST-ing to `/api/notifications` which has no creation handler. Removed the call; task creation is sufficient.

### alert() in React components
- `alert()` blocks the JS thread and looks broken in production. Replace all with `toast({ title, description, variant: "destructive" })`.

**Why:** These patterns appear in newly merged task-agent code and are hard to catch in PR review. Run `npx tsc --noEmit` and grep for `catch(() => {})` and `alert(` after every batch of merges.
