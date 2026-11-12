/**
 * Desktop -> mobile destination mapping for the responsive breakpoint.
 *
 * A phone-width browser that opens an employee dashboard link used to be sent to the mobile home page, discarding the
 * contact, task, request or filter the link named. The mapping below is the single decision:
 *   - `redirect`: the mobile app has the same entity or workspace, and the registered context that matters is carried over;
 *   - `choose`:   the mobile app has no equivalent for this exact view. Nothing is discarded or replaced; the person is told
 *                 and may open the same address in the desktop layout or go to the mobile home page.
 * Only registered selectors cross the boundary (see crm-destination-state.ts); no second filter vocabulary is introduced.
 */
import {
  buildInboxWorkspaceHref, destinationUrl, inboxWorkspaceState, parseLocalEntityId, safeFragment,
} from "@/lib/crm-destination-state";

export type MobileDestination =
  | { kind: "redirect"; href: string }
  | { kind: "choose"; reason: string; desktopHref: string; mobileHref: string };

export const MOBILE_HOME = "/mobile";

const chooseFor = (pathname: string, search: string, hash: string, reason: string): MobileDestination => ({
  kind: "choose",
  reason,
  desktopHref: `${pathname}${search ? (search.startsWith("?") ? search : `?${search}`) : ""}${hash}`,
  mobileHref: MOBILE_HOME,
});

const meaningfulKeys = (search: string) => [...new URLSearchParams(search).keys()];

/** Decide where a mobile-width browser opening `pathname` should land. */
export function mobileDestinationFor(pathname: string, search: string, hash = ""): MobileDestination {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const keys = meaningfulKeys(search);

  if (path === "/dashboard") {
    return keys.length === 0 ? { kind: "redirect", href: MOBILE_HOME } : chooseFor(pathname, search, hash, "This overview view has no mobile equivalent.");
  }

  const contact = /^\/dashboard\/contacts\/([^/]+)$/.exec(path);
  if (contact) {
    const id = parseLocalEntityId("contactId", contact[1]);
    return id
      ? { kind: "redirect", href: `/mobile/contacts/${id.value}${safeFragment(hash)}` }
      : chooseFor(pathname, search, hash, "That contact link is not a valid record address.");
  }

  if (path === "/dashboard/contacts") {
    return keys.length === 0
      ? { kind: "redirect", href: "/mobile/contacts" }
      : chooseFor(pathname, search, hash, "The mobile contact list cannot apply these filters, so it would show a different list.");
  }

  if (path === "/dashboard/pipeline") {
    return keys.length === 0
      ? { kind: "redirect", href: "/mobile/pipeline" }
      : chooseFor(pathname, search, hash, "The mobile pipeline cannot open this selection or filter.");
  }

  if (path === "/dashboard/comms-hub") {
    const workspace = inboxWorkspaceState(search);
    if (workspace.issues.length === 0) {
      return { kind: "redirect", href: buildInboxWorkspaceHref(`/mobile/inbox${search ? `?${search.replace(/^\?/, "")}` : ""}${safeFragment(hash)}`, workspace) };
    }
    return chooseFor(pathname, search, hash, "This message view has a selection the mobile inbox cannot apply.");
  }

  if (path === "/dashboard/tasks-appointments") {
    const params = new URLSearchParams(search);
    const tab = params.getAll("tab");
    const onlyPlainTasks = keys.every((key) => key === "tab") && (tab.length === 0 || (tab.length === 1 && tab[0] === "tasks"));
    return onlyPlainTasks
      ? { kind: "redirect", href: "/mobile/tasks" }
      : chooseFor(pathname, search, hash, "The mobile task list cannot open this task, filter or calendar view.");
  }

  return chooseFor(pathname, search, hash, "This workspace is not part of the mobile app.");
}

/** Blocked contacts use the People filter contract (`blocked=true`); there is no "blocked" tab. */
export function blockedContactsHref(): string {
  return destinationUrl("/dashboard/contacts", new URLSearchParams({ blocked: "true" }));
}
