---
name: Raw SQL row naming
description: Raw PostgreSQL rows do not inherit Drizzle's camelCase property mapping.
---

Raw `SELECT *` results retain database column names. Do not treat them as camelCase Drizzle contact objects through a TypeScript cast; explicitly alias or map columns before applying field-level policy.

**Why:** An isolated fill-missing reconciliation test exposed non-empty names and company values being interpreted as missing when raw snake_case rows were read through camelCase keys. That would defeat the preserve-existing-values policy.

**How to apply:** When mixing raw SQL locking queries with Drizzle writers, normalize the result before checking blanks or comparing identities. Test populated name/company fields as well as empty fields; a type assertion does not rename runtime keys.