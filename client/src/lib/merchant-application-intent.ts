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

/** Open-page copy of the intent: a retry on the same page reuses the key even when browser storage is unavailable. */
let memoryIntent: SubmissionIntent | null = null;

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
  if (existing && existing.draftId === draftId) { memoryIntent = existing; return { key: existing.key, persisted: true }; }
  if (memoryIntent && memoryIntent.draftId === draftId) {
    // Stored copy is gone or never existed: keep the open page's key and try to persist it again.
    const s2 = store();
    let ok = false;
    if (s2) { try { s2.setItem(INTENT_KEY, JSON.stringify(memoryIntent)); ok = true; } catch { ok = false; } }
    return { key: memoryIntent.key, persisted: ok };
  }
  const key = crypto.randomUUID();
  memoryIntent = { draftId, key };
  const s = store();
  let persisted = false;
  if (s) { try { s.setItem(INTENT_KEY, JSON.stringify({ draftId, key })); persisted = true; } catch { persisted = false; } }
  return { key, persisted };
}

/** Start Fresh / Discard / successful submit: the whole tuple goes together. */
export function clearSubmissionTuple(extraKeys: string[] = []): void {
  memoryIntent = null;
  for (const k of extraKeys) memoryDraft.delete(k);
  const s = store();
  if (!s) return;
  for (const k of [DRAFT_ID_KEY, DRAFT_TOKEN_KEY, INTENT_KEY, LEGACY_FINALIZE_KEY, ...extraKeys]) {
    try { s.removeItem(k); } catch { /* storage unavailable: nothing to clear */ }
  }
}

/**
 * Guarded adapter for the non-protected resume draft. Reading or writing never throws: when browser storage is
 * unavailable (blocked, full, private mode) the draft lives in memory for this open page only, and `set` reports
 * false so the page can say it was NOT saved on this device.
 */
const memoryDraft = new Map<string, string>();
export const guardedLocalDraft = {
  get(key: string): string | null {
    const s = store();
    if (s) { try { const v = s.getItem(key); if (v !== null) return v; } catch { /* fall through to memory */ } }
    return memoryDraft.get(key) ?? null;
  },
  /** true only when the value reached browser storage. */
  set(key: string, value: string): boolean {
    memoryDraft.set(key, value);
    const s = store();
    if (!s) return false;
    try { s.setItem(key, value); return true; } catch { return false; }
  },
  remove(key: string): void {
    memoryDraft.delete(key);
    const s = store();
    if (!s) return;
    try { s.removeItem(key); } catch { /* storage unavailable: nothing to clear */ }
  },
};
