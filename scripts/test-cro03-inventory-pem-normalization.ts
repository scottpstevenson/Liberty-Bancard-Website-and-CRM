#!/usr/bin/env npx tsx
/**
 * Focused, non-secret unit test for the private PEM normalizer.
 * Extracts the private helper so this test does not initialize the database
 * or load any runtime credentials.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";

const sourcePath = resolve("server/services/cro03-inventory-convergence.ts");
const source = readFileSync(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
const helper = sourceFile.statements.find(
  (statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "normalisePem",
);

if (!helper) throw new Error("normalisePem helper was not found");

const compiledHelper = ts.transpile(helper.getText(sourceFile), {
  target: ts.ScriptTarget.ES2022,
});
const normalisePem = new Function(`${compiledHelper}; return normalisePem;`)() as (
  raw: string,
) => string;

function assertEqual(actual: string, expected: string, scenario: string): void {
  if (actual !== expected) {
    throw new Error(`${scenario} normalization differed from expected output`);
  }
}

const delimiter = "-".repeat(5);
const payload = "non-secret-sample-payload";

for (const label of ["", "RSA ", "EC "]) {
  const begin = `${delimiter}BEGIN ${label}PRIVATE KEY${delimiter}`;
  const end = `${delimiter}END ${label}PRIVATE KEY${delimiter}`;
  const expected = `${begin}\n${payload}\n${end}\n`;

  assertEqual(
    normalisePem(`${begin} ${payload} ${end}`),
    expected,
    `${label || "generic"} collapsed-space`,
  );
  assertEqual(
    normalisePem(`${begin}\\n${payload}\\n${end}`),
    expected,
    `${label || "generic"} escaped-newline`,
  );
  assertEqual(
    normalisePem(expected.slice(0, -1)),
    expected,
    `${label || "generic"} multiline`,
  );
}

if (source.includes(`${delimiter}BEGIN PRIVATE KEY${delimiter}`)) {
  throw new Error("The production source contains a contiguous private-key BEGIN marker");
}

console.log("test-cro03-inventory-pem-normalization: PASS");