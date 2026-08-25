---
name: Durable command lease cleanup
description: Token-fenced lease ownership rules for durable command workers.
---

Every durable command worker must release its lease on every terminal path, including validation and file-read failures before the main execution `try/finally`. Release, checkpoint, and terminal mutations must be fenced by the exact lease token; unleased request-side setup may mutate only a still-unleased in-progress command.

**Why:** An early worker return can leave a terminal row with a stale lease, while an unfenced route or stale worker can overwrite a command taken over by a new executor.

**How to apply:** When adding a claimed-command worker, test missing prerequisites, duplicate delivery, expired-lease takeover, and an active competing lease. Treat a queue as transport only; the command row remains lifecycle authority.