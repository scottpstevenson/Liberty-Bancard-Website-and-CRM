---
name: Nested Radix dismissal context
description: Keep nested overlay dismissal coordinated across component package versions.
---
Nested Radix overlay primitives must share one dismissal-layer implementation,
not independently resolve incompatible singleton contexts.

**Why:** A real employee dialog/select test found that a newer Dialog and an older
Select used separate dismissal contexts. One Escape closed both layers. Sharing
the existing newer dismissal implementation restored inner-only dismissal and
both focus-return steps without replacing the components or their styling.

**How to apply:** After Radix package changes, inspect the resolved dependency
tree and test nested Escape/focus in a signed-in real browser. A successful
build or a themed portal alone does not establish correct nested behavior.
