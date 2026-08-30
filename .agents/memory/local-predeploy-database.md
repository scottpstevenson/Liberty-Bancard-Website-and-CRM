---
name: Disposable pre-deploy database setup
description: Local PostgreSQL setup details needed when running the full pre-deploy gate under a supervised workflow.
---

Use a disposable PostgreSQL cluster under `/tmp` for the full pre-deploy gate, with an explicit local Unix socket directory and explicit cluster-owner role. Keep the database port separate from the application port because supervised Replit workflows may inject both `PGUSER` and a dynamic `PORT`.

**Why:** The environment's default PostgreSQL socket directory may not exist, the client may default to a role that `initdb` did not create, and the workflow can inject a dynamic app port that collides with the disposable database.

**How to apply:** Set PostgreSQL to use `-k /tmp`, create/connect as the `initdb` owner, and use a `DB_PORT` shell variable rather than `PORT` for PostgreSQL. Run `postgres` itself as a managed background shell task; a daemon started by a foreground setup shell may be reaped when that shell exits. Use a URL with a valid hostname plus `?host=%2Ftmp` so both `pg` and the certification URL parser accept the socket connection. Set the app's exported port explicitly, pass matching `DATABASE_URL` and `TEST_DATABASE_URL` with `NODE_ENV=test`, and restore the original workflow command after the run.
