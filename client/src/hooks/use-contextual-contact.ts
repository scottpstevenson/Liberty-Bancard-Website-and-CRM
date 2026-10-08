import { apiRequest } from "@/lib/queryClient";
import { parseLocalEntityId } from "@/lib/crm-destination-state";
import type { ContactDetailData } from "@/pages/dashboard/contact-detail-tabs/shared";
import { useCrmQuery } from "./use-crm-query";

/** Exact authorized A/B reader, not a lookup in the first directory page. */
export function useContextualContact(id: string, section: "deals" | "overview" = "deals") {
  const valid = !!parseLocalEntityId("contactId", id);
  return useCrmQuery<ContactDetailData>({
    queryKey: ["/api/contacts", Number(id), "detail", {section}],
    enabled: valid,
    queryFn: async ({ signal }) => {
      const data = await (await apiRequest("GET", `/api/contacts/${id}/detail?section=${section}`, undefined, undefined, signal)).json();
      if (!data || data.contact?.id !== Number(id) || (section === "deals" && (!Array.isArray(data.deals)
        || data.loaded?.deals !== true || !data.deals.every((deal: any) => Number.isSafeInteger(deal.id)
          && deal.contactId === Number(id))))) throw new Error("Invalid authorized record detail");
      return data;
    },
  });
}
