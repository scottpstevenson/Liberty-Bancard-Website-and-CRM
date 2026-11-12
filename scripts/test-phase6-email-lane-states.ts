/**
 * Phase 6 CRM-15 / CRM-16: email-lane readiness vocabulary and integration guidance.
 *
 * Source/fixture proof only (pure functions and source greps). It reads no live data and starts no lane.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import type { CatalogPackage, CatalogTruth, ReadinessFact } from "../shared/catalog-truth-contract";
import {
  LANE_KEYS, campaignLaneStates, laneVerdict, packageScopeOf, sequenceLaneStates, type CatalogRead,
} from "../client/src/lib/email-lane-states";
import { INTEGRATION_LANES } from "../client/src/components/dashboard/IntegrationLaneGuide";
import { GHL_OWNERSHIP_STATEMENT } from "../shared/ghl-ownership-guidance";

let checks = 0;
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const eq = <T>(actual: T, expected: T, message: string) => { assert.deepEqual(actual, expected, message); checks++; };
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const fact = (state: ReadinessFact["state"], basis = `${state}: reading taken from the catalog authority`): ReadinessFact => ({ state, basis });
const pkg = (over: Partial<CatalogPackage["readiness"]> = {}): CatalogPackage => ({
  packageKey: "p1", vertical: "restaurants", packageVersionId: "v1", lifecycleState: "current", catalogClass: "current", classReason: "current",
  campaignId: 20, sequenceId: 10, pinsResolved: true,
  readiness: {
    configured: fact("yes"), selected: fact("yes"), contentVerified: fact("yes"), qualified: fact("yes"), paused: fact("no"),
    statusActive: fact("no", "sequence or campaign status is not active"), runtimeSelected: fact("yes"),
    operationalEvidence: fact("unavailable"), nativeEffectVerified: fact("unavailable"), ...over,
  },
});
const catalogOf = (packages: CatalogPackage[]): CatalogTruth => ({
  asOf: "2026-11-11T00:00:00.000Z", scope: "full_catalog_whole_population", available: true, unavailableReason: null, packages,
  campaigns: [
    { kind: "campaign", id: 20, name: "Current", catalogClass: "current", reason: "pinned by a current package", pinnedBy: [], retiredAt: null },
    { kind: "campaign", id: 21, name: "Old", catalogClass: "historical", reason: "pinned only by a retired package", pinnedBy: [], retiredAt: null },
    { kind: "campaign", id: 22, name: "Loose", catalogClass: "unresolved", reason: "no package pins this campaign", pinnedBy: [], retiredAt: null },
  ],
  sequences: [
    { kind: "sequence", id: 10, name: "Current", catalogClass: "current", reason: "pinned by a current package", pinnedBy: [], retiredAt: null },
    { kind: "sequence", id: 11, name: "Old", catalogClass: "historical", reason: "pinned only by a retired package", pinnedBy: [], retiredAt: null },
    { kind: "sequence", id: 12, name: "Loose", catalogClass: "unresolved", reason: "no package pins this sequence", pinnedBy: [], retiredAt: null },
  ],
  uninstalledPackageKeys: [], counts: null,
  cr06: { governedArtifacts: null, state: "unavailable", note: "" }, cro07: { productionConnected: false, note: "" },
  statusActiveSequences: { count: null, note: "" },
});
const ready = (c: CatalogTruth): CatalogRead => ({ status: "ready", catalog: c });
const byKey = (states: ReturnType<typeof sequenceLaneStates>) => Object.fromEntries(states.map(s => [s.key, s]));

// Eight separate states, always in the same order, each with its own basis.
const current = sequenceLaneStates({ sequence: { id: 10, status: "paused", totalSteps: 5 }, catalog: ready(catalogOf([pkg({ paused: fact("yes", "sequence status is paused") })])), enrollments: [{ status: "active" }, { status: "completed" }, { status: "completed" }] });
eq(current.map(s => s.key), [...LANE_KEYS], "a sequence row shows all eight states in order");
ok(current.every(s => s.basis.length > 20), "every state explains itself");
eq(byKey(current).history.summary, "1 active · 2 completed", "history is the enrollment count, not a readiness claim");
eq(byKey(current).history.tone, "neutral", "enrollment history never reads as ready");
eq(byKey(current).pause.tone, "blocked", "a paused package sequence is a blocking state");
eq(byKey(current).suppression.tone, "neutral", "suppression is a per-recipient fact, not a sequence flag");
ok(/per recipient|each recipient/.test(byKey(current).suppression.basis), "suppression basis names the per-recipient send gate");
eq(byKey(current).release.tone, "neutral", "release is its own state");
ok(byKey(current).release.href === "/dashboard/outbound-readiness", "release points at its owning screen");

// A configured, active, enrolled sequence is not send-ready: eligibility and worker selection decide separately.
const activeButUnselected = sequenceLaneStates({
  sequence: { id: 10, status: "active", totalSteps: 5 },
  catalog: ready(catalogOf([pkg({ selected: fact("no", "package key is not part of the current program plan"), runtimeSelected: fact("no", "the serving profile does not select the sequences queue") })])),
  enrollments: [{ status: "active" }],
});
eq(byKey(activeButUnselected).configuration.tone, "neutral", "configuration is status only, never ok");
eq(byKey(activeButUnselected).eligibility.tone, "blocked", "an unselected package is not eligible however active it is");
eq(byKey(activeButUnselected).worker.tone, "blocked", "a worker that does not select the queue blocks independently");
eq(laneVerdict(activeButUnselected).kind, "blocked", "the verdict names a blocker");
ok(/eligibility/.test(laneVerdict(activeButUnselected).text), "the verdict names the first blocking state");

// No blocker still never says ready.
const clear = sequenceLaneStates({ sequence: { id: 10, status: "active", totalSteps: 5 }, catalog: ready(catalogOf([pkg({ statusActive: fact("yes") })])), enrollments: [] });
const clearVerdict = laneVerdict(clear);
ok(clearVerdict.kind !== "blocked", "no blocking state is read");
ok(!/\bready to send\b|\bsend-ready\b(?!:)/i.test(clearVerdict.text.replace("Not proven send-ready:", "")), "the verdict never claims ready");
ok(/not permission to send|Not proven/.test(clearVerdict.text), "the verdict restates the permission boundary");

// Unread facts are unknown, never yes or zero.
const unread = sequenceLaneStates({ sequence: { id: 10, status: "active", totalSteps: 5 }, catalog: { status: "unavailable", catalog: null }, enrollments: null });
eq(byKey(unread).content.tone, "unknown", "an unreadable catalog leaves content approval unknown");
eq(byKey(unread).eligibility.tone, "unknown", "an unreadable catalog leaves eligibility unknown, not 'other'");
eq(byKey(unread).history.tone, "unknown", "unreadable enrollments are unknown, not zero");
ok(!/\b0 active\b/.test(byKey(unread).history.summary), "no zero is substituted for an unread count");
eq(laneVerdict(unread).kind, "not_proven", "unread facts give a not-proven verdict");
eq(sequenceLaneStates({ sequence: { id: 10, status: "active", totalSteps: 5 }, catalog: { status: "denied", catalog: null }, enrollments: [] }).find(s => s.key === "eligibility")?.basis.includes("not readable for your role"), true, "a denied read says denied");

// Historical and unpackaged sequences are labelled, with their reason, and stay out of the current package view.
const histo = sequenceLaneStates({ sequence: { id: 11, status: "active", totalSteps: 3 }, catalog: ready(catalogOf([pkg()])), enrollments: [{ status: "active" }] });
eq(byKey(histo).eligibility.tone, "blocked", "a historical sequence is not current-eligible");
ok(byKey(histo).eligibility.basis.includes("retired package"), "the catalog reason is shown");
eq(byKey(histo).history.summary, "1 active · 0 completed", "its enrollments remain visible as history");
eq(packageScopeOf(ready(catalogOf([pkg()])), "sequence", 10), "current", "current package grouping");
eq(packageScopeOf(ready(catalogOf([pkg()])), "sequence", 11), "historical", "historical grouping");
eq(packageScopeOf(ready(catalogOf([pkg()])), "sequence", 12), "other", "unpinned grouping");
eq(packageScopeOf({ status: "denied", catalog: null }, "sequence", 10), null, "no grouping is guessed when the catalog is unreadable");

// Campaigns use the same eight states; their history is the recorded send total.
const camp = campaignLaneStates({ campaign: { id: 20, status: "active", totalSteps: 4, totalSent: 12 }, catalog: ready(catalogOf([pkg()])) });
eq(camp.map(s => s.key), [...LANE_KEYS], "a campaign row shows the same eight states");
eq(byKey(camp).history.summary, "12 sent in total", "campaign history is recorded sends");
eq(byKey(campaignLaneStates({ campaign: { id: 21, status: "active", totalSteps: 4, totalSent: 0 }, catalog: ready(catalogOf([pkg()])) })).eligibility.tone, "blocked", "a historical campaign is not eligible");
eq(byKey(sequenceLaneStates({ sequence: { id: 10, status: "active", totalSteps: 0 }, catalog: ready(catalogOf([pkg()])), enrollments: [] })).configuration.tone, "blocked", "a sequence with no steps is blocked");

// Screens use the shared vocabulary and do not wake or create anything.
const sequencesSrc = read("client/src/pages/dashboard/Sequences.tsx");
ok(sequencesSrc.includes("sequenceLaneStates") && sequencesSrc.includes("select-package-filter"), "Sequences shows the lane states and a current-package view");
ok(sequencesSrc.includes("packageFilter") && sequencesSrc.includes('useState<"all" | PackageScope>("all")'), "the package view is a filter that defaults to everything, so nothing is hidden by default");
ok(read("client/src/pages/dashboard/Campaigns.tsx").includes("campaignLaneStates"), "Campaigns shows the lane states");
const queueSrc = read("client/src/pages/dashboard/OutreachQueue.tsx");
ok(!queueSrc.includes("All caught up") && queueSrc.includes("text-queue-empty-scope"), "an empty legacy queue no longer reads as caught up");
ok(queueSrc.includes("link-queue-empty-sfp") && queueSrc.includes("link-queue-empty-readiness"), "the empty queue points at the SFP population and the release authority");
for (const file of ["client/src/lib/email-lane-states.ts", "client/src/components/crm/EmailLaneStates.tsx", "client/src/hooks/use-catalog-readiness.ts"]) {
  ok(!/apiRequest|method:\s*"(POST|PUT|PATCH|DELETE)"/.test(read(file)), `${file} only reads`);
}

// ── CRM-16 integration guidance ──────────────────────────────────────────────
const settings = read("client/src/pages/dashboard/SettingsIntegrations.tsx");
for (const banned of [
  "Instant Lead Confirmation", "Instant Confirmation", "enrolling leads immediately", "instant lead confirmation",
  "usually within a few hours", "personalized savings estimate", "Send Email (Step 1",
]) ok(!settings.includes(banned), `Settings Integrations no longer says "${banned}"`);
ok(settings.includes("Historical reference") && settings.includes("section-historical-workflow-reference"), "the retained workflow reference is marked historical");
ok(settings.includes("A GHL workflow ID saved on this page is a record of the workflow"), "a saved workflow ID is not authority to message");
ok(settings.includes("IntegrationLaneGuide"), "the lane guide is shown on the integration settings");
ok(!/emailBody|smsBody|emailSubject/.test(settings), "no customer-facing message copy is kept on the settings page");
eq(INTEGRATION_LANES.map(l => l.key), ["receipt", "internal", "website", "cold", "export", "booking", "native"], "the guide separates receipt, internal task, website follow-up, cold outreach, contact export, booking and native workflow installation");
ok(INTEGRATION_LANES.every(l => l.effect.length > 30 && l.control.length > 5), "each lane names its effect and its control");
ok(INTEGRATION_LANES.find(l => l.key === "native")!.effect.includes("never starts a message"), "native workflow installation never implies messaging");
ok(!/form confirmation,/.test(GHL_OWNERSHIP_STATEMENT.workflowIds), "form confirmation is not listed as a GHL handoff");
ok(GHL_OWNERSHIP_STATEMENT.workflowIds.includes("never authorizes a message by itself"), "the shared ownership statement says a saved ID never authorizes a message");

console.log(`PHASE6_EMAIL_LANE_STATES_PASS (${checks} checks)`);
process.exit(0);
