# Liberty Stage 4C1 — published audit and grouped corrections

**October 31, 2026 · authenticated production walkthrough and current-source review**

**Verdict: 4C1 shipped useful partial implementation, but the full original task is not complete.** The new SFP proposal previews, wider template editor and server-side draft identity checks are real improvements. The primary campaign/sequence workspace and safe operator package-edit/publication flow remain unfinished. The repository itself records those shortfalls and mentions follow-ups #2117–#2119. Keep the unfinished authoring work in 4C1; do not move it to native/calendar execution in 4C2 or call it an optional upgrade.

This report supplies **eight grouped repair areas**, with exact source destinations, live evidence, narrow implementation and acceptance checks. They are not eight new Replit tasks and are not additional rows in the historical 95-entry Stage 3 lineage. Reconcile them into the existing 4C1 task/follow-ups and current ledger/spec.

## 1. Source and serving identity

| Evidence | Observed |
| --- | --- |
| Fetched current main / clean audit worktree | `03fa438b870eaafc512728a36b40709442aca0e4` |
| Production health, including end of audit | `6777641f22c9ccad89a9ab69ead6352f9a9d1003` |
| Production build | `2026-10-31T20:11:11.726Z`, publish `fbee41f1-c65b-45bb-ba03-d9b6a23ac9a2` |
| Main versus serving source | Main has a later booking/copy follow-up: 17 changed files, 127 insertions/97 deletions. Its commit message removes remaining ten-minute claims and hardcoded booking fallbacks. Those later edits are **not live** at this observation. |
| Original contract | `Liberty-Stage4C1-Master-Preflight-and-Build-2026-10-31.md`, including nine sections and Appendices A–C. Reviewed against its actual scope, not only the smaller implementation receipt. |
| Repo implementation evidence | `docs/certification/stage4-c1/preflight-report.md`, `asset-disposition.md`, `asset-inventory.json`; current ledger's Stage 4C1 section/addendum; current specification and source diff from `45c51437`. |
| Browser | Existing signed-in admin session reused successfully; no new sign-in request. Actual Campaigns, GHL Settings/content panel, premium previews, template editor, booking landing and relevant passive API reads exercised. |

Publication is established for `6777641f`. It is not established for `03fa438b`. Rebaseline before repairs and publish the final reviewed repair candidate once through the normal process; publishing the current follow-up alone will not complete the missing authoring work.

The main worktree was isolated without resetting the existing checkout or its unrelated files. No application code, production content, controls or schema were changed by this audit.

## 2. Complete fresh census and controls

### Installed content

| Collection | Fresh production read |
| --- | --- |
| Campaigns | **20 records / 79 actual steps** |
| Sequences | **127 records / 517 actual steps** |
| Total campaign/sequence assets | **147 records / 596 steps**, every step collection read successfully |
| Stored templates | **8**, including all eight version workspaces |
| Local workflows | **17**, including email/SMS wording readers for each: **13 email + 8 SMS messages** |
| Static proposed copy | **25 SFP emails / 5 families**, plus 12 warm/service baseline entries |
| Live current SFP | **5 packages**, each still 3 touches, relative delays `0/3/5` = cumulative day `0/3/8` |
| Live editorial overview | Current SFP10 asset rows, Sales library97, Merchant lifecycle12, History10, Diagnostics18 |
| Authoritative catalog | Current10, historical10, unresolved127 installed assets; five uninstalled package keys reported separately |

The earlier 23-campaign census is now stale. IDs69,77,79 are absent from the new complete installed overview; the remaining 20 match the non-test-labelled campaign IDs in the earlier register. This read does **not** establish who removed them, when, whether removal was appropriate, or whether 4C1 caused it. Do not invent that explanation or restore/delete anything based on the difference alone. The static 175-row attachment-derived disposition register is not the current 172-record campaign/sequence/template/workflow census.

Sequence512 remains a useful warning against deletion by name: it is still named `Test NLE Sequence 1784737373552`, has zero steps, is paused and has **911 enrollments**, zero active and zero reported started. Preserve its dependencies. “Test-labelled” is a name observation, not proof the records are disposable fixtures.

### Safety authorities, read at end of audit

| Authority | Observed state |
| --- | --- |
| Global outbound pause | `paused:true`, database source, epoch1 |
| Outgoing GHL contact-sync control | `enabled:false`, `permissionsEnabled:true`, epoch16 |
| Incoming GHL contact sync | `inboundEnabled:true`, `configured:true` |

