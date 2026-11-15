/**
 * The website email lane form is an editor over the SAVED revision. This suite pins the pure edit-session rules and the card
 * wiring: hydration from the loaded revision, unsaved edits kept across the 30 s refetch, an explicit reload / keep decision
 * when the saved revision moves under an edit, and a saved-versus-proposed diff (removed mappings included) before any save.
 * No database, no network: it never opens the lane or chooses a sender; hydration copies saved values only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  applyServerLane, describeChange, diffAgainstSaved, draftFromLane, draftsEqual, editDraft, editMapping, hasUnsavedEdits,
  normalizeDraft, proposedFromDraft, rebaseOnServer, reloadFromServer, snapshotKey, startSession, type LaneSnapshot,
} from "../client/src/lib/website-lane-draft";

let checks = 0;
const ok = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
const eq = <T>(actual: T, expected: T, message: string) => { assert.deepEqual(actual, expected, message); checks++; };

const E = "website_form|estimate_form", G = "website_form|get_started_form", F = "website_form|free_analysis", N = "website_form|newsletter_signup";
/** Revision 1 as saved in production: closed, no sender, daily limit 0, four forms mapped. */
const saved = (over: Partial<LaneSnapshot> = {}): LaneSnapshot => ({
  effectiveState: "closed", revision: 1, senderAccount: null, dailyLimit: 0,
  sourceProgramMap: { [E]: { requested_followup: 7 }, [G]: { requested_followup: 8 }, [F]: { requested_followup: 9 }, [N]: { nurture: 10 } },
  ...over,
});
const none: LaneSnapshot = { effectiveState: "closed", revision: null, senderAccount: null, dailyLimit: null, sourceProgramMap: {} };

// ── Hydration: the form starts from the loaded revision, not from blank fields ──
const s1 = startSession(saved());
eq(s1.draft.status, "closed", "hydrates the saved state");
eq(s1.draft.senderAccount, "", "an unselected sender stays unselected (nothing is chosen on the operator's behalf)");
eq(s1.draft.dailyLimit, "0", "hydrates the saved daily limit");
eq(s1.draft.mapping, { [`${E}::requested_followup`]: "7", [`${G}::requested_followup`]: "8", [`${F}::requested_followup`]: "9", [`${N}::nurture`]: "10" },
  "every saved mapping appears in the editor");
eq(diffAgainstSaved(s1.baseline, s1.draft), [], "an untouched editor differs from nothing");
eq(hasUnsavedEdits(s1), false, "an untouched editor has no unsaved edits");
eq(proposedFromDraft(s1.draft), { status: "closed", sourceProgramMap: saved().sourceProgramMap, senderAccount: null, dailyLimit: 0 },
  "saving the untouched editor would submit exactly the saved mappings, none dropped");
const s0 = startSession(none);
eq([s0.draft.status, s0.draft.senderAccount, s0.draft.dailyLimit, s0.draft.mapping], ["closed", "", "0", {}], "no saved revision hydrates the closed default");
eq(proposedFromDraft(s0.draft).senderAccount, null, "the default proposes no sender");
eq(draftFromLane(saved({ effectiveState: "malformed" })).status, "closed", "a malformed stored configuration hydrates as closed, never open");
eq(draftFromLane(saved({ effectiveState: "open", senderAccount: "a@b.co", dailyLimit: 5 })).status, "open", "a saved open lane is shown as saved (the editor never changes it by itself)");

// ── Polling: an unchanged saved configuration keeps the session (and its edits) exactly as they are ──
let s = editDraft(s1, { senderAccount: "  accounts@libertybancard.com " });
s = editMapping(s, `${E}::requested_followup`, "");
s = editMapping(s, `${E}::nurture`, "11");
ok(hasUnsavedEdits(s), "edits are tracked against the saved revision");
const polled = applyServerLane(s, saved()); // a 30 s refetch with the same saved configuration
ok(polled === s, "an unchanged refetch returns the very same session: dirty edits survive polling");
eq(polled.draft.senderAccount, "  accounts@libertybancard.com ", "the unsaved sender text is untouched, whitespace included");
eq(snapshotKey(saved()), snapshotKey(saved()), "the saved-configuration identity is stable between refetches");

// ── The saved revision moves while the operator has unsaved edits: explicit decision, edits retained ──
const moved = saved({ revision: 2, sourceProgramMap: { ...saved().sourceProgramMap, [E]: { requested_followup: 7, nurture: 12 } } });
const conflicted = applyServerLane(s, moved);
ok(conflicted.conflict?.revision === 2, "a newer revision with unsaved edits is recorded as a conflict");
eq(conflicted.draft, s.draft, "the operator's edits are not replaced or merged by the newer revision");
eq(conflicted.baseline.revision, 1, "the baseline stays at the revision the edits were made against until the operator decides");
ok(applyServerLane(conflicted, moved) === conflicted, "refetching the same newer revision does not change the conflict");
const reloaded = reloadFromServer(conflicted);
eq([reloaded.baseline.revision, reloaded.conflict, hasUnsavedEdits(reloaded)], [2, null, false], "reload discards the edits and starts from the newer revision");
eq(reloaded.draft.mapping[`${E}::nurture`], "12", "reload shows what the newer revision saved");
const kept = rebaseOnServer(conflicted);
eq([kept.baseline.revision, kept.conflict], [2, null], "keeping the edits measures them against the newer revision");
eq(kept.draft, s.draft, "keeping the edits keeps every edit");
const keptDiff = diffAgainstSaved(kept.baseline, kept.draft).map(describeChange);
ok(keptDiff.some((line) => /Estimate form · Requested follow-up: Revision 7 → none \(removed\)/.test(line)), "the diff against the newer revision names the removed mapping");
ok(keptDiff.some((line) => /Estimate form · Opted-in nurture: Revision 12 → Revision 11/.test(line)), "the diff shows a mapping the edit changed on top of the newer revision");
ok(applyServerLane(s, saved({ revision: 3 })).conflict?.revision === 3, "a still newer revision replaces the conflict, never stacks");

