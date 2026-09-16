---
name: First-party contact-page email crawler
description: Durable lessons from adding a bounded first-party website crawler as a fallback email-discovery source.
---

## Domain resolution priority for a fallback lookup
When a record needs a lookup keyed by domain/website, resolve it in priority
order: the record's own known value first, then a linked parent entity's
canonical value, then whatever a fresh provider call just returned. Never use
only the freshly-returned value — that silently discards an already-known
value on records where this particular provider attempt didn't happen to
re-find it.

## Distinguish transient failure from genuine no-match
A fallback lookup that can fail transiently (timeout, DNS failure, thrown
exception) must report that distinctly from "ran to completion and found
nothing" — including the completion case where the attempt was validly
short-circuited by a safety check. Only a genuine completion (found or not)
should let the caller write a cooldown/no-match record; a transport failure
must leave the record immediately eligible for retry, or a blip silently
suppresses it for a full cooldown window.

## A per-item failure must not abort the whole batch
When a batch process treats "this call didn't complete" as a signal to stop
processing further items, that shortcut is only valid if the failure reflects
a shared resource (e.g. a rate-limited gateway) — not when it's specific to
one item (e.g. one record's own domain being unreachable). Conflating the two
turns one bad record into a batch-wide backlog stall.

## Telemetry must count the real unit of work, not every consumer
When multiple records share one cached/deduplicated piece of work, attempt or
count telemetry must increment only on the actual cache miss that did the
work — not once per consumer that merely read the cached result — or the
numbers overstate real volume.

## Two acceptance policies from one base filter, by design
A shared base filter (rejecting malformed/asset/synthetic values) can
legitimately feed two different downstream acceptance policies with different
purposes — e.g. a strict "owner-identity" policy and a looser "any usable
contact address" policy. Don't assume one shared filter implies one shared
policy; check which policy a given call site actually applies.
