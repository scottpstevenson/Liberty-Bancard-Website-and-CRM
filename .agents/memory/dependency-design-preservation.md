---
name: Dependency upgrades and design preservation
description: Preserve Liberty's existing design when remediating dependency risk; public-lock provenance can regress during installation.
---
Security dependency remediation is not permission to redesign Liberty's public website or CRM. Preserve existing branding, layout and behavior and verify desktop and phone rendering separately.

**Why:** The user approved the smallest dependency migration needed to clear the high-severity security gate, explicitly requiring the existing design and behavior to remain.

**How to apply:** Keep design compatibility data independent from an obsolete compiler. Test real browser rendering after compiler upgrades; a successful build alone does not establish visual compatibility.

Validate the server-served HTML through client mounting, not just a clean Vite
page or generated CSS file. Fallback styles in the document head survive React
replacing the page body.

**Why:** A layered CSS compiler upgrade exposed older unlayered SSR resets:
the compiled utilities existed, yet global image sizing and zero-spacing resets
overrode them on real public pages. Backend certification and a successful build
did not catch the visible site-wide regression.

**How to apply:** Check computed logo dimensions and spacing on desktop and
phone after client mounting. A visibly broken public preview must block release
readiness, even when the requested patch itself is backend-only.

Module installation can reintroduce internal HTTP mirror tarballs even after a lock was made portable.

**Why:** The package installer introduced mirror sources during an otherwise safe upgrade; normal npm lock regeneration retained those sources, and deleting resolved fields left them missing.

**How to apply:** Check the actual strict lock policy after installs. Re-resolve using exact public package/version/integrity metadata, then let npm regenerate and run a clean public installation. Never substitute URLs without artifact identity verification.