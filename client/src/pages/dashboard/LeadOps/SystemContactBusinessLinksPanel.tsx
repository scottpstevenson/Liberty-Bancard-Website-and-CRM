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

const PATH = "/api/admin/contact-business-system-links";

type LinkPreviewRow = {
  contactId: number;
  businessId: number | null;
  companyName: string | null;
  sourceLinkId: string | null;
  sourceEntityId: number | null;
  snapshotHash: string | null;
  reasons: string[];
  eligible: boolean;
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
    && row.businessId != null && row.sourceLinkId != null && row.sourceEntityId != null && row.snapshotHash != null);
  const apply = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${PATH}/apply`, {
      items: chosen.map((row) => ({
        contactId: row.contactId,
        businessId: row.businessId,
        sourceLinkId: row.sourceLinkId,
        sourceEntityId: row.sourceEntityId,
        snapshotHash: row.snapshotHash,
      })),
    })).json() as Promise<{ outcomes: Array<{ status: string; code?: string }> }>,
    onSuccess: (result) => {
      const applied = result.outcomes.filter((item) => item.status === "applied").length;
      toast({ title: `${applied} link${applied === 1 ? "" : "s"} recorded`, description: "Email validation and outreach remain separate." });
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: [PATH] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/contact-business-suggestions"] });
    },
    onError: (error: Error) => toast({ title: "Linking failed", description: error.message, variant: "destructive" }),
  });

  return (
    <Card data-testid="system-contact-business-links">
      <CardHeader>
        <CardTitle className="text-sm">Strict contact–business links</CardTitle>
        <CardDescription>
          Preview a bounded page of unlinked contacts. Only independent Sunbiz source evidence plus a unique
          domain, exact company name, matching website, and corporate email domain can qualify. This does not
          validate an email, authorize a message, or link ambiguous records.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!open ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Preview eligible links</Button>
        ) : (
          <>
            {preview.isPending && <p role="status">Checking up to 25 contacts…</p>}
            {preview.isError && <p role="alert" className="text-destructive">Preview unavailable: {(preview.error as Error).message}</p>}
            {preview.data && (
              <>
                <p className="text-muted-foreground">Page after contact #{cursor} · {preview.data.rows.length} checked · no preview writes or paid calls</p>
                {!preview.data.schemaReady && (
                  <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2 text-amber-900">
                    Preview only: the SFP contact-source constraints and system-link triggers are not installed here.
                    Link writes remain disabled until the published database passes the schema checks.
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
                        <span className="font-medium">Contact #{row.contactId}</span>
                        {row.companyName ? ` · ${row.companyName}` : ""}
                        {row.businessId ? ` → business #${row.businessId}` : ""}
                        <span className="block text-xs text-muted-foreground">
                          {row.eligible ? "Independent source and identity checks passed" : row.reasons.join(", ") || "Requires review"}
                        </span>
                      </span>
                      {row.eligible ? <Badge variant="secondary">Eligible</Badge> : (
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
                        Record {chosen.length} verified {chosen.length === 1 ? "link" : "links"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Record these system-verified links?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The server will recheck every source and identity fact before writing. Stale or conflicting
                          rows will be rejected. This does not validate an address or enable outreach.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => apply.mutate()}>Record {chosen.length} links</AlertDialogAction>
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
              Automatic linking did not pass its identity checks. Review the contact and existing candidate evidence below.
              An independent evidence event is required to record a human decision; opening this review does not verify a link or authorize outreach.
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