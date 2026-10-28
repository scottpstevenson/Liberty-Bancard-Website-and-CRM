// Run: npx tsx --tsconfig scripts/tsconfig.ghl-inbound-ui-test.json scripts/test-stage4a-catalog-ui.tsx
// Static-markup mount of the catalog panel states. No network, DB or provider.
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogTruthView, describeCr06Programs, describeCr06ObjectClasses } from "../client/src/components/dashboard/CatalogTruthPanel";
import type { CatalogTruth, CatalogPackage, ReadinessFact } from "../shared/catalog-truth-contract";
import { RETIRED_PILOT_ENTRANCES } from "../server/services/pilot-entrance-retirement";

let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log(`PASS ${name}`); };
const f = (state: ReadinessFact["state"], basis = "b"): ReadinessFact => ({ state, basis });
const pkg = (over: Partial<CatalogPackage> & { key: string }): CatalogPackage => ({
  packageKey: over.key, vertical: "Automotive", packageVersionId: "ver-" + over.key, lifecycleState: "current", catalogClass: "current",
  classReason: "x", campaignId: 11, sequenceId: 22, pinsResolved: true,
  readiness: { configured: f("yes"), selected: f("yes"), contentVerified: f("yes"), qualified: f("yes", "all good"), paused: f("yes"), statusActive: f("no"),
    runtimeSelected: f("unavailable"), operationalEvidence: f("unavailable"), nativeEffectVerified: f("unavailable") },
  ...over,
});
const base = (over: Partial<CatalogTruth> = {}): CatalogTruth => ({
  asOf: "2026-10-28T00:00:00.000Z", scope: "full_catalog_whole_population", available: true, unavailableReason: null,
  packages: [pkg({ key: "sfp.automotive.v2" })], campaigns: [], sequences: [], uninstalledPackageKeys: [],
  counts: { current: 2, template: 0, historical: 0, uninstalled: 0, unresolved: 0 },
  cr06: { governedArtifacts: 0, state: "empty", note: "No CR-06 governed artifacts exist." },
  cro07: { productionConnected: false, note: "CRO-07 production transport is disconnected." },
  statusActiveSequences: { count: 0, note: "Status is not readiness proof." },
  ...over,
} as CatalogTruth);
const render = (props: React.ComponentProps<typeof CatalogTruthView>) => renderToStaticMarkup(<CatalogTruthView {...props} />);

check("current SFP package with an empty CR-06 shows real key/version/pins and no install recommendation", () => {
  const html = render({ data: base() });
  assert.match(html, /catalog-truth-ok/);
  assert.match(html, /sfp\.automotive\.v2/);
  assert.match(html, /version ver-sfp\.automotive\.v2 · campaign #11 · sequence #22/);
  assert.match(html, /qualified: yes/);
  assert.match(html, /does not affect current SFP packages/);
  assert.doesNotMatch(html, /[Ii]nstall the|Apply the rollout|legacy/);
  assert.match(html, /runtime selected: unavailable/);
  assert.match(html, /native effect: unavailable/);
});
check("unqualified current package shows the precise basis; installed is separate from qualified", () => {
  const p = pkg({ key: "sfp.automotive.v2" });
  p.readiness.qualified = f("no", "the pinned content hash differs from the live content");
  const html = render({ data: base({ packages: [p] }) });
  assert.match(html, /installed: yes/);
  assert.match(html, /qualified: no/);
  assert.match(html, /Qualification: the pinned content hash differs/);
});
check("historical, template and unresolved packages are grouped separately", () => {
  const html = render({ data: base({ packages: [
    pkg({ key: "sfp.a.v1", lifecycleState: "superseded", catalogClass: "historical" }),
    pkg({ key: "sfp.b.v2", lifecycleState: "draft", catalogClass: "template" }),
    pkg({ key: "sfp.c.v2", catalogClass: "unresolved", classReason: "the pinned sequence is retired (retired_at is set)" }),
  ], counts: { current: 0, template: 1, historical: 1, uninstalled: 2, unresolved: 1 }, uninstalledPackageKeys: ["sfp.z.v2", "sfp.y.v2"] }) });
  assert.match(html, /catalog-group-historical/);
  assert.match(html, /catalog-group-template/);
  assert.match(html, /catalog-group-unresolved/);
  assert.match(html, /the pinned sequence is retired/);
  assert.match(html, /Unresolved: 1/);
  assert.match(html, /No current SFP package version is installed/);
  assert.match(html, /Planned, not installed: sfp\.z\.v2, sfp\.y\.v2/);
});
check("an unavailable read is not zero and has a safe Retry", () => {
  for (const props of [{ error: new Error("500: boom"), onRetry: () => {} }, { data: { ...base(), available: false, counts: null, unavailableReason: "42P01" } as CatalogTruth, onRetry: () => {} }]) {
    const html = render(props);
    assert.match(html, /catalog-truth-unavailable/);
    assert.match(html, /unknown, not zero/);
    assert.match(html, /button-catalog-retry/);
    assert.doesNotMatch(html, /Current: 0|catalog-current-packages|No current SFP package/);
  }
});
check("a denied role shows denied, no retry and no empty-state wording", () => {
  const html = render({ error: new Error('403: {"error":"Forbidden"}'), onRetry: () => {} });
  assert.match(html, /catalog-truth-denied/);
  assert.match(html, /cannot read the package catalog/);
  assert.doesNotMatch(html, /button-catalog-retry|No current SFP/);
});
check("a successful empty catalog is distinct from a failed read", () => {
  const html = render({ data: base({ packages: [], counts: { current: 0, template: 0, historical: 0, uninstalled: 0, unresolved: 0 } }) });
  assert.match(html, /catalog-truth-ok/);
  assert.match(html, /No current SFP package version is installed/);
  assert.match(html, /Current: 0/);
});
check("CR-06 states never recommend installing and failed reads are not zero", () => {
  assert.match(describeCr06Programs({ programs: 0 })!, /does not affect current SFP packages/);
  assert.doesNotMatch(describeCr06Programs({ programs: 0 })!, /install the three/);
  assert.match(describeCr06Programs({ programs: 0, error: new Error("500: x") })!, /unknown, not zero/);
  assert.match(describeCr06Programs({ programs: 0, error: new Error("403: x") })!, /cannot read/);
  assert.equal(describeCr06Programs({ programs: 2 }), null);
  assert.match(describeCr06ObjectClasses(undefined), /unknown \(not read\)/);
  const t = describeCr06ObjectClasses({ campaigns: [{ catalogClass: "current" }, { catalogClass: "unresolved" }], sequences: [{ catalogClass: "historical" }] });
  assert.match(t, /1 campaigns \/ 0 sequences current SFP/);
  assert.match(t, /1 campaigns \/ 0 sequences unresolved \(review required\)/);
  assert.match(t, /0 campaigns \/ 1 sequences historical/);
});
check("retired-entrance replacement guidance names the selected program owner, not CR-06 universally", () => {
  const generic = RETIRED_PILOT_ENTRANCES.filter((e) => !/Provider controls/.test(e.authority));
  assert.ok(generic.length > 0);
  for (const e of generic) {
    assert.match(e.authority, /selected program's governed owner/);
    assert.match(e.authority, /current package path/);
    assert.doesNotMatch(e.authority, /^CR-06/);
  }
});
console.log(`${checks} mount checks passed`);
