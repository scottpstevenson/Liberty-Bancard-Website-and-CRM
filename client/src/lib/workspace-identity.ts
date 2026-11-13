/**
 * One name for "where am I" in the employee workspace (Phase 6 R09).
 *
 * The eleven sidebar entries own the area names. This module maps a route (path, plus the query keys that select a tab or a
 * record) to: the selected area, the page's own heading, the selected tab and, for record routes, the kind of record. The
 * shell header, the breadcrumb and the Contact Back control all read it, so they cannot disagree.
 *
 * Pure data and string functions: it reads no state, grants no access (route wrappers and server authorization are
 * unchanged, and an area a role does not have is never named for it), and invents no names. A path or tab that is not
 * registered contributes nothing to the trail rather than a guessed label. Page headings and tab labels below are the text
 * those pages already render; scripts/test-phase6-workspace-identity.ts compares them with the page sources so they cannot
 * drift apart.
 */
import { activeSidebarId, employeeSidebarFor, type SidebarRole } from "./employee-sidebar";

export interface WorkspaceCrumb { label: string; href: string | null }
export interface WorkspaceIdentity {
  areaId: string;
  /** The sidebar entry's label: the selected area. */
  areaLabel: string;
  /** The heading the page itself renders (equal to the area label when the page only hosts tabs). */
  pageTitle: string;
  tabLabel: string | null;
  /** What kind of single record is open, when the route opens one. */
  recordLabel: string | null;
  /** Area, page, tab, record: consecutive duplicates removed, last item is the current page and has no link. */
  crumbs: WorkspaceCrumb[];
}

interface PageRule {
  /** Page heading text as rendered; omitted for pages that only host tabs. */
  page?: string;
  tabParam?: string;
  tabs?: Readonly<Record<string, string>>;
}

/** Heading text of each landing page and the labels of its tabs, per path. Keys are exact paths. */
export const PAGE_RULES: Readonly<Record<string, PageRule>> = {
  "/dashboard": { page: "Today" },
  "/dashboard/my-day": { page: "My Day" },
  "/dashboard/nba": { page: "Next best action" },
  "/dashboard/contacts": { page: "People" },
  "/dashboard/contacts-leads": { tabParam: "tab", tabs: { people: "People", leads: "Leads" } },
  "/dashboard/pipeline": { page: "Sales Pipeline" },
  "/dashboard/comms-hub": { page: "Inbox" },
  "/dashboard/tasks-appointments": { page: "Work", tabParam: "tab", tabs: { tasks: "Tasks", calendar: "Appointments" } },
  "/dashboard/portfolio": { page: "My Portfolio" },
  "/dashboard/lead-ops": {
    page: "Lead Operations Center", tabParam: "tab",
    tabs: {
      businesses: "Businesses", prospects: "Source Prospects", imports: "Imports", staging: "Staging & Promotion", sources: "Sources",
      census: "Census", intelligence: "Intelligence", quality: "Data Quality", pipeline: "Inbound Operations", sfp: "South Florida Prospecting",
      "provider-results": "Provider Results", pilot: "Pilot history (read-only)", health: "Enrichment Program Health", canonical: "Canonical Enrichment",
    },
  },
  "/dashboard/outreach-queue": { page: "Ready for Outreach" },
  "/dashboard/outbound-center": {
    page: "Campaigns", tabParam: "tab",
    tabs: { command: "Command", campaigns: "Campaigns", sequences: "Sequences", governance: "Governance", prospects: "Re-engagement", analytics: "Analytics" },
  },
  "/dashboard/reporting": {
    page: "Reports", tabParam: "tab",
    tabs: { overview: "Overview", growth: "Growth Metrics", "win-loss": "Win/Loss", "outreach-analytics": "Outreach", operations: "Operations", financial: "Financial" },
  },
  "/dashboard/my-earnings": { page: "My Earnings" },
  "/dashboard/admin-hub": {
    page: "Administration", tabParam: "tab",
    tabs: {
      users: "User Management", permissions: "Permissions", "audit-log": "Audit Log", consent: "Consent Audit", pci: "PCI Assessment",
      agents: "Agent Management", integrations: "Integrations", ghl: "GHL Integration", "info-flow": "Information Flow",
      "gate-result": "Deploy Gate", automations: "Automations",
    },
  },
  "/dashboard/knowledge-base": { page: "Knowledge Base" },
};

