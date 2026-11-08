---
name: Public claims preflight lessons
description: Tooling and roster quirks found while preflighting the public truth/terms (W-A) task; useful for any public-copy or suite-registration work.
---

- A new test suite must be registered in BOTH the pre-deploy mandatory-suite list and the CI suite manifest (the manifest has a `--check` self-validation). Mobile, fonts and overlay public checks are registered in both; the public perf check and the route-validation DTO check are not and are run by hand.
- Workbook `.xlsx` files here have inline strings and no shared-strings part and no spreadsheet library is installed: parse with python `zipfile` plus XML.
- Plan Mode: `git fetch` is blocked and can leave `.git/index.lock` protection errors; rely on the last-fetched origin ref and re-fetch at build start. Plan-mode checks of live health work with plain curl.
- Every public page has a hand-written server-rendered body that duplicates (and can differ from) the React copy, so a claim fix must change both emitters; the React comparison pages also emit hand-written Review/AggregateRating schema client-side.

**Why:** these cost extra rounds during the preflight and are not visible from reading one file.
**How to apply:** when planning or building any public-content change, check both renderers, register suites in both rosters, and treat the legal pages (Terms, Privacy) as read-only evidence.
