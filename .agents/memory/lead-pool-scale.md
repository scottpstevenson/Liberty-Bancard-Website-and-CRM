---
name: Lead Pool Scale
description: Scale and composition of the Liberty Bancard sunbiz entity lead pool as of August 2026.
---

# Lead Pool Scale

**As of August 12, 2026:**
- Total sunbiz entities: 1,919,454
- Enriched: 306,653 (16%)
- Pending enrichment: 968,080 (50%)
- Hot leads: 190,549
- Have email: 3,168 (critically low — SERPER_API_KEY missing, all Google search steps skipped)
- Have phone: 36,862

**Top verticals (enriched):** Other (706K), Construction (61K), Professional Services (46K), Real Estate (39K), Healthcare (22K)

**Key gap:** Email discovery rate is <0.2% because SERPER_API_KEY is not configured — Steps 2 and 13 (Google website search + Google email search) are skipped for every entity. This is the single highest-ROI fix available.

**Lead Ops Center:** /dashboard/lead-ops — page for bulk enrichment, AI segmentation, queue management, bulk select + enrich.

**Enrichment writeback:** Fixed August 12 — sunbiz-enrichment.ts now calls writebackEnrichmentToLinkedRecords() after each enrichment, writing ownerName/ownerEmail/ownerPhone to the linked prospect and contact tables. One-time backfill endpoint: POST /api/lead-ops/run-writeback.

**Why:** User wants end-to-end automated sales at million-lead scale: import → enrich → segment → outreach → close.
