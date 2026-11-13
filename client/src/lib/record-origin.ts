/**
 * Where a record was opened from (Phase 6 R09), so a Contact's Back control returns to the area that sent the person there
 * (Pipeline, Inbox, Work, Prospecting, Reports, Today ...) instead of always the People list.
 *
 * The origin is the previous in-app route when the record route is entered. It is kept per signed-in actor in this tab's
 * session storage, keyed by the exact record path, and re-validated on every read: the path must still belong to a sidebar area
 * this role has, the query must use only safe characters, and a record page is never an origin. A People-list origin is left to
 * the existing list return (it keeps filters and paging). Nothing here grants access; the destination still applies its own
 * route and server authorization, and a revoked area simply stops being offered.
 */
import { isValidReturnUrl } from "./crm-return-context";
import { crmRoutes } from "./crm-route-registry";
import { isRecordPath, resolveWorkspaceIdentity } from "./workspace-identity";

const SAFE_URL = /^\/dashboard(?:\/[A-Za-z0-9_-]{1,64}){0,3}(?:\?[A-Za-z0-9_%=&.,:+~-]{0,1500})?$/;
const MAX_ENTRIES = 20;
const key = (actorId: string) => `crm:origin:${actorId}`;
type Entry = { record: string; origin: string };

export interface RecordOrigin { href: string; areaLabel: string }

/** The origin's area for this role, or null when the URL is unsafe, a record page, a People list, or in no area this role has. */
export function validateOrigin(role: string | undefined, originUrl: string): RecordOrigin | null {
  if (!role || !SAFE_URL.test(originUrl)) return null;
  const path = originUrl.split("?")[0];
  if (isRecordPath(path) || isValidReturnUrl("people", originUrl)) return null;
  // The path must be a registered route whose wrapper admits this role: an origin the role could not open is never offered.
  const route = crmRoutes.find(candidate => candidate.pattern === path);
  if (!route || (route.wrapperRoles && !(route.wrapperRoles as readonly string[]).includes(role))) return null;
  const identity = resolveWorkspaceIdentity(role, originUrl);
  return identity ? { href: originUrl, areaLabel: identity.areaLabel } : null;
}

function load(actorId: string): Entry[] {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(key(actorId)) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is Entry => !!entry && typeof entry.record === "string" && typeof entry.origin === "string")
      : [];
  } catch { return []; }
}

export function rememberRecordOrigin(actorId: string | undefined, role: string | undefined, recordPath: string, originUrl: string): void {
  if (!actorId || !isRecordPath(recordPath) || !validateOrigin(role, originUrl)) return;
  try {
    const entries = load(actorId).filter(entry => entry.record !== recordPath);
    entries.push({ record: recordPath, origin: originUrl });
    window.sessionStorage.setItem(key(actorId), JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch { /* storage unavailable: Back falls back to the People list */ }
}

export function readRecordOrigin(actorId: string | undefined, role: string | undefined, recordPath: string): RecordOrigin | null {
  if (!actorId || !isRecordPath(recordPath)) return null;
  const entry = load(actorId).find(candidate => candidate.record === recordPath);
  return entry ? validateOrigin(role, entry.origin) : null;
}

/**
 * Route changes, in order. The shell mounts per route, so the previous route is held here (module scope) rather than in a
 * component. The previous route counts only when it was visited by the same actor, and only a change of path records an
 * origin: moving between sections inside one record, or re-rendering, never replaces it.
 */
let previousRoute: { actorId: string; path: string; full: string } | null = null;
export function noteRouteChange(actorId: string | undefined, role: string | undefined, path: string, full: string): void {
  if (!actorId) { previousRoute = null; return; }
  const before = previousRoute && previousRoute.actorId === actorId ? previousRoute : null;
  previousRoute = { actorId, path, full };
  if (before && before.path !== path && isRecordPath(path)) rememberRecordOrigin(actorId, role, path, before.full);
}
/** Test seam: forget the held route. */
export function resetRouteHistoryForTests(): void { previousRoute = null; }
