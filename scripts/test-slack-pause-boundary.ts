#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { postSlackWithPause } from "../server/services/system-audit/slack-notifier";

// The critical alert prepares its Redis claim and feed entry asynchronously.
// Pause during that preparation must be observed at the final Slack boundary.
let paused = false;
let epoch = 1n;
let sends = 0;
let registrations = 0;
let deregistrations = 0;
const deps = {
  authorize: async () => ({ allowed: !paused, epoch }),
  registerInflight: async () => { registrations++; },
  recheckEpoch: async (grantedEpoch: bigint) => !paused && grantedEpoch === epoch,
  deregisterInflight: () => { deregistrations++; },
  send: async () => {
    sends++;
    return new Response(null, { status: 200 });
  },
};

let finishPreparation!: () => void;
const preparation = new Promise<void>(resolve => { finishPreparation = resolve; });
const alert = (async () => {
  await preparation;
  return postSlackWithPause("https://example.invalid/slack", { blocks: [] }, deps);
})();
paused = true;
epoch++;
finishPreparation();
assert.equal(await alert, null);
assert.equal(sends, 0, "no Slack HTTP request after pause during preparation");
assert.equal(registrations, 0, "paused attempt does not register or send");

paused = false;
const afterAuthorization = {
  ...deps,
  registerInflight: async () => {
    registrations++;
    paused = true;
    epoch++;
  },
};
assert.equal(await postSlackWithPause("https://example.invalid/slack", {}, afterAuthorization), null);
assert.equal(sends, 0, "epoch changed while registering: no Slack HTTP request");
assert.equal(deregistrations, 1, "failed recheck releases in-flight registration");

paused = false;
assert.equal((await postSlackWithPause("https://example.invalid/slack", {}, deps))?.status, 200);
assert.equal(sends, 1);
assert.equal(deregistrations, 2, "successful send releases in-flight registration");

let finishRequest!: (response: Response) => void;
const pendingResponse = new Promise<Response>(resolve => { finishRequest = resolve; });
const pending = postSlackWithPause("https://example.invalid/slack", {}, {
  ...deps,
  send: async () => {
    sends++;
    return pendingResponse;
  },
});
// Yield through the async authorize/register/recheck before checking the
// in-flight drain; the request remains unresolved until explicitly finished.
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(sends, 2);
assert.equal(deregistrations, 2, "in-flight send stays registered while Slack request is pending");
finishRequest(new Response(null, { status: 200 }));
assert.equal((await pending)?.status, 200);
assert.equal(deregistrations, 3);

const source = readFileSync("server/services/system-audit/slack-notifier.ts", "utf8");
const critical = source.slice(source.indexOf("export async function sendCriticalAlert"));
assert.match(critical, /await postSlackWithPause\(url, body\)/, "critical alerts use the tested Slack boundary");
assert.doesNotMatch(critical, /\bawait fetch\(url/);
console.log("Slack pause-boundary race checks passed");