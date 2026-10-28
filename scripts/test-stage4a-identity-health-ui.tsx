// Run: npx tsx --tsconfig scripts/tsconfig.ghl-inbound-ui-test.json scripts/test-stage4a-identity-health-ui.tsx
// Static-markup mount of identity health states plus the rate/average helpers. No network or DB.
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IdentityHealthView, type IdentityHealthData } from "../client/src/pages/dashboard/sdr/IdentityHealthDashboard";
import { summarizeDomains } from "../client/src/lib/domain-health-summary";
import { ratePercent, formatRate, averageKnown } from "../shared/rate-evidence";

let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log(`PASS ${name}`); };
const ident = (over: Partial<IdentityHealthData> = {}): IdentityHealthData => ({
  id: 1, label: "Inbox A", domain: "a.test", emailAddress: "a@a.test", isActive: true, warmupStatus: "warm", dailyLimit: 30, sentToday: 0,
  healthScore: 90, bounceRate: 2, replyRate: 5, complaintRate: 0, openRate: 40, weekSent: 100,
  evidence: { basis: "x", denominator: 100, sufficient: true }, alert: null, ...over,
});
const render = (p: React.ComponentProps<typeof IdentityHealthView>) => renderToStaticMarkup(<IdentityHealthView {...p} />);

check("ratePercent: zero denominator is null, a real zero stays 0", () => {
  assert.equal(ratePercent(3, 0), null);
  assert.equal(ratePercent(0, 0), null);
  assert.equal(ratePercent(null, undefined), null);
  assert.equal(ratePercent(0, 50), 0);
  assert.equal(ratePercent("2", "40", 1), 5);
  assert.equal(formatRate(null), "n/a");
  assert.equal(formatRate(0), "0%");
});
check("zero-send identity renders n/a rates and the no-evidence note, never 0%", () => {
  const html = render({ data: [ident({ bounceRate: null, replyRate: null, openRate: null, complaintRate: null, weekSent: 0, evidence: { basis: "x", denominator: 0, sufficient: false } })] });
  assert.match(html, /identity-1-no-evidence/);
  assert.match(html, /n\/a/);
  assert.doesNotMatch(html, />0%</);
});
check("a real 0% with sends is shown as 0%", () => {
  const html = render({ data: [ident({ bounceRate: 0, replyRate: 0, openRate: 0 })] });
  assert.match(html, />0%</);
  assert.doesNotMatch(html, /identity-1-no-evidence/);
});
check("an error with no data is unavailable (with Retry), not the setup empty state", () => {
  const html = render({ error: new Error("500: boom"), onRetry: () => {} });
  assert.match(html, /identity-health-unavailable/);
  assert.match(html, /button-identity-health-retry/);
  assert.doesNotMatch(html, /No sending identities configured/);
});
check("a denied role is denied, with no Retry and no setup guidance", () => {
  const html = render({ error: new Error('403: {"message":"Forbidden"}'), onRetry: () => {} });
  assert.match(html, /identity-health-denied/);
  assert.doesNotMatch(html, /button-identity-health-retry|No sending identities configured/);
});
check("setup guidance appears only for a successful empty result", () => {
  const html = render({ data: [] });
  assert.match(html, /identity-health-empty/);
  assert.match(html, /No sending identities configured/);
});
check("domain summary averages known scores only, keeps a real 0 and reports coverage", () => {
  const base = { domain: "d.test", isActive: true, warmupStatus: "warm", effectiveDailyLimit: 10 };
  const rows = summarizeDomains([
    { ...base, healthScore: 80 }, { ...base, healthScore: null }, { ...base, healthScore: 100 },
    { ...base, domain: "z.test", healthScore: 0 }, { ...base, domain: "n.test", healthScore: null },
  ]);
  const d = rows.find((r) => r.domain === "d.test")!;
  assert.equal(d.avgHealth, 90, "the unknown score is not averaged in as 0");
  assert.equal(d.knownHealth, 2);
  assert.equal(d.count, 3);
  assert.equal(rows.find((r) => r.domain === "z.test")!.avgHealth, 0, "a real 0 is preserved");
  assert.equal(rows.find((r) => r.domain === "n.test")!.avgHealth, null, "no known score means unknown");
  assert.deepEqual(averageKnown([]), { average: null, known: 0, total: 0 });
});
console.log(`${checks} mount checks passed`);
