---
name: Large planning payloads
description: Observed task-plan and notebook limits when preserving large portable audit packages.
---

Observed tool limits are 262,144 UTF-8 bytes per task plan and 32 MiB of retained CodeExecution notebook state. Treat newer explicit tool errors as authoritative if these limits change.

**Why:** Large historical task packages plus a complete audit appendix exceeded the task limit. Keeping full task descriptions and several derived copies in notebook variables then exceeded its retained-memory limit, resetting all variables.

**How to apply:** Measure bytes before updating a task, not character count. Preserve the original scope and immutable evidence; compact the new appendix or abbreviate regenerable Git blob identities rather than removing historical inputs. Keep the full audit separately when a nearly full task can accept only a concise annotation.

Filter large task callbacks within a local function and retain only the summary needed for later calls. Do not print or persist complete task payloads repeatedly. After a parallel update fails, inspect which updates actually persisted before retrying; a failed block does not undo successful task updates.
