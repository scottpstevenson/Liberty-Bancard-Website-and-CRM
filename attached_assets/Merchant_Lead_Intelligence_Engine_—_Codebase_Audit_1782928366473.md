Merchant Lead Intelligence Engine — Codebase Audit  
**Audit scope:** read-only, June 27 2026. No code changed.  
  
Executive Summary  
Liberty already has a **production-grade Merchant Lead Intelligence Engine** — it just needs API keys and one feature flag to turn on. The infrastructure is materially complete: multi-source discovery, Jaro-Winkler dedup, Serper/Outscraper/Apify/Apollo integrations, AI scoring with A/B/C/nurture priority buckets, a full payment-stack detector, processor-personalized email templates, a Wave 1A contactability gate, and a rich operator dashboard. Almost none of it has been activated because NIGHTLY_DISCOVERY_ENABLED defaults to false.  
  
1 · Lead / Prospect Discovery Infrastructure  
**Status: Fully built, not yet activated.**  
Core orchestrator  
server/services/sdr/lead-finder.ts (1073 lines)  
This is the discovery engine. It manages a configurable **Search Matrix**:  
* **Verticals:** auto repair, med spa, dental, chiropractic, restaurant, medical practice, construction (user-editable via lead_discovery_matrix system setting)  
* **Metros:** Miami, Fort Lauderdale, Tampa, Orlando, Jacksonville (user-editable)  
* **Sources:** outscraper, serper, osm, yellowpages, bbb  
* **Limits:** 200 results/search, $50 daily budget cap (configurable)  
* **Schedule:** nightly (currently blocked by NIGHTLY_DISCOVERY_ENABLED=false)  
Has in-memory run-guard (isDiscoveryRunning(), isNightlyDiscoveryRunning()) to prevent concurrent runs.  
Data sources wired in  

| Source | File | Free | Key Required | What it pulls |
| ------------- | ------------------------------------ | ---- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Outscraper | sdr/outscraper.ts | No | OUTSCRAPER_API_KEY | Google Maps bulk (~$0.002/biz) |
| Serper | serper.ts + sdr/serper-enrichment.ts | No | SERPER_API_KEY | Google Places search |
| Apify | sdr/apify.ts | No | APIFY_API_TOKEN | Yelp (apify/yelp-scraper), Facebook (apify/facebook-pages-scraper), Google Maps (compass/crawler-google-places) |
| Apollo | sdr/apollo.ts | No | APOLLO_API_KEY | B2B contacts — owner name, email, title |
| YellowPages | sdr/yellowpages-discovery.ts | Yes | None | YP.com scrape |
| OpenStreetMap | sdr/osm-discovery.ts | Yes | None | OSM business data |
| BBB | sdr/bbb-discovery.ts | Yes | None | BBB business listings |
| SUNBIZ | sunbiz-scraper.ts+ sunbiz-cron.ts | Yes | None | FL Division of Corporations (gated by SUNBIZ_ENRICHMENT_ENABLED) |
  
All 4 paid keys are in missing_secrets — none are currently set.  
Deduplication  
Two-pass dedup in lead-finder.ts:  
1. Exact normalize+hash match within batch (name|citykey)  
2. Exact normalize+hash match within batch (name|citykey)  
3. Exact normalize+hash match within batch (name|citykey)  
4. Jaro-Winkler fuzzy match (threshold 0.85) against existing DB records per city  
Chain-business blocklist (sdr/chain-blocklist.ts) filters out chains before insert.  
DB schema for discovered leads  
* sdr_merchants — the discovered business record  
* sdr_merchant_contacts — per-merchant owner contacts (owner name, email, title from Apollo)  
* sdr_lead_state — pipeline state: stage DISCOVERED → ENRICHED → SCORED → CONTACTED → REPLIED → CLOSED_WON, plus priorityBucket (A/B/C/nurture)  
* lead_discovery_jobs — job log (started/completed, counts, source/vertical/metro breakdown)  
* lead_discovery_results — per-business outcome log (inserted | duplicate_batch | duplicate_existing | error)  
  
2 · Google Places / Maps / Yelp / Apify / Scraping Integrations  
**Status: All wired, all dormant due to missing API keys.**  

| Integration | File | Method | Activated? |
| ----------------------------- | -------------------------------------------- | --------------------------------- | ---------------------------- |
| Google Places (via Serper) | sdr/lead-finder.ts→ serper.ts | POST /placesSerper API | No — SERPER_API_KEYunset |
| Google Maps bulk (Outscraper) | sdr/outscraper.ts | GET /maps/search-v3Outscraper API | No — OUTSCRAPER_API_KEYunset |
| Yelp | sdr/apify.ts → apify/yelp-scraper | Apify actor run-sync | No — APIFY_API_TOKENunset |
| Facebook Pages | sdr/apify.ts → apify/facebook-pages-scraper | Apify actor run-sync | No — APIFY_API_TOKENunset |
| Google Maps (alternate) | sdr/apify.ts → compass/crawler-google-places | Apify actor run-sync | No — APIFY_API_TOKENunset |
  
No Playwright, Puppeteer, or Cheerio is in the codebase. All scraping is API-based (Outscraper/Apify as managed scrapers), not headless-browser-based. Website HTML is fetched directly via fetch() with a custom LibertyBancardBot/1.0 User-Agent for the processor detector only.  
  
3 · Payment Stack Detection  
**Status: Fully built. Database table exists. Not called in production discovery flow.**  
server/services/sdr/processor-detector.ts (481 lines)  
server/services/sdr/processor-detector.ts (481 lines)  
Detection methods  
1. **HTML fetch** — fetches https://{domain}, scans script src tags, HTML body text, and meta tag content  
2. **HTML fetch** — fetches https://{domain}, scans script src tags, HTML body text, and meta tag content  
3. **HTML fetch** — fetches https://{domain}, scans script src tags, HTML body text, and meta tag content  
4. **HTML fetch** — fetches https://{domain}, scans script src tags, HTML body text, and meta tag content  
5. **HTML fetch** — fetches https://{domain}, scans script src tags, HTML body text, and meta tag content  
6. **HTML fetch** — fetches https://{domain}, scans script src tags, HTML body text, and meta tag content  
7. **Serper fallback** — if no website, searches "{businessName} payment processing" via Serper  
8. **Serper fallback** — if no website, searches "{businessName} payment processing" via Serper  
9. **Serper fallback** — if no website, searches "{businessName} payment processing" via Serper  
10. **Serper fallback** — if no website, searches "{businessName} payment processing" via Serper  
Processors covered with fingerprints  

