---
name: SFP contact–business link evidence
description: Independent identity threshold and Sunbiz vendor-source distinction for safely admitting CRM contacts into SFP.
---

Do not treat the legacy Sunbiz/corporate-domain conjunction as the universal company/contact linking policy. The user explicitly said the linking rules were too strict. Company identity, email deliverability, outreach eligibility and permission to send are separate decisions.

**Why:** Requiring every registry website, exact legal-name spelling and corporate email at once leaves genuine businesses using Gmail or missing websites unresolved. Suppression/invalid email status is a reason not to send, not proof that a company relationship is false.

**How to apply:** Allow an explicit, attributable operator confirmation of a unique company-name match without demanding missing phone/domain evidence, evidence IDs, or typed reasons. Supporting identifiers strengthen or disambiguate the match. Keep competing/conflicting matches unresolved, preserve opt-outs, and never describe operator confirmation or software matching as independent registry/provider verification.

The legacy strict automatic path still requires an independent canonical Sunbiz source relationship with matching source website domain and entity name, a unique canonical business domain, an exact normalized CRM company name, and a matching non-shared corporate email domain. This is a specific system-verification authority, not overall linking eligibility. A verified link still does not validate the email or authorize outreach.

**Why:** Production has many domain overlaps but almost no persisted contact–business links. The historical contact import largely lacks individual source-event/import-disposition evidence. Treating candidate matches as verified would falsely attribute contacts. The Sunbiz source link's `source_system` is `sunbiz`, while the linked source entities are predominantly ingested through `cordata` or `corevt`; requiring the entity's `source` to equal `sunbiz` would silently reject nearly the entire independently linked population.

**How to apply:** Keep system decisions separate from admin-reviewed decisions and recheck independent facts at the write boundary. Never assume that historical contact provenance or an unvalidated address is itself an independent corroborating source. Check both published SFP contact-source constraints and database triggers before writing; development schema success does not establish production readiness.

For broader reviewed relationships, prove the selected pre-existing event's business binding from that event alone. Contact-level filing provenance must not be inherited as evidence that an otherwise unrelated event refers to the candidate business.

**Why:** A contact can retain a correct filing identifier while an event explicitly concerns a different business. Borrowing the contact identifier converts an unrelated event into apparent independent proof.

**How to apply:** Reject explicit conflicting identifiers and evaluate each selected event's own metadata/external identifier. Do not create observations or approvals merely to satisfy the evidence requirement.

An automatic-eligibility census must satisfy both the application's strict predicate and the unchanged database authority guard, with candidate discovery equivalent across SQL and offline exports.

**Why:** Accent folding, legal-suffix whitespace, domain normalization, and coalescing only one filing key can produce different candidate sets or report eligibility that the actual write guard rejects.

**How to apply:** Test real PostgreSQL candidate sets and unchanged guard expressions against the pure classifier, including accents, www aliases, compact-export email validity, and competing filing identifiers. Bind resumable aggregate reports to the classifier and shard digests.

Strict automatic-link eligibility is not enrichment eligibility or overall lead qualification. Missing canonical/Sunbiz evidence means that the implemented linking path is unresolved, not that the contact is invalid or unusable.

**Why:** The contact pool is nationwide, whereas this automatic path requires Florida registry evidence and populated domains in both the business and source entity. Presenting that conjunction's yield as overall eligibility misrepresents coverage even when contacts contain usable company names and websites.

**How to apply:** Label linking results by their actual authority boundary. Report contact identifier coverage, business/source coverage, and geographic scope separately before diagnosing a low linking yield. Preserve suppression and verified-link safeguards; do not discard unresolved contacts or invent registry evidence to improve the count.

A trusted registry-ingestion namespace does not make an enriched website a government-confirmed company domain. Copying that website into a canonical business does not produce a second independent identity observation.

**Why:** Production diagnostics found corporate-brand domains attached to unrelated-looking legal entities in both enriched registry rows and canonical businesses. Domain agreement can therefore repeat the same bad source association; it is not by itself proof of company affiliation.

**How to apply:** Trace website enrichment and establish the domain's binding to the legal entity or documented trade name. Preserve conflict checks; do not fix low matching yield by accepting all shared-domain pairs. Missing registry website does not mean missing registry identity or that human review is the only possible relationship path.

Contact–business proposal idempotency must identify the contact as well as the business; shared enrichment batch labels do not distinguish contacts.

**Why:** Business-only proposal keys caused distinct imported contacts resolving to one business to be rejected as divergent retries. A candidate is still heuristic evidence, never verified link authority.

**How to apply:** Preserve original keys and immutable replay checks for existing proposals. Give genuinely different contact–business pairs distinct stable provenance keys without overwriting evidence or treating candidate creation as verification.