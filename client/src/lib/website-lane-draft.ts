/**
 * Edit session for the website email lane configuration form.
 *
 * The form is an editor over the SAVED lane revision. It starts from what is saved (never from blank fields), keeps the
 * operator's unsaved edits when the status refetches every 30 seconds, and refuses to carry edits silently onto a newer
 * revision someone else saved: the operator must either reload from the saved revision (discarding the edits) or keep
 * the edits on top of the new revision, and in both cases sees a saved-versus-proposed diff, removed mappings included,
 * before anything can be saved.
 *
 * Nothing here opens the lane, picks a sender or talks to the server. Hydration copies saved values only.
 */
import { PROGRAM_LABELS, WEBSITE_SOURCE_LABELS } from "./website-email-reasons";

export type LaneStatus = "closed" | "open" | "revoked";

/** The part of the status payload the editor reads. `revision` is null when nothing was ever saved (closed by default). */
export interface LaneSnapshot {
  effectiveState: "closed" | "open" | "revoked" | "malformed";
  revision: number | null;
  senderAccount: string | null;
  dailyLimit: number | null;
  sourceProgramMap: Record<string, Record<string, number>>;
}

/** Form values, as strings the inputs hold. `mapping` is keyed `${source}::${program}`; an empty value means "no revision". */
export interface LaneDraft {
  status: LaneStatus;
  senderAccount: string;
  dailyLimit: string;
  mapping: Record<string, string>;
}

export interface LaneEditSession {
  /** The saved configuration the draft is measured against (and the revision a save must be fenced on). */
  baseline: LaneSnapshot;
  draft: LaneDraft;
  /** Identity of the newest saved configuration already processed, so an unchanged refetch is a no-op. */
  seenKey: string;
  /** A newer saved configuration that arrived while the draft had unsaved edits; edits stay put until the operator decides. */
  conflict: LaneSnapshot | null;
}

export interface LaneChange {
  field: "state" | "sender" | "limit" | "mapping";
  label: string;
  from: string;
  to: string;
  /** A saved mapping that the proposal drops. */
  removed?: boolean;
  added?: boolean;
}

const sortedMap = (map: Record<string, Record<string, number>>) =>
  Object.keys(map).sort().map((source) => [source, Object.keys(map[source] ?? {}).sort().map((program) => [program, Number(map[source][program])])]);

/** Everything about the saved configuration that matters to an editor, as a stable string. Excludes status timestamps. */
export function snapshotKey(lane: LaneSnapshot): string {
  return JSON.stringify([lane.revision, lane.effectiveState, lane.senderAccount ?? null, lane.dailyLimit ?? null, sortedMap(lane.sourceProgramMap ?? {})]);
}

export function draftFromLane(lane: LaneSnapshot): LaneDraft {
  const mapping: Record<string, string> = {};
  for (const [source, programs] of Object.entries(lane.sourceProgramMap ?? {})) {
    for (const [program, revisionId] of Object.entries(programs ?? {})) mapping[`${source}::${program}`] = String(revisionId);
  }
  return {
    // A malformed stored configuration is treated as closed by the lane; the editor starts from closed, never from open.
    status: lane.effectiveState === "open" || lane.effectiveState === "revoked" ? lane.effectiveState : "closed",
    senderAccount: lane.senderAccount ?? "",
    dailyLimit: String(lane.dailyLimit ?? 0),
    mapping,
  };
}

const normalizeLimit = (value: string) => {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? String(Number(trimmed)) : trimmed;
};

/** Canonical form for comparing two drafts: trimmed sender, normalized limit, empty mappings dropped, keys sorted. */
export function normalizeDraft(draft: LaneDraft): LaneDraft {
  const mapping: Record<string, string> = {};
  for (const key of Object.keys(draft.mapping).sort()) if (draft.mapping[key]) mapping[key] = draft.mapping[key];
  return { status: draft.status, senderAccount: draft.senderAccount.trim(), dailyLimit: normalizeLimit(draft.dailyLimit), mapping };
}

export const draftsEqual = (a: LaneDraft, b: LaneDraft) => JSON.stringify(normalizeDraft(a)) === JSON.stringify(normalizeDraft(b));

export function startSession(lane: LaneSnapshot): LaneEditSession {
  return { baseline: lane, draft: draftFromLane(lane), seenKey: snapshotKey(lane), conflict: null };
}

/** True when the draft differs from the saved baseline the operator started from. */
export const hasUnsavedEdits = (session: LaneEditSession) => !draftsEqual(session.draft, draftFromLane(session.baseline));

