# Liberty Stage 4C1 — Campaign, sequence and message content workspace

**Master Replit preflight + build task · October 31, 2026 · one implementation task with six review checkpoints**

Use this file as the complete task. It contains the fresh source/live audit, every campaign and sequence ID, template/workflow inventory, repair lineage, premium copy drafts, link rules, Liberty UI specification, kill lines and acceptance gates. No other audit attachment is required. Read the current repository ledger/spec for intervening changes; earlier reports are supporting history.

**Run preflight in Plan Mode, then implement in Build Mode within this task.** Credit existing implementation. Rebaseline source, deployment, controls and dependencies before editing. Do not stop at a new audit, clone five more campaigns, or equate publishing content with enabling delivery.

## 1. Outcome, scope and boundaries

Give Liberty one clear content workspace in which an authorized operator can identify the right program, review every touch, edit useful copy, choose a correct purpose-specific CTA, see the actual assembled message, save a conflict-safe draft and publish a traceable content version. The primary acquisition path is the **five current SFP packages**, fed by the canonical enrichment/preparation system repaired in 4B. Other useful sales and merchant-service sequences remain available by purpose. History and test-labelled records stay intact and out of the default working view.

Owns previous **F07, F08, F11, N02 and N03**, plus their shared CTA, preview, inventory and copy-quality symptoms identified below. These are repair groups, not additions to the historical 95-entry Stage 3 register. The task includes actual reviewed writing and usable editing tools; an attractive list over unchanged broken content is insufficient.

Deliver:

1. Full, reconciled asset inventory with evidence-backed current ownership, proposed use/disposition, dependencies, content health and one canonical editing destination per asset.
2. Premium five-touch SFP draft packs for the five canonical verticals, plus coherent reusable sales/service wording. Preserve source attribution and useful existing content. No unsubstantiated conversion-winner claims.
3. Safe editable campaign/sequence/package, stored-template and local workflow message fields, with step management, validation, diff/history, concurrency and recovery.
4. One purpose-aware token/link contract shared by linting, previews, publication and final render boundaries; correct booking, statement, proposal, application, referral and account-management destinations.
5. Full final previews with real transport/purpose, sender/reply-to availability, signature, logo, footer, desktop/mobile, text and images-off views. Simulation is labelled.
6. Liberty-branded responsive authoring UI, meaningful registered tests, production build and dated ledger/spec/roadmap receipts.

| Workstream | Ownership after this task |
| --- | --- |
| 4A | Shipped catalog/operational truth; reuse its catalog and readiness facts. |
| 4B | Current SFP supply, affiliation, enrichment, validation and preparation. Owner reports corrections landed; this audit does not re-certify all 4B gates. |
| **4C1** | Content inventory, premium writing, safe authoring/versioning, render/link repair and message previews. |
| 4C2 | Native GHL/calendar/SMS and journey execution, appointment correlation, reminders/follow-up effects, deleted-contact reconciliation writers and actual native content installation where needed. Reuse durable handoffs already shipped. |
| 4D | Integrated/native acceptance, full roles, real effect evidence and final serving-build qualification. |

Do not combine 4B and 4C into an uncontrolled rewrite. One 4C1 task may use six scoped commits/checkpoints below. Content-ready, content-published, send-authorized, sent and native-effect-verified are separate states.

## 2. Fresh audit — verified from source and live CRM

### 2.1 Evidence identity, coverage and limits

| Evidence | Independently observed October 31 |
| --- | --- |
| Current fetched main / clean reviewed checkout | `45c51437fefa07419e7e8170408f8e5eb02dfc87` |
| Production `/api/health` | `79f112016772ddf6d90aad177d9a38cead87c2d3`; built `2026-10-30T19:37:24.234Z`; publish `e2c6add9-8f1a-4c78-9cf9-0f972abd5f0b` |
| Source difference from serving build | One file, `server/index.ts`: main additionally logs non-API 5xx paths. Reviewed content/editor files match the serving source. Do not describe the two SHAs as identical. |
| Authenticated production browser | Admin signed in. Read Campaigns, expanded current SFP steps, opened body preview and inline edit without changing/saving; read Sequences and template settings; opened Proposal Email editor and its Mobile view. |
| Complete live asset reads | All 23 campaign headers and 80 steps; all 127 sequence headers and 517 steps; all 8 templates and their workspaces; all 17 local workflows and both email/SMS wording readers for each. No variant-B text is populated in the returned sequence steps. |
| Current package checks | Package-v2 and launch-content-v2 verification both `ok:true`; all five current packages have 3 steps and matching content checks. Catalog pins resolved below. |
| Catalog snapshot | `available:true`, whole-population scope; asset counts current 10, historical 10, unresolved 130, template 0; 5 uninstalled package keys reported separately. The 150 installed campaign/sequence assets are not 150 launch programs. |
| Safety authorities | Global pause `paused:true`, database epoch 1. Outgoing GHL `enabled:false`, `permissionsEnabled:true`, epoch 16. Incoming GHL `inboundEnabled:true`, `configured:true`. No controls changed. |
| Pure source probes | 8 checks passed against the current renderer/linter: unsupported proposal field, supported calendar field, unsupported legacy booking token, residual currency/semantic demonstration, generic role greeting, missing calendar rejection and escaped literal replacement values. First probe expected an unescaped ampersand; corrected that audit expectation to match the valid escaped HTML, then all 8 passed. |
| Not executed in this audit | Production SQL/dependency joins, live content mutations, two-operator race, manager/agent browser sessions, responsive viewport changes, disposable PostgreSQL tests, stock Node22 build, CI, email sends, actual bookings, native GHL workflow bodies or mailbox delivery. These are build/4C2/4D evidence requirements, not reported passes. |

Repo guidance: `replit.md`; no `AGENTS.md` found at audit time. Preserve unrelated checkout work. Use the repository's supported Node22/npm10 environment for build evidence; this audit's pure probe used the existing Node24 installation. No dependency installation, full TypeScript check, application edit, commit or publication was performed for this audit.

### 2.2 Live inventory totals and recommended use

| Collection | Complete live census | Recommendation, not a production reclassification |
| --- | --- | --- |
| Campaigns | 23; 22 draft, 1 active; 80 actual steps; displayed recorded sends all 0 | Default to the 5 current SFP packages. Keep 10 SDR campaign sources as reusable reviewed library material; 5 superseded SFP copies in history; 3 test-labelled assets in diagnostics pending dependency proof. |
| Sequences | 127; 32 active, 95 paused; 5 of the paused records have `retiredAt`; 517 steps | 5 current SFP, 5 historical SFP, 5 recent lifecycle, 10 W6, 30 active legacy vertical/core, 54 older library and 18 test-labelled records. Status does not establish selection, permission or delivery. |
| Sequence actions | 318 email, 129 SMS, 29 call, 24 voicemail_drop, 14 task, 2 call_reminder, 1 wait | Preserve channel intent. Never turn cold manual calls into automated SMS/voicemail or flatten service sequences into cold acquisition. |
| Stored templates | 8: 6 email, 2 SMS; all active flags true; 1 currently fails supported-token lint | Keep purpose-specific reusable content with versioned editing. Active is not proof it can send or should be selected. |
| Local workflows | 17 enabled definitions, 13 email steps and 8 SMS steps across 10 workflows; 7 have no direct email/SMS wording steps | Inventory all actions and references. A zero wording count may mean task/branch/template-reference logic, not missing automation. |
| Native GHL | Stored safety review contains 14 remote workflow metadata entries | Stored review is not a fresh native-content census or installation proof. Carry native body/mapping diff to 4C2; do not toggle or fetch/install remote workflows through application jobs in this task. |

The catalog's 130 **unresolved** installed assets must not be relabelled historical/current merely from their names or UI group. Recommended library use is a separate field from authoritative package ownership. Current SFP content is already installed and verified, but catalog qualification is **no** because campaign content revision is unapproved; global sending is paused, this serving profile does not select the sequences queue, and operating/native receipt evidence is unavailable. Preserve those distinctions.

### 2.3 Current SFP pins — facts, not selection constants

| Package key | Campaign | Sequence | Current package version |
| --- | ---: | ---: | --- |
| `sfp.automotive.v2` | 82 | 1153 | `410a59f7-4ffe-4ac7-9810-5754f9ce1d8b` |
| `sfp.healthcare.v2` | 83 | 1154 | `a77216dc-6b5c-4056-b6e0-542011408e23` |
| `sfp.beauty_spa.v2` | 84 | 1155 | `7a250e3f-b131-4128-a1a8-52a8b060e75c` |
| `sfp.construction_trades_home_services.v2` | 85 | 1156 | `32331bad-bd62-4a8b-a43c-56b1e571ced6` |
| `sfp.fitness_recreation.v2` | 86 | 1157 | `4fe7ca6d-8a3d-4909-91d9-a32d8768a728` |

Resolve current versions and pins from the tables/catalog at runtime. Never hardcode these IDs as the selection algorithm. Campaigns 87–91 / sequences 1158–1162 are superseded copies; their sequences are retired and paused. Preserve package/version/step/enrollment history.

### 2.4 Findings and exact repair destinations

