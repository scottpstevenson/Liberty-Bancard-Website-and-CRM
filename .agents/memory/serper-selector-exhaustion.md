---
name: Serper discovery drop cause
description: Official-domain discovery stops when lookup memory covers the mapped pool, not at the 50,000 counter
---
The program selector excludes businesses with live `sfp_serper_lookup_memory`; with ~96% of the mapped no-domain pool remembered, ticks return `no_current_discovery_work`. The 50,000 provider_controls counter is display only.
**Why:** the drop looked like a budget ceiling but selector outcomes showed memory exhaustion.
**How to apply:** check selector/memory outcomes before suspecting the ceiling; new yield needs memory expiry or the closed unlabeled scope.

## New-business sourcing (2026-11-16 audit)
Nothing scheduled searches for new businesses by vertical and city. The manual Outscraper upload path is the working source (Outscraper-sourced contacts were ~71% of ready recipients); the old lead-discovery run is manual-only with no production job rows. The Serper spend mostly goes to registry website lookups (statewide Sunbiz entities, any industry), which rarely become prospects. Of ~8.3k program-vertical businesses, ~96% of the no-domain ones are already in lookup memory, mostly rejected as `name_mismatch` (strict identity match, not "never searched").
`serper_call_log` grouped by `call_site` shows what Serper spend actually does (Sep 26–Nov 16: ~238k calls, ~79% registry/contact enrichment, ~21% governed identity/domain lookup, 185 contact-page stage). Only 3 of ~17.6k registry entities that got a website in 30 days became prospects. The Operator Dashboard has a "Serper Gateway Control" disable button; disabling fails closed for all call sites.
**Why:** the owner asked whether anything crawls for new businesses and doubted that so many lack a domain; later said they were considering turning Serper off.
**How to apply:** answer "why no domain/email" from lookup-memory reasons first; the real gap is an automated equivalent of the owner's manual vertical-by-city Outscraper run, a scope decision.