These states were not changed. Individual channel-pause settings, native workflow enablement and live provider operation ledgers were not independently re-read in this review. Do not turn the successful global-pause read into a claim every separate control was verified. No send, booking, release, queue, provider job, enrichment or Data Health action was executed. Preview POSTs were the inspected sample-render-only endpoints and do not persist or transmit customer messages.

## 3. Improvements verified and retained

1. **All 25 premium SFP proposals render through the live UI.** Opened all five families and every touch's “Preview as SFP email”. All25 completed. Inspected the final iframe documents: no raw merge/CTA marker, one SFP signature, one compliance footer, sample unsubscribe token, correct first-party upload/booking hrefs. These are composition simulations, not sent/delivered-email evidence.
2. **Booking adapter works.** `/book` resolves to `https://api.leadconnectorhq.com/widget/booking/YFiIy7oIOUXN2qZZPnOr`; the page renders Liberty Bancard — Sales Meeting,30min. No appointment was submitted. The server adapter ignores visitor query parameters, uses no-store and has explicit unavailable handling. The existing disposable suite invokes the real public-route registration for its adapter checks; credit that.
3. **Real canvas width is repaired.** At viewport1363px, the stored-template dialog measures1120px. Desktop iframe is600px; Mobile is an actual375px, not the old237.5px shrink. The SFP preview also measured375px when selected. This is not a390px viewport or200%zoom certification.
4. **Token repairs are substantive.** `custom_values.booking_link` is now supported as an explicit calendar alias in the stored-template registry and sequence-worker interpolation. The26 retained sequence occurrences are no longer evidence of an unsupported token by themselves. `deal.topCostDrivers` has a real deal schema field, analysis writer, structured formatting and send-time reader in `ghl.ts`; empty facts fail rendering. Do not repeat the earlier “registry-only fix” claim.
5. **False residual savings generation is removed.** The worker no longer derives merchant savings from Liberty residual income or substitutes “significant savings”. Retained copy still needs repair: it now encounters an unresolved token rather than fabricated savings.
6. **Server draft checks improved.** HTTP save/discard/publish require expected draft identity, compare under the parent lock, return conflict metadata and preserve the system convergence draft refusal. Publish has replay handling. This is a substantial N03 repair, with a remaining client parent-version problem in R03 below.
7. **Read-only grouping is honest about side effects.** It does not delete, retire, activate or enroll; current pins resolve at runtime. Actual grouped step counts replace cached totals. Group labels are editorial, not authorization or canonical ownership.

## 4. Eight repair groups

| Group | Priority | Core correction | Evidence strength |
| --- | --- | --- | --- |
| **R01** | P1 completion | Finish the real campaign/sequence/package authoring workspace and safe premium-copy adoption | Live UI + source + explicit repo shortfall |
| **R02** | P1 authorization | Reconcile shared catalog visibility with manager-scoped authoring/journey reads | Complete source call chain; no live manager impersonation |
| **R03** | P1 concurrency | Preserve the editor's parent version and pending local work through conflict/refetch/save | Source-traced payload counterexample; no production mutation |
| **R04** | P1 content | Repair stored selected/reusable wording and actual CTA intent, not just seeds/code/generated proposals | Fresh live stored bodies/read DTOs + source |
| **R05** | P1 correctness | Finish shared booking/link validation across consumers, publication and final render | Live dead calendar target + executable pure counterexamples |
| **R06** | P2 preview | Make non-SFP previews use the actual asset's render/signature/purpose/transport inputs | Source mismatch; live SFP path passes |
| **R07** | P2 UI/data | Repair URL history, lifecycle grouping, cadence semantics, inventory labels and read states | Actual Back walkthrough + live grouped rows + source |
| **R08** | P1 acceptance | Make CI/input provenance reproducible, register correct gates and finish actual role/browser evidence | Both new gate failures reproduced on clean main |

### R01 — finish the actual authoring workspace and package adoption

**Confirmed shortfall.** The Campaigns sidebar still opens `OutboundCenter → Campaigns.tsx`, which shows the old mixed flat list of current and superseded packages and SDR sources. `Campaigns.tsx`, `Sequences.tsx` and `OutboundCenter.tsx` were not migrated in the reviewed 4C1 diff. The new `ContentWorkspace.tsx` is mounted only below templates in `GhlSettings.tsx`. Its rows are plain cells without an Open content/editor action. Its UI explicitly states package publication is unavailable. Twenty-five generated code proposals are not durable operator drafts; the twelve warm/service baselines are returned by the API but not adopted into working content authoring.

