/** URL authority shared by C1 and later workspace owners. Metadata does not
 * authorize rendering; mounted wrappers retain their existing role guards. */
export const financialViews = ["revenue", "forecasting", "terminal-roi"] as const;
export const operatorViews = [
  "command-center", "lifecycle", "conversion", "stuck-leads", "lead-queue-health",
  "stage-health", "vertical-coverage", "statement-upload", "a-lead-queue", "sdr",
  "recent-sends", "send-monitoring", "silent-sequences", "pipeline-silence-thresholds",
  "bounce-failure", "comm-health", "ai-health", "ai-activity", "ai-learning-center",
  "low-confidence", "subject-audit", "content-organic", "ghl-connection",
  "sync-conflicts", "ghl-invalid-contacts", "serper-control", "webhook-events",
  "registry-import", "ghl-deferred-queue", "save-cases", "score-all",
  "new-lead-enroll", "kpis", "readiness", "job-health", "queue-metrics",
  "worker-intervals", "worker-heartbeats", "deleted-records", "outbound-preflight",
  "queue-holds", "data-health", "system-audit", "launch-readiness",
  "data-quality", "deliverability-settings",
] as const;
export type SelectionIssue = { key: string; kind: "conflict" | "invalid" | "forbidden"; reason: string };
export type Selection<T extends string> = { value: T; issues: SelectionIssue[] };

export function selectValue<T extends string>(params: URLSearchParams, key: string,
  allowed: readonly T[], fallback: T, permitted: readonly T[] = allowed): Selection<T> {
  const values = [...new Set(params.getAll(key))];
  if (!values.length) return { value: fallback, issues: [] };
  const kind = values.length > 1 ? "conflict"
    : !allowed.includes(values[0] as T) ? "invalid"
    : !permitted.includes(values[0] as T) ? "forbidden" : null;
  if (kind) return { value: fallback, issues: [{ key, kind,
    reason: `${key}: ${kind} selection. Showing ${fallback}.` }] };
  return { value: values[0] as T, issues: [] };
}

export const safeContextKeys = ["contactId", "companyId", "businessId", "dealId", "sourceId", "from"] as const;
const contextIdKinds = { contactId: "integer", companyId: "integer", businessId: "integer", dealId: "integer", sourceId: "integer" } as const;
export type LocalEntityId = { kind: keyof typeof contextIdKinds; value: string };
export function parseLocalEntityId(kind: LocalEntityId["kind"], value: string): LocalEntityId | null {
  const valid = /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
  return valid ? { kind, value } : null;
}
/** Preserve only registered context, never resolve IDs by display name. */
export function safeParams(search: string, keys: readonly string[]): URLSearchParams {
  const input = new URLSearchParams(search), out = new URLSearchParams();
  for (const key of keys) {
    const values = [...new Set(input.getAll(key))];
    if (values.length !== 1) continue;
    if (key in contextIdKinds && !parseLocalEntityId(key as LocalEntityId["kind"], values[0])) continue;
    if (key === "from" && !/^\/dashboard(?:\/[a-z0-9/-]*)?$/.test(values[0])) continue;
    out.set(key, values[0]);
  }
  return out;
}
export function safeFragment(hash: string): string {
  return /^#[a-z][a-z0-9_-]{0,63}$/i.test(hash) ? hash : "";
}
export function destinationUrl(path: string, params: URLSearchParams, hash = ""): string {
  return path + (params.size ? `?${params.toString()}` : "") + safeFragment(hash);
}

