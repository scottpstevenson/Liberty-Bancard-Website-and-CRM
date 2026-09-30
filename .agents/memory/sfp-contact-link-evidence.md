---
name: SFP contact–business link evidence
description: Independent identity threshold and Sunbiz vendor-source distinction for safely admitting CRM contacts into SFP.
---

Require an independent canonical Sunbiz source relationship with matching source website domain and entity name, a unique canonical business domain, an exact normalized CRM company name, and a matching non-shared corporate email domain before a system-verified contact–business link may enter SFP. A domain-only lookup, self-reported form, or import/dedupe candidate is not proof of ownership. A verified link still does not validate the email or authorize outreach.

**Why:** Production has many domain overlaps but almost no persisted contact–business links. The historical contact import largely lacks individual source-event/import-disposition evidence. Treating candidate matches as verified would falsely attribute contacts. The Sunbiz source link's `source_system` is `sunbiz`, while the linked source entities are predominantly ingested through `cordata` or `corevt`; requiring the entity's `source` to equal `sunbiz` would silently reject nearly the entire independently linked population.

**How to apply:** Keep system decisions separate from admin-reviewed decisions and recheck independent facts at the write boundary. Never assume that historical contact provenance or an unvalidated address is itself an independent corroborating source. Check both published SFP contact-source constraints and database triggers before writing; development schema success does not establish production readiness.