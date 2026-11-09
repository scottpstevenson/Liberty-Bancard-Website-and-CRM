---
name: Public shell and hubs lessons
description: Durable pitfalls when linking to or rendering server-only public pages (glossary) from the shared public shell.
---
- The client router has no route for the glossary (`/learn`, `/learn/*`): they exist only as server renders. Any hydrated link to them (header, drawer, footer, content) must be a native anchor (`needsNativeNavigation` in the shared navigation module); a router link lands on the not-found page even though direct loads work. Verify with a real click from a hydrated page, not a URL load.
- Static pages that never hydrate get no app stylesheet, so they declare their own same-origin font faces inline; hydrating pages must not.
- The desktop dropdown opens on hover and its click then toggles it closed; real-pointer tests must confirm `aria-expanded` and re-click rather than assume one click opens it.
- Check `git ls-files` before creating a script with a plausible name; a new script once overwrote a tracked strict design check.

**Why:** each cost a rejected review or a debugging round. **How to apply:** before adding any public link to a server-only page, a new static server page, or a new gate script.
