---
name: Cross-database BullMQ test isolation
description: Why integration servers using a different database must not share a BullMQ namespace with live workers.
---

Integration and disposable-database servers must use an isolated BullMQ key prefix whenever their database differs from other running workers.

**Why:** A worker attached to another database can consume a durable command job, find no matching command row, and complete the job without advancing the command in the source database. The source command remains unclaimed even though enqueueing appeared successful.

**How to apply:** For full pre-deploy and disposable-database runs, configure a unique test Redis prefix before the server initializes queues. When diagnosing a stranded durable command, compare its attempt count and lease fields: an in-progress row with zero attempts after enqueue indicates no worker attached to that database claimed it.