const idSegment = "[A-Za-z0-9_-]{1,64}";
const RECORD_ROUTES: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: new RegExp(`^/dashboard/contacts/${idSegment}$`), label: "Contact" },
  { pattern: new RegExp(`^/dashboard/companies/${idSegment}$`), label: "Company" },
];

/** A single-record page that carries its own heading and Back control (a contact or company). */
export function isRecordPath(path: string): boolean {
  return RECORD_ROUTES.some(route => route.pattern.test(path));
}

const slug = /^[a-z0-9-]{1,40}$/;
const positiveId = /^[1-9][0-9]{0,9}$/;
const requestRef = /^[A-Fa-f0-9]{8}$/;

function splitLocation(location: string): { path: string; params: URLSearchParams } {
  const withoutHash = location.split("#")[0];
  const at = withoutHash.indexOf("?");
  const path = at === -1 ? withoutHash : withoutHash.slice(0, at);
  return { path: path.length > 1 ? path.replace(/\/+$/, "") : path, params: new URLSearchParams(at === -1 ? "" : withoutHash.slice(at + 1)) };
}

/** A query key must appear exactly once to select anything; repeated or conflicting keys select nothing. */
function single(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] : null;
}

/**
 * Identity of the route for an employee role, or null when the role has no employee shell or the route belongs to no
 * sidebar area (the caller keeps its existing label for those routes).
 */
export function resolveWorkspaceIdentity(role: string, location: string): WorkspaceIdentity | null {
  if (role !== "admin" && role !== "manager" && role !== "agent") return null;
  const { path, params } = splitLocation(location);
  const areaId = activeSidebarId(role, path);
  if (!areaId) return null;
  const item = employeeSidebarFor(role).find(candidate => candidate.entry.id === areaId);
  if (!item) return null;
  const areaLabel = item.entry.label;

  const record = RECORD_ROUTES.find(route => route.pattern.test(path)) ?? null;
  const rule = PAGE_RULES[path];
  const pageTitle = rule?.page ?? areaLabel;
  let tabLabel: string | null = null;
  let tabHref: string | null = null;
  if (rule?.tabParam && rule.tabs) {
    const selected = single(params, rule.tabParam);
    if (selected && slug.test(selected) && Object.prototype.hasOwnProperty.call(rule.tabs, selected)) {
      tabLabel = rule.tabs[selected];
      tabHref = `${path}?${rule.tabParam}=${selected}`;
    }
  }
  let recordLabel: string | null = record?.label ?? null;
  if (!recordLabel && path === "/dashboard/pipeline") {
    const deal = single(params, "id") ?? single(params, "dealId");
    if (deal && positiveId.test(deal)) recordLabel = "Deal";
  }
  if (!recordLabel && path === "/dashboard/tasks-appointments") {
    const task = single(params, "taskId");
    if (task && positiveId.test(task)) recordLabel = "Task";
  }
  if (!recordLabel && path === "/dashboard/lead-ops" && single(params, "tab") === "pipeline") {
    const ref = single(params, "ref");
    if (ref && requestRef.test(ref)) recordLabel = "Request";
  }

  const trail: Array<{ label: string; href: string | null }> = [{ label: areaLabel, href: item.href }];
  const pageHref = rule?.page || rule?.tabs ? path : null;
  trail.push({ label: pageTitle, href: pageHref });
  if (tabLabel) trail.push({ label: tabLabel, href: tabHref });
  if (recordLabel) trail.push({ label: recordLabel, href: null });
  const crumbs: WorkspaceCrumb[] = [];
  for (const crumb of trail) {
    if (crumbs.length && crumbs[crumbs.length - 1].label === crumb.label) continue;
    crumbs.push(crumb);
  }
  const last = crumbs[crumbs.length - 1];
  last.href = null;
  return { areaId, areaLabel, pageTitle, tabLabel, recordLabel, crumbs };
}

export type { SidebarRole };
