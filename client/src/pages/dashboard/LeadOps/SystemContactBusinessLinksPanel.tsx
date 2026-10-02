import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const PATH = "/api/admin/contact-business-matches";

type LinkPreviewRow = {
  contactId: number;
  businessId: number | null;
  companyName: string | null;
  sourceLinkId: string | null;
  sourceEntityId: number | null;
  snapshotHash: string | null;
  reasons: string[];
  eligible: boolean;
  contactName?: string;
  contactEmail?: string;
  businessName?: string;
  businessWebsite?: string;
  businessLocation?: string;
  signals?: string[];
  contactPhone?: string;
  businessPhone?: string;
  matchBasis?: "corroborated" | "unique_company_name" | null;
};

type LinkPreview = {
  rows: LinkPreviewRow[];
  nextCursor: number | null;
  schemaReady: boolean;
  writes: 0;
  paidProviderCalls: 0;
};

export function SystemContactBusinessLinksPanel({ renderReview }: { renderReview: (contactId: number) => ReactNode }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<number[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [reviewRow, setReviewRow] = useState<LinkPreviewRow | null>(null);
  const preview = useQuery<LinkPreview>({
    queryKey: [PATH, "preview", cursor],
    queryFn: async () => (await apiRequest("GET", `${PATH}/preview?afterContactId=${cursor}&limit=25`)).json(),
    enabled: open,
    retry: false,
  });
  const chosen = (preview.data?.schemaReady ? preview.data.rows : []).filter((row) => selected.includes(row.contactId) && row.eligible
    && row.businessId != null && row.snapshotHash != null);
  const apply = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${PATH}/confirm`, {
      items: chosen.map((row) => ({
        contactId: row.contactId,
        businessId: row.businessId,
        snapshotHash: row.snapshotHash,
      })),
    })).json() as Promise<{ outcomes: Array<{ status: string; code?: string }> }>,
    onSuccess: (result) => {
      const applied = result.outcomes.filter((item) => item.status === "applied").length;
      const replayed = result.outcomes.filter((item) => item.status === "replayed").length;
      const rejected = result.outcomes.filter((item) => item.status === "rejected");
      toast({
        title: `${applied} link${applied === 1 ? "" : "s"} recorded${replayed ? ` · ${replayed} already recorded` : ""}`,
        description: rejected.length
          ? `${rejected.length} could not be saved: ${[...new Set(rejected.map(item => item.code))].join(", ")}. Refresh and inspect those records.`
          : "Email validation and outreach remain separate.",
        variant: rejected.length && applied === 0 && replayed === 0 ? "destructive" : "default",
      });
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: [PATH] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contact-business-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/pilot/status-overview"] });
      queryClient.invalidateQueries({
        predicate: query => String(query.queryKey[0]).startsWith("/api/lead-ops/businesses"),
      });
    },
    onError: (error: Error) => toast({ title: "Linking failed", description: error.message, variant: "destructive" }),
  });

  return (
    <Card data-testid="system-contact-business-links">
      <CardHeader>
        <CardTitle className="text-sm">Match contacts to companies</CardTitle>
        <CardDescription>
          A unique company-name match can be confirmed without a website, corporate email, or matching phone.
          Matching phones and domains strengthen and help disambiguate matches. Review the displayed records and
          confirm the association; conflicting or competing matches stay unresolved. Linking does not validate
          an email or authorize sending.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!open ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Find company matches</Button>
        ) : (
          <>
            {preview.isPending && <p role="status">Checking up to 25 contacts…</p>}
            {preview.isError && <p role="alert" className="text-destructive">Preview unavailable: {(preview.error as Error).message}</p>}
            {preview.data && (
              <>
                <p className="text-muted-foreground">Page after contact #{cursor} · {preview.data.rows.length} checked · no preview writes or paid calls</p>
                {!preview.data.schemaReady && (
                  <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2 text-amber-900">
                    Company matching is available for preview, but confirmation is unavailable in this environment.
                  </p>
                )}
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {preview.data.rows.map((row) => (
                    <div key={row.contactId} className="flex items-start gap-3 rounded border p-2">
                      <Checkbox
                        checked={selected.includes(row.contactId)}
                        disabled={!row.eligible || !preview.data.schemaReady || apply.isPending}
                        onCheckedChange={(checked) => setSelected((current) =>
                          checked === true ? [...current, row.contactId] : current.filter((id) => id !== row.contactId))}
                        aria-label={`Select contact ${row.contactId}`}
                      />
                      <span className="min-w-0 flex-1">
                        <Link href={`/dashboard/contacts/${row.contactId}`} className="font-medium underline">
                          {row.contactName || `Contact #${row.contactId}`}
                        </Link>
                        {row.companyName ? ` · ${row.companyName}` : ""}
                        {row.businessId ? <> → <Link href={`/dashboard/lead-ops/business/${row.businessId}`} className="underline">
                          {row.businessName || `Business #${row.businessId}`}
                        </Link></> : ""}
                        <span className="block text-xs">{row.contactEmail}</span>
                        {row.contactPhone && <span className="block text-xs">Contact phone: {row.contactPhone} · Company phone: {row.businessPhone || "Not stored"}</span>}
                        {row.businessId && <span className="block text-xs">{row.businessLocation || "Location not stored"} · {row.businessWebsite || "No website stored"}</span>}
                        <span className="block text-xs text-muted-foreground">
                          {row.eligible ? row.signals?.map(signal => signal.replaceAll("_", " ")).join(" + ")
                            : row.reasons.includes("multiple_corroborated_businesses") ? "More than one company matches — review required"
                            : row.reasons.includes("conflicting_company_identifiers") ? "Stored website or corporate email conflicts with the company — review required"
                            : "No company-name match found"}
                        </span>
                      </span>
                      {row.eligible ? <Badge variant="secondary">{row.matchBasis === "unique_company_name" ? "Confirm affiliation" : "Match found"}</Badge> : (
                        <Button size="sm" variant="outline" onClick={() => setReviewRow(row)}
                          aria-label={`Review contact ${row.contactId}`} data-testid={`review-system-link-${row.contactId}`}>
                          Review
                        </Button>
                      )}
                    </div>
                  ))}
                  {preview.data.rows.length === 0 && <p>No contacts on this page.</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={history.length === 0 || apply.isPending}
                    onClick={() => { setCursor(history[history.length - 1]); setHistory((items) => items.slice(0, -1)); setSelected([]); }}>
                    Previous page
                  </Button>
                  <Button size="sm" variant="outline" disabled={preview.data.nextCursor == null || apply.isPending}
                    onClick={() => { setHistory((items) => [...items, cursor]); setCursor(preview.data!.nextCursor!); setSelected([]); }}>
                    Next page
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" disabled={chosen.length === 0 || apply.isPending}>
                        Confirm {chosen.length} company {chosen.length === 1 ? "match" : "matches"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Confirm these company matches?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Your confirmation records these contact–company relationships. Matching identifiers are
                          rechecked before saving; changed or conflicting matches are rejected. No reason or source-event
                          ID is needed. This does not validate an email or enable outreach.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => apply.mutate()}>Confirm {chosen.length} matches</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
      <Dialog open={reviewRow !== null} onOpenChange={(value) => { if (!value) setReviewRow(null); }}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review contact #{reviewRow?.contactId} business association</DialogTitle>
            <DialogDescription>
              No unique company match was found. Open the contact to inspect its identifiers,
              or inspect any existing reconciliation suggestions below. No relationship is recorded by opening this dialog.
            </DialogDescription>
          </DialogHeader>
          {reviewRow && <>
            <p className="text-sm" role="status">{reviewRow.reasons.join(", ") || "Independent review required"}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild><Link href={`/dashboard/contacts/${reviewRow.contactId}`}>Open contact record</Link></Button>
              {reviewRow.businessId != null && <span className="text-sm">Candidate business #{reviewRow.businessId}</span>}
            </div>
            {renderReview(reviewRow.contactId)}
          </>}
        </DialogContent>
      </Dialog>
    </Card>
  );
}