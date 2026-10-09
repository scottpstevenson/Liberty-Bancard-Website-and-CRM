# C1 contracts and boundaries

Status: implementation and partial behavioral evidence, **not whole-task acceptance**.
The exact instruction inputs and their precedence/hashes are in provenance.json. The
adjudication is binding. No production build, native recovery, publication, GO, sends,
enrollment/resume or final menu cutover is authorized by these documents.

## Destination/state API

- The generated registry retains all 147 distinct App dashboard patterns. Its one
  workspace owner is destination render ownership, not discovery/menu ownership.
  Historical current/future targets, actual App declarations and component sources
  are separate evidence. Metadata never grants a role access.
- `LocalEntityId` pairs a positive local integer with its explicit entity namespace.
  `buildCrmDestination` rejects mismatched namespaces, invalid context, contradictory
  query values and unregistered query keys. Names never become IDs.
- Financial aliases replace into Reporting with `tab=financial&financialTab=child`.
  A single explicit child wins over legacy `tab`. Equal duplicates collapse;
  contradictory/invalid selectors produce a reason with a safe default.
- Operator preserves `tab=monitor&view=validated-child`. Managers fall back to an
  authorized parent child before the monitor mounts. User selections push;
  aliases/debounced search replace. Registered safe context/fragments survive.
- People uses real registered row/facet readers, default 50 and supported 25/50/100.
  Contradictory or invalid paging/sort/class values have explicit fallbacks.
  An agent's forged archived selector is removed before either reader is requested.
  Filter changes reset paging and selection. URL presets do not use saved-filter CRUD.
  Assigned-to-me filtering is available only for agents: the existing reader resolves
  it through agent ownership. Other roles have disabled controls with a reason, and
  direct links discard the unsupported filter before either read. This is a client
  capability restriction, not a backend ownership repair or permission expansion.
- Contact25/LeadOps13/staging2/Canonical5 arrays/codecs are published for their later
  owners. Codec tests are not evidence of regrouped or fully rendered workspaces.

## Cache and session boundary

HTTP URL and cache identity are separate. Adopted cache keys retain the existing
endpoint-family/entity prefixes, then add actor, role, account version/permissions
and transition generation. Original prefix invalidators continue to match scoped
keys. Reads forward AbortSignal; prior actor/record placeholders are prohibited.
Protected transitions cancel/remove protected cache families and clear toasts.
Only context-tagged protected toasts are cleared; public feedback is retained.
Auth subscribers show a loading boundary between canonical context fencing and
the committed auth result. Overlapping transitions cannot remove a newer cache
generation; old durable callbacks cannot show a prior-context toast.
Auth/public caches survive; auth/MFA continuation still uses the real application.
Employee content is keyed by actor/permission context; record content is keyed by
pathname so stale selection, edit drafts and nested overlays do not migrate records.
Aborting reads never aborts/replaces durable B command authorization, CSRF,
idempotency or expected-version checks.

## Presentation API

`EmployeeCrmProvider` enables employee-only styling. Supported Radix content wrappers
inherit context and opt portals into `.crm-theme.crm-portal`; dimming backdrops retain
their existing black opacity. No global body class, portal authentication bypass or
clipped custom portal host is used. Toaster separately checks actor and employee route.
Public, partner, merchant and dedicated mobile branding remain excluded.

CrmPage/PageHeader, RecordHeader, data-state, metric, tab, toolbar, table/card,
filter/detail drawer and error components compose existing primitives. People owns
its H1/gutter. Contact Header preserves existing contents/commands without Contact25
regrouping. Unadopted shell headings and menus remain. Existing Tailwind compiler,
Malformed Contact IDs are rejected before mounting record readers; they never
resolve through numeric coercion or name lookup.
legacy reset/theme assets and public SSR delivery remain; CSR and SSR viewports omit
maximum-scale. Font sources/licenses/hashes are in fonts.json.

## Evidence interpretation and remaining owners

All 309 historical panels retain their specific later-owner dispositions in
panel-dispositions.json. Partition totals are C2 25/30, C3 24/28, C4 39/70, C5 59/181.
Neither the 245 App literal inventory nor those 309 observations is an action pass.
Browser attempt/receipt JSON explicitly lists tested controls, role, source/content/
compiled HTML identities, private candidate URL and request statuses. Failed attempts
and supporting mounted jsdom tests are not whole-browser acceptance.

C1 still owns closing its full adopted-control denominator, real browser session
transitions, all nested overlay/focus/contrast/reduced-motion measurements, complete
route child/role proof, fresh current/base gate comparisons and portable final receipts.
These obligations must not be silently deferred to C2–C5 or treated as complete.
Unsafe persistent saved-filter editing/deletion remains a separate A/B owner repair;
C1 has no dependent persistent UI. Native primary/convergence and recovery acceptance
remain separate work and are not inferred from the disposable stock suite.

## C4-owned nested selector extensions

The existing C1 codec now declares `testimonialView` (pending, approved,
rejected, all) beneath Merchant Success's `tab=testimonials` and `rfiView`
(all, Open, In Progress, Waiting on Merchant, Responded, Closed) beneath
Support's `tab=rfis`. These are implementation extensions, not assertions
that the original C1 snapshot shipped them. They remain distinct from the
outer workspace tab and from Review Queue's `reviewView`.

Deliberate selections push; retained aliases replace. Registered context and
safe fragments survive both. Invalid/conflicting child values are preserved
through the alias to render an unavailable state without a default child
request. Equal duplicate values resolve through the existing C1 selector.
Closing selected RFI context removes only the existing generic `id`, retaining workspace/status
and other registered context. URL metadata does not grant permission:
canonical Merchant Success and Support remain admin/manager guarded; the
existing A exact/collection RFI readers separately govern authorized employee
record access. No new command or native acceptance follows from these codecs.
