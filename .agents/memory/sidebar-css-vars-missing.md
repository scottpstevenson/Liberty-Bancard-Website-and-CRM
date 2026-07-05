---
name: Sidebar CSS vars must be defined alongside tailwind config tokens
description: tailwind.config.ts can reference CSS custom properties that don't actually exist in index.css, silently breaking colors.
---

`tailwind.config.ts` defined `sidebar`, `sidebar-primary`, `sidebar-accent` etc. color tokens mapped to CSS vars (`--sidebar`, `--sidebar-foreground`, `--sidebar-border`, `--sidebar-ring`, `--sidebar-primary(-foreground)`, `--sidebar-accent(-foreground)`), but none of those vars were ever defined in `client/src/index.css` `:root`/`.dark` blocks. Result: `bg-sidebar`/`text-sidebar-foreground` resolved to an invalid/empty color, making the mobile Sheet drawer (and desktop sidebar) render with no real background — especially glaring in light mode against the dark overlay scrim.

**Why:** Tailwind will happily generate utility classes referencing any CSS var name in the config, whether or not that var is ever defined — there's no build-time check tying `tailwind.config.ts` color tokens back to `index.css`. This class of bug (utility silently resolving to nothing) is easy to introduce when copying shadcn/ui components (like the sidebar primitive) without also copying their expected CSS variable block.

**How to apply:** When a shadcn/ui-style component uses `bg-<token>`/`text-<token>-foreground` and looks invisible or low-contrast, check that every color token in `tailwind.config.ts` has a matching `--<token>` var defined in both `:root` and `.dark` in `index.css` — don't just check the component or the Tailwind config in isolation.