| ID / lineage | Verdict and evidence | Required repair / files |
| --- | --- | --- |
| C1-01 / F07 | Confirmed source defect. `sequence-worker.ts` computes `estimatedSavings` from `estimatedResidual * 12`, or inserts “significant savings”. Live sequences **84 and 36** use the token. Currency-shaped values produce NaN; plain numbers still describe Liberty residual income rather than merchant savings. Not evidence of a current SFP/GHL financial projection. | Remove residual-derived savings and speculative fallback from customer wording. Use neutral review copy, or an independently sourced, dated, merchant-specific approved analysis value only where a real reader exists. Patch live render/publication boundaries and affected content via reviewed versions. `sequence-worker.ts`, shared token/context authority and reviewed copy manifest. |
| C1-02 / F08 | Confirmed unsupported token in **26** sequences: 24,25,27,28,30,31,33,34,55,56,58,59,61,62,64,65,67,68,70,71,73,74,76,77,79,80 use `{{custom_values.booking_link}}`. Sequence interpolation does not fill it and rejects remaining tokens. Template **1 Proposal Email** uses unsupported `{{deal.topCostDrivers}}`; live editor accurately flags and blocks publication. | Purpose-specific token support and migration map; replace only through reviewed content versions, not global string substitution. Keep unresolved-token blocking. Remove topCostDrivers or implement a factual source end to end; do not add it to the registry alone. `message-token-registry.ts`, `message-render.ts`, `sequence-worker.ts`, `message-copy-lint.ts`, templates/workflow/campaign services. |
| C1-03 / F08 | Confirmed dead first-party CTA destinations. Browser shows 404 on `/book`, `/upload`, `/apply`, `/refer`, `/terminals`, `/partners/portal`; none is registered as the intended App route. `/upload-statement` works. Sequence **85/86** use `/upload`; **91** `/apply`; **93** `/refer`; **94** `/partners/portal`; **36** `/terminals`. Workflow **7/11/12/13** contain `/apply` in message bodies. Workflow calendar tokens resolve in code to `/book`. | Central typed CTA resolver with purpose, resource/event scope and availability; exact mappings in §4. Route repair is narrow content-link work, not public-site redesign. Recipient-specific proposal/application URLs require the real authority. Do not replace every link with a generic homepage or globally redirect a stale application URL into a fresh uncorrelated application. |
| C1-04 / F08 booking | Confirmed configuration/consumer mismatch. GET `/api/ghl/calendar-url` returns booking ID **`YFily7oIOUXN2qZZPnOr`** (lowercase l); its widget renders 404. Upload page/sequence fallback uses **`YFiIy7oIOUXN2qZZPnOr`** (capital I) and renders **Liberty Bancard — Sales Meeting, 30 min**. Several messages/upload CTA promise 10 minutes; that does not match the inspected calendar. Old plural `/widget/bookings/libertybancard` also renders Sales Meeting, 30 min. Account calendar `kBRoNz5XoTpddupMQg0c` renders Account Management, 30 min. | One resolver, case-preserving validated config and separate sales/account purposes. Correct the config through supported configuration handling without changing GHL synchronization controls. Do not silently choose among disagreeing IDs or change remote calendar duration. Use “Book a review call” unless authoritative duration is deliberately adopted. `ghl.ts:getCalendarBookingUrl`, `integrations.ts`, `workflow-executor.ts`, `sequence-worker.ts`, public booking CTA consumer. |
| C1-05 / F11 | Confirmed missing operator package publication workflow. Generic Campaigns inline edits are exposed for pinned SFP assets. `populateOne` already locks and pairs campaign/sequence steps, keeps home IDs and creates a new package hash/version, but takes code-defined 3-touch drafts and rejects same-version live drift. Generic editing is not paired package publication. | Extend existing package authority into reviewed operator drafts/publish with paired rows, hashes, locks, drift checks and dependency handling. Do not replace it with a parallel package installer. `cro03/sfp-launch-content.ts`, `sfp-campaign-packages.ts`, `Campaigns.tsx`, `Sequences.tsx`, routes and command services. |
| C1-06 / N03 | Confirmed source concurrency gap, not a live race experiment. Template save compares parent published version but overwrites the shared current draft; discard deletes whichever draft exists; publish validates parent version then consumes whichever draft exists. No expected draft revision/content identity. Locks serialize writers but do not preserve what the reviewer reviewed. | CAS on save/discard/publish using published version + draft identity + revision/hash, with 409 recovery preserving local edits. Extend existing DTOs/services/editor; preserve atomic audit and `publishSystemWording` refusal when an operator draft exists. |
| C1-07 / N02 | Confirmed code and live geometry. CRM DialogContent forces max560px after caller classes. Proposal editor at viewport1363 is 560px with a **237.5px** final-preview iframe. Mobile toggle remains 237.5px because maxWidth100% shrinks requested375. | Scoped content-editor size/layout variant and true device-canvas measurement. No blanket dialog/public CSS replacement. `ui/dialog.tsx`, `MessageTemplateEditor.tsx`, `MessageFinalPreview.tsx`, campaign/sequence/workflow editors. |
| C1-08 / preview | Confirmed Campaign step preview is body-only with sample Alex/Your Business, explicitly deferring compliance footer until send. It omits the actual SFP sender-policy signature/logo/full transport assembly. | Reuse final assembly for the selected path; show body-only as such until final composition succeeds. Current stored-template/workflow final preview is already richer and truthful about GHL HTML-only payload; preserve it and add correct purpose/transport selection. |
| C1-09 / consolidation | Confirmed live usability gap. Current and superseded SFP copies, test-labelled campaigns and all SDR sources share the flat list; sequence default view shows test-labelled Cold Outreach entries prominently. Existing catalog can distinguish authoritative classes but does not drive the full authoring UX. | Current SFP first; secondary library/lifecycle/history/diagnostics views, linked campaign+sequence identity and rationale. Reuse catalog-truth and existing hub URLs; no new sidebar entries. |
| C1-10 / copy quality | Confirmed wording/evidence issues. SDR-01 claims “Highest conversion cold sequence” while displayed campaign sends all0; workflow application reminders assert saved/ready application, but a generic `/apply` does not identify it. Templates can claim analysis completed without a required event contract. This audit does not establish whether each historical trigger had the necessary fact. | Remove unsupported ranking. Bind fact-dependent statements to actual source events/resource IDs or use conditional neutral wording; classify missing event proof as unavailable. Review “0%”, fee/funding/approval/equipment/integration claims against existing approved claim sources, without promising results. |
| C1-11 / purpose | Source-confirmed limitation: generic `buildFinalEmailPreview` always assembles `marketing_outreach` and labels GHL Conversations HTML-only. SFP launch enforces SMTP; non-cold sequences use Gmail and block fallback. | Purpose/transport-specific preview adapters using existing composers and payload builders. Do not label every template transactional or every sequence SMTP. Preserve receipt purpose/enablement and SFP no-GHL-fallback. |
| C1-12 / explicit upgrade | Proposed, not a defect: all current SFP packs are already safe 3-touch day0/3/8 drafts. User wants premium multistep content and richer controls. No conversion evidence establishes an optimal cadence. | Build the proposed **5-touch day0/3/7/12/18** copy below as editable, reviewed drafts with exact CTA semantics. Extend cadence/version contracts safely; do not append steps to journeys already underway or auto-publish at startup. |

Credit existing workflow email/SMS editors, `expectedVersion` workflow commands, version history, draft/live distinction, role-name greeting normalization, HTML escaping, send-time unresolved-token rejection, signature/footer rules, package hashing, consent/suppression gates, recipient binding and effect idempotency. These are not missing features. Native publication, booking persistence and delivered-email rendering remain unproven in this audit.

## 3. Preflight and implementation checkpoints

### Checkpoint 1 — baseline, complete inventory and dependency evidence

Record branch/HEAD/dirty files, fetched main, serving health/build, migration metadata from the real journal/table, runtime selection, global/channel pauses, GHL outgoing control+truth and incoming control. No SHA freeze. Preserve the observed owner-paused outgoing GHL state and incoming enabled state; a later owner change overrides a numeric snapshot only when recorded from its authority, not guessed.

Refresh all collection counts and every row in Appendix A. Inventory subject/body and variant B, channel, order, relative delay, cumulative day, templates, trigger/family/purpose, package version/hash, content revision/approval, audience, owner, status, retiredAt, sender/transport, CTA kind/target/availability, token support, consent tier, provenance and recent fact/event dependencies. Include workflow actions referencing templates or generating messages indirectly, not only direct email/SMS arrays. Read native safety metadata as dated metadata; do not call it current remote content.

Join actual columns first, then aggregate dependencies: campaign_steps/sequence_steps, enrollments by status/currentStep, workflow/template references, package versions including superseded, staging intents, address commitments, ready-held enrollments/consumer items, runtime selectors and selection events. No production row bodies or credentials in receipts. Prior audit found real enrollments on test-labelled records, including sequence512; re-count before proposing any reclassification. Nothing is deleted or retired by this task merely because of its name.

Persist a machine-readable full inventory and repair matrix under `docs/certification/stage4-c1/`, plus readable disposition for **every** asset. Fields distinguish authoritative class from recommendation: `keep_current`, `reuse_reviewed_library`, `service_lifecycle`, `historical_read_only`, `diagnostic_review`, `unresolved`. These labels are proposed inventory metadata, not a new runtime authorization. Unresolved asset can remain inspectable and unavailable for selection until ownership evidence is present.

### Checkpoint 2 — token, claim and CTA authority

Extend the existing deterministic renderer and purpose registries; do not implement another regex-only preview interpolator. Maintain purpose separation (SFP cold, other sales follow-up, merchant service, transactional receipt, workflow/template, SMS). Define each token's source, type, null/zero behavior, consent/event/resource prerequisites, escaping and freshness. Alias mapping is explicit and tested. Unknown tokens fail publication/final render, never disappear silently. Never use residuals or modeled volume as merchant facts.

One typed CTA contract should carry kind, label, destination source, purpose, resource/event scope, required/optional status and reason unavailable. Proposed kinds: reply, secure_statement_upload, sales_booking, account_booking, proposal_view, application_resume, merchant_referral, partner_portal, product_information. Keep exact API names consistent with repository conventions; do not claim these proposed types/routes already exist.

Server rejects unsafe schemes, protocol-relative/external arbitrary hosts, JavaScript/data URLs, credentials in URLs, untrusted redirects and malformed substitutions. Validate final hrefs with URL parsing after token resolution and HTML decoding. A raw regex sees terminal punctuation in current plain-text upload URLs; trim syntactic punctuation without stripping legitimate path/query content. No production contact email/name prefill in audit URL logs. Preview uses reserved `.example`/`.test` personas and non-actionable sample resource tokens.

Remove false savings fallback and unsupported tokens from the selected/reusable copy. Retained immutable history stays readable with warnings. Do not bulk mutate historic step receipts or make previously unsupported values silently render. Legacy execution boundaries continue to refuse unsafe content; no send worker is enabled to test this.

### Checkpoint 3 — safe drafts and paired package publication

Use existing template/version, workflow command and SFP package services as owners. New package draft APIs, if needed, are **proposed** authenticated admin/manager DTOs with strict field allowlists and resource authorization. Agents/merchants cannot acquire authoring privileges through generic step routes. Metadata edits cannot inject status, approval, owner, package pins, sender identity or transport authority. Preserve CSRF/session defenses, existing command reasons, audit actor and idempotency.

Required draft identity: parent published version/hash, draft ID, draft revision or guaranteed unique mutation token, draft content hash and last author/time. Save, discard and publish all compare the expected identity under the same parent lock; first-create compares expected absence. Stale input returns409 with safe conflict metadata. No automatic overwrite; retain local unsaved work and provide Reload current / Copy my changes / review diff. Publishing must match the **saved content the operator previewed**, not whichever shared draft now exists. A retry of a committed publish returns its existing receipt; lost response has a recovery read. Switching actor, permission, asset or route cancels/fences previews and clears retained private state. Background refetch cannot reset dirty fields.