| Vendor | Type | Confidence | Detection Method |
| --------- | --------- | ---------- | ------------------------------------------ |
| Square | processor | 0.85 | script src (squareup.com), HTML text, meta |
| Stripe | processor | 0.85 | js.stripe.com, stripe-elements, HTML |
| Toast | POS | 0.80 | toasttab.com, HTML text |
| Clover | POS | 0.80 | clover.com, HTML |
| Shopify | ecommerce | 0.90 | cdn.shopify.com, HTML |
| PayPal | processor | 0.80 | paypal.com/sdk, HTML |
| Mindbody | booking | 0.85 | mindbodyonline.com, healcode.com |
| Vagaro | booking | 0.85 | vagaro.com |
| Boulevard | booking | 0.80 | joinblvd.com |
| NCR/Aloha | POS | 0.75 | ncr.com |
  
What's missing from detection  
NMI, Authorize.net, WooCommerce, Lightspeed, ChowNow, DoorDash Storefront, Wix Payments, Squarespace Commerce, Jane, Fresha, Acuity, Square Appointments (as distinct from Square POS). These are all addable as new entries in the PROCESSOR_FINGERPRINTS array — structure is already generic.  
Processor-personalized email templates  
PROCESSOR_TEMPLATES in processor-detector.ts has ready-made cold email subject + body for Square, Stripe, Toast, Clover, PayPal, Shopify — each with {{first_name}}, {{company_name}}, {{vertical}}, {{city}} placeholders and a compliance disclaimer baked in.  
Conversion analytics  
getConversionByProcessor() and getProcessorDistribution() functions exist to measure win rate by detected processor — not currently surfaced in any dashboard.  
  
4 · AI Scoring, Vertical Classification, Volume Estimation  
**Status: Two complete scoring systems exist. Both functional.**  
System A — SDR scoring (server/services/sdr/scoring.ts, 659 lines)  
For discovered sdrMerchants → sdrLeadState.  
6-dimensional score:  
1. **Fit score** — vertical fit table (restaurant=25, healthcare=24, salon/spa=22, retail=20, auto=18, construction=12)  
2. **Fit score** — vertical fit table (restaurant=25, healthcare=24, salon/spa=22, retail=20, auto=18, construction=12)  
3. **Revenue score** — estimated volume/revenue indicators  
4. **Revenue score** — estimated volume/revenue indicators  
5. **Reachability score** — contact quality (verified_owner=20, owner=18, manager=14, web_form=6)  
6. **Reachability score** — contact quality (verified_owner=20, owner=18, manager=14, web_form=6)  
7. **Processor score** — detected processor + switchability  
8. **Processor score** — detected processor + switchability  
9. **Growth score** — review trajectory, booking signals  
10. **Growth score** — review trajectory, booking signals  
11. **Priority score** — composite → priorityBucket: "A" | "B" | "C" | "nurture"  
12. **Priority score** — composite → priorityBucket: "A" | "B" | "C" | "nurture"  
13. **Priority score** — composite → priorityBucket: "A" | "B" | "C" | "nurture"  
14. **Priority score** — composite → priorityBucket: "A" | "B" | "C" | "nurture"  
Vertical-specific boost configs:  
* FL_AUTO_BOOSTS — 6 signals: high Google rating, review count, independent owner, service menu, multi-bay, financing  
* FL_MEDSPA_BOOSTS — 6 signals: memberships, online booking, Instagram, review count, multi-provider, aesthetic services  
* FL_MEDICAL_BOOSTS — 6 signals: private practice, multiple providers, text-to-pay, review count, payment plans, private pay  
Uses OpenAI for AI-assisted intent classification.  
System B — Contact lead scoring (server/services/lead-scoring.ts, 426 lines)  
For CRM contacts (already in the pipeline, not discovery stage).  
* revPotential (0–30), switchability (0–25), uwConfidence (0–25), engagement (0–20)  
* Processor switchability map: square=22, stripe=20, clover=18, paypal=20, shopify=18, none/cash-only=25  
* Returns hot/warm/cold/unqualified tier  
* Vertical revenue multipliers applied  
Vertical classification  
classifyVertical() in lead-finder.ts — regex-based, runs at insert time on discovered businesses. AI-assisted reclassification available via enrichment.ts using GPT-5.  
Volume estimation  
server/services/sunbiz-cron.ts calls estimateFromProspect(), estimateFromContact(), estimateFromDeal() — these are called during the Sunbiz auto-promote loop.  
  
5 · CRM Routes for Accepting Discovered Leads  
**Status: Fully built. Multiple pathways.**  

| Route | File | What it does |
| ------------------------------- | ------------------- | ------------------------------------------------------------------------- |
| POST /api/prospects | routes/prospects.ts | Create prospect manually or from enrichment |
| POST /api/prospects/:id/promote | routes/prospects.ts | Promote prospect → Contact + GHL upsert |
| POST /api/contacts | routes/contacts.ts | Direct contact creation |
| CSV import | routes/imports.ts | Bulk CSV → prospects |
| Auto-promote (cron) | sunbiz-cron.ts | Auto-promotes enriched Sunbiz entities with score=hot/warm + contact info |
| SDR merchant → contact | sdr/dedupe.ts | ingestBusinessFromContact()bridges discovery record to CRM contact |
  
The canonical path for a discovered lead becoming a CRM opportunity is: sdr_merchants (DISCOVERED) → enrichment → scoring (priorityBucket=A) → sdrLeadState.stage=QUALIFIED → contacts record via createContactGhlFirst() → GHL sync → pipeline deal.  
  
