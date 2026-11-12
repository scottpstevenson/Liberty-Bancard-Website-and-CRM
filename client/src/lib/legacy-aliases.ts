/**
 * Static legacy dashboard aliases. Each retired path maps to its canonical
 * destination plus the fixed selectors that reproduce the old view. The alias
 * keeps the registered selected-record, filter and context parameters and the
 * safe fragment, so a bookmark, notification or shared link such as
 * `/dashboard/tickets?id=42#notes` opens the same record at its new home
 * instead of an unselected default. Unregistered or stale query state is
 * dropped; destinations still authorize every record they open.
 *
 * App.tsx mounts each entry as `<LegacyAlias from="…" />`; the alias matrix
 * test regenerates the expectation from this table and from App.tsx.
 */
import { destinationUrl, safeFragment, safeParams, workspaceContextKeys } from "@/lib/crm-destination-state";

export type StaticLegacyAlias = { readonly from: string; readonly to: string; readonly fixed: Readonly<Record<string, string>> };

const alias = (from: string, to: string, fixed: Record<string, string> = {}): StaticLegacyAlias => ({ from, to, fixed });

export const STATIC_DASHBOARD_ALIASES: readonly StaticLegacyAlias[] = [
  alias("/dashboard/tickets", "/dashboard/support-hub", { tab: "tickets" }),
  alias("/dashboard/tasks", "/dashboard/tasks-appointments", { tab: "tasks" }),
  alias("/dashboard/review-requests", "/dashboard/merchant-success", { tab: "reviews" }),
  alias("/dashboard/ghl-settings", "/dashboard/ghl-integration", { tab: "settings" }),
  alias("/dashboard/ghl-workflows", "/dashboard/ghl-integration", { tab: "workflow-ids" }),
  alias("/dashboard/campaigns", "/dashboard/outbound-center", { tab: "campaigns" }),
  alias("/dashboard/acquisition-hub", "/dashboard/outbound-center", { tab: "analytics" }),
  alias("/dashboard/win-loss", "/dashboard/reporting", { tab: "win-loss" }),
  alias("/dashboard/sequences", "/dashboard/outbound-center", { tab: "sequences" }),
  alias("/dashboard/outreach", "/dashboard/outbound-center", { tab: "command" }),
  alias("/dashboard/outreach-command", "/dashboard/outbound-center", { tab: "command" }),
  alias("/dashboard/blaze", "/dashboard/content-hub", { tab: "blaze" }),
  alias("/dashboard/onboarding-board", "/dashboard/onboarding", { tab: "board" }),
  alias("/dashboard/chargebacks", "/dashboard/merchant-risk", { tab: "chargebacks" }),
  alias("/dashboard/nps", "/dashboard/merchant-success", { tab: "nps" }),
  alias("/dashboard/retention-campaigns", "/dashboard/merchant-success", { tab: "retention" }),
  alias("/dashboard/consent-audit", "/dashboard/admin-hub", { tab: "consent" }),
  alias("/dashboard/calendar", "/dashboard/tasks-appointments", { tab: "calendar" }),
  alias("/dashboard/user-management", "/dashboard/admin-hub", { tab: "users" }),
  alias("/dashboard/permissions", "/dashboard/admin-hub", { tab: "permissions" }),
  alias("/dashboard/pci-assessment", "/dashboard/admin-hub", { tab: "pci" }),
  alias("/dashboard/audit-logs", "/dashboard/admin-hub", { tab: "audit-log" }),
  alias("/dashboard/blog-generator", "/dashboard/content-hub", { tab: "blog" }),
  alias("/dashboard/content", "/dashboard/content-hub", { tab: "content" }),
  alias("/dashboard/social", "/dashboard/content-hub", { tab: "linkedin" }),
  alias("/dashboard/sdr", "/dashboard/sdr-hub", { tab: "sdr" }),
  alias("/dashboard/sms-inbox", "/dashboard/comms-hub", { tab: "messages" }),
  alias("/dashboard/inbox-health", "/dashboard/deliverability-hub", { tab: "inbox-health" }),
  alias("/dashboard/email-health", "/dashboard/deliverability-hub", { tab: "email-health" }),
  alias("/dashboard/seo-health", "/dashboard/system-health", { tab: "seo" }),
  alias("/dashboard/system-readiness", "/dashboard/system-health", { tab: "readiness" }),
  alias("/dashboard/live-chat", "/dashboard/comms-hub", { tab: "live-chat" }),
  alias("/dashboard/virtual-terminal", "/dashboard"),
  alias("/dashboard/ghl-sequence-guide", "/dashboard/ghl-integration", { tab: "sequence-guide" }),
  alias("/dashboard/marketing-playbook", "/dashboard/playbooks", { tab: "marketing" }),
  alias("/dashboard/growth-playbook", "/dashboard/playbooks", { tab: "growth" }),
  alias("/dashboard/growth-kpi", "/dashboard/reporting", { tab: "growth" }),
  alias("/dashboard/cold-leads", "/dashboard/outbound-center", { tab: "prospects" }),
  alias("/dashboard/conversation-ai", "/dashboard/sdr-hub", { tab: "chatbot" }),
  alias("/dashboard/outreach-hub", "/dashboard/outbound-center"),
  alias("/dashboard/information-flow", "/dashboard/admin-hub", { tab: "info-flow" }),
  alias("/dashboard/ghl-workflow-ids", "/dashboard/ghl-integration", { tab: "workflow-ids" }),
  alias("/dashboard/social-composer", "/dashboard/content-hub", { tab: "linkedin" }),
  alias("/dashboard/blaze-integration", "/dashboard/content-hub", { tab: "blaze" }),
];

/** Query keys an alias carries to its destination: registered context and selectors, never the retired `tab` itself. */
export const LEGACY_ALIAS_CONTEXT_KEYS: readonly string[] = [...new Set([...workspaceContextKeys(), "taskState", "due", "taskOwner", "view", "healthView", "reviewView", "rfiView"])]
  .filter((key) => key !== "tab");

export function staticAliasFor(from: string): StaticLegacyAlias {
  const found = STATIC_DASHBOARD_ALIASES.find((entry) => entry.from === from);
  if (!found) throw new Error(`Unregistered legacy alias ${from}`);
  return found;
}

export function legacyAliasUrl(from: string, search: string, hash = ""): string {
  const entry = staticAliasFor(from);
  const params = safeParams(search, LEGACY_ALIAS_CONTEXT_KEYS);
  for (const [key, value] of Object.entries(entry.fixed)) params.set(key, value);
  return destinationUrl(entry.to, params, hash);
}

/** Fragment kept on a hand-written alias redirect (same rule as every registered destination). */
export const aliasFragment = (hash: string) => safeFragment(hash);
