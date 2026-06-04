---
name: Admin password sync on startup
description: seedAdminUser now always re-syncs the password hash from the ADMIN_SEED_PASSWORD env var on every server startup.
---

Previously `seedAdminUser` (in `server/replit_integrations/auth/replitAuth.ts`) only set the password when the admin user did NOT yet exist — meaning if ADMIN_SEED_PASSWORD changed or a manual DB reset was done, the password would be out of sync.

Fixed: the function now always re-hashes ADMIN_SEED_PASSWORD and runs an UPDATE against the existing user on startup. This means:
- The admin password in DB always matches the ADMIN_SEED_PASSWORD env var after any server restart.
- Manual DB password resets (e.g., `scripts/reset-admin-password.ts`) will be overwritten on next restart.

**Why:** role-guards smoke test kept failing because the DB password drifted from the env var.

**How to apply:** Never rely on manually reset admin passwords surviving a server restart. Always set the env var instead.