6 · Operator Dashboard / Review Queue for A+ Leads  
**Status: Dashboard exists and is well-built. A dedicated "approval-gated outreach queue" is partially there.**  
What exists  
* client/src/pages/dashboard/sdr/DiscoveryDashboard.tsx— Full stats dashboard: today/week counts, dedup rates, by-vertical breakdown, by-metro breakdown, by-source breakdown, job history, source health indicators, run/stop controls  
* client/src/pages/dashboard/sdr/DiscoveryConfigCard.tsx— Search matrix config UI (verticals, metros, sources, schedule)  
* client/src/pages/dashboard/sdr/DiscoveryControlsPanel.tsx— Start/stop nightly scheduler  
* client/src/pages/dashboard/OperatorDashboard.tsx— Operator command center includes a Discovery Controls tab  
* client/src/pages/dashboard/ReviewQueue.tsx — A review queue page exists  
* client/src/pages/dashboard/ColdLeads.tsx — Cold leads list  
* review_queue table in DB schema with insert/select types  
What's missing  
There is no dedicated **"Priority A / A+ leads pending first-contact approval"** screen. The priorityBucket field exists on sdr_lead_state and is indexed, but there is no UI surface that shows: "Here are the 12 newly discovered A-bucket leads. Approve each for outreach, reassign, or discard." ORCHESTRATOR_REVIEW_MODE flag exists precisely for this but is defaulted to false and has no connected UI gate.  
  
7 · Feature Flags for Discovery / SDR / Enrichment  
All flags in server/services/feature-flags.ts — runtime env vars, JS getters (changes take effect immediately without restart):  

| Flag | Default | Meaning |
| ------------------------- | ------------ | --------------------------------------- |
| SDR_ENABLED | true | SDR system is active |
| ORCHESTRATOR_ENABLED | false | Autonomous outreach orchestrator runs |
| LEGACY_OUTREACH_ENABLED | false | Old daily-outreach path |
| SUNBIZ_ENRICHMENT_ENABLED | true (prod) | SUNBIZ scraping and enrichment |
| VOICE_AI_ENABLED | false | AI voice calls |
| SMS_ENABLED | false | SMS outreach |
| RINGLESS_VM_ENABLED | false | Ringless voicemail drops |
| NIGHTLY_DISCOVERY_ENABLED | false | Nightly multi-source discovery job |
| ORCHESTRATOR_BATCH_SIZE | 25 (max 500) | How many leads per orchestrator cycle |
| ORCHESTRATOR_REVIEW_MODE | false | Human-review gate before first outreach |
  
The critical gate is NIGHTLY_DISCOVERY_ENABLED=false. Everything else in the pipeline would run normally once API keys are added and this flag is enabled.  
  
8 · Outbound Safeguards Connected to Discovered Leads  
**Status: World-class safeguards built (Wave 1A). Partial gap at the SDR→contact bridge.**  
What's fully built  
server/services/contactability.ts (1206 lines) — The canonical permission gate.  
Every outbound send must call evaluateContactability({ contactId, channel, mode })which enforces:  
* **Consent tier:** cold_no_consent → email only (no direct sales pitch), warm_no_pewc → email + manual call, pewc_full_automation → all channels, opted_out / do_not_contact → hard block  
* **Channel eligibility:** 5 channels gated independently (email, manual_call, sms, voice_ai, ringless_vm)  
* **Business hours:** isWithinBusinessHours() with timezone awareness  
* **DNC/opt-out:** doNotAutoContact flag check  
* **CAN-SPAM footer:** enforced on email sends  
* **Sequence eligibility:**server/services/sequence-eligibility.ts — checks enrollment prerequisites  
* **PEWC consent evidence:**server/services/consent-evidence.ts tracks audit trail  
SDR-specific layer: server/services/sdr/compliance-engine.ts — quiet hours, suppression list, rate limiting per domain.  
The gap  
The contactability engine operates on contacts table records (keyed by contactId: number). Discovered sdrMerchants live in a separate table. The bridge is ingestBusinessFromContact() in sdr/dedupe.ts and the createContactGhlFirst() promotion path — **safeguards only activate once a discovered merchant has been promoted to a CRM contact**. Before that transition, the SDR outreach path uses its own simpler compliance checks in sdr/compliance-engine.ts, not the full Wave 1A gate. This is architecturally intentional (cold discovery leads get lighter handling) but should be explicitly documented as the boundary.  
  
What Already Exists (Summary)  

| Component | Exists | Quality |
| ------------------------------ | ------ | ---------------------------------------------- |
| Multi-source discovery engine | ✅ | Production-grade |
| Outscraper (Google Maps) | ✅ | Full integration, cost tracking |
| Apify (Yelp, Facebook, G-Maps) | ✅ | Full integration, cost tracking |
| Serper (Google Places) | ✅ | Full integration |
| Apollo.io (B2B contacts) | ✅ | Full integration, owner data merge |
| Free sources (YP, OSM, BBB) | ✅ | Wired, no keys needed |
| SUNBIZ entity import | ✅ | Full scraper + cron |
| Jaro-Winkler dedup | ✅ | Production-grade |
| Chain-business blocklist | ✅ | Exists |
| Payment stack detector | ✅ | 10 processors, HTML + Serper |
| Processor email templates | ✅ | Square, Stripe, Toast, Clover, PayPal, Shopify |
| AI scoring (A/B/C/nurture) | ✅ | 6-dimensional, vertical boosts |
| Vertical classification | ✅ | Regex + AI |
| Volume estimation | ✅ | Wired to Sunbiz cron |
| CRM lead creation routes | ✅ | Multiple pathways |
| Discovery dashboard UI | ✅ | Full operator dashboard |
| Nightly job scheduler | ✅ | BullMQ discoveryqueue |
| Contactability gate | ✅ | 1206-line Wave 1A engine |
| DNC / opt-out / quiet hours | ✅ | Fully wired |
| PEWC consent audit trail | ✅ | Evidence tiers |
| Feature flags | ✅ | All gated, JS getters |
  
What Is Partially Built but Unused  

| Component | Status | Gap |
| ------------------------------ | -------------------------------------- | ---------------------------------------------- |
| Nightly discovery | Built, NIGHTLY_DISCOVERY_ENABLED=false | Just a flag flip + API keys |
| ORCHESTRATOR_REVIEW_MODE | Flag exists, no UI | No approval-gated queue screen |
| Processor conversion analytics | Functions built, not surfaced | getConversionByProcessor()not in any dashboard |
| review_queue table | Schema exists, page exists | Not connected to discovery A-bucket flow |
| Apollo owner-level contacts | Wired in lead-finder | Apollo key absent |
| Apify Google Maps actor | Wired in apify.ts | Apify key absent |
  