For SFP: lock current package and home campaign/sequence using existing authorities, compare expected package/hash/revision, validate paired ordered content, recompute actual content/presentation hash and create a new immutable package-version record atomically with the paired publication and audit. Preserve home IDs and step identities where semantics permit. Existing publisher permits edits on paused home rows and separately rejects active enrollments; **paused alone is not enough to prove a started journey can be rewritten safely**. Check all nonzero-currentStep or already-effected dependencies and package-bound commitments. If unsafe, leave the operator draft reviewable and refuse application to that journey; use the existing supported migration/stale-package preparation authority for never-started recipients. Do not reset progress, move recipients, release them or clone a replacement home sequence without a dependency-safe contract. Historical package records must retain sufficient immutable content/snapshot evidence to explain what was reviewed/sent, even though home rows can change.

Five-touch publication requires updating the code-defined builder/delay/source-to-launch map and consumers of cadence/hash identity; generic readiness already iterates actual rows and should not be weakened. Current 3-touch content remains valid until an intentional reviewed version change. Prevent generic single-sided edits of pinned content from bypassing paired publication. Route pinned assets to the package editor or return a stable conflict directing to it. Non-SFP assets retain their own guarded editor and version semantics. Preserve approvals as separate authority: new content invalidates prior content approval; it never grants launch approval.

Copy convergence is explicit, idempotent and source/version/hash-checked. Preserve operator changes/drafts; existing `publishSystemWording` already refuses a draft. No source-name-only overwrite, seed-time republish or hidden boot migration. Use the supported managed migration path for any necessary draft-revision schema; no build/startup DDL or assumed migration head.

### Checkpoint 4 — premium copy and complete authoring UI

Implement §4–§6 and Appendix B as working UI/content, not only documentation. Every editable field has source/permission/validation and a round-trip test. Every visible control performs its labelled action. Cover add/duplicate/reorder/delete draft step, undo before save, content diff/history, token insert, CTA selection, preview persona/device, save, conflict recovery, discard and publish. Active/historical/foreign-owned content follows its real guards. Destructive actions require the existing appropriate confirmation and cannot erase sent history.

### Checkpoint 5 — fixtures, browser, build and regression

Run §7–§8 with fake provider transports and disposable data. Use actual handlers/services and real mounted UI. Do not produce a green result by lowering assertions, disabling package hashes, skipping tests or labelling source text as browser evidence. Reproduce a suspected baseline failure on the actual matched baseline before calling it pre-existing. Keep six checkpoints within this task; record any genuinely unsafe dependent migration precisely while completing independent work.

### Checkpoint 6 — handoff, publish smoke and ledger

Provide exact tested/build/source identities, changed files, evidence receipts, migration/rollback compatibility and remaining 4C2/4D ownership. Follow the user's normal merge/publication process. After publication, verify serving SHA and passive UI/control readers. Do not send, activate, book, enqueue or mutate production content solely to prove deployment. Stage4 does not close with 4C1.

## 4. CTA, booking and event contract

| Intent | Current issue / verified destination | Required behavior |
| --- | --- | --- |
| First cold touch | Current SFP uses reply-first, no upload link | Keep one primary reply question. The real sender-policy Reply-To is shown or explicitly unavailable; a reply CTA is not a decorative button with `href=#`. |
| Statement review | `https://libertybancard.com/upload-statement` renders working form | Use this exact secure upload route, including plain-text parity. Do not email financial documents or send to `/upload`. A recipient-specific statement-upload token is only issued by its real scoped authority; no fake UUIDs. |
| Sales booking | Working ID `YFiIy7oIOUXN2qZZPnOr`; configured ID `YFily7oIOUXN2qZZPnOr`404; old plural slug renders same named sales calendar | Resolve from one validated sales-purpose configuration. Show target name/duration/config source and availability. Preserve case. Do not hardcode an observed ID as a new policy. Missing/disagreeing configuration blocks publication of a required booking CTA. No native calendar settings or sync controls changed. |
| Account review | Account Management calendar `kBRoNz5XoTpddupMQg0c` renders30min | Keep a separate account-purpose mapping; never redirect account support to cold-sales booking for convenience. No invented remote ID. |
| First-party booking link | `/book`404, workflow-executor constant points there | Prefer a narrowly scoped `/book` adapter/redirect that delegates to the shared verified sales resolver, with explicit unavailable state and no arbitrary `next` parameter. Register/test route and public validation if added. This also gives SFP a first-party booking URL without broadly admitting external widget hosts. Existing native appointment writer stays 4C2. |
| Application follow-up | `/apply`404; App has `/merchant-application` | New intake and resume-existing are distinct. A saved-application claim requires real matching application and safe scoped resume destination. Generic public application path only for new-intake intent. Missing resume authority: neutral reply-for-help copy with blocked resume CTA; implement existing resource-link reader if available, otherwise explicit4C2 handoff rather than false completion. |
| Proposal review | App has `/proposal/:token`, `/co-branded-proposal/:token` | Use existing proposal-link authority for the actual deal and audience. Never invent/persist production tokens in drafts or expose another merchant's proposal. Generic booking fallback must be labelled “Discuss options”, not “View your proposal”. |
| Equipment | `/terminals`404; `/shop` is an existing navigation destination | Verify intended product/category route and match the actual approved recommendation before using it. No guaranteed free equipment, compatibility or availability claim. |
| Referral | `/refer`404 | Find the existing authorized referral journey. Do not substitute a partner-recruitment page for merchant referral. If none exists, use a reply CTA until4C2 supplies a real invitation/referral writer; do not invent public endpoints. |
| Partner access | `/partners/portal`404; App has `/partner-portal` | Use authenticated portal entry for the intended partner audience. No staff dashboard link in merchant copy, no credential/invite token in generic template text. |

**Booking duration:** inspected sales/account widgets say30min. Avoid “10-minute call” unless a verified10min calendar is deliberately selected. A short introductory conversation can be described without a fabricated scheduling duration. The current upload page's10min label is an affected shared booking consumer: repair its label/resolver narrowly, preserving the public layout/styles/forms.

**SFP allowlist:** launch presentation currently admits `libertybancard.com`; readiness permits the secure-upload URL in body text and reply-first first touch. Adding a booking CTA is a deliberate narrow policy extension to a verified first-party booking path and its typed resolver, with hashes/version bump and tests. Do not remove host checks or permit arbitrary GHL URLs. Render CTAs from structured fields using the same resolver at preview and final assembly; do not invent `{{bookingUrl}}`/`{{applicationUrl}}` tokens without implementing the whole purpose contract.

**Events:** “we received”, “analysis completed”, “proposal ready”, “appointment booked”, “application saved”, “approved”, “live”, “funded”, “review due” and “ticket received” require the corresponding resource/event proof. Preview offers fact-present/fact-missing states. When missing, publication of that conditional branch fails or it renders neutral wording that does not assert the event. A rule that only flags a few words is not an event contract. Reuse existing trigger/command identity; do not rebuild journey timers.

## 5. Exact Liberty UI and message presentation contract

### 5.1 Destinations and grouping

Keep the eleven-entry sidebar unchanged. Existing canonical entrances:

| Entrance | Authoring destination |
| --- | --- |
| `/dashboard/outbound-center?tab=campaigns` | Campaign/package workspace, default **Current SFP**. Five package rows/cards show linked campaign+sequence and current version. |
| `/dashboard/outbound-center?tab=sequences` | Sequence/workflow-purpose inventory with same package links and shared editor; never a second independent editor for the same SFP content. |
| `/dashboard/ghl-integration?tab=settings` | Existing template settings remain; “Edit and preview” opens the same template editor component. Link back to owning catalog/purpose without moving integration controls into content. |
| Existing Automation destination | Local workflow message editors reuse the shared authoring/preview components and current version commands. Preserve trigger/action graph and legacy deep links. |

Within Campaigns, use URL-backed secondary views **Current SFP / Sales library / Merchant lifecycle / History / Diagnostics**. These are proposed local view filters, not five sidebar entries or replacements for authoritative catalog classes. Register proposed asset/view/step query state with existing typed URL helpers and generated registry; preserve unrelated contactId/hash, Back/Forward/reload and role-aware invalid-state notices. Keep legacy campaign/sequence redirects. Search across all inventory; default does not hide history from direct links.

Each row: display name, purpose and channel, canonical vertical, authoritative owner/class, recommendation, step count, cadence range, content version, draft state/author, token/CTA health and delivery state. Main action **Open content**. Secondary **Full preview**, **History**. No Activate/Queue/Enroll/Launch in the content editor. Existing operational controls remain in their current governed destination. Put hash/IDs/source detail under an expandable panel. Never show “ready” from active flags or “best performing” from zero sends.

### 5.2 Tokens, type and spacing — use existing variables

Source: `client/src/styles/crm-theme.css`, existing `CrmPresentation.tsx`, local IBM Plex assets. Do not replace global styles or introduce a second palette.

| Property | Existing source value / required use |
| --- | --- |
| Background | `--background: 40 33% 98%` |
| Navy foreground/primary | `222 47% 11%` |
| Card | Existing white light card; existing dark card token |
| Blue accent | `--accent: 221 78% 48%` |
| Red | `--brand-red: 0 72% 47%`; use existing destructive/focus variants for theme contrast |
| Muted background | `210 40% 96.1%` |
| Muted foreground | `215 16% 47%` |
| Border | `214.3 31.8% 91.4%` |
| Font | IBM Plex Sans400/500/600/700. IBM Plex Mono400 for tokens/IDs only. Existing dark variables retained. |
| Page title | 24px/32px,600; oneH1 |
| Section | 18px/24px,600 |
| Body | 14px/20px,400 |
| Labels/helper | 12px/16px; controls remain readable14px |
| Metric numerals | 28px/32px, tabular figures; do not insert large vanity metrics into editor |
| Spacing | Existing4/8/12/16/24/32px scale. Page gap24, card padding24 desktop/16 mobile, field gap16, label gap8, toolbar gap8/12. |
| Radius | Existing6px controls,8px surfaces; `--radius:.5rem` respected |
| Controls | Minimum44px targets; existing focus ring, keyboard/focus-visible and disabled styling |

Do not duplicate raw HSL declarations in components: use the existing semantic classes/variables. Keep main data entry high contrast in light/dark. Status must include text/icon, not color alone.

