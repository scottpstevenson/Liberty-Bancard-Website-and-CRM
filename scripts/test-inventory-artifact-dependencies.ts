#!/usr/bin/env tsx
import { artifactSpecifiers } from "./inventory-artifact-dependencies";

const result = artifactSpecifiers(`const a = require("express"); const b = require("@scope/pkg/subpath"); import x from "pg";`);
const expected = ["@scope/pkg", "express", "pg"];
if (JSON.stringify(result) !== JSON.stringify(expected)) {
  throw new Error(`expected package-only deterministic inventory, got ${JSON.stringify(result)}`);
}
if (artifactSpecifiers(`require("./local"); require("node:fs")`).length !== 0) {
  throw new Error("relative and Node built-in imports must not be reported as external packages");
}
console.log("test-inventory-artifact-dependencies: PASS — artifact dependency extraction fixtures verified");