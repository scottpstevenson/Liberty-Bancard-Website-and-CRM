/** Pure checks for the 4C1 workspace: URL codec, cadence arithmetic, purpose grouping, package draft validation. No DB, network or provider. */
import assert from "node:assert/strict";
import { contentWorkspaceState, contentWorkspaceUrl } from "../client/src/lib/crm-destination-state";
import { classify } from "../server/services/content-workspace";
import { cumulativeDays, validatePackageTouches } from "../server/services/cro03/sfp-package-content-publish";
import { cumulative, relativeFromDays } from "../client/src/components/dashboard/PackageContentEditor";

let n = 0; const ok = (v: unknown, m: string) => { assert(v, m); n++; };

// URL codec
ok(contentWorkspaceState("").group === "current_sfp" && contentWorkspaceState("").requested === false, "default group, not requested");
ok(contentWorkspaceState("?content=history").group === "history", "valid group");
const bad = contentWorkspaceState("?content=nope");
ok(bad.group === "current_sfp" && bad.issues.length === 1, "invalid group falls back and reports");
ok(contentWorkspaceState("?content=history&content=diagnostics").issues[0].kind === "conflict", "duplicate group is a conflict");
ok(contentWorkspaceState("?package=sfp.automotive.v2").package === "sfp.automotive.v2", "valid package");
ok(contentWorkspaceState("?package=../../etc").package === "" && contentWorkspaceState("?package=../../etc").issues.length === 1, "invalid package never reaches the editor");
ok(contentWorkspaceUrl("/dashboard/outbound-center", "?tab=campaigns&x=1", "#top", { content: "history", package: null }) === "/dashboard/outbound-center?tab=campaigns&x=1&content=history#top", "URL keeps unrelated params and hash, drops null selectors");
ok(!contentWorkspaceUrl("/p", "?content=history&package=sfp.automotive.v2", "", { package: null }).includes("package"), "closing the editor removes only the package");

// Cadence
ok(JSON.stringify(cumulativeDays([0, 3, 4, 5, 6])) === "[0,3,7,12,18]" && JSON.stringify(cumulative([0, 3, 4, 5, 6])) === "[0,3,7,12,18]", "client and server agree on cumulative days");
ok(JSON.stringify(relativeFromDays([0, 3, 7, 12, 18])) === "[0,3,4,5,6]", "premium cumulative days become relative delays");

// Grouping by reviewed purpose
const p = { current: false, nonCurrent: false };
const acct = classify({ assetType: "sequence", name: "V-04: Account Management Ops" }, p);
ok(acct.group === "merchant_lifecycle" && acct.reason.startsWith("reviewed purpose"), "V-* Account Management sequences are merchant lifecycle by reviewed purpose");
ok(classify({ assetType: "sequence", name: "Quarterly QBR follow-up" }, p).group === "merchant_lifecycle", "QBR content is lifecycle");
const fb = classify({ assetType: "campaign", name: "Welcome and onboarding drip" }, p);
ok(fb.group === "merchant_lifecycle" && /fallback/.test(fb.reason), "name-rule placement is labelled a fallback");
ok(/review/.test(classify({ assetType: "campaign", name: "Cold outreach A" }, p).reason), "default placement says it awaits review");
ok(classify({ assetType: "sequence", name: "x" }, { current: true, nonCurrent: false }).group === "current_sfp", "package members stay current SFP");

// Draft validation
const t = (subject: string, body: string, delayDays: number) => ({ subject, body, delayDays });
const good = [t("A", "Hi,\n\nWould a free statement review help?", 0), t("B", "Hello,\n\nUpload at [secure_statement_upload]", 3), t("C", "Hello,\n\nLast note.", 5)];
const v = validatePackageTouches(good, { bookingAvailable: false });
ok(v.ok && v.steps[1].body.includes("https://") && !v.steps[1].body.includes("["), "markers resolve to approved links");
ok(!validatePackageTouches(good.slice(0, 2), { bookingAvailable: false }).ok, "two touches refused");
ok(!validatePackageTouches([...good.slice(0, 2), t("C", "Book at [sales_booking]", 5)], { bookingAvailable: false }).ok, "booking marker refused when no booking link is configured");
ok(!validatePackageTouches([good[0], good[1], t("C", "x", 0)], { bookingAvailable: false }).ok, "zero follow-up delay refused");
ok(!validatePackageTouches([good[0], good[1], t("C", "Call https://example.com", 5)], { bookingAvailable: false }).ok, "foreign link refused");
console.log(`STAGE4C1_WORKSPACE_NAVIGATION_PASS (${n} checks)`);
