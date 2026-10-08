import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { api, buildUrl } from "@shared/routes";
import { apiRequest, protectedScope } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useRef } from "react";
import type { z } from "zod";

type CreateContactInput = z.infer<typeof api.contacts.create.input>;
type UpdateContactInput = z.infer<typeof api.contacts.update.input>;

export function useContacts(params?: {
  limit?: number;
  offset?: number;
  /** Server-side churn risk filter: "high" = churnRiskTier IN ('High','Critical') */
  churnRisk?: string;
  /** Server-side no-outreach filter: "24h" = created last 24h + lastContactedAt IS NULL */
  noOutreach?: string;
  /** Server-side blocked filter: "true" = doNotContact OR emailStatus in bounced/invalid/opted_out/unsafe */
  blocked?: string;
  search?: string;
  sort?: string;
  archived?: string;
  recordClass?: string;
  status?: string;
  emailHealth?: string;
  assignedToMe?: boolean;
  vertical?: string;
  tag?: string;
  contactedToday?: boolean;
  hasAssignee?: boolean;
  leadSource?: string;
  lifecycle?: string;
  stale?: boolean;
  recentlyUpdated?: boolean;
  neverContacted?: boolean;
  notContactedIn30?: boolean;
  noDeal?: boolean;
  createdThisWeek?: boolean;
}) {
  const { user } = useAuth();
  const scope = protectedScope(user);
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;
  const churnRisk = params?.churnRisk;
  const noOutreach = params?.noOutreach;
  const blocked = params?.blocked;
  const search = params?.search;
  const sort = params?.sort;
  const archived = params?.archived;
  const contactClass = params?.recordClass;
  const searchParams = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (churnRisk) searchParams.set("churnRisk", churnRisk);
  if (noOutreach) searchParams.set("noOutreach", noOutreach);
  if (blocked) searchParams.set("blocked", blocked);
  if (search) searchParams.set("search", search);
  if (sort) searchParams.set("sort", sort);
  if (archived) searchParams.set("archived", archived);
  if (contactClass) searchParams.set("recordClass", contactClass);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.emailHealth) searchParams.set("emailHealth", params.emailHealth);
  if (params?.assignedToMe) searchParams.set("assignedToMe", "true");
  if (params?.vertical) searchParams.set("vertical", params.vertical);
  if (params?.tag) searchParams.set("tag", params.tag);
  if (params?.contactedToday) searchParams.set("contactedToday", "true");
  if (params?.hasAssignee) searchParams.set("hasAssignee", "true");
  if (params?.leadSource) searchParams.set("leadSource", params.leadSource);
  if (params?.lifecycle) searchParams.set("lifecycle", params.lifecycle);
  if (params?.stale) searchParams.set("stale", "true");
  if (params?.recentlyUpdated) searchParams.set("recentlyUpdated", "true");
  if (params?.neverContacted) searchParams.set("neverContacted", "true");
  if (params?.notContactedIn30) searchParams.set("notContactedIn30", "true");
  if (params?.noDeal) searchParams.set("noDeal", "true");
  if (params?.createdThisWeek) searchParams.set("createdThisWeek", "true");
  const url = `${api.contacts.list.path}?${searchParams.toString()}`;
  const filterKey = { limit, offset, churnRisk, noOutreach, blocked, search, sort, archived, contactClass,
    status: params?.status, emailHealth: params?.emailHealth, assignedToMe: params?.assignedToMe,
    vertical: params?.vertical, tag: params?.tag, contactedToday: params?.contactedToday,
    hasAssignee: params?.hasAssignee, leadSource: params?.leadSource, lifecycle: params?.lifecycle,
    stale: params?.stale, recentlyUpdated: params?.recentlyUpdated, neverContacted: params?.neverContacted,
    notContactedIn30: params?.notContactedIn30, noDeal: params?.noDeal, createdThisWeek: params?.createdThisWeek };
  return useQuery({
    queryKey: [api.contacts.list.path, filterKey, scope],
    enabled: !!user,
    queryFn: async ({ signal }) => {
      const res = await fetch(url, { credentials: "include", signal });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      const json = await res.json();
      if (!json || !Array.isArray(json.data) || !Number.isSafeInteger(json.limit) || json.limit <= 0
        || !Number.isSafeInteger(json.offset) || json.offset < 0
        || typeof json.scope !== "string" || !json.filters || typeof json.filters !== "object"
        || !json.data.every((row: any) => row && Number.isSafeInteger(row.id) && row.id > 0)) {
        throw new Error("Invalid contacts response; retry the authorized search");
      }
      // Server returns rows-only (no total/facets) — those come from useContactsFacets.
      return json as {
        data: any[]; limit: number; offset: number;
        filters: Record<string, unknown>; scope: string;
      };
    },
  });
}

/**
 * Separate hook for totals and facet breakdowns.
 * Runs independently of useContacts so a slow/failing facet query never
 * blocks contact rows from rendering.
 */