**Required repair.**

- Put the shared content workspace in the original canonical Campaigns/Sequences entrances. CurrentSFP first; Sales library, Merchant lifecycle, History and Diagnostics remain secondary views. Keep the eleven-entry sidebar and all existing deep links.
- Each authorized asset has a real Open content action, correct asset/step context, permission/state-aware fields, complete preview, draft save/discard, history/diff and explicit content publication. Keep historical/diagnostic inspection distinct from runtime selection. Do not build another disconnected catalog.
- Complete the original SFP paired draft/publish command using `cro03/sfp-launch-content.ts`, `sfp-campaign-packages.ts` and existing locking/hash authorities. Compare expected package version/content/presentation and draft identity, update campaign+sequence content atomically, invalidate content approval, preserve home IDs/step history, create the new immutable version and transactionally audit.
- Store the 25 proposals as editable, versioned review drafts or provide an explicit Adopt as draft action with idempotency. Keep their proposed5touch cadence editable; support both existing3touch and5touch versions. Do not append steps to started journeys, reset progress, clone another five programs or release recipients.
- Before publication check real dependencies and started/effected journeys, not only the displayed counter. Use existing stale-package/never-started preparation handling. Unsafe application remains a reviewable draft with an exact reason.
- Route generic single-sided campaign/sequence mutations for pinned content through this authority or fence them. A read-only panel elsewhere does not close the generic drift entrance.

**Files:** `ContentWorkspace.tsx`, `Campaigns.tsx`, `Sequences.tsx`, `OutboundCenter.tsx`, existing typed destination codecs; `templates-settings.ts`, `campaigns.ts`, package draft/publish owner; `sfp-launch-content.ts`, `sfp-campaign-packages.ts`, relevant command/schema authorities.

**Proof:** actual handlers for paired atomicity/rollback/stale hash/replay/active and started-journey refusal; no send/control effects; browser edit/reorder/add/delete draft steps, save/reload/diff/preview/publish on isolated records;3and5touch version/cadence compatibility; all175 old register rows reconciled to current inventory without forced count restoration. This was original F11/4C1 work, not optional4C2 scope.

### R02 — manager overview adds unscoped operational data

**Confirmed source scope inconsistency.** `server/routes/templates-settings.ts` allows admin and manager on `GET /api/content-workspace/overview` but discards the request actor and calls `getContentWorkspaceOverview()` without arguments. That service executes unscoped SQL for every campaign, sequence, enrollment aggregate and package. In contrast, both existing `GET /api/campaigns` and `GET /api/sequences` explicitly filter via `canMutateOwnedCampaignObject(req, createdBy)`: admin all, manager matching creator ID/email only. The new response adds foreign-asset status, step counts and per-sequence journey dependency aggregates beyond those scoped lists.

**Narrowing/disproof:** the earlier `GET /api/admin/catalog-truth` is intentionally whole-population and already permits managers to read asset names, IDs and package ownership. Therefore foreign names alone are not proof of a newly exposed secret or an unauthorized catalog read. The missing reconciliation concerns the added operational aggregates and the authoring/resource scope, not a requirement to erase intentionally shared catalog facts. No approved policy for making every foreign enrollment aggregate manager-readable was found. No agent/merchant access, all-asset mutation or production manager exploit is claimed.

**Repair:** pass an authenticated, validated actor/scope into the operational reader. Separate intentionally shared catalog metadata (using its existing approved DTO) from owned authoring and journey metrics. Apply the existing ownership predicate in SQL to operational rows/aggregates before returning them, unless an already-approved read policy explicitly grants a broader scope. Do not globally loosen manager mutation permissions or infer extra aggregate access from shared package names. Preserve admin full view and agent/merchant denials. Add private/no-store response behavior as appropriate.

**Proof:** real HTTP route fixtures for admin, own manager, foreign manager, agent, merchant and anonymous; compare operational IDs/counts to existing scoped readers and shared metadata to the catalog DTO. Unauthorized journey aggregates cannot leak through totals, while intentionally shared catalog names remain available. Include mixed ownership with more than500rows and unavailable/error states. Add this exact route to role/API coverage.

### R03 — remaining editor parent-version and save-response races

**Confirmed source-traced parent-version defect.** `MessageTemplateEditor.tsx` now retains the draft token loaded with the fields, but Save sends `baseVersion: ws!.template.contentVersion` from the **freshest query**, rather than the version used to seed those fields. The dirty guard keeps local text and sets `remoteChanged`, but `canSave = canEdit && !!t && dirty` does not block/reconcile that condition.