### 5.3 Editor geometry and fields

Use a page-sized workspace or an explicitly opted-in `content-editor` DialogContent size variant. Default dialogs stay560px. Proposed editor width `min(1440px, calc(100vw - 48px))`, height at most`calc(100dvh - 48px)`; mobile16px gutters with safe-area footer. At≥1280 use step rail220px, compose min360px, preview min400px,16px gaps if the measured available width supports it. At narrower widths collapse rail and switch Compose/Preview tabs; do not squeeze two columns into560px. At390px one pane with no page horizontal overflow. At200% zoom use the same responsive collapse.

Header: breadcrumb/back on one row, asset title/purpose, draft/live version/state, concise “Delivery paused” badge from authority. Toolbar: Save draft(primary while dirty), Full preview, Publish content version; overflow History/Discard. Persistent dirty/conflict/error status with saved time/author. Footer stays reachable; error summary links to fields. No optimistic “saved” before receipt.

Step rail shows ordinal, action/channel, short subject, relative delay and cumulative day; add/duplicate/reorder with accessible buttons and keyboard alternatives. Deleting a draft step does not delete execution history. Invalid reorder cannot leave duplicate/gapped ordinals. Step selection survives reload and Back. On non-email steps hide irrelevant subject/HTML controls while preserving existing call/task configuration.

Editable fields (strict DTOs, current permissions): display name/description where allowed; audience/purpose/vertical as governed metadata with authority shown; step name/type/channel, subject, body format/body, preheader if actually transmitted, relative days/hours, CTA kind/label and supported target selection, secondary informational links where justified, variant subject/body and weight if the real sender supports variants. Sender identity, Reply-To, signature facts, unsubscribe/address, program key and package pins are **read from their authorities**, not freeform editable send bypasses. A purpose/channel change that changes authority requires an explicit validated command or is unavailable.

Provide basic body formatting, link insertion/inspection and optional sanitized HTML source. SFP remains plain-text-source compatible with its existing renderer. Do not introduce a heavy WYSIWYG dependency or allow pasted scripts/styles/forms/tracking pixels. Editable plain text must preserve paragraphs/linebreaks in final HTML and text. Subject single-line with no CR/LF header injection; show length, not an arbitrary unproven deliverability guarantee. Body min240px desktop/200 mobile; autosize within scroll container. Save controls never submit unrelated forms.

### 5.4 Complete preview

Preview inputs: selected asset+step+draft revision/hash, purpose, transport, selected sender policy, fictional persona and event/resource fixture. Response includes rendered subject/body, final HTML/text, sender/Reply-To facts/availability, logo/signature/footer counts, link report, token errors, source version and preview hash. Server responses are read-only, bounded, private/no-store where appropriate; AbortController plus generation/actor/permission fencing prevents late previews overwriting current ones.

Provide: every touch as a timeline; selected full message; Desktop600px and Mobile375px canvases; optional320px; images-off; reference/sent text with exact transport label; dark inversion **simulation**, not actual Outlook/Gmail/iOS proof. Canvas uses actual width inside a contained horizontal scroller when necessary or accurately labelled scaled display. The rest of the CRM never horizontally scrolls. Measure the iframe, not just its CSS requested width. At desktop the preview must no longer be237.5px. Use sandboxed no-script frames and safe link inspector; no active proposal/app/unsubscribe production token can be clicked inside sample preview.

SFP preview must call the same deterministic SFP renderer, sender-policy signature and final commercial composer/payload builder as the SMTP path. It must not claim GHL Conversations or provider-default sender. Generic stored-template/workflow previews preserve accurate GHL payload facts; non-cold sequence Gmail selection remains distinct. Missing compliance/sender configuration shows final-preview unavailable with actionable reason. Do not fabricate it from a sample identity and label it real. SMS shows exact final text, Unicode/segment estimate with its assumptions and consent eligibility separately; preview never sends SMS.

### 5.5 Email branding

Existing SFP presentation `sfp-launch-presentation-2026-10-19.1`: small120×25 `https://libertybancard.com/logo-blue.png`, descriptive alt, one sender-policy sign-off,2px `#1e3a5f` signature rule,15px bold name,13px company/phone, Arial/Helvetica fallback. Existing fingerprint participates in package/recipient hashes. Reuse or deliberately version this renderer; never paste signatures into each body.

Proposed premium body: restrained text-first layout, max600–640px,16px body/24px line-height, white background, navy text, underlined blue text links. No large hero banner or red promotional block for cold outreach. One primary action per touch. If a button is appropriate for a requested proposal/service message, table-based button,44px target, existing navy/blue branding, meaningful fallback text link. CRM uses IBM Plex; email cannot depend on remote Plex fonts. Footer/address/unsubscribe are supplied once by the purpose composer. Do not hardcode a physical address into every template or duplicate an opt-out paragraph. Logos/images-off and plain-text remain readable; final sender facts must be real.

## 6. Premium copy writing and consolidation requirements

Appendix B supplies the initial reviewed **25 SFP email drafts**. Build them as editable drafts under existing logical package keys; do not silently publish them to production. Cadence is a proposed design, not proven optimal. Relative delays0/3/4/5/6 produce cumulative days0/3/7/12/18. Respect existing scheduling/timezone/weekday rules; actual send dates may differ and the UI must say so. First reply, unsubscribe, bounce, booking or actual stage progression must suppress/exit inappropriate future cold touches through existing journey authorities; execution proof belongs4C2/4D.

Every SFP body below omits signature/footer intentionally because the renderer supplies them once. `{{firstName}}` is a greeting token that must normalize role/missing names. `{{companyName}}` uses existing safe business fallback. CTA text in braces such as **[sales_booking]** below is **editor specification**, not text/token to send. The structured CTA resolver inserts the approved URL; the final linter must reject any literal bracket marker. First touch has no linked booking/upload CTA. Optional links must not turn each message into a list of competing asks.

For the rest of the inventory, do not create127 new sequences or rewrite every historical/test step. Produce a per-asset reviewed recommendation and source-to-target map. Reuse coherent copy from SDR statement review, applicable vertical language and warm follow-ups, while removing unsupported claims, stale links and mismatched purpose. Keep Restaurant/Retail/Legal/Hotel/etc in library where useful; they do not expand the five current SFP verticals. MedSpa/Dental map to Healthcare only according to canonical taxonomy; Auto/Construction vocabulary is not evidence to assign a merchant. No source-tag bulk reclassification.

Consolidate prospective reusable wording into clear families, preserving existing records/dependencies:

| Family | Existing candidates | Writing and CTA requirements |
| --- | --- | --- |
| Current SFP cold | Current five packages | Five vertical-specific packs in AppendixB; reply/upload/booking by touch. No SMS. |
| Engaged / statement chase | 1148,3,36,48,49,87 and SDR-01 | Event-aware thanks/chase, secure upload, no “received analysis” until proven; retire duplicate selection by recommendation, not history deletion. |
| Proposal / objections | 84,83,21,39,50,90; template1 | Factual offer/program/analysis references, safe proposal URL or review booking; no invented savings/approved state. |
| Booked / no-show | 40,51,88,89; workflow4/5 | Existing appointment facts, correct reschedule/cancel route, timezone; no duplicate scheduler writer. |
| Application / onboarding | 6,91,92; workflow7/11/12/13; template3 | Scoped resume/intake distinction, honest status, secure document handling, approval caveats. |
| Nurture / reactivation | 22,41,1152; templates5/6/7; SDR-08 | Prior relationship accurately described, low-pressure useful CTA, opt-out respected. “Previously spoke” only with evidence. |
| Merchant success / support | 1149–1151; account-management verticals; template8 | Account calendar, support/ticket references; avoid acquisition CTA/signature in servicing. |
| Referral | 23,37,93,94 | Merchant vs partner distinction, actual program terms and destination, no promised payout without source. |
| Education / product | 4–20,42–47,53–54 and SDR2–11 | Keep relevant ideas as content sources; competitor/cost/funding/security/equipment claims require evidence or neutral questions. No “0%” as universal free processing. |

Appendix C provides immediately usable warm/service baseline drafts. Finish purpose-specific wording for every asset recommended for current/reusable use, including SMS-only templates and local workflow messages, with tracked diff and event/CTA dependencies. The review report lists exact affected IDs/steps, before/after hashes and published/draft/blocked status. A generic “all copy improved” statement is not acceptance. Historical content remains inspectable with health warnings.

## 7. Kill lines and gate checks

1. **No outbound activation or delivery.** Database global pause stays paused(epoch1 at audit); email/SMS/cold-email channel pauses and sequence/enrollment-recovery switches stay as found. No launch approval, enqueue, release recipients, full worker profile, SMTP/Gmail/GHL transport invocation, real seed sends or native workflow activation. Tests use isolated fake transports under existing disposable-provider-deny guards.
2. **Preserve GHL controls.** Outgoing contact sync is owner-paused(false, epoch16, permissions retained); incoming enabled. Do not enable/disable/reselect/reset circuit/change owner/epoch/approval, repair deleted contacts, backfill IDs or run a GHL job. Booking resolver/configuration repair must not touch GHL synchronization authority. No native calendar/event writes or real appointments.
3. **No provider spend or production cleanup.** No enrichment triggers, paid canaries, discovery runs, mass backfills/reclassification, production Data Health apply, destructive retirement or history deletion. Production verification is passive read-only. Development content fixtures are isolated and do not reference production recipients.
4. **Preserve business authority.** Consent, suppression, provenance, role/resource checks, mailbox locks, package/content hashes, sender policy, approval invalidation, effect idempotency and already-started journeys stay enforced. Publishing wording grants no send capability.
5. **Keep UI/public scope narrow.** Eleven-entry sidebar, Liberty theme and public layouts/forms remain stable. Scoped editor sizing and booking/link adapter are permitted; no global stylesheet replacement, theme reset, dependency/lockfile churn or public-site redesign.
6. **No hidden schema operations.** Use supported managed migration/journal mechanism if necessary; no startup/build DDL, destructive downgrade or fake migration head. Never reset/clean a dirty checkout.
7. **Evidence truth.** No full TypeScript check per standing rule. Run production build/focused tests and state limits. Local fixture, code proof, production read, native effect and delivery proof are separately labelled. A blocked native stage does not excuse unfinished local authoring work.

Stop only the implicated change if a kill line is violated, explain the concrete dependency, and continue independent safe work. Do not invent a new manual campaign approval bureaucracy, provider quota, cohort cap or unrelated release freeze.

## 8. Tests, relevant files and grep checks

