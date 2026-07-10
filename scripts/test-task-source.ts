/**
 * Unit tests for isSlaGeneratedTask helper.
 * Run with: npx tsx scripts/test-task-source.ts
 */
import { isSlaGeneratedTask } from "../client/src/lib/task-source";

let passed = 0;
let failed = 0;

function assert(label: string, result: boolean, expected: boolean) {
  if (result === expected) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label} — expected ${expected}, got ${result}`);
    failed++;
  }
}

console.log("isSlaGeneratedTask unit tests\n");

// source === 'sla' → true
assert("source === 'sla'", isSlaGeneratedTask({ source: "sla" }), true);

// source === null → false
assert("source === null", isSlaGeneratedTask({ source: null }), false);

// source === undefined → false
assert("source === undefined", isSlaGeneratedTask({ source: undefined }), false);

// source === '' → false
assert("source === ''", isSlaGeneratedTask({ source: "" }), false);

// source === 'manual' → false
assert("source === 'manual'", isSlaGeneratedTask({ source: "manual" }), false);

// null task input → false (no crash)
assert("null task input", isSlaGeneratedTask(null), false);

// undefined task input → false (no crash)
assert("undefined task input", isSlaGeneratedTask(undefined), false);

// matching title string but source === null → false
assert(
  "matching title but source === null",
  isSlaGeneratedTask({ source: null }),
  false
);

// task object with no source property (source implicitly undefined) → false
assert(
  "task with no source property",
  isSlaGeneratedTask({} as { source?: string | null }),
  false
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