Counterexample traced through the real expressions:

1. OperatorA opens live version1, no saved draft; fields=A and `baseToken=null`.
2. A edits locally. OperatorB publishes version2, leaving no draft; refetch updates `ws` to version2.
3. The effect preserves A's dirty text and reports remoteChanged, as intended.
4. Save nevertheless sends **baseVersion2, expectedDraftToken null, A's version1-based text**.
5. Server's parent-version and absent-draft comparisons now both succeed. The stale editor has silently rebased its text onto version2 instead of conflicting on the version A reviewed.

The executable audit model verifies that payload construction and source anchors. It is **not** a mounted two-actor test or a production save.

**Additional same-scope risk:** successful save sets `expectReseed=true` and refetches without comparing the current local edit revision with the submitted revision. Inputs remain editable during mutation. A user who types while save is pending can have the newer local text reseeded from the earlier saved body. Exercise and repair this in the mounted test; no production data-loss incident is asserted here.

**Repair:** retain `{parentVersion,draftToken,assetId,actor/permissionScope,localRevision}` together when seeding. Save/discard/publish use that retained identity. A parent change requires explicit conflict/review/rebase and disables unsafe save/publish until resolved. Capture the submitted text/revision; acknowledge only that revision, preserve edits typed while pending, and fence late responses when asset/actor/permission changes. Do not clear dirty state merely because a newer query arrived. Keep backend CAS/transactional audit/replay protections.

**Proof:** mounted two-actor no-draft→publish→refetch→stale-save flow; ordinary draft replacement conflict; typing during pending save; discard/publish replay/lost response; actor/permission/asset switch; background refetch and stale preview cannot overwrite current work. Existing direct service checks alone cannot prove the editor's submitted identity is correct.

### R04 — stored copy and CTA intent remain unrepaired

**Fresh live facts:**

| Stored item | Still present after publication |
| --- | --- |
| Template1 Proposal Email, v1 | “Book a10-minute call”; new lint flags it. Real cost-driver token now supported. |
| Template6 90-Day Reactivation, v1 | Same unverified10-minute duration; lint flags it. |
| Workflow7/11/12/13 email steps | Literal `https://libertybancard.com/apply`, a dead route; all four show new retired_link findings. |
| Workflow4 email / workflow5 SMS |10-minute /10-min wording still flagged. |
| Application reminder SMS | Scheme-less `libertybancard.com/apply` remains in retained text; literal-link checks also need scheme-less cases, not just http(s). |
| Sequence36 steps4/9 and sequence84 step2 | `{{estimatedSavings}}` remains. The residual fallback was removed, so these branches now block on unresolved content. |
| Sequence36 step8 | Dead `/terminals`, plus unverified fast-go-live, equipment/contract and pricing assertions requiring review. |
| Sequences85/86 | Dead `/upload`. |
| Sequence91 | Dead `/apply`. |
| Sequence93 /94 | Dead `/refer` / `/partners/portal`. |
| Sequence84 step2 / sequence36 steps4/9 | “Upload a statement” or “Complete application” text points to a **booking widget**, a valid URL with the wrong action. Replacing dead-path strings alone cannot repair intent. |

All147 installed campaign/sequence step collections were read. The26 legacy booking-token occurrences remain in the stored sequences, but the alias now resolves; those occurrences are credited as supported, not counted as26 open defects. Historical copy is not to be rewritten indiscriminately.

**Root cause:** updating seeds/services and exposing static proposals does not update installed workflow/template/step rows. The repo receipt explicitly says existing rows retain wording until an operator publishes reviewed content. Some current new lint findings also are not run in the existing final stored-template/workflow send chain: `ghl.ts`/`workflow-executor.ts` use token renderers, not the complete new literal-link/content contract. A preview warning is not proof an already-active stored template cannot reach a transport once sending is otherwise permitted. Global outbound is still paused.

**Repair:** finish the per-asset selection/disposition and source/version/hash-checked content adoption workflow in4C1. For every current/recommended reusable branch, publish or prepare its corrected durable content through the relevant guarded owner, recording old/new hashes and event/CTA prerequisites. Keep operator changes/drafts protected and convergence idempotent; no seed-time overwrite. Historical/diagnostic content remains readable with warnings, and stays blocked from new operational selection as its authority dictates. Do not infer existing resource facts merely from a template's name.

