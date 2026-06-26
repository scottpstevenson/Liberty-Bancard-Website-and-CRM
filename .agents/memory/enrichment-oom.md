---
name: Enrichment worker OOM crash
description: Why the Sunbiz enrichment worker exhausted the heap and the three guards that fix it
---

# Enrichment worker OOM crash

The server crashed with a JS heap OOM ~2 min after boot. Root cause was the Sunbiz
enrichment background worker, which cascaded into seo-audit "fetch failed" failures.

Three independent contributors, each needs its own guard:

1. **Overlapping scheduled runs.** The 10-min enrichment interval + daily-outreach
   both call the same heavy batch routine with no re-entrancy guard, so a slow batch
   (200 entities × external scrapes) overlapped the next tick and stacked memory.
   **Fix:** module-level running flags that skip (and log) overlapping runs —
   mirror the existing `massEnrichmentRunning` pattern. Guard the function itself,
   not just the interval, so every caller (interval, daily-outreach, manual API) is
   protected.

2. **Unbounded response parsing.** The per-entity scrapers buffered `response.text()`
   with no size cap, so a single huge scraped page could spike the heap.
   **Fix:** read bodies through a capped streaming reader (check content-length, then
   accumulate chunks and abort past the cap). 3 MB cap is plenty for HTML scraping.

3. **Auto-runs in dev.** Heavy Sunbiz enrichment ran on every boot including local dev.
   **Fix:** gate it behind `SUNBIZ_ENRICHMENT_ENABLED`, defaulting to
   `NODE_ENV === 'production'` so prod behavior is preserved but dev is quiet.

**Why:** this OOM recurred across multiple sessions; band-aids (heap-size bumps) were
explicitly rejected — the real fix is overlap guards + body caps + dev gating.

**How to apply:** any new external-scrape step in enrichment must use the capped reader,
and any new scheduled enrichment loop needs a re-entrancy flag.
