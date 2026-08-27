import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { api, buildUrl } from "@shared/routes";
import { apiRequest } from "@/lib/queryClient";
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
  const limit = params?.limit ?? 100;
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
  return useQuery({
    queryKey: [api.contacts.list.path, { limit, offset, churnRisk, noOutreach, blocked, search, sort, archived, contactClass,
      status: params?.status, emailHealth: params?.emailHealth, assignedToMe: params?.assignedToMe,
      vertical: params?.vertical, tag: params?.tag, contactedToday: params?.contactedToday,
      hasAssignee: params?.hasAssignee, leadSource: params?.leadSource, lifecycle: params?.lifecycle,
      stale: params?.stale, recentlyUpdated: params?.recentlyUpdated, neverContacted: params?.neverContacted,
      notContactedIn30: params?.notContactedIn30, noDeal: params?.noDeal, createdThisWeek: params?.createdThisWeek }],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      const json = await res.json();
      return json as {
        data: any[]; total: number; limit: number; offset: number;
        filters: Record<string, unknown>; facets: { byRecordClass: Record<string, number>; byEmailHealth: Record<string, number> };
        scope: string; asOf: string;
      };
    },
  });
}

export function useContact(id: number) {
  return useQuery({
    queryKey: [api.contacts.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.contacts.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch contact");
      return res.json();
    },
    enabled: !!id,
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: CreateContactInput) => {
      const res = await apiRequest(api.contacts.create.method as "POST", api.contacts.create.path, data);
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || "Failed to create contact");
      }
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.contacts.list.path] }),
    onError: (err: Error) => {
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