Use neutral savings/review wording; real merchant savings only with the approved analysis source. Distinguish new merchant intake from a saved-application continuation and from a pricing proposal. A real scoped resume/proposal link is required for those CTAs; otherwise honest reply-for-help. Secure documents use `/upload-statement`, not booking. Account-service calendars cannot silently become acquisition calls. Preserve consent/purpose and native4C2 execution ownership.

**Proof:** refreshed all-asset repair map including exact affected step IDs and action intents; same-scope preview/final-render tests; no dead/mismatched href in selected reusable content, no residual/model value presented as merchant savings; missing event/resource branches explicit; operator-draft refusal and repeat convergence no-op. Do not enable delivery or mutate production records just to obtain audit evidence.

### R05 — shared booking and link-safety contract is incomplete

**Remaining live calendar defect:** `/book` works, but `GET /api/ghl/calendar-url` still returns `.../booking/YFily7oIOUXN2qZZPnOr` (lowercase l), whose page renders404. `ghl.ts:getCalendarBookingUrl` still uses `getConfig().calendarId` and builds a different widget URL. The working adapter uses `resolveSalesBooking` and uppercase-I ID. This defect remains in current main as well as the serving build. One working CTA is not one shared authority.

`workflow-executor.ts` still supplies `/book` unconditionally instead of checking shared booking availability. It can render a booking link even when the adapter would be unavailable. The typed `account_booking` CTA is hardcoded unavailable despite an observed existing account calendar, rather than implemented as a separate authorized configuration. Do not assume the appropriate account config exists; trace it and expose a truthful separate state instead of falling back to sales.

**Executable validation counterexamples:**

- `validateHref('javascript:alert(1)')` correctly rejects it.
- `findUnsafeLinks('<a href="javascript:alert(1)">Open</a>')` detects it, but **publication `lintCopy(...,'template')` returns no findings** for that same content.
- `findUnsafeLinks` misses single-quoted and unquoted javascript hrefs because its href extractor accepts double quotes only and the prose extractor does not identify those schemes.
- `<a href='/apply'>Continue</a>` passes both scans. Existing stored SMS can also use a bare-domain dead path.
- The renderer **does reject** literal `[sales_booking]` placeholders; credit that protection. Do not claim bracket markers can ship based on these href tests.

These are exact pure-function/source findings, not a demonstrated browser XSS exploit or unauthorized user publishing content. The newly claimed all-path safety contract is not yet enforced across the authoring/final-render chains.

**Repair:** delegate calendar API and workflow/template/sequence consumers to one case-preserving, purpose-aware resolver, retaining optional authorized prefill semantics without logging personal query values. Do not silently normalize IDs or broaden sync controls. Fail missing required booking config truthfully at publication/final render. Account and sales are separate mappings.

Extract/normalize hrefs using existing suitable parser/sanitizer tooling or a complete dependency-free implementation covering quote forms, entities, relative first-party paths, dangerous schemes and scheme-less text links. Validate actual final URLs and required-resource intent, not only source regex. Wire the same checks into publication and final render before any transport. Preserve allowed unsubscribe, tel/mailto, images and purpose-specific first-party routes. Do not add arbitrary host exceptions or remove SFP checks to make new copy pass.

**Proof:** shared booking API/adapter parity including the exact case mismatch, missing/disagreeing config, account-purpose separation; unsafe href forms, relative/bare retired URLs, encoded forms, query punctuation and legitimate links; selected content's preview and final hrefs agree. No native booking/write is needed for these repairs.

### R06 — finish final-preview fidelity outside SFP

**Credit:** all25 SFP preview compositions passed live. Stored-template/workflow previews continue to label GHL HTML-only and unknown sender facts honestly. Dark inversion is a simulation, not native mail-client evidence.

**Source mismatch:** `message-final-preview.ts:previewStepForTransport` accepts only subject/body/transport. The Gmail branch runs `previewMessage('template',...)` with generic template personas and always appends `getEmailSignatureHtml('accounts')`. The actual sequence worker runs its own interpolation and chooses `resolveSignatureType(sequence.triggerConfig)` before composing. Those differ for support/onboarding/partner/etc and for token support. For example the new template registry can fill deal cost-driver tokens from its sample persona, while the legacy sequence interpolator has no corresponding replacement. The preview can show a clean result the actual sequence renderer would refuse. No asset identity/purpose/step configuration is provided to resolve the difference.

The old Campaigns Manage Steps body preview remains the old body-only path. The new final-preview endpoint is only exposed for static premium proposals, not the actual campaign/sequence editing surface.

