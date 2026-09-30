/**
 * INB-01 regression guard.
 *
 * Confirms the callback route (`/api/public/callback` in server/routes/public.ts)
 * no longer hard-codes `email: ""` and always creates a new contact — it must
 * normalize phone, reuse a single unambiguous match, route ambiguous matches to
 * review instead of merging/duplicating, and still create exactly one inbound
 * occurrence acceptance in every branch.
 *
 * Static, source-pattern based — no DB required.
 */
import fs from "fs";
import assert from "assert";

const publicRoutes = fs.readFileSync("server/routes/public.ts", "utf-8");

function routeBody(src: string, path: string): string {
  const appPostStart = src.indexOf(`app.post("${path}"`);
  assert.ok(appPostStart > -1, `route ${path} not found`);
  const rest = src.slice(appPostStart);
  // crude but effective: find the next top-level "app.post(" or "app.get(" after this one
  const nextIdx = rest.slice(10).search(/\n\s*app\.(post|get)\(/);
  return nextIdx > -1 ? rest.slice(0, nextIdx + 10) : rest;
}

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

const callbackRoute = routeBody(publicRoutes, "/api/public/callback");

check("callback route no longer hard-codes email: \"\" on every submission", () => {
  assert.doesNotMatch(callbackRoute, /email:\s*""\s*,\s*phone:\s*phone/);
});

check("callback route normalizes the submitted phone before identity matching", () => {
  assert.match(callbackRoute, /normalizePhoneE164\(/);
});

check("callback route reuses a single safe match via the canonical existing-contact path", () => {
  assert.match(callbackRoute, /matchingContacts\.length === 1/);
  assert.match(callbackRoute, /processExistingPublicFormSubmission\(/);
});

check("callback route routes multiple candidate matches to review instead of merging/duplicating", () => {
  assert.match(callbackRoute, /matchingContacts\.length > 1/);
  assert.doesNotMatch(
    callbackRoute.slice(
      callbackRoute.indexOf("matchingContacts.length > 1"),
      callbackRoute.indexOf("matchingContacts.length === 1"),
    ),
    /writeContact\(|processExistingPublicFormSubmission\(/,
    "the ambiguous-match branch must not itself create or merge a contact",
  );
});

check("callback route creates exactly one new contact only when there is no match", () => {
  assert.match(callbackRoute, /writeContact\(/);
  assert.match(callbackRoute, /no-email-\$\{submissionId\}@no-email\.libertybancard\.internal/);
});

check("ambiguous callback uses the contactless review authority, not sales orchestration", () => {
  assert.match(callbackRoute, /queueAmbiguousCallbackReview\(/);
  assert.doesNotMatch(callbackRoute, /acceptInbound\(req,\s*\{\s*\}\)/);
  assert.match(callbackRoute, /acceptInbound\(req,\s*\{\s*contactId:\s*contact\.id/);
});

console.log(`\nINB-01 callback identity checks: ${passed} passed.`);
if (process.exitCode) process.exit(1);
