import { useMemo } from "react";
import type { CatalogTruth } from "@shared/catalog-truth-contract";
import { useAuth } from "@/hooks/use-auth";
import { useCrmQuery } from "@/hooks/use-crm-query";
import type { CatalogRead } from "@/lib/email-lane-states";

/**
 * One read of the derived package catalog for every email-lane screen. Denied, unavailable and loading are distinct and
 * never become "not in a package": a screen that cannot read the catalog shows the facts as unknown.
 */
export function useCatalogReadiness(): CatalogRead {
  const { user } = useAuth();
  const allowed = user?.role === "admin" || user?.role === "manager";
  const query = useCrmQuery<CatalogTruth>({
    queryKey: ["/api/admin/catalog-truth", "readiness"],
    enabled: allowed,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/admin/catalog-truth", { credentials: "include", signal });
      if (!res.ok) throw new Error(`${res.status}`);
      const body = await res.json() as CatalogTruth;
      if (!body.available || !Array.isArray(body.campaigns) || !Array.isArray(body.sequences) || !Array.isArray(body.packages)) throw new Error("catalog unavailable");
      return body;
    },
    retry: false,
  });
  return useMemo<CatalogRead>(() => {
    if (!allowed) return { status: "denied", catalog: null };
    if (query.data) return { status: "ready", catalog: query.data };
    if (query.isError) return { status: /^(401|403)/.test(String((query.error as Error)?.message ?? "")) ? "denied" : "unavailable", catalog: null };
    return { status: "loading", catalog: null };
  }, [allowed, query.data, query.isError, query.error]);
}
