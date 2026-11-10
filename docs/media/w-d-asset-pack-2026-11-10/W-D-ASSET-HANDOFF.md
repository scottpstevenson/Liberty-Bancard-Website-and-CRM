# Liberty W-D — visual asset pack and implementation handoff

Created November 10, 2026. This package supplies artwork and implementation direction. It does not publish or modify the website, CRM, controls, forms, consent or providers. The generated assets are review candidates, not represented as owner-approved, real Liberty customers, employees, facilities or equipment-software installations.

## What is included

- **12 core assets:** ten separate generated editorial photographs and two authored, editable SVG illustrations, with PNG previews.
- **One additional terminal cutout:** an upright illustrative Liberty-branded terminal with a level navy screen panel and alpha transparency. The terminal is also incorporated into the countertop panel of the payment-options illustration; it is not a ninth Home section.
- Original PNG photo masters; 640/960/1536 px WebP exports and 960 px JPEG fallbacks; transparent 320/640 px terminal WebP exports.
- `index.html`: local responsive review gallery. Open after extracting the ZIP. `Liberty-W-D-Asset-Contact-Sheet.jpg`: quick overview.
- `reference/home-hero-desktop-mobile-mockup.png`: latest agreed hero layout direction. It is a design reference, not a web asset to embed as a screenshot.
- `asset-manifest.json`: placement, alt text, dimensions, focal suggestions, checksums, generation history and approval status. `generation-record.json`: exact photography and terminal prompts. `build-pack.py`: derivative/gallery/SVG source.

The other eleven core assets are now built; the hero photograph has also been produced separately from the mockup so it can be used on the actual page.

## Exact placement map

| ID | Asset | Home use | Dedicated destination |
| --- | --- | --- | --- |
| 01 | Merchant payment moment | Main hero, inset photo on desktop; below the two CTAs on mobile | `/` |
| 02 | Restaurant service | Compact restaurant card | `/industries/restaurant-payment-processing` |
| 03 | Dental reception | Compact dental card | `/industries/dental-payment-processing` |
| 04 | Med-spa consultation | Compact med-spa card | `/industries/med-spa-payment-processing` |
| 05 | Working automotive shop | Compact automotive card | `/industries/auto-repair-payment-processing` |
| 06 | Independent record shop | Compact retail card | `/industries/retail-payment-processing` |
| 07 | HVAC field service | No extra Home placement | Existing construction page's field-service context, if its section fits; otherwise reserve for a later field-service section. Do not invent a new URL |
| 08 | Ecommerce packing | No extra Home placement | `/industries/ecommerce-payment-processing` |
| 09 | Professional collaboration | No extra Home placement | `/industries/professional-services-payment-processing` |
| 10 | Statement-review process | No extra Home placement | About/contact or Why Liberty process inset, without presenting the pictured analyst as Liberty staff |
| 11 | Editable statement anatomy | Review-deliverable section | `/upload-statement`, where appropriate |
| 12 | Editable payment options | Payment-setup section | `/payment-processing`, where appropriate |
| 13 | Upright terminal concept | Within asset 12/countertop context; not an independent extra section | Illustrative equipment context only; not proof of an exact catalog model |

**Home has eight visual placements:** one hero + five industry cards + one review illustration + one payment-options illustration. Mobile and desktop variants of one photo do not count as separate originals. Other industry pages need not be filled with unrelated pictures just to occupy every slot. Existing industry URLs above were checked against `IndustryPage.tsx` (content blob `ac8a7b20dbd66f3909933ab1f58366f33351368f`); this is an asset-placement check, not a fresh full W-D source/live audit.

## Locked hero copy and hierarchy

- Headline: **Know what you’re paying. See your options.**
- Support: **Understand your processing costs, compare payment options, and get personal guidance for your business.**
- Primary: **Get a free statement review** → the existing statement-upload page/form entrance.
- Secondary: **Find the right payment setup** → the existing equipment/general inquiry flow for visitors without a statement. Preserve its actual form mode and existing durable intake handling; verify the destination during preflight rather than inventing a booking or marketing enrollment.
- Desktop only near the primary: **Free review. No obligation to switch.** Keep the qualification sentence smaller and visually quieter: **Pricing, equipment and eligibility are confirmed during review.**
- Mobile: remove those two helper/qualification lines from the hero CTA area. Show two full-width buttons, then the photo, with comfortable spacing. Keep any separately required page disclosures in the proper page locations.
- Desktop: retain the latest inset photo size, roughly half the usable hero width with a clear text gutter; do not return to the initial full-height oversized photo. Match the supplied final mockup's proportions at the actual container width rather than deriving CSS pixels directly from a presentation-board raster.
- Use the official logo unchanged. Liberty navy `#071D57`, blue `#174B93`, red `#C8102E`, ink `#101C32`, muted text `#526077`, light surface `#F4F6FA`. Use the site's existing typography tokens, not new global font/theme overrides.

