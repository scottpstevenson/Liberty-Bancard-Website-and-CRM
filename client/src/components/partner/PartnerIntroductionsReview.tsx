import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CrmDataState, CrmDataTable, type CrmDataColumn } from "@/components/crm/CrmPresentation";
import { useUrlParam } from "@/hooks/use-url-param";

interface Row {
  id: string; partnerId: number; partnerName: string; businessName: string; contactName: string;
  reviewState: string; reviewReason: string | null; contactId: number | null; referralId: number | null;
  permissionVersion: string; permissionConfirmedAt: string; createdAt: string;
}
interface Response { rows: Row[]; total: number; page: number; pageSize: number }

const STATES = [
  { value: "all", label: "All review states" },
  { value: "pending_review", label: "Pending review" },
  { value: "duplicate_review", label: "Duplicate review" },
  { value: "competing_referrer", label: "Competing referrer" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
];
const LABEL: Record<string, string> = Object.fromEntries(STATES.filter((s) => s.value !== "all").map((s) => [s.value, s.label]));
const fmt = (iso: string) => new Date(iso).toLocaleString();

/**
 * Read-only staff list of partner introductions. A duplicate or competing referrer is an explicit review state: nothing
 * here moves attribution, merges a company or creates an entitlement. Contact details are not part of this list.
 */
export function PartnerIntroductionsReview() {
  const [state, setState] = useUrlParam("introState", "all", (raw) => (STATES.some((s) => s.value === raw) ? raw : undefined), { history: "replace" });
  const [page, setPage] = useUrlParam("introPage", 1, (raw) => (/^\d{1,4}$/.test(raw) && Number(raw) >= 1 ? Number(raw) : undefined), { history: "replace" });
  const params = new URLSearchParams();
  if (state !== "all") params.set("reviewState", state);
  params.set("page", String(page));
  params.set("pageSize", "25");
  const key = `/api/partner-introductions?${params.toString()}`;
  const query = useQuery<Response>({ queryKey: [key], staleTime: 0 });
  const data = query.data;

  const columns: CrmDataColumn<Row>[] = [
    { id: "submitted", label: "Submitted", render: (r) => fmt(r.createdAt) },
    { id: "business", label: "Business", render: (r) => <span className="font-medium">{r.businessName}</span> },
    { id: "contact", label: "Contact", render: (r) => r.contactName },
    { id: "partner", label: "Introduced by", render: (r) => r.partnerName },
    { id: "state", label: "Review state", render: (r) => <Badge variant={r.reviewState === "pending_review" ? "secondary" : "outline"}>{LABEL[r.reviewState] ?? r.reviewState}</Badge> },
    { id: "reason", label: "Reason", render: (r) => r.reviewReason ?? "—" },
    { id: "links", label: "Linked records", render: (r) => [r.contactId ? `Contact #${r.contactId}` : null, r.referralId ? `Referral #${r.referralId}` : null].filter(Boolean).join(" · ") || "None" },
    { id: "permission", label: "Introducer permission", render: (r) => `${r.permissionVersion}, ${fmt(r.permissionConfirmedAt)}` },
  ];

  return (
    <Card data-testid="partner-introductions-review">
      <CardHeader><CardTitle className="text-lg">Introductions</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Businesses introduced by approved partners. The permission shown is the partner's statement that the contact agreed to be introduced; it is not the business's own marketing consent.
        </p>
        <label className="block max-w-xs text-xs text-muted-foreground">Review state
          <select className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={state}
            onChange={(e) => { setState(e.target.value); setPage(1); }} data-testid="filter-introduction-state">
            {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        {query.isLoading ? <CrmDataState state="loading" /> : query.isError || !data ? (
          <CrmDataState state="unavailable" message="Introductions could not be loaded." onRetry={() => void query.refetch()} />
        ) : data.rows.length === 0 ? (
          <CrmDataState state={state === "all" ? "empty" : "no-match"} message={state === "all" ? "No introductions have been submitted yet." : undefined} />
        ) : (
          <CrmDataTable<Row>
            testId="introductions-table"
            rows={data.rows}
            columns={columns}
            page={data.page}
            pageSize={25}
            total={data.total}
            totalAvailability="known"
            hasPrevious={data.page > 1}
            hasNext={data.page * data.pageSize < data.total}
            onPageChange={setPage}
            mobileCard={(r) => (
              <div className="space-y-1 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{r.businessName}</span>
                  <Badge variant="outline">{LABEL[r.reviewState] ?? r.reviewState}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{r.contactName} · introduced by {r.partnerName}</p>
                <p className="text-xs text-muted-foreground">Submitted {fmt(r.createdAt)}</p>
                {r.reviewReason ? <p className="text-xs text-muted-foreground">{r.reviewReason}</p> : null}
              </div>
            )}
          />
        )}
      </CardContent>
    </Card>
  );
}