**Repair:** share actual pure render/signature/purpose/payload assembly functions with the owning sender. Preview receives an authorized asset/step/draft identity or an equivalent strictly validated fixture configuration, rather than letting arbitrary transport selection masquerade as a specific asset. Preserve SFP sender-policy/SMTP-only, Gmail department rules, template/workflow GHL facts and true text-part reporting. Missing facts or configuration remain unavailable. Do not invent native From/Reply-To identities.

Add actual selected-step previews across editable Campaigns, Sequences and local workflow/template contexts, all personas and supported variants; enforce preview generation/asset/actor fencing. Do not leave a prior preview visible as current after a failed/new render. Keep no-store/bounded sample endpoints and sandboxed frames. No production send is required.

**Proof:** content and metadata equality with final assembly for at leastSFP,cold non-SFP,Gmail-support,Gmail-onboarding,stored-template/workflow; token/context mismatch refusals; signature/footer exactly once; actual text/HTML transport properties; delayed failed preview, permission and asset switch. Dedicated HTML-only/reference-text labels are not substitutes for matching the body and purpose.

### R07 — navigation, grouping and metric semantics

**Confirmed live navigation:** click Sales library, then Diagnostics, then browser Back. Back returns to Campaigns, skipping the prior content view. `ContentWorkspace.tsx` uses `window.history.replaceState`, keeps selected tab only in `useState(initialGroup)` and has no popstate/typed-codec integration. It is not the required user-choice history behavior. Duplicate/invalid selectors lack the established issue notice and role-aware reconciliation.

**Confirmed grouping:** the broad name regex puts all13 `V-*: Account Management Ops` sequences and sequence1151 `90-Day QBR & Upsell` in Sales library. Their static reviewed recommendation and intended account-service purpose differ. This does not prove a new send-policy bypass—the grouping is read-only—but it is a misleading working destination for the consolidation.

**Confirmed cadence:** live table says “Cadence (days)” and displays `0 / 3 / 5`, which are **relative delays**, not send days. Existing content is day0/3/8. The proposal list shows cumulative day0/3/7/12/18. Without labels this invites the wrong comparison. `delay_hours`, timezone/weekday rules and scheduled versus relative timing also need their proper representation.

**Inventory truth:** CurrentSFP(10) counts asset rows but displays5package rows. Static disposition says unresolved0 because it assigns editorial recommendations; authoritative live catalog says unresolved127. Neither figure should be presented as the other. The static census still says23campaigns/175assets; current read says20/172. The overview's seven sequential independent queries also have no one-read deadline or coherent database snapshot; concurrent publications can mix row/step/pin generations. No live timeout or concurrent-read inconsistency was induced here.

**Repair:**

- Use existing URL codecs and push/history listeners for user choices; preserve unrelated query/hash; reload/Back/Forward/direct invalid/duplicate states work. Use entity-scoped deep links for step/editor selection.
- Group from reviewed purpose/family metadata and existing package authority, retaining an explicit editorial recommendation and unresolved state. Name regex is a fallback with a review reason, not the final purpose owner. Do not mass reclassify records or rewrite runtime policies.
- Label package count versus asset count; show relative delay and cumulative day separately with actual scheduling caveat. Retain source/as-of/availability, don't show failed reads as0.
- Give overview/premium-query errors an explicit unavailable notice and Retry; premium-data failure is currently not surfaced by the component's `isLoading/problems/families` rendering. Add a bounded/cancellable authorized snapshot read suitable for this small catalog; preserve complete grouped counts rather than sampling.
- Refresh the census/repair map under a timestamped snapshot and explain changed IDs without inventing history. Any source/disposition disagreement is recorded for review, not made to disappear by a label.

**UI refinement within original design:** keep existing Liberty colors/IBM Plex/type/spacing and1120 workspace variant; use one selected-step rail + compose/preview canvas so operators do not need25 expanded iframes deep in integration settings. Display human titles and concise status; put hashes/dependencies in expandable diagnostics. Open content must be clickable. Keep actual375/600canvas width in contained labelled scrollers, not document overflow. Sticky action/dirty/conflict status remains reachable at390px and200%zoom. These implement the original editor contract; no theme/sidebar rewrite is needed.

### R08 — clean-checkout CI and acceptance are not complete

**Failure1, reproduced:** `scripts/test-stage4c1-premium-drafts.ts` exits with ENOENT for:

```
attached_assets/Liberty-Stage4C1-Master-Preflight-and-Build-2026-10-31_1793469717746.md
```

Both generators hardcode that uploaded attachment path. It is absent from a clean checkout and is not tracked by Git. A Replit workspace's uploaded file is not a reproducible CI source. Generated module/manifest existence does not close this dependency.

