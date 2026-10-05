---
name: Original-row claim planning
description: Avoid backlog-wide JSON decompression when claiming retained workbook source rows.
---

Large retained workbook JSON must not be opened for every sortable candidate.
Use indexed membership identity for observation retrieval and verify that the
native plan selects the bounded scalar work item before projecting its original
raw row.

**Why:** A fingerprint join can cause PostgreSQL to scan observation payloads;
extracting a row from a whole workbook before the limit can repeatedly
decompress that workbook. A small scalar-candidate benchmark does not establish
the cost of the actual original-row extraction.

**How to apply:** Inspect the actual compiled claim plan, not a simplified ID
query. Keep original-row availability and immutable accounting rules intact.
Certify the native locking/recovery path in a disposable database; production
replica EXPLAIN without row locking is performance evidence, not a write proof.