### 8.1 Required behavioral proof

| Gate | Minimum evidence on final candidate |
| --- | --- |
| Inventory completeness | All150 campaign/sequence rows plus8templates/17workflows accounted for; actual0/1/many step counts; variants; empty/unavailable/denied differ; current pins correct despite emptyCR-06; no name-only deletion/retirement. Large mixed-scope fixture proves no500row truncation or N+1 list read. |
| Tokens/claims | Exact26 legacy booking-token records and template1 disposition; typo/unknown rejection; named/role/missing personas; literal `$&`,quotes,HTML; missing/zero financial fields; no residual savings; factual analysis/application claims require events. |
| Links | Every currently found first-party path and booking spelling tested; secure upload valid; purpose-specific sales/account mapping; no10min claim for30min authority; malformed/unsafe/external/redirect targets refused; missing config/resource/event shown unavailable. Preview/final href parity, plain-text parity and punctuation cases. No live booking submission. |
| Draft concurrency | Two actual actors/tabs with same parent version: stale save/discard/publish return409; saved/reviewed hash is what publishes; first-draft race; actor/permission switch; no draft lost on refetch; lost response/replay; one committed audit/content version. Preserve existing system convergence refusal. |
| SFP publication | Paired campaign/sequence publication; rollback-on-one-side failure; new hash/version; same home IDs; repeated publish no-op; active/started/foreign/retired/drift refusal; held preparation stale hash rejected; no progress reset/release; immutable historical evidence;3and5touch support with cumulative cadence. |
| Other editors | Workflow expectedVersion, unchanged actions/enablement; stored-template purpose/channel; non-SFP command reasons/version/roles; add/edit/reorder/delete draft steps0/1/many; variant preview if supported; invalid input and retry. No queue/transport side effects. |
| Final previews | Real SFP SMTP composer vs GHLHTML-only vs non-coldGmail; sender/Reply-To unknown state; one appropriate signature/logo/footer; images-off, text and missing compliance; allsteps and personas; sandbox; delayed failed/aborted preview cannot overwrite current/other actor. |
| Browser UI | Actual mounted authoring flows: Campaigns/currentpackage, ordinarysequence, templateemail/SMS, workflowemail/SMS.1280/768/390px,light/dark,keyboard,200%zoom; real375pxcanvas or honest scale; no page overflow; focus restore/Escape; Back/Forward/reload/filter/step; dirty leave/conflict/recovery; accessible names and error links. |
| Safety/roles | Real handlers deny anonymous/merchant/agent authoring; manager limits preserved; no authority-field injection. Fake transport spies prove save/preview/publish do not enqueue, activate, send, book or change controls. |

Register every new/extended suite in the appropriate `pre-deploy.ts`, `ci-suite-manifest.ts` and disposable/browser runner; do not run database suites against production. Existing relevant suites include:

- `scripts/certification/test-message-template-versions.ts`
- `scripts/certification/test-message-copy-convergence.ts`
- `scripts/certification/test-template-final-preview.ts`
- `scripts/certification/test-workflow-email-wording.ts`
- `scripts/certification/test-workflow-sms-wording.ts`
- `scripts/certification/test-sfp-launch-content.ts`
- Existing SFP package/launch lifecycle and runner suites, token/renderer/signature/sender-policy and CAN-SPAM suites found by current inventory.
- `test-stage3-c3-contracts.ts`, existing C3 campaign/sequence roles/browser suites, SFP vertical/fairness, canonical preparation/release hash and GHL runtime/projection boundary regressions; role guards, API coverage, route registry and manifest checks.

Run supported production build and focused relevant tests. Public route/SEO checks become applicable if adding `/book` adapter; test that unrelated public pages/styles/forms remain unchanged. Whole pre-deploy/native mailbox-client qualification remains4D unless explicitly run and recorded here.

### 8.2 Exact source destinations to inspect/edit narrowly

`client/src/pages/dashboard/Campaigns.tsx`, `Sequences.tsx`, `OutboundCenter.tsx`, `Automation.tsx`, `GhlSettings.tsx`, `GhlIntegrationHub.tsx`; `client/src/components/dashboard/MessageTemplateEditor.tsx`, `MessageFinalPreview.tsx`; existing workflow email/SMS editor components; `client/src/components/ui/dialog.tsx`; `client/src/components/crm/CrmPresentation.tsx`; `client/src/lib/crm-destination-state.ts`; `client/src/styles/crm-theme.css`(reference, not palette rewrite); `client/src/App.tsx`; `client/src/pages/UploadStatement.tsx`(narrow booking consumer).

`server/routes/campaigns.ts`, `templates-settings.ts`, workflow wording registrations, `integrations.ts`, `cr06.ts`, `lead-ops.ts`; `server/services/catalog-truth.ts`; `shared/catalog-truth-contract.ts`; `server/services/message-render.ts`, `message-token-registry.ts`, `message-copy-lint.ts`, `message-template-versions.ts`, `reviewed-copy-replacements.ts`, `workflow-email-wording.ts`, `workflow-sms-wording.ts`, `workflow-executor.ts`, `sequence-command.ts`, `sequence-worker.ts`, `sfp-launch-render.ts`, `email-presentation.ts`, `email-signatures.ts`, `can-spam-footer.ts`, `ghl.ts`; `server/services/cro03/sfp-launch-content.ts`, `sfp-launch-presentation.ts`, `sfp-campaign-packages.ts`; existing sender-policy, commercial transport/payload builders and package-bound preparation authorities; actual template/workflow/sequence schema and supported migration tooling.

Documentation: `docs/public-journeys/copy-reconciliation.md`, current go-live ledger/spec and `docs/certification/stage4-c1/`. Audit catalog/DTO changes must use the existing registry generation procedure, not hand-edited generated output.

### 8.3 Gate/grep checks — inspect matches, never delete blindly

```bash
git status --short
git rev-parse HEAD
git log -5 --oneline
rg -n 'estimatedSavings|estimatedResidual|significant savings' server/services/sequence-worker.ts server/services/message* client/src
rg -n 'custom_values.booking_link|topCostDrivers|calendarLink|GHL_CALENDAR' server client/src scripts
rg -n 'libertybancard.com/(book|upload|apply|refer|terminals|partners/portal)' server client/src
rg -n 'YFily7oIOUXN2qZZPnOr|YFiIy7oIOUXN2qZZPnOr|widget/bookings/libertybancard|kBRoNz5XoTpddupMQg0c' server client/src
rg -n 'Highest conversion|10-minute|10-Min|guaranteed|significant savings' server client/src
rg -n 'saveDraft|discardDraft|publishDraft|expectedVersion|baseVersion|draft.*revision|contentHash' server/services/message-template-versions.ts server/routes/templates-settings.ts client/src/components/dashboard/MessageTemplateEditor.tsx
rg -n 'populateOne|lockLivePackageContentRows|liveEnrollments|current_step|SFP_LAUNCH_STEP_DELAYS_DAYS|SFP_LAUNCH_CONTENT_VERSION|computeLivePackageContentHash' server/services/cro03
rg -n 'buildFinalEmailPreview|marketing_outreach|textTransmitted|ghl_conversations|SFP_SMTP_TRANSPORT_REQUIRED' server/services
rg -n 'max-w-\[560px\]|maxWidth|375|final-html-frame' client/src/components/ui/dialog.tsx client/src/components/dashboard/MessageFinalPreview.tsx
rg -n 'audit-retained-message-copy|test-message|test-template|test-workflow|test-sfp-launch|CERTIFICATION_FIXTURE_SUITES' scripts/pre-deploy.ts scripts/ci-suite-manifest.ts scripts/certification
git diff --check
git diff --stat
git diff --name-only
git diff --name-only | rg 'ghl-sync-control|ghl-sync-runtime|outbound-pause|crm-theme|index.css|package(-lock)?\.json'
```

Last check expects no incidental control/theme/dependency changes. Historical fixtures/docs may legitimately retain old strings to prove rejection; explain them. Removing a source string does not prove stored content was repaired. Run the read-only retained-copy audit through approved development/disposable connection only, and produce version-checked production content disposition rather than silently pointing the script at production credentials.

## 9. Handoff, rollback and documentation acceptance

Provide one manifest with: source row/step IDs, old hash/version, source copy provenance, target purpose/family/vertical, proposed/saved/published version/hash, CTA source and link availability, event/consent dependencies, author/time, tests and any blocked reason. Every AppendixA row must have a disposition. No count arithmetic that treats duplicate symptoms as separate repair projects.

Update the current repo ledger and spec with a new dated section; preserve historical numbering/95-entry lineage. The companion working ledger/spec had separate appended sections51.7/43.7 at audit start, while repo task receipts have their own numbering; append to the actual current files, do not overwrite them with an older attachment. Update roadmap with **4C1 → 4C2 → 4D**. This report is an audit/prompt, not evidence the proposed content has shipped.

After normal merge/publish, read health, current catalog pins/hash, draft/version read DTOs and repaired UI. Confirm global/channel pause, outgoingGHL owner control and incomingGHL authority remain unchanged. Visit shared first-party booking landing and passive target view; no booking submission. Read-only smoke cannot certify live content mutations, native workflow effects or mailbox rendering. Those require isolated handler/browser evidence now and explicit4C2/4D acceptance later.

Rollback uses the recorded prior release and compatible schema plan. Content rollback is a new version based on a prior reviewed snapshot, not erasing audit/history or resetting recipient progress. Never roll back consent/suppression/control state to make content appear usable. Report source-fixed, fixture-tested, merged, published, live-read-verified and native-effect-verified separately.

**Done:** complete inventory/disposition; selected/reusable writing and CTA semantics repaired; working conflict-safe editors and exact final previews; safe paired SFP content versions; all required local gates passed; explicit post-publish/native boundaries. A five-card visual redesign, a copy file without an editing workflow, or passing source grep alone is not completion.

## Appendix A. Complete installed-asset register

Snapshot is October31 production admin reads. Names below are identifiers/descriptions; no automatic deletion, activation or taxonomy changes are authorized by this register. Counts are actual returned steps, not cached totals. Recommendation codes: **S** current SFP; **H** package history; **L** reusable sales/education library candidate; **M** merchant/service lifecycle; **T** test-labelled diagnostics pending dependencies. Codes are editorial recommendations, separate from catalog ownership (many remain unresolved).

### A1. Campaigns — 23 rows / 80 steps