**Failure2, reproduced:** `scripts/ci-suite-manifest.ts --check` exits1 with three errors. The manifest classifies244suites, but the mandatory-roster comparison sees241 and flags all three new4C1suites as stale:

- `scripts/test-stage4c1-cta-contract.ts`
- `scripts/test-stage4c1-premium-drafts.ts`
- `scripts/certification/test-stage4c1-content-workspace.ts`

They were added to `CERTIFICATION_FIXTURE_SUITES`; the current comparator checks `MANDATORY_SUITES`. Mere presence in pre-deploy.ts is not a passing manifest gate. The two pure suites should be registered/classified in the proper normal roster; the DB fixture's supported optional roster must be represented correctly by the manifest/runner contract. Do not make the check pass by dropping required tests or reclassifying DB work as pure.

**Evidence gaps:** no new mounted-browser suite was shipped for this workspace. The DB suite covers service CAS, previews, overview classification and the real `/book` route, but not new overview manager scope, actual template-editor refetch behavior or all new authenticated HTTP paths. No dedicated role-guard entries for these new endpoints were found. Repo receipts retain “uncommitted/not merged/not published” and preflight development-only status even though production now serves6777641f. Existing follow-ups are acknowledged, not evidence of completion.

**Repair:** check in the canonical reviewed copy source under a stable repo path and make both generators/tests use it; keep the original attachment as provenance, not an executable dependency. Inventory snapshots and generated outputs should regenerate deterministically without production credentials, with semantic assertions independent of the generator's own output. Wire suites into actual CI/fixture runners and manifest contract; extend API/role coverage.

Run mounted/concurrency/HTTP/browser gates for R01–R07, supported Node22/npm10 production build, relevant package/renderer/C3/GHL-control regressions and public-route checks for the booking adapter. Keep the standing no-full-TypeScript instruction. Do not claim all CI, native mailbox delivery or production role matrix passed from this audit's limited commands.

Update ledger/spec with the exact implemented/tested/merged/serving identities, actual current scope, remaining existing follow-up ownership and post-publish proof. Replace outdated status conclusions with dated superseding entries while preserving historical evidence. No task is closed solely because it merged.

## 5. Original audit reconciliation

| Original item | Current disposition |
| --- | --- |
| C1-01 / F07 savings semantics | Source generation repaired; live retained savings branches not repaired. R04. |
| C1-02 / F08 tokens | Booking alias and cost-driver real source repaired. Do not count their retained syntax as unsupported. Stored copy/duration/event work remains. R04–R05. |
| C1-03 dead/mismatched CTAs | Partial: working `/book`; retained dead/misdirected actions remain. R04–R05. |
| C1-04 calendar config/duration | Partial: working adapter, old calendar API still wrong and stored duration claims remain. Main's later follow-up is not live. R04–R05. |
| C1-05 / F11 package authoring | Not delivered; explicitly acknowledged by code/UI/docs. R01. |
| C1-06 / N03 draft concurrency | Backend expected identity repaired; parent-version/client pending-edit cases remain. R03. |
| C1-07 / N02 geometry | Widened template editor and real375/600canvas verified. Responsive/zoom proof outstanding; keep the repair. R07–R08 acceptance. |
| C1-08 final previews | SFP proposal previews pass all25; actual campaign editor and non-SFP parity remain. R01/R06. |
| C1-09 consolidation | Read-only secondary panel shipped; canonical working destination/group semantics still incomplete. R01/R07. |
| C1-10 copy/event quality | Generated proposals present; installed copy and event/CTA conditions remain unfinished. R04. |
| C1-11 purpose/transport preview | New API partly addresses it; Gmail/purpose/context mismatch remains. R06. |
| C1-12 five-touch upgrade |25proposals implemented as read-only code data; editable adoption/paired publication not delivered. R01. |

The new manager-scope defect, parent-version counterexample, validation integration gaps and reproducible gate failures are additional verified problems within this same repair scope. Do not turn each symptom/affected asset into a new build.

## 6. Checks actually executed in this audit

