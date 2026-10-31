/**
 * Stage 4C1 CTA / link / token contract (pure; no database, network, provider or send).
 *
 * Proves the typed CTA contract, the single sales-booking resolver, final-href validation, the explicit token alias and
 * cost-driver fact, the new publication lint rules, and (as STATIC source evidence, labelled as such) that the sequence
 * worker no longer carries the savings fallback or a hardcoded calendar.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CTA_CONTRACT, CTA_KINDS, FIRST_PARTY_BOOK_URL, RETIRED_FIRST_PARTY_PATHS, findDurationClaims, findUnsafeLinks,
  resolveCta, resolveSalesBooking, trimUrlPunctuation, validateHref,
} from "../server/services/message-cta-contract";
import { costDriverText, previewMessage, renderMessage, unsupportedTokens } from "../server/services/message-token-registry";
import { lintCopy } from "../server/services/message-copy-lint";

let checks = 0;
const check = (v: unknown, message: string) => { assert(v, message); checks++; console.log(`✓ [CTA-${String(checks).padStart(2, "0")}] ${message}`); };

const ID = "AbCdEfGhIjKlMnOpQrSt";
const url = (id: string, seg = "booking") => `https://api.leadconnectorhq.com/widget/${seg}/${id}`;

// ── Sales booking resolver ──────────────────────────────────────────────────
const ok = resolveSalesBooking({ GHL_CALENDAR_BOOKING_URL: url(ID), GHL_DEFAULT_CALENDAR_ID: ID, GHL_DEFAULT_BOOKING_LINK: url(ID, "bookings") });
check(ok.available && ok.widgetUrl === url(ID) && ok.sources.length === 3, "Agreeing sources (including the old plural slug) resolve to the canonical widget URL");
check(ok.available && ok.widgetUrl.endsWith(ID), "The ID's case is preserved exactly");
const slugUrl = "https://api.leadconnectorhq.com/widget/bookings/shortslug1234";
const withSlug = resolveSalesBooking({ GHL_CALENDAR_BOOKING_URL: url(ID), GHL_DEFAULT_CALENDAR_ID: ID, GHL_DEFAULT_BOOKING_LINK: slugUrl });
check(withSlug.available && withSlug.widgetUrl === url(ID) && /cannot be compared/.test(withSlug.note), "A slug address beside ID sources never disagrees with them (different identifier kind) and the ID address is used");
const slugOnly = resolveSalesBooking({ GHL_DEFAULT_BOOKING_LINK: slugUrl });
check(slugOnly.available && slugOnly.widgetUrl === slugUrl, "A slug-only configuration resolves to the slug address");
check((resolveSalesBooking({ GHL_DEFAULT_BOOKING_LINK: "https://api.leadconnectorhq.com/widget/bookings/a b" }) as any).available === false, "A malformed slug address is rejected");
const typo = resolveSalesBooking({ GHL_CALENDAR_BOOKING_URL: url(ID), GHL_DEFAULT_CALENDAR_ID: ID.replace("I", "l") });
check(!typo.available && typo.reason === "sources_disagree", "A one-character (I vs l) disagreement between sources blocks instead of choosing one");
check(!resolveSalesBooking({}).available && (resolveSalesBooking({}) as any).reason === "not_configured", "No configuration is an explicit unavailable state, never a default ID");
check((resolveSalesBooking({ GHL_CALENDAR_BOOKING_URL: "http://api.leadconnectorhq.com/widget/booking/" + ID }) as any).reason === "invalid_configuration", "Non-https booking configuration is rejected");
check((resolveSalesBooking({ GHL_CALENDAR_BOOKING_URL: "https://evil.example/widget/booking/" + ID }) as any).reason === "invalid_configuration", "A non-widget host is rejected");
check((resolveSalesBooking({ GHL_CALENDAR_BOOKING_URL: "https://u:p@api.leadconnectorhq.com/widget/booking/" + ID }) as any).reason === "invalid_configuration", "Credentials in the booking URL are rejected");

// ── CTA contract ────────────────────────────────────────────────────────────
check(CTA_KINDS.length === 9 && CTA_KINDS.every((k) => CTA_CONTRACT[k].kind === k), "All nine CTA kinds are declared with their own spec");
const ctx = { salesBooking: ok };
check(resolveCta("secure_statement_upload", "sfp_cold", ctx).url === "https://libertybancard.com/upload-statement", "Secure statement upload resolves to the exact /upload-statement route");
check(resolveCta("sales_booking", "sfp_cold", ctx).url === FIRST_PARTY_BOOK_URL, "Sales booking is delivered through the first-party /book adapter");
check(!resolveCta("sales_booking", "sfp_cold", { salesBooking: typo }).available && !!resolveCta("sales_booking", "sfp_cold", { salesBooking: typo }).reasonUnavailable, "Sales booking is unavailable, with a reason, when configuration disagrees");
check(!resolveCta("account_booking", "sfp_cold", ctx).available && !resolveCta("account_booking", "merchant_service", ctx).available, "Account booking is never satisfied by the sales calendar (and has no invented target)");
check(!resolveCta("secure_statement_upload", "merchant_service", ctx).available, "A CTA outside its purposes is unavailable rather than reused");
check(!resolveCta("proposal_view", "sales_followup", ctx).available && resolveCta("proposal_view", "sales_followup", { ...ctx, resourceUrls: { proposal_view: "https://libertybancard.com/proposal/abc123" } }).available, "Proposal view needs a real resource link; without one it is unavailable");
check(!resolveCta("proposal_view", "sales_followup", { ...ctx, resourceUrls: { proposal_view: "https://evil.example/p" } }).available, "A resource link on another host is rejected");
check(resolveCta("reply", "sfp_cold", ctx).available && resolveCta("reply", "sfp_cold", ctx).url === null, "Reply is a real reply CTA with no href");
check(!resolveCta("merchant_referral", "merchant_service", ctx).available && !resolveCta("product_information", "sales_followup", ctx).available, "Referral and equipment stay unavailable until a real destination exists");

// ── Final href validation ───────────────────────────────────────────────────
const allowed = ["libertybancard.com"];
check(validateHref("https://libertybancard.com/upload-statement", { allowedHosts: allowed }).ok, "The secure upload URL validates");
check(validateHref("https://libertybancard.com/upload-statement?a=1&amp;b=2", { allowedHosts: allowed }).ok, "HTML-encoded query ampersands are decoded before parsing");
for (const [bad, why] of [
  ["javascript:alert(1)", "javascript scheme"], ["data:text/html,x", "data scheme"], ["//libertybancard.com/x", "protocol-relative"],
  ["http://libertybancard.com/x", "plain http"], ["https://user:pw@libertybancard.com/x", "credentials"], ["https://evil.example/x", "foreign host"],
  ["https://libertybancard.com/{{x}}", "unresolved substitution"], ["", "empty"], ["not a url", "malformed"],
] as const) check(!validateHref(bad, { allowedHosts: allowed }).ok, `Rejected: ${why}`);
for (const path of Object.keys(RETIRED_FIRST_PARTY_PATHS)) check(!validateHref(`https://libertybancard.com${path}`, { allowedHosts: allowed }).ok, `Retired path ${path} is rejected`);
check(validateHref("https://libertybancard.com/merchant-application", { allowedHosts: allowed }).ok && validateHref("https://libertybancard.com/book", { allowedHosts: allowed }).ok, "/merchant-application and the /book adapter are accepted");
check(trimUrlPunctuation("https://libertybancard.com/upload-statement.") === "https://libertybancard.com/upload-statement" && trimUrlPunctuation("https://libertybancard.com/a?x=1)") === "https://libertybancard.com/a?x=1", "Trailing prose punctuation is trimmed without touching path or query");
check(trimUrlPunctuation("https://libertybancard.com/a_(b)") === "https://libertybancard.com/a_(b)", "A balanced parenthesis inside the path is kept");
const found = findUnsafeLinks(`<a href="https://libertybancard.com/apply">Apply</a> and https://libertybancard.com/upload-statement. plus http://x.example/y`, { allowedHosts: allowed });
check(found.length === 2 && found.some((f) => /\/apply/.test(f.link)) && found.some((f) => /x\.example/.test(f.link)), "findUnsafeLinks flags the retired and the foreign link but not the secure upload URL");
check(findDurationClaims("Book a 10-minute call. Takes 10 minutes. Ten min chat. A short call.").length === 3, "Unverified duration claims are detected");

// ── Token contract ──────────────────────────────────────────────────────────
const source = { contact: { firstName: "Alex", companyName: "Sample Business LLC", email: "alex@sample-business.example" }, calendarLink: FIRST_PARTY_BOOK_URL };
check(renderMessage("template", "Book: {{custom_values.booking_link}} / {{calendarLink}}", source, "text").output === `Book: ${FIRST_PARTY_BOOK_URL} / ${FIRST_PARTY_BOOK_URL}`, "custom_values.booking_link is an explicit alias of the sales booking link");
check(unsupportedTokens("template", "{{custom_values.booking_link}}").length === 0, "The alias is a supported template token (no unknown_merge_variable)");
let threw = false; try { renderMessage("template", "{{custom_values.booking_link}}", { contact: source.contact }, "text"); } catch (e: any) { threw = e?.code === "RENDER_UNRESOLVED_TOKEN"; }
check(threw, "Without a validated booking link the alias fails to resolve instead of printing a blank or dead link");
const withDrivers = { ...source, deal: { topCostDrivers: ["Interchange downgrades", "PCI fee", "", "Monthly fee"] } };
check(renderMessage("template", "Drivers: {{deal.topCostDrivers}}", withDrivers, "text").output === "Drivers: Interchange downgrades, PCI fee, Monthly fee", "deal.topCostDrivers renders the real list (empty entries dropped)");
let missing = false; try { renderMessage("template", "{{deal.topCostDrivers}}", { ...source, deal: { topCostDrivers: [] } }, "text"); } catch (e: any) { missing = e?.code === "RENDER_UNRESOLVED_TOKEN"; }
check(missing, "An empty cost-driver list fails closed; it never prints a blank clause");
check(costDriverText(["a", "b", "c", "d", "e", "f"]) === "a, b, c, d, e" && costDriverText(null) === null, "Cost drivers are capped at five and null when empty");
check(previewMessage("template", { body: "{{deal.topCostDrivers}} {{custom_values.booking_link}}" }, "text").unresolved.length === 0, "The preview personas supply both facts through the same renderer");
check(unsupportedTokens("template", "{{estimatedSavings}}").length === 1 && unsupportedTokens("workflow", "{{custom_values.booking_link}}").length === 1, "estimatedSavings stays unsupported; the alias is not widened to workflow wording");

// ── Publication lint ────────────────────────────────────────────────────────
const rules = (t: string) => lintCopy(t, "template").map((f) => f.rule);
check(rules("<p>Book a 10-minute call</p>").includes("unverified_duration"), "Publication lint rejects a 10-minute claim");
check(rules('<a href="https://libertybancard.com/apply">x</a>').includes("retired_link") && !rules('<a href="https://libertybancard.com/merchant-application">x</a>').includes("retired_link"), "Publication lint rejects retired links and accepts the supported one");
check(rules("<p>Choose a time: {{calendarLink}}</p>").length === 0, "Clean booking wording passes lint");

// ── Static source evidence (labelled static; behavior is covered above and in the database suite) ───────────────────
const worker = readFileSync(new URL("../server/services/sequence-worker.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
check(!/significant savings/.test(worker) && !/estimatedResidual\)\s*\*\s*12/.test(worker), "STATIC: the sequence worker has no residual-based or 'significant savings' fallback");
check(!/YFiIy7oIOUXN2qZZPnOr/.test(worker) && !/api\.leadconnectorhq\.com\/widget\/booking\//.test(worker), "STATIC: the sequence worker has no hardcoded calendar ID or widget URL");
check(/custom_values\\\.booking_link/.test(worker), "STATIC: the sequence worker resolves the custom_values.booking_link alias");

console.log(`STAGE4C1_CTA_CONTRACT_PASS (${checks} checks)`);
