import { readFileSync } from "node:fs";
import { verifyCro03cApprovalArtifact } from "../server/services/cro03/approval-artifact";

const signed = JSON.parse(readFileSync("/tmp/signed-approvals-v3.json", "utf8"));
console.log("CRO03C_TRUSTED_APPROVAL_ISSUERS set:", !!process.env.CRO03C_TRUSTED_APPROVAL_ISSUERS);
try {
  console.log(JSON.parse(process.env.CRO03C_TRUSTED_APPROVAL_ISSUERS || "{}"));
} catch (e) { console.log("parse fail", e); }

for (const dim of ["operator", "data", "finance", "legal"]) {
  try {
    const payload = verifyCro03cApprovalArtifact(signed[dim]);
    console.log(dim, "OK", payload.receiptId);
  } catch (e: any) {
    console.log(dim, "FAILED:", e.message);
  }
}
