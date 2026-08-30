import assert from "node:assert/strict";
import fs from "node:fs";

const sourceStaging = fs.readFileSync("server/services/cro03/source-staging.ts", "utf8");
const contactWriter = fs.readFileSync("server/services/contact-writer.ts", "utf8");
assert.match(sourceStaging, /assertCro03bLegacySourceWriteAllowed/);
assert.match(contactWriter, /assertCro03bLegacySourceWriteAllowed/);
assert.match(contactWriter, /assertCro03bLegacyContactWriteAllowed/);

const governedFiles = [
  "server/routes/prospects.ts",
  "server/routes/imports.ts",
  "server/services/enrichment.ts",
  "server/services/sunbiz-cron.ts",
  "server/services/daily-outreach.ts",
  "server/services/prospect-conversion.ts",
  "server/services/cro03/enrichment-factory.ts",
];
for (const file of governedFiles) {
  const source = fs.readFileSync(file, "utf8");
  const usesAuthority =
    /createCro03SourceBatch|updateContactLocalFirst|writeContact|assertCro03bLegacy/.test(source);
  assert.ok(usesAuthority, `${file} must use a CRO-03B-fenced canonical boundary`);
  assert.doesNotMatch(source, /db\.(?:insert|update)\(\s*contacts\s*\)/,
    `${file} must not write contacts directly`);
  assert.doesNotMatch(source, /(?:INSERT\s+INTO|UPDATE)\s+contacts\b/i,
    `${file} must not issue raw canonical contact SQL`);
}
console.log(`PASS CRO-03B legacy writer inventory (${governedFiles.length} governed paths)`);