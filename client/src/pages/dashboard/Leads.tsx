import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import DashboardErrorState from "@/components/DashboardErrorState";

type RevenueLead = {
  id: string | number;
  companyName?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string | null;
  stage?: string | null;
  ownerName?: string | null;
  assignedTo?: string | null;
  createdAt?: string | null;
  primaryDeal?: { id: number; stage?: string | null; owner?: string | null };
};

type LeadList = { data: RevenueLead[]; total: number; limit: number; offset: number; scope: string; asOf: string };

function asLeadList(payload: unknown): LeadList {
  if (Array.isArray(payload)) return { data: payload as RevenueLead[], total: payload.length, limit: payload.length, offset: 0, scope: "unknown", asOf: "" };
  if (payload && typeof payload === "object") {
    const result = payload as Partial<LeadList>;
    if (Array.isArray(result.data)) {
      return {
        data: result.data, total: Number(result.total ?? result.data.length),
        limit: Number(result.limit ?? 50), offset: Number(result.offset ?? 0),
        scope: String(result.scope ?? "unknown"), asOf: String(result.asOf ?? ""),
      };
    }
  }
  return { data: [], total: 0, limit: 50, offset: 0, scope: "unknown", asOf: "" };
}

export default function Leads() {
  const limit = 50;
  const [offset, setOffset] = useState(0);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["/api/revenue/leads", { limit, offset }],
    queryFn: async () => {
      const response = await fetch(`/api/revenue/leads?limit=${limit}&offset=${offset}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch leads");
      return response.json() as Promise<unknown>;
    },
  });
  const result = asLeadList(data);
  const leads = result.data;

  if (isError) return <DashboardErrorState title="Failed to load leads" onRetry={() => refetch()} />;

  return (
    <Card data-testid="revenue-leads-page">
      <div className="flex items-center justify-between border-b px-4 py-3 text-sm text-muted-foreground">
        <span>{result.total} lead{result.total === 1 ? "" : "s"} · {result.scope}</span>
        <div className="flex gap-2">
          <button className="rounded border px-3 py-1 disabled:opacity-50" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</button>
          <button className="rounded border px-3 py-1 disabled:opacity-50" disabled={offset + limit >= result.total} onClick={() => setOffset(offset + limit)}>Next</button>
        </div>
      </div>
      <CardContent className="p-0 overflow-x-auto">
        <Table className="min-w-[720px]">
          <TableHeader><TableRow>
            <TableHead>Lead</TableHead><TableHead>Company</TableHead><TableHead>Email</TableHead>
            <TableHead>Phone</TableHead><TableHead>Status</TableHead><TableHead>Owner</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading ? Array.from({ length: 5 }).map((_, index) => (
              <TableRow key={index}>{Array.from({ length: 6 }).map((__, cell) => (
                <TableCell key={cell}><Skeleton className="h-4 w-full" /></TableCell>
              ))}</TableRow>
            )) : leads.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground" data-testid="text-no-revenue-leads">No leads found</TableCell></TableRow>
            ) : leads.map((lead) => {
              const name = lead.name || [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "--";
              return <TableRow key={lead.id} data-testid={`row-revenue-lead-${lead.id}`}>
                <TableCell className="font-medium">{name}</TableCell>
                <TableCell>{lead.companyName || "--"}</TableCell>
                <TableCell>{lead.email ? <a className="text-blue-600 hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a> : "--"}</TableCell>
                <TableCell>{lead.phone ? <a className="text-blue-600 hover:underline" href={`tel:${lead.phone}`}>{lead.phone}</a> : "--"}</TableCell>
                <TableCell>{lead.primaryDeal?.stage || lead.status || lead.stage ? <Badge variant="outline">{lead.primaryDeal?.stage || lead.status || lead.stage}</Badge> : "--"}</TableCell>
                <TableCell>{lead.primaryDeal?.owner || lead.ownerName || lead.assignedTo || "--"}</TableCell>
              </TableRow>;
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}