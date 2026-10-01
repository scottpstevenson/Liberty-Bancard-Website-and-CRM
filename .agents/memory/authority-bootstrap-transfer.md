---
name: Authority bootstrap versus transfer
description: Choosing SQL verbs for authority controls with different bootstrap and transfer evidence.
---

Use an explicit INSERT for bootstrap and an explicit UPDATE for transfer when database guards require different evidence for each transition.

**Why:** PostgreSQL runs BEFORE INSERT triggers for INSERT ... ON CONFLICT DO UPDATE before conflict handling. A valid transfer event can therefore fail a bootstrap-only guard despite an existing control row. Weakening that guard would lose the distinction between establishing authority and transferring it.

**How to apply:** Serialize cooperating writers, lock an existing control row, CAS the complete previous binding/version/event, and require exactly one updated row. Let the singleton key reject competing bootstrap inserts. Keep the audit event and authority change in the same transaction so failed transitions roll back together.