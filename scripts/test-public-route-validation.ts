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
//
// Support still posts directly with apiRequest (kind "direct"). Estimate and
// GetStarted submit through the shared intake hook (kind "intake"): the page
// builds the payload and calls usePublicIntake(form, route).submit(payload),
// and the hook + lib/public-intake own the POST and the idempotency key.
type ClientCheck =
  | { kind: "direct"; route: string; file: string; requiredServerFields: string[] }
  | { kind: "intake"; route: string; file: string; form: string; requiredServerFields: string[] };

const clientChecks: ClientCheck[] = [
  {
    kind: "intake",
    route: "/api/public/estimate",
    file: "client/src/pages/Estimate.tsx",
    form: "estimate",
    requiredServerFields: ["contactName", "businessName", "email", "phone", "vertical", "monthlyVolume", "totalFees"],
  },
  {
    kind: "direct",
    route: "/api/public/support",
    file: "client/src/pages/Support.tsx",
    requiredServerFields: ["name", "businessName", "email", "mobile", "issueType", "priority", "message"],
  },
  {
    kind: "intake",
    route: "/api/public/get-started",
    file: "client/src/pages/GetStarted.tsx",
    form: "get_started",
    requiredServerFields: ["goal", "vertical", "monthlyVolume", "needTerminal", "interestedIn0Percent", "firstName", "lastName", "email", "phone"],
  },
];

const INTAKE_HOOK_FILE = "client/src/hooks/use-public-intake.ts";
const INTAKE_LIB_FILE = "client/src/lib/public-intake.ts";

function assertFieldsPresent(payloadSrc: string, requiredServerFields: string[], route: string, where: string) {
  for (const field of requiredServerFields) {
    assert.ok(
      new RegExp(`^\\s*${field}\\s*[:,]`, "m").test(payloadSrc),
      `payload for ${route} in ${where} is missing required server field "${field}"`,
    );
  }
}

/** The text of one top-level function/const, from its declaration to the first closing brace at the same indent. */
function sliceBlock(src: string, startNeedle: string, endPattern: RegExp, label: string): string {
  const startIdx = src.indexOf(startNeedle);
  assert.ok(startIdx > -1, `expected ${label} (${startNeedle})`);
  const rest = src.slice(startIdx);
  const endMatch = endPattern.exec(rest);
  assert.ok(endMatch, `could not find the end of ${label}`);
  return rest.slice(0, endMatch.index + endMatch[0].length);
}

/**
 * Shared-hook half of the contract, asserted for each intake page: the hook forwards the caller's payload untouched
 * to submitPublicIntake, which POSTs it to the page's route with an Idempotency-Key header.
 */
function assertIntakeTransport() {
  const hookSrc = fs.readFileSync(INTAKE_HOOK_FILE, "utf-8");
  const libSrc = fs.readFileSync(INTAKE_LIB_FILE, "utf-8");
  assert.match(
    hookSrc,
    /submitPublicIntake\(form, path, payload\)/,
    `${INTAKE_HOOK_FILE} must forward the caller's payload unchanged to submitPublicIntake(form, path, payload)`,
  );
  const submitFn = sliceBlock(libSrc, "export async function submitPublicIntake", /\n\}\n/, "submitPublicIntake");
  assert.match(
    submitFn,
    /apiRequest\("POST", path, payload, \{ "Idempotency-Key": intent\.key \}\)/,
    `${INTAKE_LIB_FILE} must POST the unmodified payload to the page route with its Idempotency-Key`,
  );
}

/**
 * Shared-hook half of the rotation guarantee: a 400 discards the stored intent, and the next submit mints a fresh key
 * (an existing intent is reused only for an identical payload fingerprint).
 */
function assertIntakeKeyRotation() {
  const libSrc = fs.readFileSync(INTAKE_LIB_FILE, "utf-8");
  const submitFn = sliceBlock(libSrc, "export async function submitPublicIntake", /\n\}\n/, "submitPublicIntake");
  assert.match(
    submitFn,
    /\/\^\(\\d\{3\}\):\/\.exec\(message\)/,
    `expected ${INTAKE_LIB_FILE} to read the HTTP status from the apiRequest error message`,
  );
  assert.match(
    submitFn,
    /if \([^)]*"400"[^)]*\) \{[^}]*\bclearIntent\(form\)/,
    `expected a 400-specific idempotency-key rotation guard (clearIntent on 400) in ${INTAKE_LIB_FILE}`,
  );
  const intentFn = sliceBlock(libSrc, "async function intentFor", /\n\}\n/, "intentFor");
  assert.match(intentFn, /existing\.fingerprint === fingerprint/, "an existing key may only be reused for an identical payload");
  assert.match(intentFn, /key: crypto\.randomUUID\(\)/, "a cleared or changed intent must mint a fresh idempotency key");
}

for (const clientCheck of clientChecks) {
  const { route, file, requiredServerFields } = clientCheck;

  if (clientCheck.kind === "direct") {
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
    continue;
  }

  const { form } = clientCheck;
  check(`${file} sends every server-required field for ${route} through the shared intake hook`, () => {
    const src = fs.readFileSync(file, "utf-8");
    assert.ok(
      src.includes(`usePublicIntake("${form}", "${route}")`),
      `expected ${file} to submit through usePublicIntake("${form}", "${route}")`,
    );
    assert.match(
      src,
      /intake\.submit\(buildPayload\(/,
      `expected ${file} to submit the payload from buildPayload() via intake.submit(...)`,
    );
    const payloadSrc = sliceBlock(src, "const buildPayload = ", /\n {2}\}\)?;/, `buildPayload in ${file}`);
    assertFieldsPresent(payloadSrc, requiredServerFields, route, `${file} buildPayload()`);
    assertIntakeTransport();
  });

  check(`${file} rotates its idempotency key after a 400 (shared intake hook) so a corrected resubmission isn't blocked`, () => {
    const src = fs.readFileSync(file, "utf-8");
    assert.ok(
      src.includes(`usePublicIntake("${form}", "${route}")`),
      `expected ${file} to submit through usePublicIntake("${form}", "${route}")`,
    );
    assertIntakeKeyRotation();
  });
}

console.log(`\nINB-03 public route validation checks: ${passed} passed.`);
if (process.exitCode) process.exit(1);