## Replit integration work during W-D

1. Re-read current main, `replit.md`, applicable instructions, public claims records, shared Home content, `client/src/lib/public-imagery.ts`, its manifest, `PublicImage.tsx` and `scripts/build-public-images.ts`. Preserve unrelated work. This package is not a replacement for the master W-D brief or a reason to rebuild already completed W-A/W-B/W-C.
2. Add the selected masters to the existing image pipeline. Create AVIF/WebP/JPEG variants using its established width and aspect-ratio conventions. The bundled WebPs are usable previews/exports; no AVIF conversion or repository image-pipeline acceptance is claimed here.
3. Update registry provenance truthfully for these specific assets. The current registry's provenance type is `unverified`; extend it explicitly if adding a `generated` state. Never blanket-relabel old assets as licensed. Record that these are synthetic illustrative scenes, and retain exact source/prompt/checksum records.
4. Use the existing `PublicImage` path and explicit dimensions. Lazy-load images below the first view; prioritize only the actual hero. Reuse a source across its Home card and relevant industry page, with intentional crops. The suggested focal point is a starting value, not a substitute for checking the crop at 390 and 1440 px.
5. Prefer readable HTML/native SVG for the two explanation graphics. Editable SVG masters are supplied; asset 12 embeds a raster terminal inset, while its headings, device/context shapes and labels remain editable. Do not squeeze a desktop explanation diagram into an unreadable 390 px thumbnail: implement the same three payment-context cards responsively with live headings, or use the supplied PNG as a decorative supplement with equivalent text nearby.
6. The terminal concept has no visible Dejavoo branding. Do not use it to rename an actual manufacturer model, replace a model-specific shop photo deceptively, imply included/free equipment, or claim Liberty software is installed. Preserve truthful catalog names where real products are sold. It is generic illustrative brand art, not a verified product specification. Its initial reference chain includes the owner-supplied manufacturer-derived concept; rights/offer/availability are not established by AI editing.
7. Remove misleading team imagery from any target section replaced by asset 10. This pack contains no founder/team photograph, testimonial portrait, customer case study or actual customer results. Keep any real founder portrait slot text-led until a genuine approved portrait is available.
8. Verify every selected photo on light/dark surroundings where used; the terminal alpha must be composited on white and navy for inspection. No background smoke should be rendered from invisible RGB pixels. The blue screen rectangle is horizontal in this upright version.
9. Check 320/390/768/1440 px, mobile 200% text sizing, keyboard focus, no horizontal overflow, no assistant/widget overlap, and image decoding/failure behavior. Check SSR/hydrated Home copy and links agree. Verify the existing image/build/mobile/overlay/performance gates appropriate to W-D. Do not assert these gates passed merely because assets exist.
10. No outbound unpause, receipt change, provider/analysis enablement, GHL or booking mutation, production submission or existing statement recovery is part of this media handoff. No package/lockfile or CRM theme change is needed.

## Quality and factual guardrails

Different scenes were chosen deliberately: boutique payment, restaurant service, dental reception, med-spa discussion, active workshop, independent music retail, field service, packing bench, professional studio and overhead document review. They share a restrained brand palette without repeating the same counter, people or tap pose. Generated anatomy, props and the page crops were visually reviewed at delivery size; this is not a certification of physical product accuracy or real-world documentary provenance. Preserve the embedded illustrative labels in the graphics; no savings rates, customer outcomes or unsupported business claims were added.

## Review and acceptance

Review the contact sheet and individual masters before choosing the final publication set. Keep `approval: owner-review-pending` until actual owner acceptance. The package was checked for file integrity, image dimensions, terminal alpha, relative gallery references and SVG/XML parsing. Source masters were preserved and only delivery encodings created. Neither this gallery nor the mockup has been installed or published. This deliverable closes asset creation for the scoped set; W-D implementation, route acceptance and owner publication remain separate.
