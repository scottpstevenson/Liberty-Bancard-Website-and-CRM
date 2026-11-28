import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { ReleaseRecipientReview, type ReleaseReviewRecipient } from "./ReleaseRecipientReview";

interface RefreshReceipt {
  enrollmentId: number;
  refreshed: boolean;
  reviewRecipient: ReleaseReviewRecipient | null;
  subject: string | null;
  reason: string | null;
  audit: "recorded" | "failed" | null;
}

function parseEnrollmentIds(value: string) {
  const tokens = value.trim().split(/[\s,]+/).filter(Boolean);
  const ids = tokens.map(Number);
  if (tokens.length > 50 || tokens.some((token, i) => !/^[1-9]\d*$/.test(token) || ids[i] > 2147483647) ||
    new Set(ids).size !== ids.length) return null;
  return ids;
}

export function TargetedHeldRefresh({ onStart }: { onStart: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<RefreshReceipt[]>([]);
  const ids = parseEnrollmentIds(value);

  async function refresh(enrollmentIds: number[]) {
    onStart();
    setResults([]);
    setBusy(true);
    try {
      for (let offset = 0; offset < enrollmentIds.length; offset += 2) {
        const receipts = await Promise.all(enrollmentIds.slice(offset, offset + 2).map(async enrollmentId => {
          try {
            return (await apiRequest("POST", "/api/canonical-enrichment/release/refresh-held", { enrollmentId })).json() as Promise<RefreshReceipt>;
          } catch (error) {
            const pause = error instanceof Error && error.message.startsWith("409:");
            return { enrollmentId, refreshed: false, reviewRecipient: null, subject: null, audit: null,
              reason: pause ? "Outbound must be paused." : "Could not confirm refresh. Retry to verify the current version." };
          }
        }));
        setResults(previous => [...previous, ...receipts]);
      }
    } finally {
      setBusy(false);
    }
  }

  const verified = results.flatMap(r => r.reviewRecipient ? [r.reviewRecipient] : []);
  const subjects = new Map(results.flatMap(r => r.subject === null ? [] : [[r.enrollmentId, r.subject] as const]));
  return <details className="mt-4 rounded-md border p-3" data-testid="targeted-held-refresh">
    <summary className="cursor-pointer text-sm font-semibold">Refresh specific held recipients</summary>
    <p className="mt-2 text-sm text-muted-foreground">Enter up to 50 enrollment IDs to refresh and verify their published email previews. Recipients stay held.</p>
    <label className="mt-2 block text-sm">
      Enrollment IDs
      <Textarea className="mt-1" rows={3} maxLength={560} value={value} disabled={busy} onChange={e => { setValue(e.target.value); setResults([]); }} />
    </label>
    {!ids && <p role="alert" className="mt-1 text-sm text-destructive">Enter up to 50 unique enrollment IDs, separated by commas or spaces.</p>}
    <Button className="mt-2" variant="outline" size="sm" disabled={busy || !ids?.length} onClick={() => { if (ids?.length) void refresh(ids); }}>
      {busy ? "Refreshing held recipients…" : "Refresh and verify"}
    </Button>
    {(busy || results.length > 0) && <p className="mt-2 text-sm" role="status">
      {results.length} of {ids?.length ?? 0} checked. {verified.length} verified on current copy. {results.filter(r => r.refreshed).length} refreshed.
    </p>}
    {results.some(r => r.reason || r.audit === "failed") && <ul className="mt-2 space-y-1 text-sm">
      {results.filter(r => r.reason || r.audit === "failed").map(r => <li key={r.enrollmentId}>
        Enrollment {r.enrollmentId} — {r.reason ?? "Verified"}{r.audit === "failed" ? " · Audit record unavailable" : ""}
      </li>)}
    </ul>}
    <ReleaseRecipientReview recipients={verified} verifiedSubjects={subjects} />
  </details>;
}