export function financialState(search: string) {
  const params = new URLSearchParams(search);
  // Explicit child wins even when a legacy tab also names another valid child.
  return params.has("financialTab")
    ? selectValue(params, "financialTab", financialViews, "revenue")
    : selectValue(params, "tab", [...financialViews, "financial"] as const, "revenue");
}
export function financialUrl(search: string, hash = "", child?: typeof financialViews[number]) {
  const state = financialState(search);
  const params = safeParams(search, safeContextKeys);
  params.set("tab", "financial");
  params.set("financialTab", child ?? (state.value === "financial" ? "revenue" : state.value));
  // Persist a machine-readable invalid/conflict reason across alias replacement.
  if (state.issues.length) params.set("selectionIssue", state.issues[0].kind);
  return destinationUrl("/dashboard/reporting", params, hash);
}
export function systemState(search: string, isAdmin: boolean) {
  const params = new URLSearchParams(search);
  const allowed = ["monitor", "readiness", "seo", "incidents"] as const;
  const tab = selectValue(params, "tab", allowed, "readiness",
    isAdmin ? allowed : ["readiness", "seo"]);
  const view = selectValue(params, "view", operatorViews, "command-center");
  return { tab: tab.value, view: view.value, issues: [...tab.issues, ...view.issues] };
}
export function systemUrl(search: string, hash = "", tab = "monitor", view?: typeof operatorViews[number]) {
  const params = safeParams(search, safeContextKeys);
  params.set("tab", tab);
  if (tab === "monitor") {
    const state = selectValue(new URLSearchParams(search), "view", operatorViews, "command-center");
    params.set("view", view ?? state.value);
    if (state.issues.length) params.set("selectionIssue", state.issues[0].kind);
  }
  return destinationUrl("/dashboard/system-health", params, hash);
}
export function operatorAliasUrl(search: string, hash = "") {
  const params = new URLSearchParams(search);
  // Historical /operator?tab=child is a child selector, not a parent tab.
  if (!params.has("view") && params.has("tab")) {
    for (const v of params.getAll("tab")) params.append("view", v);
  }
  return systemUrl(params.toString(), hash);
}
export function selectionMessage(search: string): string | null {
  const issue = new URLSearchParams(search).get("selectionIssue");
  return ["conflict", "invalid", "forbidden"].includes(issue ?? "")
    ? `The requested selection was ${issue}. A permitted default is shown.` : null;
}
export function peopleHubState(search: string) {
  return selectValue(new URLSearchParams(search),"tab",["people","leads","prospect-staging"] as const,"people");
}

// Published, source-matching contracts only. C2/C3 own actual adoption.
export const contactSections = ["overview","deals","tickets","tasks","notes","documents",
  "live-processing","chargebacks","activity","call-logs","call-assist","relationships",
  "locations","history","comments","churn-risk","delivery-log","comm-timeline",
  "comm-health","offer-intelligence","company-intelligence","sales-prep",
  "onboarding-stages","rfis","nps"] as const;
export const leadOpsSections = ["businesses","prospects","imports","staging","sources",
  "census","intelligence","quality","pipeline","sfp","provider-results","pilot","health"] as const;
export const stagingSections = ["master-leads","promotion-review"] as const;
export const canonicalSections = ["pipeline","records","imports","exceptions","health"] as const;
export function recordSectionState(search: string, permitted: readonly typeof contactSections[number][] = contactSections) {
  return selectValue(new URLSearchParams(search),"section",contactSections,
    permitted.includes("overview") ? "overview" : permitted[0],permitted);
}

export const contactAreas = ["overview", "sales-work", "conversations", "lifecycle", "service-performance"] as const;
export type ContactArea = typeof contactAreas[number];
export type ContactSection = typeof contactSections[number];
export const contactAreaSections: Record<ContactArea, readonly ContactSection[]> = {
  overview: ["overview", "relationships", "locations", "company-intelligence"],
  "sales-work": ["deals", "tasks", "call-logs", "call-assist", "offer-intelligence", "sales-prep"],
  conversations: ["comm-timeline", "comm-health", "delivery-log", "notes", "comments"],
  lifecycle: ["documents", "onboarding-stages", "rfis"],
  "service-performance": ["tickets", "live-processing", "chargebacks", "churn-risk", "nps"],
};
export function contactSectionArea(section: ContactSection): ContactArea | null {
  return contactAreas.find(area => contactAreaSections[area].includes(section)) ?? null;
}
/** Decode before mounting child readers. A zero-capability record has no fallback
 * child, rather than accidentally mounting Overview with undefined authority. */
