import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type CreateTicketRequest, type UpdateTicketRequest } from "@shared/routes";

export function useTickets() {
  return useQuery({
    queryKey: [api.tickets.list.path],
    queryFn: async () => {
      const res = await fetch(api.tickets.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tickets");
      return api.tickets.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateTicketRequest) => {
      const res = await fetch(api.tickets.create.path, {
        method: api.tickets.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.tickets.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to create ticket");
      }
      return api.tickets.create.responses[201].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.tickets.list.path] }),
  });
}

export function useUpdateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & UpdateTicketRequest) => {
      const url = buildUrl(api.tickets.update.path, { id });
      const res = await fetch(url, {
        method: api.tickets.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 404) throw new Error("Ticket not found");
        throw new Error("Failed to update ticket");
      }
      return api.tickets.update.responses[200].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.tickets.list.path] }),
  });
}
