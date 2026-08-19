---
name: Provider isolation & audit redaction principles
description: Durable rules for isolating external providers in tests and keeping PII out of audit logs.
---

- Provider test isolation must be real transport interception, verified against the running server — never an acknowledgment env flag. **Why:** a flag no server code consumes gives false confidence while real provider records get created.
- Any raw external mutation must run the full pause protocol (authorize → register in-flight with epoch → recheck epoch → I/O → deregister). An authorize-only gate loses to a pause activating mid-flight.
- Audit-log writes anywhere (including direct inserts in services) must sanitize payloads; error-message fields commonly carry raw provider bodies and need scrubbing too, and entity keys must never be raw emails/phones. Message-content tables that deliberately store business data are exempt.
