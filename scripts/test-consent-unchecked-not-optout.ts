/**
 * CONS-01 regression guard.
 *
 * Confirms that optional, unchecked consent checkboxes on public routes never
 * pass a defined `false` into the consent-merge/consent-authority boundary
 * (which would silently opt out a previously-consented contact), while an
 * explicit affirmative checkbox still records opt-in, and consent-merge.ts's
 * own block/DNC logic (previously-opted-out stays blocked; explicit
 * STOP/unsubscribe still works) is untouched.
 *
 * Static, source-pattern based — no DB required.
 */
import fs from "fs";
import assert from "assert";

const publicRoutes = fs.readFileSync("server/routes/public.ts", "utf-8");
const consentMerge = fs.readFileSync("server/services/consent-merge.ts", "utf-8");

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`FAIL ${name}`);
    console.error(err?.message || err);
    process.exitCode = 1;
  }
}

check("statement-upload existing-contact SMS consent is undefined when unchecked, not false", () => {
  assert.match(
    publicRoutes,
    /incomingConsent:\s*\{\s*consentSms:\s*parseBool\(consentSms\)\s*\?\s*true\s*:\s*undefined\s*\}/,
    "statement-upload must pass undefined (not false) for an unchecked optional SMS consent box",
  );
});

check("support existing-contact SMS consent is undefined when unchecked, not false", () => {
  const supportRoute = publicRoutes.slice(publicRoutes.indexOf('"/api/public/support"'));
  const nextRouteIdx = supportRoute.indexOf('app.post("/api/public/get-started"');
  const scoped = nextRouteIdx > -1 ? supportRoute.slice(0, nextRouteIdx) : supportRoute;
  assert.doesNotMatch(
    scoped,
    /incomingConsent:\s*\{\s*consentSms:\s*consentSms\s*===\s*true\s*\}/,
    "support route must not pass a defined boolean derived directly from consentSms===true for an optional box",
  );
});

check("consent-merge.ts still blocks re-opt-in over an existing opt-out/DNC record", () => {
  assert.match(consentMerge, /existing_email_opt_out/);
  assert.match(consentMerge, /existing_sms_opt_out/);
  assert.match(consentMerge, /global_dnc/);
  assert.match(
    consentMerge,
    /incoming === true[\s\S]{0,300}blockedAttempts\.push/,
    "an incoming true against a blocked channel must still be rejected, not silently accepted",
  );
});

check("consent-merge.ts treats an absent (undefined) incoming value as a no-op for both channels", () => {
  assert.match(consentMerge, /incomingConsent\.consentEmail !== undefined/);
  assert.match(consentMerge, /incomingConsent\.consentSms !== undefined/);
});

console.log(`\nCONS-01 unchecked-consent-not-opt-out checks: ${passed} passed.`);
if (process.exitCode) process.exit(1);