| Check | Result and limit |
| --- | --- |
| Fresh source fetch/identity and clean isolated worktree | PASS; main03fa438b, serving6777641f recorded separately |
| All live campaign/sequence step reads |147/147 collections,596steps, zero read errors |
| Template/workflow census |8workspaces +17workflow email/SMS readers; findings listed above |
| Premium UI full-preview sweep |25/25 render; all one signature/footer and no raw marker; intended hrefs |
| Template dialog/canvas |1120dialog;600desktop/375mobile canvas at1363viewport |
| Content-tab history |FAIL: prior selection not restored; Back skips content views |
| Booking adapter |PASS passive destination renders correct SalesMeeting30min |
| Old calendar API target |FAIL: returns different-case target that renders404 |
| `test-stage4c1-cta-contract.ts` |PASS55checks using existing tsx ESM loader on Node24; includes52purebehavior +3source checks. Not stockNode22 build evidence. |
| `test-stage4c1-premium-drafts.ts` |FAIL ENOENT on untracked attachment in clean checkout |
| `ci-suite-manifest.ts --check` |FAIL3stale-roster entries |
| Additional focused pure probes |Unsafe href/lint integration and relative link gaps reproduced; literal CTA bracket correctly refused. Parent-version payload model/source assertions reproduced, not a mounted race. |
| Diff/control/dependency inspection |No changes to GHL owner-control/runtime/pause authorities, theme palette or package/lock files in this task diff; global/incoming/outgoing authorities freshly read unchanged |
| App-source edits by auditor |None; review files/probes only outside repo |

The initial bundled test attempt relocated `import.meta.url` and failed a source-file lookup; rerunning the unchanged CTA suite through the existing ESM loader passed55. A separate bundling attempt pulled unresolved dependencies; that is not counted as a repository build defect. The premium suite's ENOENT was reproduced through the unchanged direct source loader and is the confirmed clean-checkout defect. The additional bracket probe initially expected acceptance; actual renderer rejection was credited and the probe expectation corrected. No candidate checks were weakened.

Not executed: full production build/CI/pre-deploy roster, disposable PostgreSQL concurrency/roles in this audit environment, actual390/768/1280viewport/200%zoom matrix, screen reader/native mail clients, manager/agent production login, production content mutations, real bookings or send effects. Chrome extension metadata errors were excluded from application defect claims. Do not call these unrun cases passes or confirmed failures.

## 7. Replit handoff — apply to existing 4C1 task/follow-ups

Use this message with this report; no original91KB prompt reattachment is necessary if it is already on the task:

> Reconcile this published4C1 audit into the existing4C1 task/follow-ups. Production serves6777641f; main03fa438b has a later unpublished booking/copy follow-up. Keep those identities separate. Full4C1 completion is not established: the proposal panel is read-only and safe paired package drafting/adoption/editing/publication is still missing. Preserve the verified25SFPpreviews,1120editor/375canvas, token fixes and backendCAS. Implement R01–R08 as grouped corrections under existing ownership, without creating eight new tasks. Prioritize manager overview ownership, retained parent-version CAS, portable CI/roster repairs and actual stored-content/link repairs. Finish the canonical Campaigns/Sequences workspace, editable premium drafts and safe paired package publication; those belong4C1, not4C2. Use actual purpose/context for previews, the shared booking authority across the older API too, and complete link validation in publish/final render. Fix Back/Forward, lifecycle grouping and relative-versus-cumulative cadence. Refresh inventory from current20campaigns/127sequences/8templates/17workflows without inventing why threecampaigns disappeared. Run real route/role/concurrency/browser tests and the supported build; do not claim tests from source text. Update ledger/spec with tested/build/serving identities and remaining4C2/4D scope. Keep outbound paused, outgoingGHL owner-paused(epoch16)/permissions retained and incomingGHL enabled. No production content mutation, native write, activation, provider job or send solely for verification; no fullTypeScript, globalCSS/dependency/lockfile churn. Follow normal merge/publish, then passive production smoke of the exact repair candidate.

### Acceptance before closing 4C1

1. The existing canonical navigation opens the working content editor, every permitted action is correct and current package content is safely adoptable as reviewed drafts.
2. New/old readers obey the same resource scope; two-editor/refetch/pending-save flows preserve the reviewed parent/draft and unsaved work.
3. Selected/reusable stored content has correct CTA intent, actual event/resource requirements and no blocked false savings/duration/dead-link branches. History remains intact.
4. Preview equals the owning final assembly, while simulation/native delivery boundaries remain explicit.
5. Clean checkout can regenerate/test copy and inventory; roster/manifest, role/API/route and required mounted/browser gates pass; supported build and rollback compatibility recorded.
6. Final repair build is actually served, content/read/control smoke passes, and ledger/spec accurately distinguish4C1 completion from4C2 native execution and4D integrated acceptance.

**No outbound or GHL activation is authorized by this audit.**
