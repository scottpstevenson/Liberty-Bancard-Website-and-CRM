import assert from "node:assert/strict";
import { decideInboundLifecycle } from "../services/inbound-request-authority";

assert.equal(
  decideInboundLifecycle([{ state: "sent" }, { state: "sent" }]),
  "accepted",
  "all required internal effects accept the request",
);
assert.equal(
  decideInboundLifecycle([{ state: "sent" }, { state: "held" }]),
  "processing",
  "a held required internal effect keeps the request processing",
);
assert.equal(
  decideInboundLifecycle([{ state: "sent" }, { state: "attempting" }], "review_required"),
  "review_required",
  "operator review remains visible while required internal work is incomplete",
);
assert.equal(
  decideInboundLifecycle([{ state: "sent" }], "review_required", "completed"),
  "completed",
  "worker completion advances only after all required internal effects complete",
);
assert.equal(
  decideInboundLifecycle([{ state: "failed" }]),
  "failed",
  "a failed required internal effect is terminally truthful",
);

console.log("Inbound request lifecycle pure tests passed");