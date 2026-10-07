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