| ID | Name | Status | Steps | Recommendation |
| ---: | --- | --- | ---: | --- |
| 82 | SFP-V2: Automotive (draft, unreviewed) | draft | 3 | S |
| 83 | SFP-V2: Healthcare (draft, unreviewed) | draft | 3 | S |
| 84 | SFP-V2: Beauty/Spa (draft, unreviewed) | draft | 3 | S |
| 85 | SFP-V2: Construction/Trades/Home Services (draft, unreviewed) | draft | 3 | S |
| 86 | SFP-V2: Fitness/Recreation (draft, unreviewed) | draft | 3 | S |
| 87 | SFP-V2: Automotive (draft, unreviewed) (launch 2026-10-19.2) | draft | 3 | H |
| 88 | SFP-V2: Healthcare (draft, unreviewed) (launch 2026-10-19.2) | draft | 3 | H |
| 89 | SFP-V2: Beauty/Spa (draft, unreviewed) (launch 2026-10-19.2) | draft | 3 | H |
| 90 | SFP-V2: Construction/Trades/Home Services (draft, unreviewed) (launch 2026-10-19.2) | draft | 3 | H |
| 91 | SFP-V2: Fitness/Recreation (draft, unreviewed) (launch 2026-10-19.2) | draft | 3 | H |
| 79 | mismatch-gate-test-73d6d08a | draft | 0 | T |
| 77 | mismatch-gate-test-7e85fb30 | draft | 0 | T |
| 69 | Preview-Test-concurrent-1783799218733 | active | 1 | T |
| 11 | SDR-10: Salon / Spa / Beauty | draft | 5 | L |
| 10 | SDR-09: Professional Services | draft | 5 | L |
| 9 | SDR-08: Win-Back / Reactivation | draft | 4 | L |
| 8 | SDR-07: Auto / Service / Trades | draft | 5 | L |
| 7 | SDR-06: Retail & E-Commerce | draft | 5 | L |
| 6 | SDR-05: Medical / Dental / Medspa | draft | 5 | L |
| 5 | SDR-04: Restaurant & Food Service | draft | 5 | L |
| 4 | SDR-03: Beat Square & Stripe | draft | 5 | L |
| 3 | SDR-02: 0% Processing Program | draft | 5 | L |
| 2 | SDR-01: Statement Review Cold Outreach | draft | 5 | L |

### A2. Sequences — 127 rows / 517 steps

All rows are paused unless **active** is specified. The five H rows have actual `retiredAt`; other L/M/T recommendations do not imply retirement. Names of timestamped test rows are abbreviated after their stable ID; full names were read and must be retained in the machine inventory.

| ID | Name | Steps | Status / recommendation |
| ---: | --- | ---: | --- |
| 1153 | SFP Cold Outreach — Automotive (v2) | 3 | paused / S |
| 1154 | SFP Cold Outreach — Healthcare (v2) | 3 | paused / S |
| 1155 | SFP Cold Outreach — Beauty/Spa (v2) | 3 | paused / S |
| 1156 | SFP Cold Outreach — Construction/Trades/Home Services (v2) | 3 | paused / S |
| 1157 | SFP Cold Outreach — Fitness/Recreation (v2) | 3 | paused / S |
| 1158 | SFP Cold Outreach — Automotive (v2) — launch 2026-10-19.2 | 3 | retired, paused / H |
| 1159 | SFP Cold Outreach — Healthcare (v2) — launch 2026-10-19.2 | 3 | retired, paused / H |
| 1160 | SFP Cold Outreach — Beauty/Spa (v2) — launch 2026-10-19.2 | 3 | retired, paused / H |
| 1161 | SFP Cold Outreach — Construction/Trades/Home Services (v2) — launch 2026-10-19.2 | 3 | retired, paused / H |
| 1162 | SFP Cold Outreach — Fitness/Recreation (v2) — launch 2026-10-19.2 | 3 | retired, paused / H |
| 1152 | Win-Back: Critical Churn Risk | 4 | active / M |
| 1151 | 90-Day QBR & Upsell | 3 | paused / M |
| 1150 | 60-Day Merchant Health Review | 2 | paused / M |
| 1149 | 30-Day Merchant Success Check-In | 2 | paused / M |
| 1148 | Statement Chase (Auto) | 4 | active / L |
| 512 | Test NLE Sequence 1784737373552 | 0 | paused / T |
| 511 | Test NLE Sequence 1784737373518 | 1 | paused / T |
| 510 | Test NLE Sequence 1784737355650 | 0 | paused / T |
| 509 | Test NLE Sequence 1784737355641 | 0 | paused / T |
| 246 | DailyCap Test 1784682816434-xyr88g4qgh | 1 | paused / T |
| 245 | KillSwitch Test 1784682815592-eh4xndjsd0c | 1 | paused / T |
| 244 | KillSwitch Test 1784682814133-tu1ojcmnod | 1 | paused / T |
| 243 | KillSwitch Test 1784682813215-sqjpirinkh9 | 1 | paused / T |
| 242 | CAN-SPAM Block Test 1784682811651-xrjhe3lechk | 1 | paused / T |
| 241 | PreEnrollGate Test 1784682810733-680f078lkvj | 1 | paused / T |
| 240 | PreEnrollGate Test 1784682810694-t7wrylar9dn | 2 | paused / T |
| 239 | PreEnrollGate Test 1784682810654-1i0yos4t59b | 2 | paused / T |
| 238 | PreEnrollGate Test 1784682810621-f659h3u2xh | 1 | paused / T |
| 237 | PreEnrollGate Test 1784682810564-ngkkgxsa5x | 2 | paused / T |
| 236 | PreEnrollGate Test 1784682810521-7c3fv5duvh6 | 1 | paused / T |
| 235 | PreEnrollGate Test 1784682810135-btdahvfhokw | 1 | paused / T |
| 203 | Test NLE Sequence 1783570429349 | 0 | paused / T |
| 202 | Test NLE Sequence 1783570429342 | 0 | paused / T |
| 94 | W6 — Partner Referral Sequence | 3 | paused / M |
| 93 | W6 — Merchant Referral Program | 3 | paused / M |
| 92 | W6 — Closed Won: Onboarding | 4 | paused / M |
| 91 | W6 — Application Abandoned | 4 | paused / L |
| 90 | W6 — Proposal Sent | 5 | paused / L |
| 89 | W6 — No-Show Recovery | 4 | paused / L |
| 88 | W6 — Booked Appointment | 3 | paused / L |
| 87 | W6 — Statement Uploaded | 4 | paused / L |
| 86 | W6 — Inbound Lead: No PEWC | 3 | paused / L |
| 85 | W6 — Cold Outreach: Email + Manual Call | 5 | paused / L |
| 84 | Switch & Save (Core Sales) | 3 | active / L |
| 83 | Objection Crusher | 3 | active / L |
| 82 | Inbound Confirmation | 3 | active / L |
| 81 | V-Legal: Account Management Ops | 3 | active / M |
| 80 | V-Legal: Inbound Lead Nurture | 5 | active / L |
| 79 | V-Legal: SDR Outbound Prospecting | 7 | active / L |
| 78 | V-Construction: Account Management Ops | 3 | active / M |
| 77 | V-Construction: Inbound Lead Nurture | 5 | active / L |
| 76 | V-Construction: SDR Outbound Prospecting | 7 | active / L |
| 75 | V-Landscaping: Account Management Ops | 3 | active / M |
| 74 | V-Landscaping: Inbound Lead Nurture | 5 | active / L |
| 73 | V-Landscaping: SDR Outbound Prospecting | 7 | active / L |
| 72 | V-Hotel: Account Management Ops | 3 | active / M |
| 71 | V-Hotel: Inbound Lead Nurture | 5 | active / L |
| 70 | V-Hotel: SDR Outbound Prospecting | 7 | active / L |
| 69 | V-Gym: Account Management Ops | 3 | active / M |
| 68 | V-Gym: Inbound Lead Nurture | 5 | active / L |
| 67 | V-Gym: SDR Outbound Prospecting | 7 | active / L |
| 66 | V-Salon: Account Management Ops | 3 | active / M |
| 65 | V-Salon: Inbound Lead Nurture | 5 | active / L |
| 64 | V-Salon: SDR Outbound Prospecting | 7 | active / L |
| 63 | V-Auto Repair: Account Management Ops | 3 | active / M |
| 62 | V-Auto Repair: Inbound Lead Nurture | 5 | active / L |
| 61 | V-Auto Repair: SDR Outbound Prospecting | 7 | active / L |
| 60 | V-Dental: Account Management Ops | 3 | active / M |
| 59 | V-Dental: Inbound Lead Nurture | 5 | active / L |
| 58 | V-Dental: SDR Outbound Prospecting | 7 | active / L |
| 57 | V-Med Spa: Account Management Ops | 3 | active / M |
| 56 | V-Med Spa: Inbound Lead Nurture | 5 | active / L |
| 55 | V-Med Spa: SDR Outbound Prospecting | 7 | active / L |
| 54 | SDR: Cold Outbound — Construction | 11 | paused / L |
| 53 | 25. FL Construction — Vertical Playbook | 6 | paused / L |
| 52 | Voicemail Follow-Up SMS | 1 | paused / L |
| 51 | SDR: No-Show Recovery | 7 | paused / L |
| 50 | SDR: Proposal Follow-Up | 7 | paused / L |
| 49 | SDR: Statement Chase | 8 | paused / L |
| 48 | SDR: Reply Engaged | 7 | paused / L |
| 47 | SDR: Cold Outbound — Dental | 11 | paused / L |
| 46 | SDR: Cold Outbound — Med Spa | 11 | paused / L |
| 45 | SDR: Cold Outbound — Auto Repair | 11 | paused / L |
| 44 | 24. FL Medical/Dental — Vertical Playbook | 6 | paused / L |
| 43 | 23. FL Med Spa — Vertical Playbook | 6 | paused / L |
| 42 | 22. FL Auto Repair — Vertical Playbook | 6 | paused / L |
| 41 | Long-Term Nurture | 4 | paused / L |
| 40 | No-Show Reschedule | 3 | paused / L |
| 39 | Proposal Follow-Up | 4 | paused / L |
| 38 | Post-Call Review Follow-Up | 4 | paused / L |
| 37 | 21. Referral Flywheel — Merchant to Merchant | 5 | paused / M |
| 36 | 20. Free Analysis Follow-Up | 9 | paused / L |
| 35 | V-Restaurant: Account Management Ops | 2 | paused / M |
| 34 | V-Restaurant: Inbound Lead Nurture | 3 | paused / L |
| 33 | V-Restaurant: SDR Outbound Prospecting | 5 | paused / L |
| 32 | V-Medical: Account Management Ops | 1 | paused / M |
| 31 | V-Medical: Inbound Lead Nurture | 3 | paused / L |
| 30 | V-Medical: SDR Outbound Prospecting | 5 | paused / L |
| 29 | V-Auto: Account Management Ops | 2 | paused / M |
| 28 | V-Auto: Inbound Lead Nurture | 3 | paused / L |
| 27 | V-Auto: SDR Outbound Prospecting | 5 | paused / L |
| 26 | V-Retail: Account Management Ops | 2 | paused / M |
| 25 | V-Retail: Inbound Lead Nurture | 4 | paused / L |
| 24 | V-Retail: SDR Outbound Prospecting | 5 | paused / L |
| 23 | 20. Referral Flywheel — Merchant to Merchant | 5 | paused / M |
| 22 | 19. Reactivation — Cold Lead Revival | 5 | paused / L |
| 21 | 18. Objection Crusher — Overcome Hesitation | 6 | paused / L |
| 20 | 17. Contract Escape — Switch Help | 5 | paused / L |
| 19 | 16. Security & PCI Compliance — Made Easy | 4 | paused / L |
| 18 | 15. Omnichannel — Online + In-Person | 5 | paused / L |
| 17 | 14. Text-to-Pay & Payment Links | 4 | paused / L |
| 16 | 13. Recurring Billing — Subscription Merchants | 5 | paused / L |
| 15 | 12. Medical & Med Spa — SDR Outbound + Drip | 6 | paused / L |
| 14 | 11. Auto Merchants — SDR Outbound + Drip | 6 | paused / L |
| 13 | 10. Retail Merchants — SDR Outbound + Drip | 6 | paused / L |
| 12 | 9. Surcharge & Cash Discount — Compliance | 4 | paused / L |
| 11 | 8. Liberty Smart Terminal — Product Showcase | 4 | paused / L |
| 10 | 7. POS vs Terminal — Decision Guide | 4 | paused / L |
| 9 | 6. Funding Speed & Reliability | 4 | paused / L |
| 8 | 5. Chargeback Defense | 6 | paused / L |
| 7 | 4. Trust Builder — Authority Sequence | 6 | paused / L |
| 6 | 3. Fast Approval — Application Completion | 4 | paused / L |
| 5 | 2. Payment Stack 101 — Education | 4 | paused / L |
| 4 | 1. Switch & Save — Statement Audit | 8 | paused / L |
| 3 | Statement Review Follow-up | 3 | paused / L |
| 2 | New Lead Drip Campaign | 3 | paused / L |
| 1 | New Lead Drip Campaign | 0 | paused / L |

