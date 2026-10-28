/** Stage 4A F02: derived catalog contract. Pure derivation over fixtures plus one read-only dev read. */
import assert from "node:assert/strict";
import { pool } from "../server/db";
import { buildCatalogTruth, catalogClassForPins, loadCatalogTruth, type CatalogInput } from "../server/services/catalog-truth";

let n = 0;
const ok = (m: string) => { n++; console.log(`  ✅ ${m}`); };

// Fixture ids are deliberately NOT 82-86 / 1153-1157: pins are resolved from the rows, never from known ids.
const input = (over: Partial<CatalogInput> = {}): CatalogInput => ({
  packages: [
    { id: "p1", packageKey: "sfp.automotive.v2", vertical: "Automotive", campaignId: 901, sequenceId: 2001, lifecycleState: "current" },
    { id: "p2", packageKey: "sfp.healthcare.v2", vertical: "Healthcare", campaignId: 902, sequenceId: 2002, lifecycleState: "draft" },
    { id: "p3", packageKey: "sfp.restaurant.v1", vertical: "Restaurant", campaignId: 903, sequenceId: 2003, lifecycleState: "superseded" },
  ],
  campaigns: [
    { id: 901, name: "anything", status: "draft", retiredAt: null, approvedRevision: 2, contentRevision: 2 },
    { id: 902, name: "SFP-V2 draft", status: "draft", retiredAt: null, approvedRevision: null, contentRevision: 1 },
    { id: 903, name: "old", status: "active", retiredAt: null, approvedRevision: 1, contentRevision: 1 },
    { id: 904, name: "orphan", status: "active", retiredAt: null, approvedRevision: null, contentRevision: 1 },
  ],
  sequences: [
    { id: 2001, name: "x", status: "paused", retiredAt: null, stepCount: 3 },
    { id: 2002, name: "y", status: "paused", retiredAt: null, stepCount: 3 },
    { id: 2003, name: "z", status: "paused", retiredAt: "2026-01-01T00:00:00.000Z", stepCount: 3 },
    { id: 2004, name: "SFP Cold Outreach (current)", status: "active", retiredAt: null, stepCount: 1 },
    { id: 2005, name: "retired-no-package", status: "paused", retiredAt: "2026-01-01T00:00:00.000Z", stepCount: 0 },
  ],
  plannedPackageKeys: ["sfp.automotive.v2", "sfp.healthcare.v2", "sfp.restaurant.v1", "sfp.dental.v1"],
  currentProgramKeys: ["sfp.automotive.v2", "sfp.healthcare.v2"],
  evidence: { p1: { contentIssues: [], pinnedHash: "h1", liveHash: "h1" } },
  cr06GovernedArtifacts: 0,
  globalPauseState: "paused",
  statusActiveSequences: 1,
  asOf: "2026-10-28T00:00:00.000Z",
  ...over,
});

