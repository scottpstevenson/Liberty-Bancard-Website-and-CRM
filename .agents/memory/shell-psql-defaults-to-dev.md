---
name: Shell/psql defaults to dev DB
description: Raw psql or DATABASE_URL checks on this project silently connect to development, not production — a real production check needs the platform's production-scoped query path.
---

On this project, running `psql`/`DATABASE_URL` from a shell (or any ad-hoc `ShellExec` DB check) connects to the **development** database (`heliumdb`), not production (`neondb`) — even though nothing in the command line says "dev." The two are genuinely different databases with different data volumes and, in at least one observed case, different schema/constraint state.

**Why this matters:** a task #1955 BUILD pass ran what it believed was a "live psql check against production" to confirm two CHECK constraints were already repaired. It was actually checking dev, which already had the fix; production did not. The false "already fixed" conclusion was reported as fact and had to be corrected in a follow-up pass, including writing the migration that should have been written the first time.

**How to apply:** never treat a `psql`/`DATABASE_URL`/`ShellExec` DB query as evidence about production. Any claim about production state — row counts, constraint definitions, column values — must go through the platform's production-scoped query path (e.g. `executeSql` with `environment: "production"` in the code-execution sandbox, or the database skill's production mode). If a report or finding says "confirmed against production," verify which connection path was actually used before trusting it.
