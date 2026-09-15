#!/usr/bin/env npx tsx
/**
 * Request-shape guard for the Sunbiz bootstrap admin control in
 * LeadOpsCenter.tsx. A prior review round caught the run mutation body
 * missing `previewToken` even though the server route required it — every
 * click on "Run bounded batch" would 400. This is a static source check
 * (no component-render test framework in this project) asserting the wiring
 * stays correct: the mutation must read and send the preview query's
 * previewToken, and the run button must stay disabled until one exists.
 */
import { readFileSync } from "fs";

let passed = 0;
function check(cond: unknown, label: string) {
  if (!cond) throw new Error(`FAIL: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

function main() {
  const src = readFileSync("client/src/pages/dashboard/LeadOpsCenter.tsx", "utf8");

  const mutationBlockMatch = src.match(/const bootstrapRunMutation = useMutation\(\{[\s\S]*?\n  \}\);/);
  check(mutationBlockMatch, "bootstrapRunMutation block found in LeadOpsCenter.tsx");
  const mutationBlock = mutationBlockMatch![0];

  check(/previewToken\s*=\s*bootstrapPreviewQuery\.data\?\.previewToken/.test(mutationBlock),
    "mutationFn reads previewToken from the preview query's response");
  check(/previewToken,?\s*\n\s*\}\);/.test(mutationBlock) || /body[\s\S]*previewToken/.test(mutationBlock) ||
    /\/api\/lead-ops\/sunbiz-bootstrap\/run"[\s\S]*previewToken/.test(mutationBlock),
    "mutationFn's POST body includes previewToken");
  check(/if \(!previewToken\)/.test(mutationBlock),
    "mutationFn refuses to submit without a previewToken (throws instead of sending a doomed request)");

  const buttonMatch = src.match(/<Button size="sm" variant="outline"\s*\n\s*disabled=\{[^}]*\}\s*\n\s*onClick=\{\(\) => bootstrapRunMutation\.mutate\(\)\}>/);
  check(buttonMatch, "Run bounded batch button found");
  check(/bootstrapPreviewQuery\.data\?\.previewToken/.test(buttonMatch![0]),
    "Run bounded batch button's disabled condition requires bootstrapPreviewQuery.data.previewToken");

  // A confirmation typo must not burn the still-valid previewToken. The
  // server only deletes it after limit+confirmation both validate, so the
  // UI's onError must NOT refetch/invalidate preview for a
  // typed_confirmation_required rejection — only for error codes that mean
  // the token itself is actually dead.
  const onErrorMatch = mutationBlock.match(/onError:\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\n    \},/);
  check(onErrorMatch, "bootstrapRunMutation.onError handler found");
  check(/err(?:\?\.|\.)\s*code\s*!==\s*["']typed_confirmation_required["']/.test(onErrorMatch![0]),
    "onError only invalidates preview when the error code is not typed_confirmation_required (typo does not burn the token)");
  check(/parseApiRequestError\(/.test(mutationBlock),
    "mutationFn recovers the server's structured error code via parseApiRequestError (apiRequest never returns a Response on failure)");
  check(/err\.code\s*=\s*code/.test(mutationBlock),
    "mutationFn attaches the recovered code to the thrown Error for onError to branch on");

  console.log(`\n[test-sunbiz-bootstrap-ui-shape] ${passed} passed`);
}

main();
