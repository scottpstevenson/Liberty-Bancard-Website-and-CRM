---
name: Nested Radix dismissal context
description: Keep nested overlay dismissal coordinated across component package versions.
---
Nested Radix overlay primitives must share both dismissal-layer and focus-scope
singleton implementations, not independently resolve separate modal stacks.

**Why:** A real employee dialog/select test found that a newer Dialog and an older
Select used separate dismissal contexts. One Escape closed both layers. Sharing
the existing newer dismissal implementation restored inner-only dismissal and
both focus-return steps without replacing the components or their styling.

Sharing dismissal context alone is insufficient. A real keyboard test opened a
nested Select but could not focus any option because Dialog and Select resolved
separate focus-scope copies. Their implementation code was identical; independent
modal stacks still prevented the child from pausing the enclosing focus trap.

**How to apply:** After Radix package changes, inspect the resolved dependency
tree and test nested Escape/focus in a signed-in real browser. A successful
build or a themed portal alone does not establish correct nested behavior.
Compiler deduplication can share an existing implementation without changing
locked package versions when the installed implementations are compatible.
