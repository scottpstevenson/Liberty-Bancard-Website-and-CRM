import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type CreateContactRequest, type UpdateContactRequest } from "@shared/routes";

export function useContacts() {
  return useQuery({
    queryKey: [api.contacts.list.path],
    queryFn: async () => {
      const res = await fetch(api.contacts.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch contacts");
      return api.contacts.list.responses[200].parse(await res.json());
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
      return api.contacts.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateContactRequest) => {
      const res = await fetch(api.contacts.create.path, {
        method: api.contacts.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.contacts.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to create contact");
      }
      return api.contacts.create.responses[201].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.contacts.list.path] }),
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & UpdateContactRequest) => {
      const url = buildUrl(api.contacts.update.path, { id });
      const res = await fetch(url, {
        method: api.contacts.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.contacts.update.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        if (res.status === 404) throw new Error("Contact not found");
        throw new Error("Failed to update contact");
      }
      return api.contacts.update.responses[200].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.contacts.list.path] }),
  });
}