// ── No edits, or the operator's own save landing: the newer revision is adopted without a prompt ──
const clean = applyServerLane(s1, moved);
eq([clean.baseline.revision, clean.conflict, clean.draft.mapping[`${E}::nurture`]], [2, null, "12"], "with no edits the editor adopts a newer saved revision");
const ownSave = saved({ revision: 2, senderAccount: "accounts@libertybancard.com", dailyLimit: 0,
  sourceProgramMap: { [E]: { nurture: 11 }, [G]: { requested_followup: 8 }, [F]: { requested_followup: 9 }, [N]: { nurture: 10 } } });
const landed = applyServerLane(s, ownSave);
eq([landed.conflict, landed.baseline.revision, hasUnsavedEdits(landed)], [null, 2, false], "the operator's own save landing is adopted silently, with no false conflict");

// ── Diff: state, sender, limit, added and removed mappings, before any save ──
let d = editDraft(s1, { status: "open", senderAccount: "x@y.co", dailyLimit: "25" });
d = editMapping(d, `${G}::requested_followup`, "");
d = editMapping(d, `${G}::nurture`, "30");
const lines = diffAgainstSaved(d.baseline, d.draft);
eq(lines.map((c) => c.field), ["state", "sender", "limit", "mapping", "mapping"], "state, sender, limit then mappings, in a stable order");
const removal = lines.find((c) => c.removed);
ok(removal && removal.from === "Revision 8" && removal.to === "none" && /\(removed\)$/.test(describeChange(removal)), "a dropped saved mapping is marked removed");
ok(lines.find((c) => c.added)?.to === "Revision 30", "a new mapping is marked added");
eq(diffAgainstSaved(startSession(none).baseline, editDraft(s0, { senderAccount: "  " }).draft), [], "whitespace in the sender box is not a change");
ok(draftsEqual({ ...s1.draft, dailyLimit: "00" }, s1.draft), "a limit typed as 00 equals the saved 0");
ok(!draftsEqual({ ...s1.draft, dailyLimit: "abc" }, s1.draft) && Number.isNaN(proposedFromDraft({ ...s1.draft, dailyLimit: "abc" }).dailyLimit),
  "a non-numeric limit is a change and proposes NaN, which the card refuses to preview");
eq(Object.keys(normalizeDraft({ ...s1.draft, mapping: { ...s1.draft.mapping, "x::y": "" } }).mapping).length, 4, "empty mappings do not count");
// A saved mapping for a form this page does not list is carried into the proposal unchanged, never silently dropped.
const odd = startSession(saved({ sourceProgramMap: { ...saved().sourceProgramMap, "other_form|x": { nurture: 99 } } }));
eq(proposedFromDraft(odd.draft).sourceProgramMap["other_form|x"], { nurture: 99 }, "a mapping the page cannot display stays in the proposal");
eq(diffAgainstSaved(odd.baseline, odd.draft), [], "and is not reported as a change");

// ── Card wiring ──
const card = fs.readFileSync("client/src/components/dashboard/WebsiteEmailLaneCard.tsx", "utf8");
ok(/refetchInterval: 30_000/.test(card), "the 30 s status refetch is unchanged (edits survive it by design, not by removing it)");
ok(!/useState<"closed" \| "open" \| "revoked">\("closed"\)/.test(card) && !/useState\(""\);\s*\n\s*const \[dailyLimit/.test(card),
  "the form no longer starts from blank state fields");
ok(/applyServerLane\(session, data\.lane\)/.test(card) && /snapshotKey\(data\.lane\)/.test(card), "the card folds each loaded revision into the edit session");
ok(/data-testid="section-website-lane-conflict"/.test(card) && /data-testid="button-website-lane-reload"/.test(card) && /data-testid="button-website-lane-keep"/.test(card),
  "a moved revision shows an explicit reload / keep choice");
ok(/Boolean\(currentReview\?\.ok\) && !conflict/.test(card), "Save stays disabled while a newer saved revision is unresolved");
ok(/disabled=\{previewMutation\.isPending \|\| Boolean\(conflict\)\}/.test(card), "Preview stays disabled while a newer saved revision is unresolved");
ok(/proposedKey = `\$\{live\?\.baseline\.revision \?\? 0\}:/.test(card), "a review is tied to the saved revision it was measured against");
ok(/onSuccess: \(value, input\) => setReview\(\{ key: input\.key, value \}\)/.test(card), "a review is keyed by the input captured when it was requested, not by later edits");
ok(/data-testid="section-website-lane-diff"/.test(card) && /describeChange\(c\)/.test(card), "the saved-versus-proposed diff is shown before saving");
ok(/expectedRevision: currentReview\.currentRevision/.test(card), "the server revision fence is unchanged");
ok(!/status: "open"/.test(card) && !/setStatus\("open"\)/.test(card), "the card never sets the lane to open by itself");

console.log(`website lane draft: ok (${checks} checks)`);
process.exit(0);