export function contactWorkspaceState(search: string, permitted: readonly ContactSection[] = contactSections) {
  const params = new URLSearchParams(search), issues: SelectionIssue[] = [];
  const allowed = permitted.filter(section => contactSectionArea(section) !== null);
  const fallback = allowed.includes("overview") ? "overview" : allowed[0] ?? null;
  let section: ContactSection | null = fallback;
  let drawer: "activity" | "history" | null = null;
  const read = (key: string, values: readonly string[]) => {
    const all = [...new Set(params.getAll(key))];
    if (!all.length) return null;
    const kind = all.length > 1 ? "conflict" : !values.includes(all[0]) ? "invalid" : null;
    if (kind) { issues.push({key, kind, reason:`The requested ${key} is ${kind}.`}); return null; }
    return all[0];
  };
  const areaInput = read("area", contactAreas);
  const sectionInput = read("section", contactSections);
  const legacy = read("tab", contactSections);
  const drawerInput = read("drawer", ["activity", "history"]);
  if (sectionInput && legacy && sectionInput !== legacy && legacy !== drawerInput) {
    issues.push({key:"tab", kind:"conflict", reason:"Legacy and canonical section selections disagree."});
  }
  const chosen = sectionInput ?? legacy;
  if (chosen === "activity" || chosen === "history") drawer = chosen;
  else if (chosen) section = chosen as ContactSection;
  else if (areaInput) section = contactAreaSections[areaInput as ContactArea].find(s => allowed.includes(s)) ?? null;
  if (drawerInput) {
    if (drawer && drawer !== drawerInput) issues.push({key:"drawer",kind:"conflict",reason:"Drawer selections disagree."});
    drawer = drawerInput as typeof drawer;
  }
  if (section && !allowed.includes(section)) {
    issues.push({key:"section",kind:"forbidden",reason:"This record does not permit the requested section."});
    section = fallback;
  }
  if (drawer && !permitted.includes(drawer)) {
    issues.push({key:"drawer",kind:"forbidden",reason:"This record does not permit the requested drawer."});
    drawer = null;
  }
  if (areaInput && section && contactSectionArea(section) !== areaInput) {
    issues.push({key:"area",kind:"conflict",reason:"The section does not belong to the requested area."});
  }
  if (issues.some(i => i.kind === "conflict" || i.kind === "invalid")) {
    section = fallback; drawer = null;
  }
  if (!allowed.length) {
    issues.push({key:"section",kind:"forbidden",reason:"No record sections are available for this context."});
    drawer = null;
  }
  return {area:section ? contactSectionArea(section) : null, section, drawer, issues, permittedSections:allowed};
}
function workspaceContextKeys() {
  return [...peopleQueryKeys, "id", "taskId", "month", "timezone", "channel", "filter", "thread", "source"] as const;
}
/** Preserve registered context and hash; callers push user choices, replace only
 * alias/invalid canonicalization. Source/thread strings remain opaque namespaces. */
export function buildContactWorkspaceHref(href: string, patch: {
  area?: ContactArea; section?: ContactSection; drawer?: "activity" | "history" | null;
}) {
  const url = new URL(href, "https://crm.invalid");
  const params = safeParams(url.search, workspaceContextKeys());
  const state = contactWorkspaceState(url.search);
  const section = patch.section ?? (patch.area ? contactAreaSections[patch.area][0] : state.section ?? "overview");
  const area = patch.area ?? contactSectionArea(section);
  if (!area || !contactAreaSections[area].includes(section)) throw new Error("Incompatible Contact area and section");
  params.set("area", area); params.set("section", section);
  const drawer = patch.drawer === undefined ? state.drawer : patch.drawer;
  if (drawer) params.set("drawer", drawer);
  return destinationUrl(url.pathname, params, url.hash);
}
export function workWorkspaceState(search: string) {
  const selected = selectValue(new URLSearchParams(search), "tab", ["tasks", "calendar"] as const, "tasks");
  return {tab:selected.value, value:selected.value, issues:selected.issues};
}
export function buildWorkWorkspaceHref(href: string, tab: "tasks" | "calendar") {
  const url = new URL(href, "https://crm.invalid"), params = safeParams(url.search, workspaceContextKeys());
  params.set("tab", tab);
  return destinationUrl("/dashboard/tasks-appointments", params, url.hash);
}
export const inboxChannels = ["all", "email", "sms", "voicemail", "site", "ghl_chat"] as const;
export const inboxFilters = ["all", "unread", "needs_reply"] as const;
export function inboxWorkspaceState(search: string) {
  const params = new URLSearchParams(search);
  // Historical sms-inbox messages means SMS; live-chat means the first-party
  // site chat, NOT all messages or the external GHL chat source.
  const aliases: Record<string,string> = {messages:"sms", "live-chat":"site"};
  const legacy = [...new Set(params.getAll("tab"))];
  const issues: SelectionIssue[] = [];
  if (legacy.length > 1 || (legacy.length && !aliases[legacy[0]])) {
    issues.push({key:"tab",kind:legacy.length > 1 ? "conflict" : "invalid",reason:"Unrecognized legacy Inbox selection."});
  } else if (legacy.length) {
    const mapped = aliases[legacy[0]];
    if (params.has("channel") && params.getAll("channel").some(c => c !== mapped))
      issues.push({key:"channel",kind:"conflict",reason:"Legacy and canonical Inbox channels disagree."});
    else params.set("channel", mapped);
  }
  const channel = selectValue(params, "channel", inboxChannels, "all");
  const filter = selectValue(params, "filter", inboxFilters, "all");
  issues.push(...channel.issues, ...filter.issues);
  const single = (key:string) => {
    const values = [...new Set(params.getAll(key))];
    if (values.length > 1 || (values[0]?.length ?? 0) > 512 || /[\u0000-\u001f]/.test(values[0] ?? "")) {
      issues.push({key,kind:"invalid",reason:`Invalid ${key} selection.`}); return "";
    }
    return values[0] ?? "";
  };
  const searchText=single("search"), thread=single("thread");
  return {channel:issues.some(i=>i.key==="channel" || i.key==="tab")?"all" as const:channel.value,
    filter:filter.value, search:searchText, thread, issues};
}
export function buildInboxWorkspaceHref(href: string, patch: Partial<Pick<ReturnType<typeof inboxWorkspaceState>, "channel" | "filter" | "search" | "thread">>) {
  const url=new URL(href,"https://crm.invalid"),params=safeParams(url.search,workspaceContextKeys());
  params.delete("tab");
  const state={...inboxWorkspaceState(url.search),...patch};
  if (!inboxChannels.includes(state.channel) || !inboxFilters.includes(state.filter)) throw new Error("Invalid Inbox selection");
  params.set("channel",state.channel);params.set("filter",state.filter);
  for(const key of ["search","thread"] as const) { if(state[key])params.set(key,state[key]);else params.delete(key); }
  return destinationUrl(url.pathname,params,url.hash);
}
export function prospectingState(search: string) {
  const params = new URLSearchParams(search);
  return {
    tab:selectValue(params,"tab",leadOpsSections,"businesses"),
    staging:selectValue(params,"stagingView",stagingSections,"master-leads"),
    canonical:selectValue(params,"canonicalView",canonicalSections,"pipeline"),
  };
}