What Is Missing  

| Gap | Severity | Notes |
| ----------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| Missing processor fingerprints | Medium | NMI, Authorize.net, WooCommerce, Lightspeed, ChowNow, DoorDash Storefront, Wix Payments, Squarespace Commerce, Jane, Fresha |
| A-bucket approval queue UI | Medium | No screen to review/approve new A leads before first outreach. ORCHESTRATOR_REVIEW_MODEhas no frontend |
| Contactability bridge documentation | Low | Needs explicit note that Wave 1A only activates post-promotion |
| No Playwright/Puppeteer/Cheerio | N/A | By design — all scraping is API-managed |
  
API Keys Needed (All in missing_secrets)  

| Secret             | Source         | Purpose                              |
| ------------------ | -------------- | ------------------------------------ |
| OUTSCRAPER_API_KEY | outscraper.com | Google Maps bulk discovery           |
| APIFY_API_TOKEN    | apify.com      | Yelp + Facebook + G-Maps scraping    |
| SERPER_API_KEY     | serper.dev     | Google Places discovery + enrichment |
| APOLLO_API_KEY     | apollo.io      | Owner-level B2B contact data         |
  
Safest MVP Activation Plan  
**Phase 1 — No-cost discovery (immediately safe)**  
1. Add SERPER_API_KEY to Replit Secrets (Serper has a free tier: 2,500 searches/month)  
2. Add SERPER_API_KEY to Replit Secrets (Serper has a free tier: 2,500 searches/month)  
3. Add SERPER_API_KEY to Replit Secrets (Serper has a free tier: 2,500 searches/month)  
4. Set NIGHTLY_DISCOVERY_ENABLED=true — sources without keys auto-skip gracefully  
5. Set NIGHTLY_DISCOVERY_ENABLED=true — sources without keys auto-skip gracefully  
6. Set NIGHTLY_DISCOVERY_ENABLED=true — sources without keys auto-skip gracefully  
7. Free sources (YellowPages, OSM, BBB) will run immediately  
8. Validate first job completes in DiscoveryDashboard → review stats  
**Phase 2 — Enable paid sources** 5. Add OUTSCRAPER_API_KEY — enables Google Maps bulk (highest quality source)  
9. Add APIFY_API_TOKEN — enables Yelp (best for restaurants/spas)  
10. Add APIFY_API_TOKEN — enables Yelp (best for restaurants/spas)  
11. Add APIFY_API_TOKEN — enables Yelp (best for restaurants/spas)  
12. Monitor outscraper_usage and apify_usage system settings for cost tracking  
13. Monitor outscraper_usage and apify_usage system settings for cost tracking  
14. Monitor outscraper_usage and apify_usage system settings for cost tracking  
15. Monitor outscraper_usage and apify_usage system settings for cost tracking  
16. Monitor outscraper_usage and apify_usage system settings for cost tracking  
**Phase 3 — Enable owner-level data** 8. Add APOLLO_API_KEY — enriches discovered merchants with owner names + verified emails  
**Phase 4 — Enable orchestrator (gated)** 9. Set ORCHESTRATOR_REVIEW_MODE=true first  
**Phase 4 — Enable orchestrator (gated)** 9. Set ORCHESTRATOR_REVIEW_MODE=true first  
17. Set ORCHESTRATOR_ENABLED=true  
18. Set ORCHESTRATOR_ENABLED=true  
19. Set ORCHESTRATOR_ENABLED=true  
20. Build or wire the existing ReviewQueue.tsx page to sdr_lead_state where priorityBucket='A' and stage='SCORED' — this gives the human-approval gate before first automated contact  
21. Build or wire the existing ReviewQueue.tsx page to sdr_lead_state where priorityBucket='A' and stage='SCORED' — this gives the human-approval gate before first automated contact  
22. Build or wire the existing ReviewQueue.tsx page to sdr_lead_state where priorityBucket='A' and stage='SCORED' — this gives the human-approval gate before first automated contact  
23. Build or wire the existing ReviewQueue.tsx page to sdr_lead_state where priorityBucket='A' and stage='SCORED' — this gives the human-approval gate before first automated contact  
24. Build or wire the existing ReviewQueue.tsx page to sdr_lead_state where priorityBucket='A' and stage='SCORED' — this gives the human-approval gate before first automated contact  
25. Build or wire the existing ReviewQueue.tsx page to sdr_lead_state where priorityBucket='A' and stage='SCORED' — this gives the human-approval gate before first automated contact  
26. Build or wire the existing ReviewQueue.tsx page to sdr_lead_state where priorityBucket='A' and stage='SCORED' — this gives the human-approval gate before first automated contact  
27. Build or wire the existing ReviewQueue.tsx page to sdr_lead_state where priorityBucket='A' and stage='SCORED' — this gives the human-approval gate before first automated contact  
28. Build or wire the existing ReviewQueue.tsx page to sdr_lead_state where priorityBucket='A' and stage='SCORED' — this gives the human-approval gate before first automated contact  
**Phase 5 — Extend processor detection** 12. Add NMI, Authorize.net, WooCommerce, Lightspeed to PROCESSOR_FINGERPRINTS array in processor-detector.ts (30 min work — structure is generic)  
29. Surface getConversionByProcessor() in the DiscoveryDashboard or OperatorDashboard  
30. Surface getConversionByProcessor() in the DiscoveryDashboard or OperatorDashboard  
31. Surface getConversionByProcessor() in the DiscoveryDashboard or OperatorDashboard  
The system is not "being built" — it is built. The gap between current state and a live Merchant Lead Intelligence Engine is: **4 API keys in Replit Secrets + 1 env flag flip + one review-queue UI wiring**  
  
  
  
  
  
Task #686 — Updated Handoff Plan (Addendum Applied)  
  