The two New Lead Drip records and two Referral Flywheel names are real distinct IDs; assess dependencies before choosing a preferred reusable source. Do not merge histories. Legacy vertical grouping includes different taxonomy eras; selection must use the current canonical vertical authority, not these labels.

### A3. Stored templates — 8

| ID | Name | Channel | Live version | Required disposition |
| ---: | --- | --- | ---: | --- |
| 1 | Proposal Email | email | 1 | Repair unsupported topCostDrivers, factual analysis prerequisites, booking/duration and full branding via versioned draft. |
| 2 | Follow-Up SMS | sms | 1 | Correct shared booking resolution; purpose/consent-aware text; no activation. |
| 3 | Welcome Onboarding Email | email | 1 | Actual onboarding event, secure next steps, appropriate service signature. |
| 4 | Day 7 Review Request | email | 2 | Confirm service milestone, balanced request/no incentive promise; preserve history. |
| 5 | 30-Day Nurture Email | email | 2 | Useful neutral nurture, shared booking authority and no invented past conversation. |
| 6 | 90-Day Reactivation Email | email | 1 | Neutral reopening, booking authority, suppression. |
| 7 | Nurture SMS | sms | 1 | Short purpose/consent-aware text and valid booking. |
| 8 | Support Acknowledgment | email | 1 | Receipt event/reference and service purpose; no fabricated SLA. |

All had no current draft. Templates4/5 each returned2published history entries; the others returned0. Baseline history is created lazily on first publish by existing service, so zero history is not proof history was lost.

### A4. Local workflows — all17 enabled definitions

| ID | Name | Direct email / SMS steps | Disposition |
| ---: | --- | --- | --- |
| 17 | Inbound: Unsubscribe | 0 / 0 | Preserve suppression/branch actions; no promotional reply. |
| 16 | Inbound: Objection | 0 / 0 | Trace indirect content/tasks; maintain routing. |
| 15 | Inbound: Positive Reply | 0 / 0 | Trace handoff/template references; stop cold cadence appropriately. |
| 14 | Inbound: Booking Intent | 0 / 0 | Preserve durable appointment handoff; native execution4C2. |
| 13 | F4. Application Reminder - Day 7 | 1 / 1 | Replace dead apply link, event-scoped resume/neutral fallback. |
| 12 | F3. Application Reminder - Day 3 | 1 / 1 | Same source family; distinct timing/content. |
| 11 | F2. Application Reminder - Day 1 | 1 / 1 | Same source family; don't reset reminders. |
| 10 | I. Support SLA Escalation | 0 / 0 | Preserve task/escalation authority; no fabricated customer notice. |
| 9 | H. Case Study Request | 1 / 0 | Event/permission-aware request; no invented result/testimonial. |
| 8 | G. Go-Live Lifecycle (Day 2/7/14/30) | 3 / 1 | Actual merchant milestones, account-purpose CTA. |
| 7 | F. Closed Won - Onboarding Kickoff | 1 / 1 | Closed-won is not processor approval; fix apply destination. |
| 6 | E. Proposal Follow-Up Cadence | 2 / 1 | Real proposal identity, secure upload and correct sales booking. |
| 5 | D. No-Show Rescue | 1 / 1 | Actual missed appointment, valid reschedule/booking, no blame. |
| 4 | C. Appointment Booked | 1 / 1 | Actual appointment facts, timezone and supported manage link. |
| 3 | B. Estimate Request Intake | 1 / 0 | Confirm request fact, correct secure upload route, no savings promise. |
| 2 | A. Statement Upload Intake | 0 / 0 | Trace indirect actions and receipt owner; no duplicate acknowledgement. |
| 1 | New Lead Follow-up | 0 / 0 | Trace task/template actions; no assumption missing messages. |

Current workflow email/SMS wording readers report no lint findings. That does **not** validate literal URLs or factual event claims: the dead `/apply` strings still exist. Extend link/event checks without weakening current token rules.

## Appendix B. Premium SFP draft packs — 25 complete bodies

These are proposed drafts, not live copy. Keep a single primary CTA; resolver appends the link only where specified. Subjects/bodies may be refined during implementation, but final equivalents must remain this specific, vertical-aware and claim-safe, with a recorded diff. No invented merchant research, fees, savings, processor, conversation or integration. Headers/signature/footer are supplied by the shared assembly.

### B1. Automotive — `sfp.automotive.v2`

**1 · Day0 · Reply · Subject: Card processing at {{companyName}}**

Hi {{firstName}},

When repair invoices vary in size, a quoted card rate can be hard to compare with the fees on the monthly statement.

I’m with Liberty Bancard. We can break a statement into network costs, processor markup and fixed charges so you can see what the current setup actually costs.

Would a free statement review be useful for {{companyName}}?

**2 · Day3 · Secure upload · Subject: A useful comparison for your repair payments**

Hello,

One number worth checking is the total processing cost against the same month’s card volume—not just the advertised rate.

For {{companyName}}, we can explain the statement’s fee lines and identify questions worth asking your current provider. If the pricing is already competitive, we’ll say so.

Request the free review here: [secure_statement_upload]. Please use the secure form rather than emailing financial documents.

**3 · Day7 · Reply · Subject: Keep the payment setup that works**

Hello,

A pricing conversation should start with what you need to keep: the way customers pay, the equipment you rely on and the work your team does at checkout.

Before suggesting an alternative for {{companyName}}, we’d ask about those requirements and review the current costs. No assumption that switching is the right answer.

What would you most want a processing review to clarify?

**4 · Day12 · Sales booking · Subject: Prefer to talk through it?**

Hello,

If a conversation is easier than starting with a statement, we can discuss how {{companyName}} takes card payments and what you’d want to compare.

There’s no obligation to change providers, and we won’t quote savings before reviewing the facts.

Choose a review call here: [sales_booking].

**5 · Day18 · Secure upload · Subject: Closing the loop on the statement review**

Hello,

I’ll leave the processing-review offer here for {{companyName}}.

If a clearer breakdown of your card fees would help later, you can request the free review at [secure_statement_upload]. You can keep the explanation whether or not you make a change.

This is my final follow-up in this series. Thanks for taking a look.

### B2. Healthcare — `sfp.healthcare.v2`

**1 · Day0 · Reply · Subject: Patient-payment processing at {{companyName}}**

Hi {{firstName}},

Patient payments can involve different transaction sizes and payment methods, which makes a headline processing rate only part of the picture.

I’m with Liberty Bancard. We offer a free review of a processing statement, separating network costs, processor markup and fixed fees in plain English.

Would that breakdown be useful for {{companyName}}?

**2 · Day3 · Secure upload · Subject: Make the statement easier to compare**

Hello,

A useful processing comparison uses the same volume and payment mix, with monthly charges included.

We can explain the fee lines on a statement from {{companyName}} and identify the questions to ask before considering another setup.

Use [secure_statement_upload] to request the free review. Please submit only the processing information needed for the review, with unnecessary account details redacted. Do not include patient records or email financial documents.

**3 · Day7 · Reply · Subject: Start with your practice’s requirements**

Hello,

Cost is only one part of a payment decision. Your front-desk workflow, existing systems and how patients pay matter too.

For {{companyName}}, we’d establish those requirements before discussing options. We won’t assume a system integration or a feature is supported without checking it.

What would you want to preserve or improve in your current payment process?

**4 · Day12 · Sales booking · Subject: A conversation before a change**

Hello,

If you prefer, we can start with a review call about {{companyName}}’s payment process and the questions you want answered.

We can explain what information would support a fair comparison, without a commitment to switch.

Choose a time here: [sales_booking].

**5 · Day18 · Secure upload · Subject: Leaving the review option with you**

Hello,

I’ll close this series here. If a clearer explanation of {{companyName}}’s processing costs becomes useful, the free review is available at [secure_statement_upload].

The goal is a practical breakdown of the current statement, not a savings promise made before we’ve seen it.

This is my final follow-up in this series. Thank you for your time.

