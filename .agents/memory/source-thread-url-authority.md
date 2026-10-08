---
name: Source thread URL authority
description: Persist source selection in the shared codec and authorize it independently of loaded pagination windows.
---
Persist a selected source occurrence in URL state, but resolve its exact identity
through the existing authorized reader before mounting a composer or draft.
Loaded list rows may supply supplementary display hints, never current contact,
channel or content authority.

**Why:** A real phone draft reload lost selection held only in component state.
A paginated desktop implementation also could not reopen a selection outside its
first loaded window. URL persistence alone does not solve that second failure.

**How to apply:** Use the shared destination codec and namespaced occurrence ID.
Keep the reader with its existing access owner, reject conflicting IDs before
child reads, and test reload/Back/Forward plus absent and foreign occurrences.

Local anonymous site sessions use the existing live-chat access owner for
privileged triage, rather than contact-bound immutable-message access.
Do not require a contact to read/link them or enable a contact draft before
linking. A session projection is not an actual message body.

**Why:** Applying contact-bound access universally removed the existing
admin/manager anonymous-site triage capability.