export const peopleQueryKeys = ["tab","search","sort","archived","status","recordClass","limit","offset",
  "churnRisk","noOutreach","blocked","emailHealth","assignedToMe","vertical","tag","contactedToday",
  "hasAssignee","leadSource","lifecycle","stale","recentlyUpdated","neverContacted","notContactedIn30",
  "noDeal","createdThisWeek",...safeContextKeys] as const;
/** Match the registered People parser; do not send an archived read which the
 * actor is forbidden to request. URL presets have no persistent ownerless CRUD. */
export function peopleState(search: string, privileged: boolean, assignmentFilterSupported = false) {
  const input=new URLSearchParams(search),params=safeParams(search,peopleQueryKeys),issues:SelectionIssue[]=[];
  for(const key of peopleQueryKeys){
    if(new Set(input.getAll(key)).size>1)
      issues.push({key,kind:"conflict",reason:`${key}: contradictory values were discarded.`});
  }
  const enums:Record<string,{values:readonly string[];fallback:string;permitted?:readonly string[]}>={
    limit:{values:["25","50","100"],fallback:"50"},
    sort:{values:["activity_desc","activity_asc","score_desc","alpha","name","createdAtAsc","updatedAt","leadScore"],fallback:""},
    recordClass:{values:["production","test","demo","synthetic","unknown","all"],fallback:"production"},
    churnRisk:{values:["high"],fallback:""},noOutreach:{values:["24h"],fallback:""},
    archived:{values:["true","false"],fallback:"false",permitted:privileged?["true","false"]:["false"]},
  };
  enums.assignedToMe={values:["true","false"],fallback:"false",permitted:assignmentFilterSupported?["true","false"]:["false"]};
  for(const key of ["blocked","contactedToday","hasAssignee","stale","recentlyUpdated",
    "neverContacted","notContactedIn30","noDeal","createdThisWeek"])
    enums[key]={values:["true","false"],fallback:"false"};
  for(const [key,rule] of Object.entries(enums)){
    if(!input.has(key))continue;
    const selection=selectValue(input,key,rule.values,rule.fallback,rule.permitted);
    issues.push(...selection.issues);
    if(selection.value && selection.value!=="false")params.set(key,selection.value);else params.delete(key);
  }
  if(input.has("offset")){
    const values=[...new Set(input.getAll("offset"))],value=Number(values[0]);
    if(values.length===1 && /^[0-9]+$/.test(values[0]) && Number.isSafeInteger(value)){
      const size=Number(params.get("limit")??50),offset=Math.floor(value/size)*size;
      if(offset>0)params.set("offset",String(offset));else params.delete("offset");
    }else{params.delete("offset");issues.push({key:"offset",kind:"invalid",reason:"offset: using the first page."});}
  }
  return {params,issues};
}
