---
name: Test EIN uniqueness in form tests
description: Hardcoded EINs in test scripts collide across runs; always generate unique per-run EINs.
---

## Rule
Never use a hardcoded EIN in test scripts. Any fixed EIN will collide on the second run because the finalize endpoint enforces EIN-level uniqueness.

**Why:** `POST /api/public/merchant-app/finalize` returns 409 on duplicate EIN. A hardcoded value like `"919191919"` in `test-forms.ts` fails every run after the first.

**How to apply:** Generate a unique suffix per run:
```ts
const einSuffix = (Date.now() % 10000000).toString().padStart(7, "0");
const testEin = `91${einSuffix}`;
```
Same pattern applies to test phones (use `uniquePhone()`) and any other unique-constrained test data.
