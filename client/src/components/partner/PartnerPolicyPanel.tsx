import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CrmDataState } from "@/components/crm/CrmPresentation";
import { apiRequest, parseApiRequestError, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PolicyVersion {
  id: string; version: number; sharePercent: number; status: "draft" | "approved" | "revoked";
  scheduleReference: string; copyVersion: string; createdBy: string; approvedAt: string | null; revokedAt: string | null; createdAt: string;
}
interface PolicyResponse {
  published: { state: string } & Record<string, unknown>;
  versions: PolicyVersion[];
}

const POLICY_KEY = "/api/partner-policy";
const ERRORS: Record<string, string> = {
  INVALID_SHARE_PERCENT: "Enter the share as a whole number from 1 to 100.",
  INVALID_SCHEDULE_REFERENCE: "Enter the approved agreement or schedule reference.",
  INVALID_COPY_VERSION: "Enter the version name of the approved public wording (letters, numbers, . _ @ -).",
};

/**
 * Administrator control for the one published referral policy. A share reaches public pages only after an administrator
 * approves a draft that names the approved agreement and wording; approval is recorded against the signed-in user.
 * Nothing here is shown to non-administrators.
 */
export function PartnerPolicyPanel() {
  const { toast } = useToast();
  const query = useQuery<PolicyResponse>({ queryKey: [POLICY_KEY], staleTime: 0 });
  const [share, setShare] = useState("");
  const [schedule, setSchedule] = useState("");
  const [copyVersion, setCopyVersion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: "approve" | "revoke" } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: [POLICY_KEY] });
  const onError = (err: Error) => {
    const { code } = parseApiRequestError(err.message);
    setConfirm(null);
    setError((code && ERRORS[code]) || "That change could not be saved. Nothing was changed.");
  };

  const createDraft = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `${POLICY_KEY}/drafts`, {
        sharePercent: /^\d{1,3}$/.test(share.trim()) ? Number(share.trim()) : null,
        scheduleReference: schedule.trim(),
        copyVersion: copyVersion.trim(),
      });
      return res.json();
    },
    onSuccess: () => { setShare(""); setSchedule(""); setCopyVersion(""); setError(null); toast({ title: "Draft saved. It is not public until approved." }); void refresh(); },
    onError,
  });
  const change = useMutation({
    mutationFn: async (input: { id: string; action: "approve" | "revoke" }) => {
      const res = await apiRequest("POST", `${POLICY_KEY}/${input.id}/${input.action}`);
      return res.json();
    },
    onSuccess: (_data, input) => { setConfirm(null); setError(null); toast({ title: input.action === "approve" ? "Policy approved and now published" : "Policy revoked" }); void refresh(); },
    onError,
  });

  const published = query.data?.versions.find((v) => v.status === "approved");

  return (
    <Card data-testid="partner-policy-panel">
      <CardHeader><CardTitle className="text-lg">Published referral policy</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Public pages show a referral share only after an administrator approves it here against a signed agreement. With no approved policy, public pages say the terms are set in a written agreement.
        </p>
        {query.isLoading ? <CrmDataState state="loading" /> : query.isError || !query.data ? (
          <CrmDataState state="unavailable" message="The policy could not be loaded." onRetry={() => void query.refetch()} />
        ) : (
          <>
            <p className="text-sm" data-testid="policy-published-state">
              {published ? `Published: version ${published.version} (${published.sharePercent}%), reference ${published.scheduleReference}.` : "Nothing is published. Public pages use the written-agreement wording."}
            </p>
            {query.data.versions.length > 0 ? (
              <ul className="divide-y divide-border rounded-md border" data-testid="policy-versions">
                {query.data.versions.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">Version {v.version} · {v.sharePercent}% <Badge variant={v.status === "approved" ? "default" : "outline"}>{v.status}</Badge></p>
                      <p className="break-words text-xs text-muted-foreground">{v.scheduleReference} · wording {v.copyVersion}</p>
                    </div>
                    {confirm?.id === v.id ? (
                      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm policy change">
                        <span className="text-sm">{confirm.action === "approve" ? "Publish this share on public pages?" : "Remove this share from public pages?"}</span>
                        <Button className="min-h-11" disabled={change.isPending} onClick={() => change.mutate(confirm)} data-testid={`policy-confirm-${v.id}`}>Confirm</Button>
                        <Button variant="outline" className="min-h-11" onClick={() => setConfirm(null)}>Back</Button>
                      </div>
                    ) : v.status === "draft" ? (
                      <Button variant="outline" className="min-h-11" onClick={() => setConfirm({ id: v.id, action: "approve" })} data-testid={`policy-approve-${v.id}`}>Approve</Button>
                    ) : v.status === "approved" ? (
                      <Button variant="outline" className="min-h-11" onClick={() => setConfirm({ id: v.id, action: "revoke" })} data-testid={`policy-revoke-${v.id}`}>Revoke</Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <form className="grid grid-cols-1 gap-3 sm:grid-cols-3" noValidate aria-label="New policy draft"
              onSubmit={(e) => { e.preventDefault(); setError(null); createDraft.mutate(); }}>
              <label className="text-xs text-muted-foreground">Share percentage
                <Input inputMode="numeric" className="min-h-11" value={share} onChange={(e) => setShare(e.target.value)} data-testid="policy-share-input" />
              </label>
              <label className="text-xs text-muted-foreground">Agreement or schedule reference
                <Input className="min-h-11" maxLength={200} value={schedule} onChange={(e) => setSchedule(e.target.value)} data-testid="policy-schedule-input" />
              </label>
              <label className="text-xs text-muted-foreground">Approved wording version
                <Input className="min-h-11" maxLength={60} value={copyVersion} onChange={(e) => setCopyVersion(e.target.value)} data-testid="policy-copy-input" />
              </label>
              <div className="sm:col-span-3">
                <Button type="submit" className="min-h-11" disabled={createDraft.isPending} data-testid="policy-create-draft">{createDraft.isPending ? "Saving..." : "Save draft"}</Button>
              </div>
            </form>
            {error ? <p role="alert" className="text-sm text-destructive" data-testid="policy-error">{error}</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
