/**
 * INB-03 regression guard.
 *
 * Confirms the estimate, support, and get-started public routes validate
 * their body with a bounded, strict Zod schema (matching the existing
 * integration-request/newsletter pattern) before any business mutation.
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

for (const path of ["/api/public/estimate", "/api/public/support", "/api/public/get-started"]) {
  const route = routeBody(publicRoutes, path);
  check(`${path} validates the body with a strict Zod schema before mutation`, () => {
    assert.match(route, /z\.object\(\{/, "expected a z.object schema literal in this route");
    assert.match(route, /\}\)\.strict\(\)/, "schema must reject unexpected keys (.strict())");
    assert.match(route, /safeParse\(req\.body\)/, "expected schema.safeParse(req.body)");
    assert.match(route, /if \(!parsed\.success\)/, "expected an explicit failure branch");
    assert.match(route, /res\.status\(400\)/, "invalid input must return 400");
  });
  check(`${path} schema validation runs before any storage/contact mutation`, () => {
    const parseIdx = route.indexOf("safeParse(req.body)");
    const firstMutationIdx = Math.min(
      ...["writeContact(", "processExistingPublicFormSubmission(", "storage.createDeal(", "storage.createTicket("]
        .map((needle) => {
          const idx = route.indexOf(needle);
          return idx === -1 ? Infinity : idx;
        }),
    );
    assert.ok(parseIdx > -1 && parseIdx < firstMutationIdx, "validation must precede business mutation");
  });
}

// Client/server contract parity: every server-required field for these three
// routes must actually be present in the corresponding client payload, or a
// normal, validly-filled-out submission gets rejected by the new strict Zod
// schema before it ever reaches business logic.
const clientChecks: Array<{ route: string; file: string; requiredServerFields: string[] }> = [
  {
    route: "/api/public/estimate",
    file: "client/src/pages/Estimate.tsx",
    requiredServerFields: ["contactName", "businessName", "email", "phone", "vertical", "monthlyVolume", "totalFees"],
  },
  {
    route: "/api/public/support",
    file: "client/src/pages/Support.tsx",
    requiredServerFields: ["name", "businessName", "email", "mobile", "issueType", "priority", "message"],
  },
  {
    route: "/api/public/get-started",
    file: "client/src/pages/GetStarted.tsx",
    requiredServerFields: ["goal", "vertical", "monthlyVolume", "needTerminal", "interestedIn0Percent", "firstName", "lastName", "email", "phone"],
  },
];

for (const { route, file, requiredServerFields } of clientChecks) {
  check(`${file} sends every server-required field for ${route}`, () => {
    const src = fs.readFileSync(file, "utf-8");
    const postIdx = src.indexOf(`apiRequest("POST", "${route}"`);
    assert.ok(postIdx > -1, `expected an apiRequest("POST", "${route}", ...) call site`);
    // Scan the payload object literal that follows (bounded window is fine —
    // these are flat, single-call payload literals).
    const payloadWindow = src.slice(postIdx, postIdx + 1500);
    for (const field of requiredServerFields) {
      assert.ok(
        new RegExp(`\\b${field}\\b\\s*:`).test(payloadWindow) || new RegExp(`\\b${field}\\b,`).test(payloadWindow),
        `payload for ${route} in ${file} is missing required server field "${field}"`,
      );
    }
  });

  check(`${file} rotates its idempotency key after a 400 so a corrected resubmission isn't blocked`, () => {
    const src = fs.readFileSync(file, "utf-8");
    assert.match(
      src,
      /if \(\/\^400:\/\.test\(error\?\.message/,
      `expected a 400-specific idempotency-key rotation guard in ${file}`,
    );
    assert.match(src, /idempotencyKeyRef\.current = null/);
  });
}

console.log(`\nINB-03 public route validation checks: ${passed} passed.`);
if (process.exitCode) process.exit(1);
