/**
 * Offline C7 contract checks. This test reads source only; it does not connect
 * to a database, call a provider, or mutate budget/control state.
 *
 * Run: npx tsx scripts/test-ladder-budget-accounting-static.ts
 */
import { readFileSync } from "node:fs";

let failures = 0;
function check(label: string, condition: boolean): void {
  if (condition) console.log(`PASS: ${label}`);
  else {
    failures++;
    console.error(`FAIL: ${label}`);
  }
}

const ledger = readFileSync("server/services/cro03/shared-paid-budget-ledger.ts", "utf8");
const authority = readFileSync("server/services/mi09-pilot-authority.ts", "utf8");
const preview = readFileSync("server/services/cro03/sfp-cost-preview.ts", "utf8");
const operations = readFileSync("server/services/cro03/sfp-provider-operations.ts", "utf8");

check(
  "terminal SFP stage runs stay in the canonical amount denominator",
  /SUM\(reserved_cost_micros\) FROM sfp_stage_runs\)/.test(ledger) &&
    /SUM\(settled_cost_micros\) FROM sfp_stage_runs\)/.test(ledger),
);
check(
  "classification evidence is settled source without re-adding its run summary",
  /SUM\(cost_micros\) FROM sfp_classification_evidence/.test(ledger) &&
    !/SUM\(settled_cost_micros\) FROM sfp_classification_runs\), 0\) AS settled/.test(ledger),
);
check(
  "CRO-03C terminal settled costs and ambiguous reservations remain represented",
  /GREATEST\(max_reserved_amount_micros, settled_amount_micros\)/.test(ledger) &&
    /billing_certainty IN \('ambiguous','unknown'\)/.test(ledger) &&
    !/WHERE state NOT IN \('failed', 'cancelled'\)/.test(ledger),
);
check(
  "pilot summary reads the same canonical shared ledger",
  /computeLadderBudgetLedger\(tx\)/.test(authority) &&
    /acquireLadderBudgetLock\(tx\)/.test(authority),
);
check(
  "provider breakdown is explicitly scoped to linked CRO-03C pilot operations",
  /scope: "mi09_pilot_linked_cro03c_operations_only"/.test(authority) &&
    /provider breakdown remains pilot-link scoped/.test(authority),
);
check(
  "SFP preview consumes the shared summary without adding pilot spend twice",
  /const aggregate = await getAggregatePilotSpend\(\)/.test(preview) &&
    !/pilotSpend\.settledMicros|pilotSpend\.reservedMicros/.test(preview),
);
check(
  "SFP reservation adds only its new reservation to the already-combined ledger",
  !/externalSpendMicros/.test(operations) &&
    /reservationMicros: input\.reservationMicros,\s*capMicros: input\.capMicros/.test(operations),
);
check(
  "settlement changes share the advisory lock and ambiguous failures retain reservation",
  (operations.match(/await acquireLadderBudgetLock\(tx\)/g) ?? []).length >= 3 &&
    /const dispatchWasMarked = String\(attemptState\?\.outcome \?\? ""\) === "ambiguous"/.test(operations) &&
    /const billingAmbiguous = !completed && \(input\.outcome === "ambiguous" \|\| dispatchWasMarked\)/.test(operations) &&
    /notDispatched \|\| completed \? input\.reservation\.amountMicros/.test(operations),
);
check(
  "provider transport persists the post-dispatch ambiguity boundary",
  /markSfpProviderOperationDispatchBoundary\(reservation\.operationId, reservation\.claimToken\)/.test(operations) &&
    /UPDATE provider_attempts a SET outcome='ambiguous'/.test(operations),
);
check(
  "only expired, still-pending pre-dispatch reservations are released automatically",
  /releaseExpiredPreDispatchSfpReservations/.test(operations) &&
    /lease_expires_at<=NOW\(\) AND a\.outcome='pending'/.test(operations) &&
    /billing_state='released',failure_code='PRE_DISPATCH_LEASE_EXPIRED'/.test(operations),
);

if (failures > 0) process.exit(1);
console.log("ALL C7 STATIC CHECKS PASSED");