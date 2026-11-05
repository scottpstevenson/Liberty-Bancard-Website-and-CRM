/**
 * Public wizard submission intent (R01-4). One tuple — draft id, draft capability and the
 * finalize idempotency key — is stored and cleared TOGETHER, so a key can never outlive or be
 * reused against a different draft. Nothing protected is ever stored here.
 */

export const DRAFT_ID_KEY = "lb_draft_id";
export const DRAFT_TOKEN_KEY = "lb_draft_token";
export const INTENT_KEY = "lb_finalize_intent";
/** Pre-tuple key; only ever removed, never read. */
const LEGACY_FINALIZE_KEY = "lb_finalize_key";

export interface SubmissionIntent { draftId: number; key: string }

function store(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** Returns false when storage is unavailable or full (never throws). */
export function writeDraftCredentials(id: number, token: string): boolean {
  const s = store();
  if (!s) return false;
  try { s.setItem(DRAFT_ID_KEY, String(id)); s.setItem(DRAFT_TOKEN_KEY, token); return true; } catch { return false; }
}

export function readDraftCredentials(): { id: number; token: string } | null {
  const s = store();
  if (!s) return null;
  try {
    const id = Number(s.getItem(DRAFT_ID_KEY));
    const token = s.getItem(DRAFT_TOKEN_KEY);
    return Number.isInteger(id) && id > 0 && token ? { id, token } : null;
  } catch { return null; }
}

export function readIntent(): SubmissionIntent | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(INTENT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return Number.isInteger(v?.draftId) && typeof v?.key === "string" && v.key ? { draftId: v.draftId, key: v.key } : null;
  } catch { return null; }
}

/** Reuse the stored key only when it belongs to THIS draft; otherwise mint a new one for it. */
export function intentKeyForDraft(draftId: number): { key: string; persisted: boolean } {
  const existing = readIntent();
  if (existing && existing.draftId === draftId) return { key: existing.key, persisted: true };
  const key = crypto.randomUUID();
  const s = store();
  let persisted = false;
  if (s) { try { s.setItem(INTENT_KEY, JSON.stringify({ draftId, key })); persisted = true; } catch { persisted = false; } }
  return { key, persisted };
}

/** Start Fresh / Discard / successful submit: the whole tuple goes together. */
export function clearSubmissionTuple(extraKeys: string[] = []): void {
  const s = store();
  if (!s) return;
  for (const k of [DRAFT_ID_KEY, DRAFT_TOKEN_KEY, INTENT_KEY, LEGACY_FINALIZE_KEY, ...extraKeys]) {
    try { s.removeItem(k); } catch { /* storage unavailable: nothing to clear */ }
  }
}
