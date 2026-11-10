---
name: W-C closure correction lessons
description: Durable rules from correcting public-form anchors, terminal-entrance parity, pending-upload restore, analysis truth and control sizing after a live audit.
---

- A hash link into a lazily rendered page cannot rely on the browser's native fragment scroll: the target does not exist at first paint. Use one shared helper (aligns the region's own computed scroll-margin-top under the fixed header, focuses the form heading, stops on visitor input) and leave native hash/history behavior untouched. Both fragment aliases must exist in the server HTML. A cert that only checks "the element exists" or "the heading gets focus eventually" passed the broken build; measure position, focus and added history entries after the page settles.
- Server-rendered and hydrated copy for the same URL must come from one shared constant module (no db import) that both the SSR emitter and the React page read; a first-HTML test and a hydrated-page test then fail together if either drifts.
- A deal's analysis status is last-writer-wins across all uploads on that deal. An upload's own analysis wording must come from that upload's own evidence (its chain step, or a document-bound completion audit row); the shared deal status counts only for the upload that last queued work. Missing own evidence is "not recorded", never held or completed by inference.
- Page-level touch-target floors in the global stylesheet (min-height rules for coarse/narrow viewports) beat a single-class component rule; scope the component rule with the theme wrapper and double the class so the agreed control size wins at every width, then measure at 320 px.
- Make cert files report by section (a `section()` wrapper that records failures and continues) so one failing-before run lists every defect instead of stopping at the first.
- To prove failing-before without `git stash` (blocked here), snapshot the changed paths to a tarball under the ignored artifacts directory, restore base content with `git show HEAD:<path>`, build, run, then untar the snapshot and rebuild. The browser suite's candidate identity covers `scripts/`, so any test edit needs a rebuild before the browser suites run.
- A browser-driven read-only production check can use one ordinary administrator sign-in at the API level plus GET requests; confirm the session twice before relying on it. Metadata about a protected file comes from the production read replica (never open or download the file). The platform makes the checkpoint commit when the turn closes, so a pass cannot name its own commit; identify the tested tree by base commit plus a content digest.

**Why:** each was found by a post-publish audit of a build that had passed its own certs.
**How to apply:** when changing public deep links, SSR/React page pairs, statement-chain wording, public form sizing, or when proving a regression test fails before the fix.
