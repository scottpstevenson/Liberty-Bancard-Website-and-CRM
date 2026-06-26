---
name: Broken Tailwind value patterns
description: Tailwind utility class forms that silently no-op in this project's config
---

Some class forms look valid but produce NO css in this Tailwind setup, failing silently (element looks unstyled / fully opaque):

- `opacity-15` (and other non-default opacity steps) — the default scale is 0/5/10/20/25.../100; 15 is not generated. Use the arbitrary form `opacity-[0.15]`.
- `from-[hsl(222,47%,8%)/0.92]` — arbitrary HSL-with-alpha gradient stops do not compile. Instead use a solid color (e.g. `bg-primary`) plus a separate absolutely-positioned overlay div, or `bg-primary/90`.

**Why:** these silently broke the Home risk-reversal + final-CTA sections during the Statement Intelligence rebuild — the dark overlay never rendered, leaving washed/over-bright sections.

**How to apply:** when a color/opacity does not visibly apply, suspect a non-generated utility step before debugging layout; prefer arbitrary `[...]` values or solid + overlay.
