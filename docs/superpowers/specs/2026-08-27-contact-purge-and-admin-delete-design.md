# Contact purge and admin delete design

## Scope

- Permanently purge the 79 contacts from the reviewed production dry-run inventory.
- Use only the immutable reviewed contact IDs plus the two synthetic email domains as the safety boundary.
- Delete the 18 linked GoHighLevel contacts before deleting local contact rows.
- Add an admin/manager UI delete action that remains a reversible soft archive.

## One-time purge

The purge is exposed through a sealed admin-only endpoint. The server owns the
manifest and confirmation phrase; callers cannot provide IDs, domains, or phone
patterns. Preflight requires all 79 records to exist and still use an approved
synthetic domain.

GoHighLevel deletions happen first through the existing pause-aware provider
delete service while the 79 local contact rows are locked. The manifest binds
the exact 18 reviewed GHL IDs so a concurrent relink cannot expand the external
deletion scope. A provider failure blocks the local transaction. HTTP 404 is
idempotent success, so interrupted runs can be retried.

The local transaction deletes disposable operational rows, detaches nullable
history references, relies on declared cascades where appropriate, and then
deletes exactly 79 contacts. The transaction fails closed if production adds an
unclassified foreign key.

## Admin UI

Single and bulk delete actions use the existing admin/manager-only bulk endpoint.
The confirmation dialog states that the action archives records and can be
reversed through Show Archived. Success refreshes the contact list; partial
failures are reported.

Normal contact archive/restore routes are also admin/manager-only and never
delete a GHL contact. Provider deletion is exclusive to the sealed one-time
purge.

## Verification

- Manifest has 79 unique IDs.
- Every ID is revalidated against the synthetic domains.
- Agents and merchants cannot call either endpoint.
- The normal delete UI never invokes the permanent purge endpoint.
- Production post-check confirms zero reviewed IDs remain and no phone-only
  contact was selected.