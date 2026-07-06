#!/usr/bin/env tsx
/**
 * Task #767 — Truthful-State Follow-ups: Ticket Reply Draft Persistence
 *
 * Unit-tests the pure storage helpers in client/src/lib/ticket-draft.ts
 * (loadTicketDraft/saveTicketDraft/clearTicketDraft) used by Tickets.tsx to
 * persist an AI-inserted or hand-typed reply draft across navigation.
 *
 * Uses a minimal in-memory localStorage shim (no browser/DOM needed) so this
 * runs as a plain tsx script, per project convention.
 *
 * No network calls, no DB, no outbound sends. Exits 0 if all assertions
 * pass, 1 if any fail.
 */

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
  get size(): number {
    return this.store.size;
  }
}

const memoryStorage = new MemoryStorage();
(globalThis as any).window = { localStorage: memoryStorage };

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(label);
  }
}

async function main() {
  console.log(`▶ Testing ticket reply draft persistence helpers (client/src/lib/ticket-draft.ts)\n`);

  const { loadTicketDraft, saveTicketDraft, clearTicketDraft, ticketDraftStorageKey } = await import(
    "../client/src/lib/ticket-draft"
  );

  // 1. No draft yet → empty string, no crash.
  assert("No draft saved → loadTicketDraft returns empty string", loadTicketDraft(101) === "");

  // 2. Save a typed draft, reload it (simulating navigating away and back).
  saveTicketDraft(101, "Hi there, following up on your ticket...");
  assert(
    "Saved draft persists across a fresh load call",
    loadTicketDraft(101) === "Hi there, following up on your ticket..."
  );

  // 3. Saved record is scoped to exactly {ticketId, draftBody, updatedAt} —
  //    no extra fields (auth tokens, ticket metadata, etc).
  const raw = memoryStorage.getItem(ticketDraftStorageKey(101));
  assert("Draft record exists in storage", !!raw);
  if (raw) {
    const parsed = JSON.parse(raw);
    const keys = Object.keys(parsed).sort();
    assert(
      "Draft record is scoped to exactly [draftBody, ticketId, updatedAt]",
      JSON.stringify(keys) === JSON.stringify(["draftBody", "ticketId", "updatedAt"]),
      JSON.stringify(keys)
    );
    assert("Draft record ticketId matches", parsed.ticketId === 101);
    assert("Draft record updatedAt is a valid ISO date string", !Number.isNaN(Date.parse(parsed.updatedAt)));
  }

  // 4. AI-inserted draft overwrite behaves the same as a typed one.
  saveTicketDraft(101, "AI drafted: Thanks for reaching out, here's an update...");
  assert(
    "AI-inserted draft overwrites and persists",
    loadTicketDraft(101) === "AI drafted: Thanks for reaching out, here's an update..."
  );

  // 5. Drafts are scoped per-ticket — do not leak across tickets.
  saveTicketDraft(202, "Different ticket, different draft");
  assert("Ticket 101 draft unaffected by ticket 202 save", loadTicketDraft(101).startsWith("AI drafted"));
  assert("Ticket 202 has its own draft", loadTicketDraft(202) === "Different ticket, different draft");

  // 6. Clearing (on send/discard) removes the draft entirely — not just
  //    empties the text — so a future reload does not resurrect stale text.
  clearTicketDraft(101);
  assert("clearTicketDraft removes the stored record", loadTicketDraft(101) === "");
  assert("clearTicketDraft does not affect other tickets", loadTicketDraft(202) === "Different ticket, different draft");

  // 7. Saving an empty/whitespace-only draft also clears storage (mirrors
  //    "discard" semantics without an explicit clear call).
  saveTicketDraft(202, "   ");
  assert("Saving whitespace-only draft clears storage", loadTicketDraft(202) === "");

  // 8. localStorage failures (private browsing, quota) must never throw —
  //    persistence is a UX nicety, not a hard dependency.
  const throwingStorage = {
    getItem() { throw new Error("storage disabled"); },
    setItem() { throw new Error("storage disabled"); },
    removeItem() { throw new Error("storage disabled"); },
  };
  const previousWindow = (globalThis as any).window;
  (globalThis as any).window = { localStorage: throwingStorage };
  let threw = false;
  try {
    saveTicketDraft(303, "test");
    loadTicketDraft(303);
    clearTicketDraft(303);
  } catch {
    threw = true;
  }
  assert("Storage helpers never throw when localStorage is unavailable", threw === false);
  (globalThis as any).window = previousWindow;

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFailures:", failures.join(", "));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
