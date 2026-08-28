#!/usr/bin/env tsx
import { inspectLock } from "./dependency-policy-evidence";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const packageJson = { dependencies: { example: "1.0.0" } };
const validLock = {
  lockfileVersion: 3,
  packages: {
    "": { dependencies: { example: "1.0.0" } },
    "node_modules/example": {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/example/-/example-1.0.0.tgz",
      integrity: "sha512-example",
    },
  },
};

assert(inspectLock(packageJson, validLock).length === 0, "valid HTTPS fixture should pass");
assert(
  inspectLock(packageJson, { ...validLock, lockfileVersion: 2 }).some(f => f.code === "LOCKFILE_VERSION"),
  "old lockfile fixture must fail",
);
assert(
  inspectLock(packageJson, {
    ...validLock,
    packages: { ...validLock.packages, "node_modules/example": { version: "1.0.0" } },
  }).some(f => f.code === "PACKAGE_PROVENANCE_MISSING"),
  "missing provenance fixture must fail",
);
assert(
  inspectLock(packageJson, {
    ...validLock,
    packages: { ...validLock.packages, "node_modules/example": { ...validLock.packages["node_modules/example"], resolved: "http://mirror.invalid/example.tgz" } },
  }, true).some(f => f.code === "NON_HTTPS_TARBALL" && f.severity === "error"),
  "strict source fixture must reject HTTP",
);
assert(
  inspectLock(packageJson, {
    ...validLock,
    packages: {
      ...validLock.packages,
      "node_modules/example/node_modules/bundled": {
        version: "1.0.0",
        inBundle: true,
      },
    },
  }).length === 0,
  "inBundle records inherit their parent tarball provenance",
);
console.log("test-dependency-policy-evidence: PASS — valid and negative fixtures verified");