/**
 * Folds a freshly loaded saved configuration into the session. Called on every status refetch:
 *  - unchanged saved configuration: the session is returned as is (the draft, dirty or not, is untouched);
 *  - changed, and the draft already equals it (the operator's own save landed) or has no edits: adopt it silently;
 *  - changed, with unsaved edits that differ: keep the edits and record the conflict; saving is blocked until resolved.
 */
export function applyServerLane(session: LaneEditSession | null, lane: LaneSnapshot): LaneEditSession {
  if (!session) return startSession(lane);
  const key = snapshotKey(lane);
  if (key === session.seenKey) return session;
  const served = draftFromLane(lane);
  if (draftsEqual(session.draft, served) || !hasUnsavedEdits(session)) {
    return { baseline: lane, draft: served, seenKey: key, conflict: null };
  }
  return { ...session, seenKey: key, conflict: lane };
}

export function editDraft(session: LaneEditSession, patch: Partial<LaneDraft>): LaneEditSession {
  return { ...session, draft: { ...session.draft, ...patch } };
}

export function editMapping(session: LaneEditSession, key: string, value: string): LaneEditSession {
  return editDraft(session, { mapping: { ...session.draft.mapping, [key]: value } });
}

/** Discards the edits and starts again from the newest saved configuration (or from the baseline when there is no conflict). */
export function reloadFromServer(session: LaneEditSession): LaneEditSession {
  const lane = session.conflict ?? session.baseline;
  return { baseline: lane, draft: draftFromLane(lane), seenKey: snapshotKey(lane), conflict: null };
}

/** Keeps the edits and measures them against the newest saved configuration, so the diff shows exactly what would change. */
export function rebaseOnServer(session: LaneEditSession): LaneEditSession {
  if (!session.conflict) return session;
  return { baseline: session.conflict, draft: session.draft, seenKey: snapshotKey(session.conflict), conflict: null };
}

export function proposedFromDraft(draft: LaneDraft) {
  const sourceProgramMap: Record<string, Record<string, number>> = {};
  for (const [key, value] of Object.entries(draft.mapping)) {
    if (!value) continue;
    const [source, program] = key.split("::");
    (sourceProgramMap[source] ??= {})[program] = Number(value);
  }
  return {
    status: draft.status,
    sourceProgramMap,
    senderAccount: draft.senderAccount.trim() ? draft.senderAccount.trim() : null,
    dailyLimit: Number.parseInt(draft.dailyLimit, 10),
  };
}

const programShort = (program: string) => (PROGRAM_LABELS[program] ?? program).replace(/\s*\(.*$/, "");
const STATE_WORD: Record<string, string> = { closed: "Closed", open: "Open", revoked: "Revoked" };
const revisionWord = (value: string | undefined) => (value ? `Revision ${value}` : "none");

/** Saved-versus-proposed differences, in a stable order: state, sender, limit, then mappings (removals included). */
export function diffAgainstSaved(baseline: LaneSnapshot, draft: LaneDraft): LaneChange[] {
  const saved = normalizeDraft(draftFromLane(baseline));
  const next = normalizeDraft(draft);
  const changes: LaneChange[] = [];
  if (saved.status !== next.status) changes.push({ field: "state", label: "State", from: STATE_WORD[saved.status], to: STATE_WORD[next.status] });
  if (saved.senderAccount !== next.senderAccount) {
    changes.push({ field: "sender", label: "Sender account", from: saved.senderAccount || "not selected", to: next.senderAccount || "not selected" });
  }
  if (saved.dailyLimit !== next.dailyLimit) changes.push({ field: "limit", label: "Daily limit", from: saved.dailyLimit, to: next.dailyLimit });
  const keys = [...new Set([...Object.keys(saved.mapping), ...Object.keys(next.mapping)])].sort();
  for (const key of keys) {
    const from = saved.mapping[key];
    const to = next.mapping[key];
    if (from === to) continue;
    const [source, program] = key.split("::");
    changes.push({
      field: "mapping", label: `${WEBSITE_SOURCE_LABELS[source] ?? source} · ${programShort(program)}`,
      from: revisionWord(from), to: revisionWord(to), removed: Boolean(from) && !to, added: !from && Boolean(to),
    });
  }
  return changes;
}

/** One line per change, for the review block and for tests. */
export const describeChange = (c: LaneChange) =>
  `${c.label}: ${c.from} → ${c.to}${c.removed ? " (removed)" : c.added ? " (added)" : ""}`;
