---
name: Sandboxed email preview and cross-origin-resource-policy
description: Why images (logo) do not render inside sandbox="" srcDoc previews, and the chosen fix.
---
An iframe with `sandbox=""` has an opaque origin, so same-site images count as cross-origin. The site sends `Cross-Origin-Resource-Policy: same-origin` on static files, so the browser blocks them in the preview frame even though the URL works and real email clients show them.

**Why:** a missing logo in the CRM preview looked like a broken email; the image URL itself was fine (200) and the CSP already allows `data:` images.
**How to apply:** keep `sandbox=""` (a browser test asserts it); inline the image as a data URI for display only (`email-preview-logo.ts`) instead of adding `allow-same-origin` or loosening the header. Reproduce with a standalone page served with the production CSP/CORP headers; the dev app's own page cannot show opaque-origin behaviour.
