---
name: Production schema ownership
description: Why production application startup must not execute the development Drizzle migration journal on Replit.
---

Replit Publish is the sole owner of production schema reconciliation. Application startup must skip Drizzle migrations when `NODE_ENV=production`; development and disposable tests may continue applying the migration journal.

**Why:** Publish can provision development tables in production without advancing the application's `drizzle.__drizzle_migrations` journal. Replaying that older journal during container startup then collides with already-provisioned relations and prevents the readiness probe from succeeding.

**How to apply:** Put the environment gate at the application entrypoint before invoking the migration runner. Keep schema changes in development sources, validate them there, and let Publish apply the development-to-production diff.