Updated Preflight Findings  
Dedup path (Addendum #1)  
storage.getContactByEmail(email) exists and is the canonical lookup used throughout the codebase (routes/contacts.ts:67, routes/imports.ts:818, routes/partners.ts:93, etc.). **There is no getContactByPhone method in the storage interface** — confirmed by grep across all of storage.ts. findDuplicateContacts() exists but is a batch scan, not a per-lookup tool.  
createContactGhlFirst() has **zero internal dedup** — it calls storage.createContact() unconditionally. Every caller in the codebase that wants dedup calls getContactByEmail() first, manually. This means a dedup layer must be written into the new promote route.  
**Available dedup identifiers on an SDR merchant record:**  
* sdr_lead_state.ownerEmail → look up via getContactByEmail()  
* sdr_lead_state.email (denormalized copy) → look up via getContactByEmail()  
* sdr_merchants.mainEmail → look up via getContactByEmail()  
* Phone / domain / name+city → **no existing storage method**; these require raw Drizzle queries  
DEDUPED / CLASSIFIED scoring (Addendum #3)  
orchestrator.ts:1012 confirms scoreLeadFull() is called for both DEDUPED and CLASSIFIED stages and sets lastScoredAt. However the orchestrator is currently **disabled** (ORCHESTRATOR_ENABLED=false), so leads at those stages only have scoring if a manual re-score (POST /api/sdr/leads/:id/score) ran. Safe gate: include DEDUPED and CLASSIFIED only when lastScoredAt IS NOT NULL. stage-rules.ts:405–407 confirms valid forward transitions ENRICHED → DEDUPED → CLASSIFIED → QUALIFIED.  
Suppression language (Addendum #2)  
No human_suppressed or internal_suppressionconstants exist anywhere in the codebase today. reply-intelligence.ts uses coolingUntil + suppressDays for reply-intent suppression — completely separate from human-triggered suppression. The distinction must be enforced in the new event payload: notes: "human_suppressed — internal not-a-fit decision, not a merchant DNC/opt-out request".  
Query param format (Addendum #6)  
Current GET /api/sdr/leads at sdr.ts:1290 accepts only single-value ?stage=X&priorityBucket=Y. The chosen format for the new queue filter is **comma-separated**because it requires zero Express middleware change and parses cleanly with a .split(","):  
GET /api/sdr/leads?stages=ENRICHED,SCORED,QUALIFIED,DEDUPED,CLASSIFIED&priorityBuckets=A,B&excludeStages=DEAD,CONVERTED,NURTURE,OUTREACH_EMAIL,OUTREACH_SMS,OUTREACH_CALL,OUTREACH_CHAT  
  
  
1 — Files to Change  
Backend  

| File | Action |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| server/routes/sdr.ts | Add 3 routes after line 1344: POST /api/sdr/leads/:id/promote, /discard, /suppress |
| server/storage.ts | Extend getSdrLeadStatesinterface signature; add SdrLeadStateWithMerchantreturn type |
| server/storage/sdr-leads.ts(or wherever getSdrLeadStates is implemented) | Extend query: inArray() multi-value, LEFT JOINs for merchant + processor |
  
Frontend  

| File | Action |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| client/src/pages/dashboard/sdr/DiscoveredLeadQueue.tsx | Create new — full queue page |
| client/src/App.tsx | Add lazy import + protected route at /dashboard/sdr/review-queue |
| client/src/pages/dashboard/sdr/DiscoveryDashboard.tsx | Add "A-Lead Queue" nav link/tab |
  
2 — Exact Lines / Sections  
server/routes/sdr.ts — insert after line 1344  
**Route 1 — Promote (with dedup)**  
POST /api/sdr/leads/:id/promote  
Guard: isDashboardUser + requireRole("admin","manager")  
  
Step 1 — Fetch lead + merchant  
getSdrLeadState(id) → 404 if missing  
Guard: if lead.contactId already set → 400 "Already promoted — linked to contact #X"  
Guard: if lead.stage === "CONVERTED" → 400 "Already promoted"  
Fetch sdrMerchants row for lead.merchantId  
  
Step 2 — Dedup (ordered by confidence)  
Collect candidate emails: [lead.ownerEmail, lead.email, merchant.mainEmail].filter(Boolean)  
For each email: existingContact = await storage.getContactByEmail(email)  
If found → LINK path (do not create):  
updateSdrLeadState(id, { contactId: existingContact.id, stage: "CONVERTED",  
statusReason: "promoted_linked_existing" })  
Write sdrLeadEvent: eventType="human_promoted_linked", actorType="human"  
Return { contact: existingContact, action: "linked", leadState }  
If not found → CREATE path:  
createContactGhlFirst({  
firstName: lead.ownerName?.split(" ")[0] || merchant.ownerFirstName || "",  
lastName: lead.ownerName?.split(" ").slice(1).join(" ") || merchant.ownerLastName || "",  
email: lead.ownerEmail || lead.email || merchant.mainEmail || undefined,  
phone: lead.ownerPhone || merchant.mainPhone || undefined,  
companyName: lead.companyName || merchant.businessName,  
vertical: lead.vertical || merchant.vertical || undefined,  
city: lead.city || merchant.city || undefined,  
state: lead.state || merchant.state || undefined,  
sourceCategory: "sdr_discovery",  
source: merchant.source || "sdr_discovery",  
processorDetected: detectedProcessor || undefined,  
// Preserve attribution  
notes: JSON.stringify({  
sdrMerchantId: merchant.id,  
priorityBucket: lead.priorityBucket,  
priorityScore: lead.priorityScore,  
scoreBreakdown: lead.scoreBreakdown,  
suggestedPitch: (lead.enrichmentData as any)?.suggestedPitch || null,  
}),  
}, { actorType: "human", actorId: String(req.user.id) })  
  
Step 3 — Update SDR state  
updateSdrLeadState(id, {  
contactId: newContact.id,  
stage: "CONVERTED",  
statusReason: "human_promoted",  
updatedAt: new Date()  
})  
Insert sdrLeadEvent: eventType="human_promoted_created", fromStage=lead.stage,  
toStage="CONVERTED", actorType="human", actorId=req.user.id,  
payloadJson: { contactId: newContact.id, sdrMerchantId: merchant.id }  
  
Step 4 — Explicit safety checks (no outreach)  
DO NOT call: autoEnrollFromTrigger, enrollInGhlWorkflow, sequenceWorker,  
scoreContact, sendEmail, sendSms, voice/ringless paths  
  
Return { contact, action: "created", leadState }  
  
**Route 2 — Discard**  
POST /api/sdr/leads/:id/discard  
Guard: requireRole("admin","manager")  
Body: { reason?: string }  
  
1. getSdrLeadState(id) → 404  
2. Guard: stage already DEAD or CONVERTED → 400  
3. updateSdrLeadState(id, { stage: "DEAD", statusReason: body.reason || "human_discarded" })  
4. Insert sdrLeadEvent: eventType="human_discarded", actorType="human", actorId=req.user.id,  
payloadJson: { reason: body.reason || "human_discarded" },  
decisionReason: "Removed from active queue by human reviewer — not a legal DNC/opt-out"  
5. Return { success: true }  
  
**Route 3 — Suppress**  
POST /api/sdr/leads/:id/suppress  
Guard: requireRole("admin","manager")  
Body: { reason?: string }  
  
1. getSdrLeadState(id) + sdr_merchants row → 404  
2. Guard: already suppressed (doNotContactFlag=true) → 400  
3. updateSdrLeadState(id, { stage: "DEAD", statusReason: body.reason || "human_suppressed" })  
4. db.update(sdrMerchants).set({ doNotContactFlag: true }).where(eq(sdrMerchants.id, lead.merchantId))  
5. db.insert(sdrComplianceState)  
.values({ merchantId: lead.merchantId, dncBlock: true,  
notes: "human_suppressed — internal not-a-fit decision; NOT a merchant DNC/opt-out request" })  
.onConflictDoUpdate({ target: [sdrComplianceState.merchantId],  
set: { dncBlock: true, updatedAt: new Date(),  
notes: "human_suppressed — internal not-a-fit" } })  
6. Insert sdrLeadEvent: eventType="human_suppressed", actorType="human", actorId=req.user.id,  
payloadJson: { reason: body.reason || "human_suppressed",  
suppressionType: "internal_not_a_fit",  
isLegalDnc: false,  
isMerchantRequested: false }  
7. Return { success: true }  
  
server/storage.ts — extend interface at line 600  
// New return type (alongside existing SdrLeadState)  
export interface SdrLeadStateWithMerchant extends SdrLeadState {  
merchantSource?: string | null;  
merchantDomain?: string | null;  
detectedProcessor?: string | null;  
processorConfidence?: number | null;  
processorMethod?: string | null;  
}  
  
// Extended interface signature  
getSdrLeadStates(filters?: {  
stage?: string; // backward compat — single value  
stages?: string[]; // new: comma-split inArray  
priorityBucket?: string; // backward compat  
priorityBuckets?: string[]; // new: comma-split inArray  
excludeStages?: string[]; // new: NOT IN  
requireScored?: boolean; // new: lastScoredAt IS NOT NULL guard  
limit?: number;  
offset?: number;  
}): Promise<SdrLeadStateWithMerchant[]>;  
  
server/routes/sdr.ts — extend existing GET /api/sdr/leads at line 1288  
The existing route handles single values. Extend query parameter parsing to support comma-separated lists while preserving backward compat:  
// line 1290 area — replace the filter extraction block  
const stagesParam = req.query.stages as string | undefined;  
const stageParam = req.query.stage as string | undefined;  
const bucketsParam = req.query.priorityBuckets as string | undefined;  
const bucketParam = req.query.priorityBucket as string | undefined;  
const excludeParam = req.query.excludeStages as string | undefined;  
const requireScored = req.query.requireScored === "true";  
  
const leads = await storage.getSdrLeadStates({  
stage: stageParam,  
stages: stagesParam ? stagesParam.split(",").map(s => s.trim()) : undefined,  
priorityBucket: bucketParam,  
priorityBuckets: bucketsParam ? bucketsParam.split(",").map(s => s.trim()) : undefined,  
excludeStages: excludeParam ? excludeParam.split(",").map(s => s.trim()) : undefined,  
requireScored,  
limit: limit ? parseInt(limit as string) : undefined,  
});  
  
Storage implementation query (wherever getSdrLeadStates is implemented)  
// Drizzle query additions  
.leftJoin(sdrMerchants, eq(sdrLeadState.merchantId, sdrMerchants.id))  
.leftJoin(  
// Sub-select: highest-confidence processor signal per businessId  
db.select({  
businessId: processorSignals.businessId,  
vendorName: processorSignals.vendorName,  
confidenceScore: processorSignals.confidenceScore,  
detectionMethod: processorSignals.detectionMethod,  
})  
.from(processorSignals)  
.orderBy(desc(processorSignals.confidenceScore))  
.as("best_processor"),  
eq(sdrMerchants.businessId, sql`best_processor.business_id`)  
)  
  
// WHERE conditions (additive with existing)  
if (filters.stages?.length) conditions.push(inArray(sdrLeadState.stage, filters.stages))  
if (filters.priorityBuckets?.length) conditions.push(inArray(sdrLeadState.priorityBucket, filters.priorityBuckets))  
if (filters.excludeStages?.length) conditions.push(notInArray(sdrLeadState.stage, filters.excludeStages))  
if (filters.requireScored) conditions.push(isNotNull(sdrLeadState.lastScoredAt))  
  
client/src/App.tsx (lines ~137 and ~462)  
// line ~137  
const DiscoveredLeadQueue = lazy(() => import("@/pages/dashboard/sdr/DiscoveredLeadQueue"));  
  
// line ~462 (after /dashboard/review-queue route)  
<Route path="/dashboard/sdr/review-queue">  
<ProtectedRoute component={DiscoveredLeadQueue} allowedRoles={["admin", "manager"]} />  
</Route>  
  
  
3 — Confirmed Patterns to Reuse  

| Pattern | Source location | Reuse in |
| ----------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------ |
| getContactByEmail() dedup before create | routes/imports.ts:818, routes/contacts.ts:67 | Promote route step 2 |
| createContactGhlFirst() with auditCtx | services/contact-writer.ts:17 | Promote route step 2 CREATE path |
| sdrLeadEvents insert fields: fromStage, toStage, actorType, payloadJson | orchestrator.ts:1008–1038 | All 3 action routes |
| inArray() + notInArray() from drizzle-orm | Throughout storage layer | Multi-stage filter |
| isDashboardUser + requireRole("admin","manager") | review-queue.ts:9, sdr.ts:1331 | All 3 routes |
| storage.createAuditLog() | review-queue.ts:89 | All 3 routes |
| Badge component pattern (colored, with icon) | DiscoveryDashboard.tsxsource/status badges | Priority + processor badges |
| useQuery + useMutation + apiRequest + queryClient.invalidateQueries | DiscoveryDashboard.tsx:57–80 | Queue page data layer |
| Dialog confirm-before-action | ReviewQueue.tsx:10,172 | Promote and Suppress confirm dialogs |
| ScrollArea + Table layout | ReviewQueue.tsx:12–13 | Main queue table |
| useToast feedback after mutation | Standard — all SDR dashboard pages | Post-action feedback |
  
4 — Prompt Assumptions That Are Wrong (Updated)  

| Assumption | Reality |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "ReviewQueue.tsx is already meant for SDR leads" | Confirmed wrong. Existing ReviewQueue is for RFIs, quizzes, dead-letter jobs. The review_queue table's sourceType enum (`"rfi" |
| "ORCHESTRATOR_REVIEW_MODE has existing UI/queue behavior" | It only console-logs skipped leads. No queue is written, no leads surface to any screen. |
| "POST /api/prospects/:id/promote is the canonical path for SDR merchants" | That promotes prospects table rows. No existing route promotes sdr_lead_state records. |
| "Processor stack is attached to SDR merchant records before scoring" | No processorDetected column on sdr_merchants or sdr_lead_state. Must join via sdr_merchants.businessId → processorSignals.businessId. |
| "createContactGhlFirst() will dedup automatically" | Confirmed — it has zero internal dedup. All callers must check getContactByEmail() first. |
| "getContactByPhone exists" | Confirmed absent from storage interface. Dedup by phone requires a raw Drizzle query. For this task, email-only dedup is the implementable path. |
| "DEDUPED and CLASSIFIED are unscored raw stages" | Partially wrong. orchestrator.ts:1012confirms scoring runs for both. BUT with ORCHESTRATOR_ENABLED=false, these stages only have scoring if a manual re-score ran. Safe gate: requireScored=true (filter lastScoredAt IS NOT NULL). |
  
5 — Missing Routes / Assets / Helpers  

| What | Status |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| POST /api/sdr/leads/:id/promote | Does not exist — must be created |
| POST /api/sdr/leads/:id/discard | Does not exist — must be created |
| POST /api/sdr/leads/:id/suppress | Does not exist — must be created |
| getSdrLeadStates multi-value filters + LEFT JOINs | Not implemented — must be extended |
| DiscoveredLeadQueue.tsx | Does not exist — must be created |
| /dashboard/sdr/review-queueroute in App.tsx | Not registered — must be added |
| getContactByPhone in storage | Does not exist — phone dedup is out of scope; document as a follow-up gap |
  
6 — Kill-Line Risk Assessment  

| Risk | Source | Mitigation |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Promote blindly creates duplicate contacts | createContactGhlFirst() has no dedup; double-clicking promote creates 2 contacts | Dedup by email via getContactByEmail()before any create; 400 guard if already CONVERTED |
| Suppress recorded as legal DNC | sdrComplianceState.dncBlockis also used by the compliance engine for all outbound blocking | Event payload MUST include suppressionType: "internal_not_a_fit", isLegalDnc: false, isMerchantRequested: false; notes field on sdrComplianceState must be explicit |
| Queue shows unscored raw discovery records as A/B | DISCOVERED stage has default priorityBucket="C" but a bug could set A/B without scoring | Add requireScored=true to default queue filter; UI documents "Scored leads only" in header |
| Processor badge shows fabricated/inferred data | enrichmentData JSONB may contain processor hints not from processorSignals table | Queue joins ONLY from processorSignals table; if join returns null → badge shows "Unknown / not yet detected"; no inference from raw JSONB |
| Promote triggers GHL workflow | Existing ReviewQueue.tsxapprove path calls enrollInGhlWorkflow() — must not copy | New promote route must NOT import or call enrollInGhlWorkflow, autoEnrollFromTrigger, any sequence or outreach service |
| Same merchant promoted twice | No idempotency guard on current flow | Guard: if lead.contactId !== null → 400 "Already promoted"; if lead.stage === 'CONVERTED' → 400— checked before any create/link |
| doNotContactFlag suppression doesn't prevent re-discovery | lead-finder.ts dedup only checks name+city hash; doesn't query doNotContactFlag | Document as follow-up gap; suppress sets the flag and blocks sends; re-discovery prevention requires a separate task |
  
7 — Final Scoped Implementation Checklist  
Backend  
*  **B1.** Locate and confirm the file implementing getSdrLeadStates; extend it with: inArray/notInArray multi-value stage/bucket filters, requireScored (lastScoredAt IS NOT NULL), LEFT JOIN sdrMerchants for source/domain, LEFT JOIN processorSignals (highest confidence per businessId) for detectedProcessor/processorConfidence  
*  **B2.** Extend IStorage.getSdrLeadStates interface in storage.ts with new filter params and SdrLeadStateWithMerchant return type  
*  **B3.** Extend existing GET /api/sdr/leads route (line 1288–1300) to parse comma-separated stages, priorityBuckets, excludeStages, requireScoredparams — backward compat with single-value params preserved  
*  **B4.** Add POST /api/sdr/leads/:id/promote in sdr.ts after line 1344:  
    *  Fetch lead + merchant record  
    *  Guard: already CONVERTED or contactId set → 400  
    *  Dedup: getContactByEmail() against ownerEmail, lead.email, mainEmail (in priority order)  
    *  If existing found → link, update stage to CONVERTED, write linked event  
    *  If not found → createContactGhlFirst() with all attribution fields preserved  
    *  Update sdrLeadState: stage=CONVERTED, contactId, statusReason="human_promoted"  
    *  Write sdrLeadEvents row with actorType="human"  
    *  **No calls to**: enrollInGhlWorkflow, autoEnrollFromTrigger, any sequence/outreach service  
*  **B5.** Add POST /api/sdr/leads/:id/discard:  
    *  Guard: already DEAD/CONVERTED → 400  
    *  Set stage=DEAD, statusReason="human_discarded"  
    *  Write event with decisionReason: "not a legal DNC — internal reviewer decision"  
*  **B6.** Add POST /api/sdr/leads/:id/suppress:  
    *  Set stage=DEAD, statusReason="human_suppressed"  
    * db.update(sdrMerchants).set({ doNotContactFlag: true })  
    *  Upsert sdrComplianceState: dncBlock=true, notes clarifying internal suppression (NOT legal DNC)  
    *  Write event with payloadJson: { suppressionType: "internal_not_a_fit", isLegalDnc: false, isMerchantRequested: false }  
*  **B7.** All 3 routes: isDashboardUser + requireRole("admin","manager"), storage.createAuditLog() after each action  
Frontend  
*  **F1.** Create client/src/pages/dashboard/sdr/DiscoveredLeadQueue.tsx  
*  **F2.** Query URL: /api/sdr/leads?stages=ENRICHED,SCORED,QUALIFIED,DEDUPED,CLASSIFIED&priorityBuckets=A,B&excludeStages=DEAD,CONVERTED,NURTURE,OUTREACH_EMAIL,OUTREACH_SMS,OUTREACH_CALL,OUTREACH_CHAT&requireScored=true— refetch every 30s  
*  **F3.** Table columns (fast-scan layout): Business Name | Vertical | City | Detected Stack | Priority | Score | Source | Owner | Last Scored | Actions  
*  **F4.** Priority badges: A = bg-green-100 text-green-800, B = bg-amber-100 text-amber-800  
*  **F5.** Processor badges (from detectedProcessorfield only — no inference):  
    * Square → slate badge  
    * Toast → orange badge  
    * Clover → green badge  
    * Stripe → indigo badge  
    * Shopify → emerald badge  
    * null → gray badge "Unknown / not yet detected" — **never blank, never throws**  
*  **F6.** Three action buttons per row — no outreach buttons anywhere:  
    * **Promote** (green) — confirm dialog: "Create CRM contact for {businessName}?"  
    * **Discard** (amber) — confirm dialog: "Remove from review queue?"  
    * **Suppress** (red) — confirm dialog: "Mark {businessName} as internal suppressed? This is NOT a legal DNC/opt-out."  
*  **F7.** View Details — slide-out sheet showing: all score dimensions with labels, scoreBreakdown JSONB as readable rows, detected processor evidence if present, owner contact fields, stage history link, compliance state if present  
*  **F8.** Suppress dialog must show: "This marks the merchant as internally suppressed — not a legal opt-out or DNC request."  
*  **F9.** Empty state: "No high-priority scored leads pending review. Run discovery and enrichment, then use the Score button on individual leads to populate this queue."  
*  **F10.** Page header note: "Showing scored A/B priority leads only. Leads without a scoring timestamp are excluded."  
*  **F11.**queryClient.invalidateQueries({ queryKey: ["/api/sdr/leads"] })after every mutation  
*  **F12.** Register lazy import + ProtectedRoute in App.tsx (allowedRoles: ["admin","manager"])  
*  **F13.** Add "A-Lead Queue" tab or link in DiscoveryDashboard.tsx  
  
8 — Validation Plan  
Automated  
npx tsc --noEmit --skipLibCheck  
npx tsx scripts/smoke-role-guards.ts  
  
Functional (manual, test data required)  

| Check | Pass condition |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Page loads at /dashboard/sdr/review-queue | 200, no JS errors, table renders |
| Query only returns priorityBucket A/B, stage in allowed set, lastScoredAt IS NOT NULL | Inspect via network tab — no C/nurture/DEAD/CONVERTED rows |
| Processor "Unknown" renders when join returns null | Gray badge visible, no crash, no blank cell |
| Promote dedup — email match found | Returns 200, action="linked", no new contact row created |
| Promote dedup — no email match | Returns 200, action="created", new contact appears in /dashboard/contacts |
| Promote guard — double promote same lead | Second call returns 400 "Already promoted" |
| Promoted lead disappears from queue | stage=CONVERTED excluded from query |
| Promote → no sequence enrollment | sequence_enrollments count unchanged; no email in audit log |
| Promote → no GHL workflow enrollment | ghl_workflow_enrollments count unchanged |
| Discard → lead removed from queue | stage=DEAD, statusReason="human_discarded" in DB |
| Suppress → lead removed, flags set | doNotContactFlag=true on sdr_merchants; dncBlock=true on sdrComplianceState; event payload has isLegalDnc=false |
| sdrLeadEvents audit trail | Row per action with actorType="human", correct actorId |
| Agent role cannot access any new route | 403 on all 3 POST routes for agent-role user |
| Existing DiscoveryDashboard loads | No regression |
| Existing ReviewQueue (/dashboard/review-queue) loads | No regression — completely separate table and routes |
| Feature flags unchanged | NIGHTLY_DISCOVERY_ENABLED=false, ORCHESTRATOR_ENABLED=falseconfirmed |
| No Replit Secrets added | Env count unchanged |
| companyName preserved on promoted contact | contacts.companyName = original businessName |
| Source attribution preserved | contacts.sourceCategory = "sdr_discovery" |
  
9 — Known Gaps for Follow-Up Tasks  

| Gap | Severity | Recommended task |
| ------------------------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phone-only dedup path missing — getContactByPhone not in storage interface | Medium | Add getContactByPhone(phone)to storage and incorporate in promote dedup chain |
| doNotContactFlag on sdr_merchants not checked in lead-finder.ts insert guard | Medium | "Discovery Suppress Guard — filter doNotContactFlag=truemerchants from re-insert" |
| Processor signals join only works if sdr_merchants.businessIdis set | Medium | "Processor Detector Wiring — run detectProcessors()during enrichment, store to processorSignals, ensure businessId FK is set on all enriched merchants" |
| Missing processor fingerprints: NMI, Authorize.net, WooCommerce, Lightspeed, ChowNow | Medium | "Processor Fingerprint Expansion" |
| ORCHESTRATOR_REVIEW_MODElogs skipped leads but no UI surfaces them | Low | Wire skippedSends count to operator dashboard |
| No API keys set — discovery sources all dormant | Blocking for full queue population | "Controlled Discovery Pilot — Phase 1: Serper + free sources only" |
  
