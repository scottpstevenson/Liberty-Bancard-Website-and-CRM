/**
 * Regression test: CRO-03A zero-handoff run completion must not trigger admission.
 *
 * Proves:
 *   1. A completed qualification run with selectedCount=0 does NOT invoke the
 *      downstream admission endpoint (POST /api/cro03b/commands with empty handoffIds).
 *   2. The server-side route returns CRO03B_ZERO_HANDOFFS (not the opaque
 *      CRO03_REQUEST_FAILED fallback) for an empty-handoffs admission request.
 *   3. The panel's useEffect guard (selectedCount === 0 → return before any
 *      downstream call) is present in source.
 */

import { readFileSync } from "fs";
import { resolve } from "path";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

console.log("\n── Area 1: server-side zero-handoff route guard ──");

const cro03RouteFile = readFileSync(resolve("server/routes/cro03.ts"), "utf8");

assert(
  /handoffIds\.length\s*===\s*0/.test(cro03RouteFile),
  "POST /api/cro03b/commands guards against handoffIds.length === 0",
);
assert(
  /CRO03B_ZERO_HANDOFFS/.test(cro03RouteFile),
  "Zero-handoff guard returns CRO03B_ZERO_HANDOFFS code (not opaque CRO03_REQUEST_FAILED)",
);
// The guard must fire BEFORE the admitCro03bHandoffs call site (await admitCro03bHandoffs).
// We search for the call site (not the import line which uses the name too).
const zeroGuardIdx = cro03RouteFile.indexOf("CRO03B_ZERO_HANDOFFS");
const admitCallIdx = cro03RouteFile.indexOf("await admitCro03bHandoffs");
assert(
  zeroGuardIdx < admitCallIdx,
  "CRO03B_ZERO_HANDOFFS guard appears before 'await admitCro03bHandoffs' call site",
);

console.log("\n── Area 2: client-side zero-handoff completion guard ──");

const panelFile = readFileSync(
  resolve("client/src/components/lead-ops/SouthFloridaQualificationPanel.tsx"),
  "utf8",
);

assert(
  /selectedCount.*===.*0/.test(panelFile) || /Number.*selectedCount.*===.*0/.test(panelFile),
  "Panel checks selectedCount === 0 on run completion",
);
assert(
  /return/.test(panelFile),
  "Panel useEffect returns early on zero-handoff completion",
);
// Verify there is no unconditional apiRequest/fetch to cro03b in the panel.
const hasCro03bCall = /apiRequest.*cro03b\/commands|fetch.*cro03b\/commands/.test(panelFile);
assert(
  !hasCro03bCall,
  "Panel does NOT contain an unconditional call to /api/cro03b/commands",
);
assert(
  /No admission command sent/.test(panelFile),
  "Panel shows 'No admission command sent' informational message for zero-handoff result",
);
assert(
  /Qualification complete.*0.*qualified/.test(panelFile) ||
    /0.*qualified/.test(panelFile),
  "Panel displays zero-qualified informational success state",
);

console.log("\n── Area 3: admission service internal guard ──");

const admissionFile = readFileSync(
  resolve("server/services/cro03/admission-service.ts"),
  "utf8",
);

assert(
  /!handoffIds\.length|handoffIds\.length\s*===\s*0/.test(admissionFile),
  "admitCro03bHandoffs service rejects empty handoffIds independently of route guard",
);

console.log("\n── Area 4: no auto-call in qualification run completion ──");

const qualServiceFile = readFileSync(
  resolve("server/services/cro03a/qualification-service.ts"),
  "utf8",
);

// Ensure the qualification batch processor has no import or call to admitCro03bHandoffs.
const qualHasAdmit = /admitCro03bHandoffs/.test(qualServiceFile);
assert(
  !qualHasAdmit,
  "qualification-service.ts does NOT call admitCro03bHandoffs (no server-side auto-admit)",
);
const qualHasCro03bImport = /from.*admission-service/.test(qualServiceFile);
assert(
  !qualHasCro03bImport,
  "qualification-service.ts does NOT import from admission-service",
);

console.log("\n──────────────────────────────────────────────");
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\nZero-handoff qualification regression FAILED.");
  process.exit(1);
} else {
  console.log("\nAll zero-handoff qualification regression tests PASSED.");
}
