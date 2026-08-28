#!/usr/bin/env tsx
import { logOperationalDiagnostic, serverError } from "../server/utils/server-error";

let failed = 0;
function assert(label: string, condition: boolean) {
  if (condition) console.log(`  ✓ ${label}`);
  else { failed++; console.error(`  ✗ ${label}`); }
}

const calls: unknown[][] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => { calls.push(args); };

try {
  const secret = "UNRECOGNIZED_PROVIDER_BODY recipient@example.com SELECT * FROM users";
  const response: Record<string, unknown> = {
    req: { method: "POST", route: { path: "/api/auth/:id" } },
    setHeader() { return this; },
    status() { return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  serverError(response as any, new Error(secret), `/unsafe/${secret}`);
  logOperationalDiagnostic("auth_email_delivery", new Error(secret), "transport_unavailable", { userId: "abc_123" });

  const serialized = JSON.stringify(calls);
  const serverLog = calls[0][1] as Record<string, unknown>;
  const operationalLog = calls[1][1] as Record<string, unknown>;
  assert("unrecognized error message is never logged", !serialized.includes(secret) && !serialized.includes("recipient@example.com"));
  assert("server error has correlation ID", typeof serverLog.correlationId === "string" && String(serverLog.correlationId).length > 0);
  assert("server error uses coarse class and fixed reason", serverLog.errorClass === "Error" && serverLog.reasonCode === "internal_error");
  assert("server error includes safe route metadata", serverLog.route === "/api/auth/:id" && serverLog.method === "POST" && serverLog.status === 500);
  assert("operational error preserves coarse class and allowlisted reason", operationalLog.errorClass === "Error" && operationalLog.reasonCode === "transport_unavailable");
  assert("unexpected response is generic", (response.body as any).message === "Internal server error");
} finally {
  console.error = originalError;
}

if (failed) process.exit(1);
console.log("Server error diagnostic assertions passed.");