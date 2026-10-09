---
name: Independent read-fault isolation
description: Proving a failed reader does not accidentally fail its successful sibling.
---

An unsupported route in a fixture is not evidence that its real reader failed.
Register the actual reader before interpreting a loaded/empty result, and inject
the named failure explicitly when testing unavailable states.

**Why:** Registering a previously omitted summary converted a fixture's
“Unavailable” into a legitimate authorized zero. The old assertion had measured
missing fixture wiring, not an observed failure of that source.

**How to apply:** Record both successful and failed request identities/statuses;
do not preserve an unavailable assertion by disabling a newly functional sibling.

When testing independent readers, identify the exact failed request and prove
the successful sibling remains successful and rendered. An endpoint prefix
is not necessarily one source: a collection URL can also prefix its stats URL.

**Why:** A scoped NPS browser regression unintentionally intercepted both the
collection and statistics requests, making a fixture failure look like coupled
product state.

**How to apply:** Check intercepted request paths/statuses and the same
document's successful sibling. Use exact-path faults when that is the intended
boundary; retain broad-prefix behavior only for deliberately failing a family
of requests. Do not weaken application loading/error states to pass the fixture.
