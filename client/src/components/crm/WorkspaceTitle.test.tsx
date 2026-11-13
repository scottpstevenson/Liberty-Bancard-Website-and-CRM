/**
 * Phase 6 R09 mounted behaviour: the employee shell title and breadcrumb (jsdom, real component and registry, no network).
 * Proves the visible trail, links that navigate, the single heading, the area-only record pages, unregistered routes keeping the
 * shell's existing label, and a trail that follows route changes (Back/forward and reload re-render from the URL alone).
 */
import assert from "node:assert/strict";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const jsdomModule = await import(["js", "dom"].join("")) as {
  JSDOM: new (html: string, options: { url: string; pretendToBeVisual: boolean }) => { window: any };
};
const dom = new jsdomModule.JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  url: "http://localhost/dashboard/lead-ops?tab=pipeline&ref=a1b2c3d4", pretendToBeVisual: true,
});
for (const name of ["window", "document", "navigator", "HTMLElement", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver", "Node", "Element", "sessionStorage", "localStorage"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : dom.window[name] });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).React = React;
for (const name of ["location", "history", "addEventListener", "removeEventListener", "dispatchEvent"]) {
  Object.defineProperty(globalThis, name, { configurable: true, value: typeof dom.window[name] === "function" ? dom.window[name].bind(dom.window) : dom.window[name] });
}

const { WorkspaceTitle } = await import("./WorkspaceTitle");
const { PageHeadingOwnerProvider, PageTitle: ClaimingHeading } = await import("@/components/ui/page-header");

const byTest = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const root = createRoot(document.getElementById("root")!);
type Props = { role: string; location: string; search: string; fallback?: string; claim?: boolean };
const show = async ({ role, location, search, fallback = "Dashboard", claim = false }: Props) => {
  await act(async () => {
    root.render(
      <PageHeadingOwnerProvider>
        <header><WorkspaceTitle role={role} location={location} search={search} fallbackLabel={fallback} className="title" /></header>
        {claim && <main><ClaimingHeading data-testid="page-owned-title">Page heading</ClaimingHeading></main>}
      </PageHeadingOwnerProvider>,
    );
  });
};
const crumbText = () => [...document.querySelectorAll('[data-testid="shell-breadcrumb"] li:not([aria-hidden])')].map(li => li.textContent?.trim());
const title = () => byTest("text-page-title");

// 1. A deep admin route: complete trail, links where they lead, the current crumb marked and not a link.
await show({ role: "admin", location: "/dashboard/lead-ops", search: "tab=pipeline&ref=a1b2c3d4" });
assert.deepEqual(crumbText(), ["Prospecting", "Lead Operations Center", "Inbound Operations", "Request"]);
const nav = document.querySelector('nav[aria-label="Breadcrumb"]')!;
assert.ok(nav && nav.querySelector("ol"), "a labelled breadcrumb list");
assert.equal(nav.querySelectorAll("li[aria-hidden='true']").length, 3, "separators are hidden from assistive technology");
const current = byTest("shell-breadcrumb-current")!;
assert.equal(current.textContent, "Request");
assert.equal(current.getAttribute("aria-current"), "page");
assert.equal(current.closest("a"), null, "the current crumb is not a link");
assert.deepEqual([...nav.querySelectorAll("a")].map(a => a.getAttribute("href")),
  ["/dashboard/lead-ops?tab=businesses", "/dashboard/lead-ops", "/dashboard/lead-ops?tab=pipeline"], "earlier crumbs link to their own areas, pages and tabs");
assert.equal(document.querySelectorAll("a[aria-current]").length, 0, "no link claims to be the current page");

// 2. The shell title stays in the page for assistive technology while the trail is shown, as the only heading.
assert.equal(title()?.tagName, "H1", "the shell title is the h1 when no page owns it");
assert.equal(title()?.textContent, "Prospecting", "the shell title names the selected area");
assert.ok(title()!.className.includes("sr-only"), "visually hidden while the trail is visible");
assert.equal(document.querySelectorAll("h1").length, 1);

// 3. A crumb link navigates to the registered destination (Back/forward then re-render from the URL).
await act(async () => { (nav.querySelectorAll("a")[1] as HTMLElement).click(); });
assert.equal(`${dom.window.location.pathname}${dom.window.location.search}`, "/dashboard/lead-ops", "the page crumb navigates");
await show({ role: "admin", location: dom.window.location.pathname, search: dom.window.location.search.replace(/^\?/, "") });
assert.deepEqual(crumbText(), ["Prospecting", "Lead Operations Center"], "no tab selected: no invented tab crumb");
await show({ role: "admin", location: "/dashboard/lead-ops", search: "tab=health" });
assert.deepEqual(crumbText(), ["Prospecting", "Lead Operations Center", "Enrichment Program Health"], "the selected tab is named");
await show({ role: "admin", location: "/dashboard/lead-ops", search: "tab=pipeline&ref=a1b2c3d4" });
assert.deepEqual(crumbText(), ["Prospecting", "Lead Operations Center", "Inbound Operations", "Request"], "navigating back restores the full trail from the URL alone");

// 4. Today has no trail; the title is the visible h1 and names the area.
await show({ role: "admin", location: "/dashboard", search: "" });
assert.equal(byTest("shell-breadcrumb"), null, "no breadcrumb where there is nothing below the area");
assert.equal(title()?.textContent, "Today");
assert.ok(!title()!.className.includes("sr-only"), "the title is visible when it is the whole location");
await show({ role: "agent", location: "/dashboard/my-day", search: "" });
assert.deepEqual(crumbText(), ["Today", "My Day"], "an agent's Today names its page");

// 5. A record page shows the area only (its own heading and Back control name the origin), never "Dashboard".
await show({ role: "admin", location: "/dashboard/contacts/123", search: "section=notes" });
assert.equal(byTest("shell-breadcrumb"), null, "record pages leave the trail to their own header");
assert.equal(title()?.textContent, "Records", "the record's area, not a generic label");
await show({ role: "agent", location: "/dashboard/companies/9", search: "" });
assert.equal(title()?.textContent, "Records");

// 6. Routes in no sidebar area, or in an area this role does not have, keep the label the shell already computed.
await show({ role: "admin", location: "/dashboard/notifications", search: "", fallback: "Notifications" });
assert.equal(title()?.textContent, "Notifications");
assert.equal(byTest("shell-breadcrumb"), null);
await show({ role: "agent", location: "/dashboard/outbound-center", search: "tab=campaigns", fallback: "Campaigns elsewhere" });
assert.equal(title()?.textContent, "Campaigns elsewhere", "an agent is never told it is in the Campaigns area");
assert.equal(byTest("workspace-title")?.getAttribute("data-area"), null);

// 7. Selectors that do not validate add no crumb; a tab named like an inherited property is ignored.
await show({ role: "manager", location: "/dashboard/reporting", search: "tab=constructor" });
assert.deepEqual(byTest("shell-breadcrumb") ? crumbText() : [], [], "an unknown tab shows no trail below Reports");
await show({ role: "manager", location: "/dashboard/reporting", search: "tab=financial" });
assert.deepEqual(crumbText(), ["Reports", "Financial"]);

// 8. When a page owns the heading, the shell title is plain text and there is exactly one h1.
await show({ role: "admin", location: "/dashboard/tasks-appointments", search: "tab=tasks", claim: true });
assert.equal(document.querySelectorAll("h1").length, 1, "exactly one h1 when a page claims it");
assert.equal(byTest("page-owned-title")?.tagName, "H1");
assert.equal(title()?.tagName, "DIV", "the shell title yields to the page heading");
assert.deepEqual(crumbText(), ["Work", "Tasks"]);

await act(async () => root.unmount());
console.log("WORKSPACE_TITLE_UI_PASS");
process.exit(0);
