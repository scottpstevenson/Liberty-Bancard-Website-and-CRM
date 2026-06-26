---
name: Public marketing shell overlays
description: Fixed-position overlay widgets on the public site and how they must be offset
---

The public PublicLayout (client/src/App.tsx) renders several fixed overlays, route-gated (hidden on /dashboard, /mobile, auth, /thanks, /upload-statement as applicable):
- StickyMobileCTA — `fixed bottom-0 md:hidden`, the ONLY live sticky CTA (a dead duplicate `MobileStickyCtA.tsx` was deleted). Has a scroll-trigger (appears after 400px) and must set `invisible pointer-events-none` + `aria-hidden` while hidden so its links aren't tabbable.
- ChatWidget — `fixed z-50` all viewports, bottom-right. On mobile it must be raised (e.g. `bottom-24`) so it clears the 56px sticky bar and never covers the "Upload" button.
- ContactBubble — `hidden lg:block`, desktop only. Moved to bottom-LEFT so it doesn't stack on ChatWidget (bottom-right) on desktop.

**Why:** chat bubble was covering the sticky-bar Upload CTA on mobile and stacking on the contact bubble on desktop.

**How to apply:** any new fixed overlay must pick a corner that doesn't collide with these three and respect the mobile sticky-bar height.
