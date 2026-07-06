---
name: OpenAI max_tokens parameter rejected
description: gpt-5 chat.completions calls fail with "Unsupported parameter: max_tokens", AND raising the param name alone isn't enough — reasoning tokens can silently eat the whole budget.
---

Calls to the OpenAI API using `model: "gpt-5"` fail with a 400
`invalid_request_error`: `"Unsupported parameter: 'max_tokens' is not
supported with this model. Use 'max_completion_tokens' instead."`
`gpt-4o-mini` call sites are unaffected and should be left alone.

**Why:** gpt-5 is a reasoning model. It rejects the legacy `max_tokens` param
entirely. Renaming to `max_completion_tokens` is necessary but NOT
sufficient: reasoning models spend part of that same token budget on hidden
"reasoning_tokens" before ever emitting visible content. If the budget is too
small (e.g. the old `max_tokens` values like 600–2000 carried over verbatim),
the model can burn 100% of the budget on reasoning, return `finish_reason:
"length"` with an EMPTY `message.content`, and the caller's
`JSON.parse`/regex-match step then fails or silently returns blank fields
(e.g. `overallAssessment: ""`). This will also trip any confidence-scoring
governance layer (empty content -> score 0 -> flagged/review-queued) even
though the request "succeeded" with HTTP 200.

**How to apply:** When fixing/adding a `gpt-5` call: (1) rename `max_tokens`
-> `max_completion_tokens`, (2) size the budget generously — plan for
several thousand hidden reasoning tokens on top of the actual expected
output length, not just the old max_tokens number. Simple classification
prompts needed ~3000; complex structured-JSON-schema prompts (statement
analysis, proposal generation) needed 8000–10000 to reliably avoid
truncation. (3) Verify live by checking `finish_reason` and
`usage.completion_tokens_details.reasoning_tokens` in the raw response, not
just the HTTP status — a 200 with `finish_reason: "length"` and empty
content is a silent failure.

All `gpt-5` call sites across `server/routes/ai.ts`, `server/routes/training.ts`,
`server/routes/public.ts`, and `server/services/proposal-engine.ts` have been
converted and given headroom budgets. `gpt-4o-mini` call sites
(sunbiz-enrichment.ts, sales-prep.ts, ghl.ts, offer-router.ts,
sdr/orchestrator.ts, sdr/reply-intelligence.ts, sdr/scoring.ts) are unaffected.
