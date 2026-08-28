import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AUTH_ACTION_PURPOSES } from "../../shared/models/auth";

// Deterministic source contract; DB concurrency coverage is intentionally
// separate because it may only run against TEST_DATABASE_URL.
const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
assert.deepEqual(AUTH_ACTION_PURPOSES, [
  "user_password_reset", "user_email_verification", "merchant_activation",
  "partner_password_reset", "partner_invite", "partner_org_activation", "partner_org_password_reset",
]);
const authority = read("server/services/auth-actions.ts");
assert.match(authority, /randomBytes\(32\)/);
assert.match(authority, /pg_advisory_xact_lock/);
assert.match(authority, /isNull\(authActions\.consumedAt\)/);
assert.match(authority, /await input\.mutate\(subject, tx\)/);
assert.match(authority, /value === false \|\| value === null \|\| value === undefined/);
assert.match(authority, /revokedAt: disposition === "definite_failure"/);
const partner = read("server/routes/partners.ts");
assert.match(partner, /consumePartnerPassword/);
assert.match(partner, /userSessions/);
assert.match(partner, /createPartnerWithCredential/);
assert.match(partner, /registerPartnerLoginSession/);
assert.match(partner, /failPartnerLoginClosed/);
assert.match(partner, /req\.logout[\s\S]*req\.session\.destroy[\s\S]*clearCookie\("connect\.sid"\)/);
assert.doesNotMatch(partner, /console\.(?:error|warn)\([^)]*(?:provider|sync).*err/i);
assert.match(partner, /issuedActionId.*ambiguous/s);
assert.doesNotMatch(partner, /Password reset URL/);
const partnerOrg = read("server/routes/partner-orgs.ts");
assert.match(partnerOrg, /sessionVersion/);
assert.match(partnerOrg, /partner_org_activation/);
assert.doesNotMatch(partnerOrg, /Math\.random\(\)/);
const fragment = read("client/src/lib/auth-action-fragment.ts");
assert.match(fragment, /history\.replaceState/);
assert.match(fragment, /window\.location\.hash/);
assert.match(fragment, /\["token", "reset", "invite", "code"\]/);
assert.match(read("server/routes/merchant-portal-invite.ts"), /app\.post\("\/api\/auth\/portal-invite\/validate"/);
assert.match(read("server/routes/merchant-portal-invite.ts"), /Referrer-Policy/);
assert.match(read("server/services/merchant-portal-invite.ts"), /issuedActionId[\s\S]*setAuthActionDelivery\(issuedActionId, "ambiguous"\)/);
assert.match(read("server/routes/partner-orgs.ts"), /app\.post\("\/api\/partner-org\/auth-action\/consume"/);
assert.match(read("server/routes/partner-orgs.ts"), /partnerOrgSessionVersion/);
assert.match(read("client/src/pages/PartnerLogin.tsx"), /useState\(\(\) =>/);
assert.match(read("client/src/pages/PartnerPortal.tsx"), /initialReset/);
console.log("auth-action source contract passed");