### B3. Beauty/Spa — `sfp.beauty_spa.v2`

**1 · Day0 · Reply · Subject: A processing review for {{companyName}}**

Hi {{firstName}},

When a business takes payments for services, tips and retail items, it helps to understand the full processing statement rather than a single quoted rate.

I’m with Liberty Bancard. We can separate network charges, processor markup and fixed fees in a free statement review.

Would you like a clearer breakdown for {{companyName}}?

**2 · Day3 · Secure upload · Subject: Look beyond the headline card rate**

Hello,

The useful question is what card acceptance costs over a full month, including the charges outside the advertised rate.

For {{companyName}}, we can explain those costs using the statement you already receive. You’ll have a clearer basis for deciding whether anything needs to change.

Request the free review at [secure_statement_upload]. Please use the secure form rather than emailing financial documents.

**3 · Day7 · Reply · Subject: What matters at checkout?**

Hello,

Any processing conversation should account for the way your team works: checkout, tips and any retail sales or repeat visits you support.

Before discussing an alternative for {{companyName}}, we’d ask what works today and which requirements need to be checked. We won’t assume you need new equipment or a different booking system.

What would make a payment review worthwhile for you?

**4 · Day12 · Sales booking · Subject: Talk through the options first**

Hello,

If it’s easier to talk, we can start with {{companyName}}’s current payment setup and what you’d like to understand about the costs.

There’s no obligation to switch. Any recommendation should follow the facts and your actual workflow.

Choose a review call here: [sales_booking].

**5 · Day18 · Secure upload · Subject: One place to request the review**

Hello,

I’ll leave this here for {{companyName}}. If you want the processing statement explained later, request the free review at [secure_statement_upload].

We’ll separate the costs and discuss what they mean before suggesting a change.

This is my final follow-up in this series. Thanks for considering it.

### B4. Construction/Trades/Home Services — `sfp.construction_trades_home_services.v2`

**1 · Day0 · Reply · Subject: Card-payment costs at {{companyName}}**

Hi {{firstName}},

For a business taking deposits, invoice payments or payments after a job, a quoted processing rate may not explain the full monthly cost.

I’m with Liberty Bancard. We can review a processing statement and separate network charges, processor markup and fixed fees.

Would a free breakdown be useful for {{companyName}}?

**2 · Day3 · Secure upload · Subject: Compare the same payments and fees**

Hello,

A fair processing comparison starts with the same volume, transaction sizes and ways customers pay.

We can explain the fees on {{companyName}}’s statement and identify which costs are network charges and which are added by the provider.

Request the free review at [secure_statement_upload]. Please use the secure form rather than sending financial documents by email.

**3 · Day7 · Reply · Subject: Keep the job-payment workflow in view**

Hello,

Any alternative should fit how you collect payments—not add work for your office or crew.

Before suggesting options for {{companyName}}, we’d ask about deposits, invoices and payments taken in person or remotely, then check what is actually supported.

Is there a part of the current payment process you’d like to make clearer or simpler?

**4 · Day12 · Sales booking · Subject: Start with a review call**

Hello,

If you’d rather start with a conversation, we can discuss {{companyName}}’s payment process and the costs you want to compare.

No commitment to change providers, and no promised savings or funding speed before the relevant terms and statement are reviewed.

Choose a time here: [sales_booking].

**5 · Day18 · Secure upload · Subject: Closing this review offer**

Hello,

I’ll close this series here for {{companyName}}.

If a line-by-line explanation of processing costs would be helpful later, the free review is available at [secure_statement_upload]. Keep the breakdown whether you stay with the current provider or explore another option.

This is my final follow-up in this series. Thanks for your time.

### B5. Fitness/Recreation — `sfp.fitness_recreation.v2`

**1 · Day0 · Reply · Subject: Payment processing at {{companyName}}**

Hi {{firstName}},

Whether customers pay for memberships, classes or individual visits, it helps to see what card acceptance costs across the full month.

I’m with Liberty Bancard. We offer a free processing-statement review that separates network costs, processor markup and fixed fees.

Would that be useful for {{companyName}}?

**2 · Day3 · Secure upload · Subject: A clearer view of recurring and one-off payments**

Hello,

The advertised card rate doesn’t always explain all the charges on a monthly statement.

For {{companyName}}, we can review the fees against the actual processing volume and explain the costs in plain English. No need to change providers to get the review.

Request it at [secure_statement_upload]. Please use the secure form rather than emailing financial documents.

**3 · Day7 · Reply · Subject: Your payment requirements come first**

Hello,

If {{companyName}} uses membership billing or a front-desk payment system, those requirements should lead the conversation.

We’d ask what you use, what works and what needs checking before recommending any processing alternative. Compatibility needs verification; it isn’t something we assume from the business category.

What would you most want a review to answer?

**4 · Day12 · Sales booking · Subject: Prefer a conversation?**

Hello,

We can start with a review call about {{companyName}}’s payment setup, the statement and any questions you have about the fees.

There’s no obligation to switch, and we’ll be direct if the current pricing is already competitive.

Choose a time here: [sales_booking].

**5 · Day18 · Secure upload · Subject: Leaving the statement review with you**

Hello,

I’ll leave the review option here for {{companyName}}.

If you want a clearer explanation of processing costs later, request the free review at [secure_statement_upload]. We can discuss what the statement shows before considering a change.

This is my final follow-up in this series. Thank you for taking a look.

## Appendix C. Reusable warm/service baseline writing

These are content drafts, not new runtime programs. Bracketed CTA specifications must be resolved into real supported targets or replaced by the stated neutral fallback. Do not register unsupported resource tokens just to make the text pass. Existing signatures/footers are appended by purpose.

| Use / subject | Complete baseline body | Required fact / CTA |
| --- | --- | --- |
| Engaged reply / A useful next step | Hi {{firstName}},\n\nThanks for your reply. We can start by explaining the processing costs on your current statement, then discuss whether any alternatives are worth comparing.\n\nPlease use [secure_statement_upload] if you’d like the review. Don’t email financial documents. If a conversation is easier, reply with the question you want to cover. | Inbound reply fact required for “Thanks for your reply”; one secure-upload primary CTA. |
| Statement chase / Ready when you are | Hello,\n\nIf you’d still like the processing review for {{companyName}}, the secure form is here: [secure_statement_upload].\n\nWe can explain the current statement before discussing a change. Please use the form rather than sending financial documents by email.\n\nIf the timing has changed, just let us know. | Prior requested-review/engagement fact for “still”; otherwise neutral offer. Exit on actual upload. |
| Analysis/proposal / Review the options for {{companyName}} | Hi {{firstName}},\n\nWe can walk through the processing options for {{companyName}}, including the fees, equipment requirements and any terms that need clarification.\n\nYou can review the proposal here: [proposal_view]. Please reply with any question you’d like us to address before deciding on a next step. | Real authorized proposal required. Without one remove proposal assertion/link and use sales booking “Discuss the options”. Never state completed analysis without event. |
| Objection / A comparison without a commitment | Hello,\n\nKeeping a payment setup that works is a reasonable starting point. A review doesn’t require a decision to switch.\n\nWe can clarify the current fees, identify the requirements you need to preserve and explain any tradeoffs before you consider a change.\n\nWhat would you need to know to decide whether a comparison is worthwhile? | Reply CTA. No manufactured urgency or contract-escape promise. |
| No-show / Find another time | Hi {{firstName}},\n\nSorry we missed each other. If a conversation would still be helpful, you can choose another time here: [sales_booking or actual appointment_reschedule].\n\nIf your priorities have changed, a reply is enough to let us know. | Actual missed appointment. Prefer actual reschedule authority; do not create a second appointment automatically. |
| Application / Need help with the next step? | Hi {{firstName}},\n\nIf you’d like help with the merchant application for {{companyName}}, reply and tell us where you’d like assistance.\n\nWhen an application is already in progress, use the secure continuation link provided for that application. Please don’t email identity or banking documents.\n\nAn application is subject to review and does not guarantee approval. | Safe neutral fallback without fabricated saved-state. Add application_resume only with real matching resource; day1/3/7 variants must avoid repeating unsupported claims. |
| Merchant success / How is the payment setup working? | Hi {{firstName}},\n\nHow is the payment setup working for {{companyName}}? If there’s a question about a fee, payment workflow or support issue, reply with what you’d like us to look at.\n\nFor an account review, choose a time here: [account_booking]. Please leave account numbers and financial documents out of your reply. | Actual merchant relationship; account calendar, not cold-sales. No uptime/funding promises. |
| Reactivation / Is a processing review useful now? | Hi {{firstName}},\n\nWould a clearer explanation of {{companyName}}’s card-processing costs be useful at this point?\n\nWe can start with a free statement review and discuss any questions before considering a change. If now isn’t a good time, there’s no need to take a next step.\n\nReply if you’d like help getting started. | Purpose/relationship/suppression checked. No “we spoke” claim by default. |
| Merchant referral / A business you’d like to introduce? | Hi {{firstName}},\n\nIf another business asks about understanding its processing costs, you’re welcome to introduce Liberty Bancard.\n\nAsk them to contact us directly or reply for the current referral-program details. We’ll explain any eligibility and terms before a referral is submitted.\n\nPlease don’t send another person’s private information without their permission. | Reply fallback until actual merchant referral destination exists; no promised commission. |
| Support acknowledgement / We received your request | Hi {{firstName}},\n\nWe received your support request. Our team will review the details and follow up using the contact information provided.\n\nIf you need to add context, reply with a brief description. Please don’t email passwords, identity documents or full payment-account details. | Actual submitted ticket/request; use real reference if supported, no invented reference token or turnaround guarantee. Transactional/service purpose stays distinct. |
| Permissioned follow-up SMS | Hi {{firstName}}, Liberty Bancard here. If you’d like to talk through your processing questions, choose a time: [sales_booking]. | Only supported eligible SMS purpose/consent. Add required identification/opt-out wording through existing SMS authority; show segments after full assembly. Never cold-SMS the SFP list. |
| Permissioned nurture SMS | Hi {{firstName}}, would a processing-statement review be useful for {{companyName}}? Reply if you’d like the secure upload link or help getting started. — Liberty Bancard | Correct consent and suppression; reply CTA; no automatic attachment request. |

Use the above as a deliberate writing baseline, not a blind mass replacement. Finish each retained current/reusable branch with its real event, resource, tone and CTA; record no-change decisions when existing copy already meets the contract. No single “premium” style should turn factual support, receipts or onboarding into advertising.
