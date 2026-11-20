import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type Status = {
  implemented: boolean;
  credentialsConfigured: boolean;
  mappingsConfigured: boolean;
  uploadsEnabled: boolean;
  encryptionAvailable: boolean;
  acceptance: string;
  states: { state: string; count: number }[];
  recent: {
    id: string;
    kind: string;
    deal_id: number;
    state: string;
    provider_status: string | null;
    last_error: string | null;
  }[];
};
export function GoogleOfflineConversionsPanel() {
  const [dealId, setDealId] = useState(""),
    [expectedStage, setExpectedStage] = useState(""),
    [reason, setReason] = useState(""),
    [feedback, setFeedback] = useState("");
  const { data, error } = useQuery<Status>({
    queryKey: ["/api/acquisition/offline-conversions/status"],
    refetchInterval: 30_000,
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["/api/acquisition/offline-conversions/status"],
    });
  const qualify = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        "/api/acquisition/offline-conversions/qualify",
        {
          dealId: Number(dealId),
          expectedStage,
          reason,
          confirm: "RECORD REVIEWED QUALIFIED LEAD",
        },
      );
      return response.json();
    },
    onSuccess: (r) => {
      setFeedback(
        `Qualification retained for deal ${r.deal_id}; delivery state: ${r.state}.`,
      );
      void refresh();
    },
    onError: () =>
      setFeedback(
        "Qualification was not recorded. Verify the deal, exact current stage and its consented website intake; your role must permit review.",
      ),
  });
  const process = useMutation({
    mutationFn: async (mode: "validate" | "send") => {
      const r = await apiRequest(
        "POST",
        "/api/acquisition/offline-conversions/process",
        {
          mode,
          confirm:
            mode === "send"
              ? "UPLOAD CONSENTED CRM OUTCOMES"
              : "VALIDATE CONSENTED CRM OUTCOMES",
        },
      );
      return r.json();
    },
    onSuccess: (r) => {
      setFeedback(
        r.held
          ? `Held: ${r.held}`
          : `Processed ${r.processed} items. Check each retained provider status below.`,
      );
      void refresh();
    },
    onError: () =>
      setFeedback(
        "Processing unavailable. An administrator must review the connection and retained status before retrying.",
      ),
  });
  if (error)
    return (
      <p role="status">
        Offline measurement status unavailable for this session. Administrator
        or manager access is required.
      </p>
    );
  if (!data) return <p>Loading offline measurement…</p>;
  const configured =
    data.credentialsConfigured &&
    data.mappingsConfigured &&
    data.encryptionAvailable;
  return (
    <Card data-testid="google-offline-measurement">
      <CardHeader>
        <CardTitle>Google CRM outcome measurement</CardTitle>
        <CardDescription>
          Reviewed qualification and Closed Won are separate from website form
          conversions. This panel processes the account-wide pending queue; report filters do not select uploads. It does not enable campaigns or customer messaging.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Badge variant={configured ? "default" : "secondary"}>
            {configured
              ? "Configuration present; provider receipt required"
              : "Connection setup required"}
          </Badge>
          <Badge variant="outline">
            Uploads {data.uploadsEnabled ? "opted in" : "off"}
          </Badge>
          <Badge variant="outline">
            Credentials {data.credentialsConfigured ? "present" : "missing"}
          </Badge>
          <Badge variant="outline">
            Action mapping {data.mappingsConfigured ? "configured" : "missing"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {data.acceptance} Only separately consented, occurrence-bound click
          IDs are eligible. No contact details or revenue estimates are
          uploaded.
        </p>
        <div className="flex flex-wrap gap-3">
          {data.states.map((s) => (
            <Badge key={s.state} variant="outline">
              {s.state}: {s.count}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={!configured || process.isPending}
            onClick={() => process.mutate("validate")}
          >
            Validate pending payloads
          </Button>
          <Button
            disabled={!configured || !data.uploadsEnabled || process.isPending}
            onClick={() => process.mutate("send")}
          >
            Process eligible CRM outcomes
          </Button>
        </div>
        <fieldset className="grid gap-3 rounded-lg border p-4">
          <legend className="px-1 font-medium">
            Record a staff-reviewed qualified lead
          </legend>
          <p className="text-sm text-muted-foreground">
            After reviewing the actual sales opportunity, record your decision
            and reason. Enrichment scores alone do not qualify a lead. The
            deal’s current stage and consented website occurrence must match.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="offline-deal">Deal ID</Label>
              <Input
                id="offline-deal"
                type="number"
                min="1"
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="offline-stage">Exact current CRM stage</Label>
              <Input
                id="offline-stage"
                value={expectedStage}
                onChange={(e) => setExpectedStage(e.target.value)}
              />
            </div>
          </div>
          <Label htmlFor="offline-reason">Qualification reason</Label>
          <Textarea
            id="offline-reason"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={
              !Number.isInteger(Number(dealId)) ||
              Number(dealId) < 1 ||
              !expectedStage ||
              reason.trim().length < 10 ||
              qualify.isPending
            }
            onClick={() => qualify.mutate()}
          >
            Record reviewed qualification
          </Button>
        </fieldset>
        {feedback && (
          <p role="status" className="text-sm">
            {feedback}
          </p>
        )}
        <div className="space-y-2">
          {data.recent.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap justify-between gap-2 border-b py-2 text-sm"
            >
              <span>
                Deal {r.deal_id} · {r.kind.replaceAll("_", " ")}
              </span>
              <span>
                {r.state}
                {r.provider_status ? ` · ${r.provider_status}` : ""}
                {r.last_error ? ` · ${r.last_error}` : ""}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
