---
name: SEO audit regex apostrophe fix
description: seo-audit.ts meta-description regex stopped at apostrophes in double-quoted attributes.
---

The SEO audit regex `/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i` used `[^"']+` which excludes both double-quote AND single-quote. This meant any description containing an apostrophe (e.g. "we'll") was truncated at the apostrophe.

Fixed by changing the regex to:
```
/<meta\s+name=["']description["']\s+content="([^"]*)"/i
```
This matches only double-quote-bounded attribute values, allowing apostrophes inside.

**Why:** The SSR template (`server/ssrShared.ts`) uses `content="${safeDescription}"` (double quotes), and does not escape apostrophes. Any description with contractions would fail the audit with a falsely short length.

**How to apply:** If the SSR template ever changes to single-quoted attributes, this regex needs revisiting. Keep description strings apostrophe-free OR keep the double-quote anchor in the regex.
