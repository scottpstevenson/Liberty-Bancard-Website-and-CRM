# Device and live readback acceptance

Local Chromium viewport emulation and native browser 200% zoom are exercised separately from real device acceptance. The actual CRM funnel is asserted mounted after explicitly choosing desktop layout on a phone-sized destination notice. Public pages retain the existing brand-light shell when the system theme is dark; CRM light/dark themes remain distinct.

NOT EXERCISED: WebKit/Safari, a real iPhone, a real Android phone, mobile keyboard interaction on the deployed app, actual Gmail/Outlook email clients, deployed bundle/server parity, production network/CPU budgets, and live conversion outcomes.

Before device acceptance, repeat on the actual published build:

- Confirm serving SHA/build and schema status match the reviewed candidate.
- Check 320/390/454/768/1280 widths, portrait/landscape, both system themes and 200% zoom. Verify header/consent/sticky controls do not cover content or focused fields.
- Open the phone destination notice and explicitly select desktop layout; verify the same query, filters, experiment and pagination survive reload, Back/Forward and copy-link.
- Run empty, partial, unavailable, unauthorized, stale and conflicting-revision flows. A failed read must not become zero conversion or no experiments.
- Inspect every reviewed email touch and both subject arms, missing-name fallback, missing-company hold, images-off and text views. Verify the real footer, sender, reply path and secure CTA. Do not send a test or connect a mailbox without separate authorization.
- Confirm keyboard/focus order, labels and readable equivalents for charts. Use actual touch input for consent controls, forms, accordions, filter Apply, evidence pagination and export.
- Scroll lazy images into view before calling them broken; inspect selected derivatives, aspect ratios and loading/layout shift. Preserve source licenses and claim evidence.
- Validate any real forms only through the separately authorized receipt/operations procedure. The local layout test submits no form and its static API responses are deliberately unavailable.
