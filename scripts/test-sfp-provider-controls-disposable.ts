#!/usr/bin/env npx tsx
/**
 * Disposable certification for audited provider controls and exact SFP cost
 * accounting. This never calls a provider: fake credentials are present only
 * so the control service can validate its enable precondition, and the deny
 * boundary prevents accidental external I/O.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { assertDisposableTestInfrastructure } from "./test-infrastructure-guard";
import { applyCertificationProviderDenyBoundary } from "./certification-provider-deny";

await assertDisposableTestInfrastructure({
  operation: "SFP provider-control and exact-cost disposable certification",
  requireRedis: false,
});
process.env.VG_PROVIDER_DENY_MODE = "1";
applyCertificationProviderDenyBoundary({ fatal: true });
process.env.CRO03_PROVIDER_TRANSPORT_ENABLED = "true";
process.env.SERPER_API_KEY = "fake-cert-serper";
process.env.OUTSCRAPER_API_KEY = "fake-cert-outscraper";
process.env.APOLLO_API_KEY = "fake-cert-apollo";
process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "fake-cert-openai";
process.env.ZEROBOUNCE_API_KEY = "fake-cert-zerobounce";

const { runDrizzleMigrations } = await import("../server/db-migrate");
await runDrizzleMigrations();
const { db, pool } = await import("../server/db");
const rows = (r: any): any[] => r?.rows ?? r ?? [];
let checks = 0;
function check(value: unknown, label: string): asserts value {
  checks++;
  assert.ok(value, `[${checks}] ${label}`);
  console.log(`✓ [${checks}] ${label}`);
}

try {
  const { execSync } = await import("node:child_process");
  execSync("npx tsx scripts/seed-mi09-pricing.ts --apply --confirm-env=test", { stdio: "pipe", env: process.env });
} catch {
  // Seed is idempotent; pricing is checked below and fails closed if absent.
}

const { getCurrentPricingSchedule, MI09_LADDER_AGGREGATE_PAID_BUDGET_MICROS } = await import(
  "../server/services/mi09-pilot-authority"
);
const { updateSfpPaidProviderControl, getPaidProviderControls } = await import(
  "../server/services/paid-provider-control"
);
const pricing = await getCurrentPricingSchedule();
const apolloPrice = Number((pricing.priceSchedules as any).apollo?.amountMicros);
const serperPrice = Number((pricing.priceSchedules as any).serper?.amountMicros);
check(Number.isSafeInteger(apolloPrice) && apolloPrice > 0 && Number.isSafeInteger(serperPrice) && serperPrice > 0,
  "reviewed active pricing exists for Apollo and Serper");

const nonce = randomUUID();
const authorityBefore = rows(await db.execute(sql`
  SELECT value FROM system_settings WHERE key='mi09_pilot_paid_budget_authorization'
`))[0]?.value ?? null;
for (const [provider, capability] of [
  ["serper", "business_discovery"], ["outscraper", "business_discovery"],
  ["openai", "cro03_classification"], ["apollo", "contact_enrichment"],
  ["zerobounce", "email_validation"],
] as const) {
  await db.execute(sql`
    INSERT INTO provider_controls(provider,capability,enabled,circuit_state,local_budget_units,reserved_units,consumed_units,version,updated_at)
    VALUES (${provider},${capability},FALSE,'closed',100,2,3,0,NOW())
    ON CONFLICT(provider) DO UPDATE SET capability=EXCLUDED.capability,enabled=FALSE,circuit_state='closed',
      local_budget_units=100,reserved_units=2,consumed_units=3,version=provider_controls.version+1,updated_at=NOW()
  `);
}
await db.execute(sql`
  INSERT INTO serper_control(id,enabled,state,window_calls,local_budget,window_started_at,window_ends_at)
  VALUES (1,FALSE,'closed',7,40,NOW(),date_trunc('month',NOW())+INTERVAL '1 month')
  ON CONFLICT(id) DO UPDATE SET enabled=FALSE,state='closed',window_calls=7,local_budget=40,updated_at=NOW()
`);

const apolloCapMicros = apolloPrice * 20; // 20 units, comfortably above 5 already committed.
const apolloEnabled = await updateSfpPaidProviderControl({
  provider: "apollo", enabled: true, maxSpendUsdMicros: apolloCapMicros,
  reason: "Disposable control certification", actorId: `cert:${nonce}`,
});
check(apolloEnabled.enabled === true && Number(apolloEnabled.local_budget_units) === 20,
  "Apollo enable converts explicit USD ceiling through the current reviewed unit price");
check(Number(apolloEnabled.consumed_units) === 3 && Number(apolloEnabled.reserved_units) === 2,
  "Apollo control mutation preserves prior consumed and reserved units");

const serperCapMicros = serperPrice * 50;
const serperEnabled = await updateSfpPaidProviderControl({
  provider: "serper", enabled: true, maxSpendUsdMicros: serperCapMicros,
  reason: "Disposable control certification", actorId: `cert:${nonce}`,
});
check(Number(serperEnabled.local_budget_units) === 50 && Number(serperEnabled.gatewayBudgetUnits) === 50,
  "Serper canonical and legacy gateway caps are synchronized in one transaction");
check(Number(serperEnabled.consumed_units) === 3 && Number(serperEnabled.reserved_units) === 2 && Number(serperEnabled.gatewayConsumedUnits) === 7,
  "Serper cap synchronization preserves both counters");

await updateSfpPaidProviderControl({
  provider: "apollo", enabled: false, reason: "Pause provider in disposable test", actorId: `cert:${nonce}`,
});
const apolloPaused = rows(await db.execute(sql`SELECT enabled,local_budget_units,reserved_units,consumed_units,circuit_state FROM provider_controls WHERE provider='apollo'`))[0];
check(apolloPaused.enabled === false && Number(apolloPaused.local_budget_units) === 20 &&
      Number(apolloPaused.reserved_units) === 2 && Number(apolloPaused.consumed_units) === 3 && apolloPaused.circuit_state === "closed",
  "pausing a provider preserves its cap, counters, and circuit state");

let belowCommittedRejected = false;
try {
  await updateSfpPaidProviderControl({
    provider: "apollo", enabled: true, maxSpendUsdMicros: apolloPrice * 4,
    reason: "Reject cap below current usage", actorId: `cert:${nonce}`,
  });
} catch (error: any) {
  belowCommittedRejected = String(error?.message ?? error).includes("SPEND_CAP_BELOW_COMMITTED_USAGE");
}
check(belowCommittedRejected, "requested provider cap below committed units fails without changing control");

await db.execute(sql`UPDATE provider_controls SET circuit_state='open' WHERE provider='outscraper'`);
let circuitRejected = false;
try {
  await updateSfpPaidProviderControl({
    provider: "outscraper", enabled: true, maxSpendUsdMicros: 1_000_000,
    reason: "Reject open circuit enable", actorId: `cert:${nonce}`,
  });
} catch (error: any) {
  circuitRejected = String(error?.message ?? error).includes("CIRCUIT_NOT_CLOSED");
}
check(circuitRejected, "provider with its own open circuit cannot be enabled through the control UI");

const exactCost = 12_345;
const priorApolloSfpCosts = rows(await db.execute(sql`
  SELECT COALESCE(SUM(settled_cost_micros),0)::bigint AS settled,
         COUNT(*) FILTER (WHERE unit_price_micros IS NULL)::int AS unpriced
    FROM provider_operations WHERE provider='apollo' AND purpose LIKE 'sfp_%'
`))[0];
const costOperationKey = `sfp-cost-cert-${nonce}`;
await db.execute(sql`
  INSERT INTO provider_operations
    (provider,operation_type,purpose,idempotency_key,actor_type,actor_id,target_fingerprint,state,
     requested_units,reserved_units,billing_state,attempt_count,unit_price_micros,settled_cost_micros,started_at,completed_at)
  VALUES ('apollo','sfp_enrichment','sfp_contact_enrichment',${costOperationKey},'system',${`cert:${nonce}`},
          ${`business:${nonce}`},'completed',1,1,'committed',1,${apolloPrice},${exactCost},NOW(),NOW())
`);
await db.execute(sql`
  INSERT INTO provider_operations
    (provider,operation_type,purpose,idempotency_key,actor_type,actor_id,target_fingerprint,state,
     requested_units,reserved_units,billing_state,attempt_count,started_at,completed_at)
  VALUES ('apollo','legacy_operation','sfp_legacy_unpriced',${`sfp-legacy-cost-cert-${nonce}`},'system',${`cert:${nonce}`},
          ${`business:legacy-${nonce}`},'completed',1,1,'committed',1,NOW(),NOW())
`);
const providerControls = await getPaidProviderControls();
const apolloView = providerControls.providers.find((provider: any) => provider.provider === "apollo") as any;
check(Number(apolloView.sfpSettledCostMicros) === Number(priorApolloSfpCosts.settled) + exactCost &&
      Number(apolloView.sfpUnpricedOperationCount) === Number(priorApolloSfpCosts.unpriced) + 1,
  "CRM control snapshot reports exact stored provider cost and separately identifies legacy unpriced operations");

const authorityAfter = rows(await db.execute(sql`
  SELECT value FROM system_settings WHERE key='mi09_pilot_paid_budget_authorization'
`))[0]?.value ?? null;
check(MI09_LADDER_AGGREGATE_PAID_BUDGET_MICROS === 50_000_000 && JSON.stringify(authorityBefore) === JSON.stringify(authorityAfter),
  "provider controls do not raise/reset the shared $50 cap or rewrite its authorization");
const audits = rows(await db.execute(sql`
  SELECT COUNT(*)::int AS n FROM audit_logs
   WHERE action='sfp_provider_control_changed' AND actor_id=${`cert:${nonce}`}
`))[0];
check(Number(audits.n) === 3, "each successful provider enable/pause writes an operator audit receipt");

console.log(`\n✅ ${checks} provider-control and exact-cost assertions passed; provider deny boundary remained active.`);
process.exit(0);
