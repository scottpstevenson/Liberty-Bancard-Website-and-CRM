import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { Ticket } from "@shared/schema";
import { insertTicketSchema } from "@shared/schema";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";

type CreateTicketRequest = z.infer<typeof insertTicketSchema>;
type UpdateTicketRequest = Partial<CreateTicketRequest>;

export function useTickets() {
  return useQuery<Ticket[]>({
    queryKey: [api.tickets.list.path],
    queryFn: async () => {
      const res = await fetch(api.tickets.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tickets");
      return res.json();
    },
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateTicketRequest) => {
      const res = await apiRequest(api.tickets.create.method as "POST", api.tickets.create.path, data);
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.message || "Failed to create ticket");
      }
      return res.json() as Promise<Ticket>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.tickets.list.path] }),
  });
}

export function useUpdateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & UpdateTicketRequest) => {
      const url = buildUrl(api.tickets.update.path, { id });
      const res = await apiRequest(api.tickets.update.method as "PATCH" | "PUT", url, updates);
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        if (res.status === 404) throw new Error("Ticket not found");
        throw new Error(error.message || "Failed to update ticket");
      }
      return res.json() as Promise<Ticket>;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.tickets.list.path] }),
  });
}
