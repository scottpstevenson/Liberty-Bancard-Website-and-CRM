---
name: OpenAI max_tokens parameter rejected
description: proposal-engine.ts OpenAI calls fail with "Unsupported parameter: max_tokens" — model requires max_completion_tokens
---

Calls to the OpenAI API from `server/services/proposal-engine.ts` (at minimum
`analyzeStatementData` and `autoGenerateProposal`) currently fail with a 400
`invalid_request_error`: `"Unsupported parameter: 'max_tokens' is not
supported with this model. Use 'max_completion_tokens' instead."`

**Why:** Newer OpenAI models (e.g. GPT-5-era reasoning models) reject the
legacy `max_tokens` chat-completions parameter and require
`max_completion_tokens` instead. This was discovered while manually
validating an unrelated fix (statement chain Step 10) — the auto-proposal
generation step failed non-fatally every time, independent of that bug.

**How to apply:** Before touching any OpenAI `chat.completions.create` (or
similar) call in this codebase, grep for `max_tokens` usage and check whether
the target model requires `max_completion_tokens`. This likely affects other
OpenAI call sites beyond proposal-engine.ts (e.g. deal-blueprint, AI
advisors) — audit broadly rather than assuming it's isolated.