async function main() {
  const t = buildCatalogTruth(input());
  const cls = (list: { id: number; catalogClass: string }[], id: number) => list.find((a) => a.id === id)!.catalogClass;
  assert.equal(cls(t.campaigns, 901), "current");
  assert.equal(cls(t.sequences, 2001), "current");
  assert.equal(cls(t.campaigns, 902), "template");
  assert.equal(cls(t.campaigns, 903), "historical");
  assert.equal(cls(t.sequences, 2003), "historical");
  ok("current / template / historical derive from package lifecycle pins");

  assert.equal(cls(t.campaigns, 904), "unresolved");
  assert.equal(cls(t.sequences, 2004), "unresolved", "an unpinned status='active' sequence stays unresolved; name and status never decide");
  assert.equal(cls(t.sequences, 2005), "historical", "retired_at derives retirement");
  ok("unowned assets are unresolved; retirement comes from retired_at; name/status never decide");

  assert.deepEqual(t.uninstalledPackageKeys, ["sfp.dental.v1"]);
  assert.equal(t.counts!.uninstalled, 1);
  ok("planned package with no installed row is uninstalled");

  assert.equal(t.packages.filter((p) => p.lifecycleState === "superseded").length, 1);
  ok("superseded package versions are preserved in the catalog");

  assert.equal(catalogClassForPins(["current"], true), "unresolved");
  assert.equal(t.cr06.state, "empty");
  assert.equal(cls(t.campaigns, 901), "current", "empty CR-06 must not make verified current SFP legacy");
  ok("empty CR-06 does not relabel current SFP as legacy");

  const cur = t.packages.find((p) => p.packageKey === "sfp.automotive.v2")!;
  assert.equal(cur.readiness.configured.state, "yes");
  assert.equal(cur.readiness.selected.state, "yes");
  assert.equal(cur.readiness.qualified.state, "yes");
  assert.equal(cur.readiness.paused.state, "yes");
  assert.equal(cur.readiness.contentVerified.state, "yes");
  assert.equal(cur.readiness.statusActive.state, "no");
  assert.equal(cur.readiness.runtimeSelected.state, "unavailable");
  assert.equal(cur.readiness.operationalEvidence.state, "unavailable");
  assert.equal(cur.readiness.nativeEffectVerified.state, "unavailable");
  assert.equal(t.cro07.productionConnected, false);
  ok("readiness states: configured/selected/contentVerified/qualified/paused true; statusActive no; runtime, operational and native evidence unavailable");

  const draft = t.packages.find((p) => p.packageKey === "sfp.healthcare.v2")!;
  assert.equal(draft.readiness.selected.state, "no");
  assert.equal(draft.readiness.qualified.state, "no");
  ok("draft template is not selected or qualified");

  const active = buildCatalogTruth(input({ globalPauseState: "unpaused", sequences: input().sequences.map((s) => (s.id === 2001 ? { ...s, status: "active" } : s)), campaigns: input().campaigns.map((c) => (c.id === 901 ? { ...c, status: "active" } : c)) }));
  assert.equal(active.packages.find((p) => p.packageKey === "sfp.automotive.v2")!.readiness.statusActive.state, "yes");
  const unk = buildCatalogTruth(input({ globalPauseState: "unavailable" }));
  assert.equal(unk.packages.find((p) => p.packageKey === "sfp.automotive.v2")!.readiness.statusActive.state, "unavailable");
  ok("statusActive needs unpaused + active and is status only; unreadable pause state is unavailable, not no");

  const missing = buildCatalogTruth(input({ sequences: input().sequences.filter((s) => s.id !== 2001) }));
  const mp = missing.packages.find((p) => p.packageKey === "sfp.automotive.v2")!;
  assert.equal(mp.pinsResolved, false);
  assert.equal(mp.readiness.configured.state, "no");
  ok("a pin that no longer resolves is configured:no");

  const conflict = buildCatalogTruth(input({ sequences: input().sequences.map((s) => (s.id === 2001 ? { ...s, retiredAt: "2026-02-01T00:00:00.000Z" } : s)) }));
  assert.equal(cls(conflict.sequences, 2001), "unresolved");
  const cp = conflict.packages.find((p) => p.packageKey === "sfp.automotive.v2")!;
  assert.equal(cp.catalogClass, "unresolved", "package class agrees with its asset class");
  assert.equal(cp.readiness.qualified.state, "no", "a retired pinned sequence is never qualified");
  assert.equal(cp.readiness.selected.state, "no");
  assert.match(cp.readiness.qualified.basis, /retired/);
  ok("current pin onto a retired sequence: asset and package are unresolved and not qualified");

  // Evidence: hash mismatch, content issues and unread evidence never qualify.
  const q = (over2: Partial<CatalogInput>) => buildCatalogTruth(input(over2)).packages.find((p) => p.packageKey === "sfp.automotive.v2")!.readiness;
  assert.equal(q({ evidence: { p1: { contentIssues: [], pinnedHash: "h1", liveHash: "h2" } } }).qualified.state, "no");
  assert.match(q({ evidence: { p1: { contentIssues: [], pinnedHash: "h1", liveHash: "h2" } } }).contentVerified.basis, /hash differs/);
  assert.equal(q({ evidence: { p1: { contentIssues: ["SEQUENCE_HAS_NO_STEPS"], pinnedHash: "h1", liveHash: "h1" } } }).qualified.state, "no");
  assert.equal(q({ evidence: undefined }).qualified.state, "unavailable");
  assert.equal(q({ evidence: { p1: { contentIssues: null, pinnedHash: "h1", liveHash: null } } }).qualified.state, "unavailable");
  assert.equal(q({}).qualified.state, "yes");
  ok("qualification needs matching hash and clean content evidence; unread evidence is unavailable, not yes");

  // Active statuses never imply operation; runtime selection is its own fact.
  const act = q({ globalPauseState: "unpaused", runtime: { state: "no", basis: "process profile off" }, sequences: input().sequences.map((s) => (s.id === 2001 ? { ...s, status: "active" } : s)), campaigns: input().campaigns.map((c) => (c.id === 901 ? { ...c, status: "active" } : c)) });
  assert.equal(act.statusActive.state, "yes");
  assert.equal(act.runtimeSelected.state, "no");
  assert.equal(act.operationalEvidence.state, "unavailable");
  assert.equal(act.nativeEffectVerified.state, "unavailable");
  ok("active statuses with the runtime unselected do not read as operating; no operational or native evidence is claimed");

  // Program ownership is explicit: a current package outside the current program plan is not selected.
  const foreign = buildCatalogTruth(input({ packages: [...input().packages, { id: "p8", packageKey: "sfp.legacy.v1", vertical: "Legacy", campaignId: 904, sequenceId: 2004, lifecycleState: "current" }] }));
  assert.equal(foreign.packages.find((p) => p.packageVersionId === "p8")!.readiness.selected.state, "no");
  assert.equal(foreign.packages.find((p) => p.packageVersionId === "p8")!.readiness.qualified.state, "no");
  const noPlan = buildCatalogTruth(input({ plannedPackageKeys: undefined, currentProgramKeys: undefined }));
  assert.equal(noPlan.packages.find((p) => p.packageKey === "sfp.automotive.v2")!.readiness.selected.state, "unavailable");
  ok("a current package outside the current program plan is not selected; an unread plan is unavailable");

  // Empty CR-06 with a valid SFP package stays qualified; historical packages are never qualified.
  const emptyCr = buildCatalogTruth(input({ cr06GovernedArtifacts: 0 }));
  assert.equal(emptyCr.cr06.state, "empty");
  assert.equal(emptyCr.packages.find((p) => p.packageKey === "sfp.automotive.v2")!.readiness.qualified.state, "yes");
  assert.equal(emptyCr.packages.find((p) => p.packageKey === "sfp.restaurant.v1")!.readiness.qualified.state, "no");
  ok("empty CR-06 does not override a valid current SFP package; historical packages are not qualified");

  const dup = buildCatalogTruth(input({ packages: [...input().packages, { id: "p9", packageKey: "sfp.automotive.v2", vertical: "Automotive", campaignId: 901, sequenceId: 2001, lifecycleState: "current" }] }));
  assert.equal(dup.packages[0].readiness.selected.state, "no");
  assert.equal(dup.packages[0].readiness.qualified.state, "no");
  assert.equal(dup.packages[0].catalogClass, "unresolved");
  assert.equal(cls(dup.campaigns, 901), "unresolved", "an asset pinned by two current versions is unresolved");
  ok("duplicate current selection is not selected, not qualified and unresolved for package and asset");

  assert.equal(t.statusActiveSequences.count, 1);
  assert.match(t.statusActiveSequences.note, /not readiness proof/);
  ok("status='active' count is labelled as not readiness proof");

  // Live read-only dev read: never throws; an unreadable DB is reported unavailable, not an empty catalog.
  const live = await loadCatalogTruth();
  if (live.available) { assert.ok(Array.isArray(live.packages)); assert.ok(live.counts); }
  else { assert.equal(live.counts, null); assert.ok(live.unavailableReason); }
  ok(`loadCatalogTruth ${live.available ? "read" : "reported unavailable"} (${live.packages.length} package versions in this environment)`);

  // Actual read DTO over fixture rows (only when this environment has no package versions, i.e. a disposable database).
  if (live.available && live.packages.length === 0) {
    const tag = `s4a-catalog-${Date.now()}`;
    const ids = { camps: [] as number[], seqs: [] as number[] };
    const mk = async (retired: boolean) => {
      const c = await pool.query(`INSERT INTO campaigns(name,total_steps) VALUES ($1,0) RETURNING id`, [`${tag}-c${ids.camps.length}`]);
      const sq = await pool.query(`INSERT INTO follow_up_sequences(name,total_steps${retired ? ",retired_at" : ""}) VALUES ($1,0${retired ? ",now()" : ""}) RETURNING id`, [`${tag}-s${ids.seqs.length}`]);
      ids.camps.push(c.rows[0].id); ids.seqs.push(sq.rows[0].id);
      return { c: c.rows[0].id as number, s: sq.rows[0].id as number };
    };
    try {
      const a = await mk(false); const b = await mk(true);
      const ins = (key: string, v: string, pins: { c: number; s: number }, state: string) => pool.query(
        `INSERT INTO sfp_campaign_package_versions(package_key,vertical,campaign_id,campaign_name,sequence_id,sequence_name,sequence_family,content_hash,lifecycle_state,actor_id)
         VALUES ($1,$2,$3,$4,$5,$6,'fixture','pinned-hash',$7,'fixture-actor')`, [key, v, pins.c, `${tag}-cn`, pins.s, `${tag}-sn`, state]);
      await ins("sfp.automotive.v2", "Automotive", a, "current");
      await ins("sfp.healthcare.v2", "Healthcare", b, "current");
      const dto = await loadCatalogTruth();
      assert.equal(dto.available, true);
      const good = dto.packages.find((p) => p.packageKey === "sfp.automotive.v2")!;
      assert.equal(good.readiness.configured.state, "yes");
      assert.equal(good.readiness.selected.state, "yes");
      assert.equal(good.readiness.contentVerified.state, "no", "an empty package never verifies");
      assert.match(good.readiness.contentVerified.basis, /SEQUENCE_HAS_NO_STEPS/);
      assert.equal(good.readiness.qualified.state, "no");
      const bad = dto.packages.find((p) => p.packageKey === "sfp.healthcare.v2")!;
      assert.equal(bad.catalogClass, "unresolved");
      assert.equal(bad.readiness.qualified.state, "no");
      assert.equal(dto.sequences.find((x) => x.id === b.s)!.catalogClass, "unresolved");
      assert.equal(dto.cr06.state === "empty" || dto.cr06.state === "populated" || dto.cr06.state === "unavailable", true);
      ok("actual read DTO: empty content and a retired pinned sequence are never qualified, and package class agrees with asset class");
    } finally {
      await pool.query(`DELETE FROM sfp_campaign_package_versions WHERE campaign_name = $1`, [`${tag}-cn`]);
      for (const id of ids.seqs) await pool.query(`DELETE FROM follow_up_sequences WHERE id=$1`, [id]);
      for (const id of ids.camps) await pool.query(`DELETE FROM campaigns WHERE id=$1`, [id]);
    }
  }

  console.log(`\n${n} check groups passed`);
  process.exit(0);
}
main().catch((e) => { console.error("FAIL", e); process.exit(1); });