export function useContactsFacets(params?: Parameters<typeof useContacts>[0]) {
  const { user } = useAuth();
  const scope = protectedScope(user);
  const limit = params?.limit ?? 100;
  const offset = params?.offset ?? 0;
  const churnRisk = params?.churnRisk;
  const noOutreach = params?.noOutreach;
  const blocked = params?.blocked;
  const search = params?.search;
  const sort = params?.sort;
  const archived = params?.archived;
  const contactClass = params?.recordClass;
  const searchParams = new URLSearchParams();
  if (churnRisk) searchParams.set("churnRisk", churnRisk);
  if (noOutreach) searchParams.set("noOutreach", noOutreach);
  if (blocked) searchParams.set("blocked", blocked);
  if (search) searchParams.set("search", search);
  if (sort) searchParams.set("sort", sort);
  if (archived) searchParams.set("archived", archived);
  if (contactClass) searchParams.set("recordClass", contactClass);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.emailHealth) searchParams.set("emailHealth", params.emailHealth);
  if (params?.assignedToMe) searchParams.set("assignedToMe", "true");
  if (params?.vertical) searchParams.set("vertical", params.vertical);
  if (params?.tag) searchParams.set("tag", params.tag);
  if (params?.contactedToday) searchParams.set("contactedToday", "true");
  if (params?.hasAssignee) searchParams.set("hasAssignee", "true");
  if (params?.leadSource) searchParams.set("leadSource", params.leadSource);
  if (params?.lifecycle) searchParams.set("lifecycle", params.lifecycle);
  if (params?.stale) searchParams.set("stale", "true");
  if (params?.recentlyUpdated) searchParams.set("recentlyUpdated", "true");
  if (params?.neverContacted) searchParams.set("neverContacted", "true");
  if (params?.notContactedIn30) searchParams.set("notContactedIn30", "true");
  if (params?.noDeal) searchParams.set("noDeal", "true");
  if (params?.createdThisWeek) searchParams.set("createdThisWeek", "true");
  const facetsUrl = `/api/contacts/facets?${searchParams.toString()}`;
  const filterKey = { churnRisk, noOutreach, blocked, search, sort, archived, contactClass,
    status: params?.status, emailHealth: params?.emailHealth, assignedToMe: params?.assignedToMe,
    vertical: params?.vertical, tag: params?.tag, contactedToday: params?.contactedToday,
    hasAssignee: params?.hasAssignee, leadSource: params?.leadSource, lifecycle: params?.lifecycle,
    stale: params?.stale, recentlyUpdated: params?.recentlyUpdated, neverContacted: params?.neverContacted,
    notContactedIn30: params?.notContactedIn30, noDeal: params?.noDeal, createdThisWeek: params?.createdThisWeek };
  return useQuery({
    queryKey: ["/api/contacts/facets", filterKey, scope],
    enabled: !!user,
    queryFn: async ({ signal }) => {
      const res = await fetch(facetsUrl, { credentials: "include", signal });
      if (!res.ok) throw new Error("Facets unavailable");
      const data=await res.json();
      if(!data || !Number.isSafeInteger(data.total) || data.total<0 ||
        typeof data.asOf!=="string" || !Number.isFinite(Date.parse(data.asOf)) ||
        !data.byRecordClass || !data.byEmailHealth ||
        ![data.byRecordClass,data.byEmailHealth].every(values=>typeof values==="object" && !Array.isArray(values) &&
          Object.values(values).every(value=>Number.isSafeInteger(value) && (value as number)>=0))) {
        throw new Error("Invalid authorized facets response; retry the scoped read");
      }
      return data as {
        total: number;
        byRecordClass: Record<string, number>;
        byEmailHealth:  Record<string, number>;
        asOf: string;
      };
    },
    // Retry once after 4 s on failure; don't block contact rows.
    retry: 1,
    retryDelay: 4_000,
    // Stale after 30 s — matches server-side cache TTL.
    staleTime: 30_000,
  });
}

export function useContact(id: number) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [api.contacts.get.path, id, protectedScope(user)],
    queryFn: async ({ signal }) => {
      const url = buildUrl(api.contacts.get.path, { id });
      const res = await fetch(url, { credentials: "include", signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch contact");
      return res.json();
    },
    enabled: !!user && Number.isSafeInteger(id) && id > 0,
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const scope = JSON.stringify(protectedScope(user));
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const intent = useRef<{ payload: string; id: string } | null>(null);
  return useMutation({
    onMutate: () => ({ scope }),
    mutationFn: async (data: CreateContactInput) => {
      const payload = JSON.stringify([scope,data]);
      if(intent.current?.payload!==payload)intent.current={payload,id:crypto.randomUUID()};
      const commandId=intent.current.id;
      const res = await apiRequest(api.contacts.create.method as "POST", api.contacts.create.path, data,
        {"Idempotency-Key":commandId});
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || "Failed to create contact");
      }
      const contact=await res.json();
      if(!Number.isSafeInteger(contact?.id) || contact.id<=0)throw new Error("Creation receipt unavailable. Retry the same intent.");
      if(scopeRef.current!==scope)throw new Error("Creation belongs to the previous employee context.");
      if(scopeRef.current===scope && intent.current?.id===commandId)intent.current=null;
      return contact;
    },
    onSuccess: (_contact,_data,context) => {
      if(context?.scope===scopeRef.current)void queryClient.invalidateQueries({ queryKey: [api.contacts.list.path] });
    },
    onError: (err: Error,_data,context) => {
      if(context?.scope!==scopeRef.current)return;
      toast({ title: "Failed to create contact", description: err.message, variant: "destructive" });
    },
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & UpdateContactInput) => {
      const url = buildUrl(api.contacts.update.path, { id });
      const res = await apiRequest(api.contacts.update.method as "PATCH" | "PUT", url, updates);
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || "Failed to update contact");
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.contacts.list.path] }),
    onError: (err: Error) => {
      toast({ title: "Failed to update contact", description: err.message, variant: "destructive" });
    },
  });
}
