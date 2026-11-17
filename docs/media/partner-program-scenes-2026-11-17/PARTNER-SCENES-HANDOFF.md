# Partner-program scenes — bookkeeper and insurance heroes

Created November 17, 2026 for the #2162 closeout. Status: **generated, owner review pending**. Not photographs of real people.

The live re-audit found the bookkeeper hero (a clinic receptionist) and the insurance hero (a service technician outside a house) did not support their audiences. The cleared W-D set has no bookkeeper or insurance scene, so two new editorial scenes were generated in the W-D style (prompt prefix identical to the W-D generation record; exact prompts in `generation-record.json`).

| Page | Scene | Master in repository |
|---|---|---|
| `/partners/bookkeeper` | Stands for a bookkeeper going through a client's records: two adults reviewing a printed report in a bakery's back office | `client/src/assets/images/partner/partner-bookkeeper-review.png` |
| `/partners/insurance` | Stands for an insurance agent reviewing coverage: two adults going over a printed summary in an open binder in a flooring showroom | `client/src/assets/images/partner/partner-insurance-advice.png` |

Framing. The generator returned 1024 x 1024 squares. Each master is a 1024 x 683 window of the original resized to 1536 x 1024 so it fits the same derivative pipeline as the W-D masters. The unmodified originals are in `original/`; the window and checksums are in `asset-manifest.json`.

Alt text. The pages' alt text describes only what is visible ("Two adults going over a printed report at a desk in the back office of a small bakery."). It does not say the people are a bookkeeper or an insurance agent; an image cannot show that, and the visible caption already says the scene is illustrative.

Review items for the owner: approve or replace each scene; neither shows a payment terminal, readable text, real brand, or a Liberty customer, partner or employee. The pages' visible caption says the scene is illustrative. Provenance is recorded in `client/src/lib/public-imagery.ts` and checked by `scripts/test-wd-media-contract.ts`.
