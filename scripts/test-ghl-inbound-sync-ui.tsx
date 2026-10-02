// Run: npx tsx --tsconfig scripts/tsconfig.ghl-inbound-ui-test.json scripts/test-ghl-inbound-sync-ui.tsx
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GhlInboundSyncCard } from "../client/src/components/dashboard/GhlInboundSyncCard";
import type { GhlInboundSyncRun, GhlInboundSyncStatus } from "../shared/ghl-inbound-sync";

const endpoint = "/api/admin/ghl/inbound-contact-sync";
const run: GhlInboundSyncRun = {
  runId: "00000000-0000-4000-8000-000000000001",
  state: "ready", createdAt: "2026-10-02T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z",
  previewHash: "a".repeat(64), nextAction: null, lastError: null, issues: [],
  counts: { scanned: 100, matched: 20, wouldUpdate: 10, wouldCreate: 80, unchanged: 10, conflicts: 0, skipped: 0, updated: 0, created: 0 },
};
const status: GhlInboundSyncStatus = {
  environment: "production", configured: true, inboundEnabled: false, outboundPaused: true, run,
};
function render(data?: GhlInboundSyncStatus, canControl = true, error = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } } });
  if (data) client.setQueryData([endpoint], data);
  if (error) client.getQueryCache().build(client, { queryKey: [endpoint] }).setState({
    status: "error", fetchStatus: "idle", error: new Error("unavailable"),
  });
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><GhlInboundSyncCard canControl={canControl} /></QueryClientProvider>);
  client.clear();
  return html;
}
const button = (html: string, id: string) => html.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
const disabledAttribute = /\sdisabled(?:=|\s|>)/;
let checks = 0;
function check(name: string, test: () => void) { test(); checks++; console.log(`PASS ${name}`); }
check("Non-admin has no preview, import or control actions", () => {
  const html = render(undefined, false);
  assert.match(html, /An administrator must/);
  assert.doesNotMatch(html, /button-ghl-inbound-preview|button-ghl-inbound-execute|switch-ghl-inbound-updates/);
});
check("Unknown status is not healthy or active", () => {
  const html = render();
  assert.match(html, /Database state unknown/);
  assert.match(button(html, "button-ghl-inbound-preview"), disabledAttribute);
  assert.doesNotMatch(html, /Import completed|Applying to this database/);
});
check("Failed status is explicitly unavailable", () => {
  assert.match(render(undefined, true, true), /Incoming sync status is unavailable/);
});
check("Production preview is not an import receipt", () => {
  const html = render(status);
  assert.match(html, /Preview ready — not imported/);
  assert.match(html, /Apply to production database/);
  assert.match(html, /Actually added<\/dt><dd[^>]*>0/);
  assert.match(html, /Would add contacts<\/dt><dd[^>]*>80/);
  assert.doesNotMatch(button(html, "button-ghl-inbound-execute"), disabledAttribute);
});
check("Development cannot be mistaken for production", () => {
  const html = render({ ...status, environment: "development" });
  assert.match(html, /Applying here does not update production/);
  assert.match(html, /Apply to development database/);
});
check("Unpaused or unknown outbound blocks execution", () => {
  for (const outboundPaused of [false, null]) {
    const html = render({ ...status, outboundPaused });
    assert.match(button(html, "button-ghl-inbound-execute"), disabledAttribute);
    assert.match(html, /import blocked/);
  }
});
check("Missing preview hash cannot enable execution", () => {
  assert.match(button(render({ ...status, run: { ...run, previewHash: null } }), "button-ghl-inbound-execute"), disabledAttribute);
});
check("Running imports cannot start competing previews", () => {
  const html = render({ ...status, run: { ...run, state: "running", nextAction: "apply" } });
  assert.match(button(html, "button-ghl-inbound-preview"), disabledAttribute);
  assert.doesNotMatch(html, /button-ghl-inbound-execute/);
});
check("Complete receipts use actual counts separately from preview", () => {
  const html = render({ ...status, run: { ...run, state: "complete", counts: { ...run.counts, updated: 9, created: 70 } } });
  assert.match(html, /Import completed/);
  assert.match(html, /Actually added<\/dt><dd[^>]*>70/);
  assert.doesNotMatch(html, /button-ghl-inbound-execute/);
});
check("Ongoing-update enablement is not proof of receipt", () => {
  const html = render({ ...status, inboundEnabled: true, run: null });
  assert.match(html, /receipt depends on GHL delivering signed events/);
  assert.match(html, /It does not|Nothing is sent back to GHL/);
});
console.log(`${checks} GHL inbound UI state checks passed (static render; no browser actions or API mutations).`);