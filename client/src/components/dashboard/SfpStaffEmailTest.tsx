import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, parseApiRequestError } from "@/lib/queryClient";
import { EmailPreviewContent } from "@/components/EmailPreviewModal";

const root = "/api/canonical-enrichment/seed-test";
const pauseRequired = "Keep global outbound paused to run this test.";

interface TestStatus {
  authorization: { mailbox: string } | null;
  blockedBecause: string | null;
  outboundPause: { reasonCode: string; seedLease: { eligible: boolean } };
  deliveryRedirectActive: boolean;
  receipts: TestReceipt[];
}

interface TestReceipt {
  idempotencyKey: string;
  occurrenceId: string;
  packageKey: string;
  stepOrder: number;
  state: "claimed" | "sending" | "sent" | "unsent" | "uncertain";
  claimedAt: string;
  finishedAt: string | null;
  replyReceivedAt?: string;
}

interface TestPreview {
  mailbox: string;
  fromAddress: string;
  subject: string;
  html: string;
  previewHash: string;
  packageKey: string;
  stepOrder: number;
  blockedBecause: string | null;
  outboundPause: TestStatus["outboundPause"];
  unresolvedPlaceholders: string[];
}

interface TestPackage {
  packageKey: string;
  vertical: string;
  steps: { stepOrder: number }[];
}

const receiptLabels: Record<TestReceipt["state"], string> = {
  claimed: "Preparing",
  sending: "Sending",
  sent: "Sent",
  unsent: "Unsent",
  uncertain: "Delivery unconfirmed",
};

function formatTime(value: string) {
  return new Date(value).toLocaleString();
}

function describeError(error: Error) {
  const { code } = parseApiRequestError(error.message);
  if (code === "SEED_MAILBOX_IS_A_CONTACT") return "Use a staff mailbox that is outside the CRM’s contact list.";
  if (code === "SEED_PREVIEW_CHANGED") return "The message or authorization changed. Prepare a fresh preview.";
  if (code === "SEED_MESSAGE_LIMIT_REACHED") return "The authorization’s one-message limit has been reached. Check the receipt.";
  if (code) return `The CRM blocked this step (${code}).`;
  return error.message.startsWith("4") || error.message.startsWith("5")
    ? "The CRM couldn’t confirm this step. Check the receipt before trying again."
    : error.message;
}

export function SfpStaffEmailTest() {
  const [mailbox, setMailbox] = useState("");
  const [selection, setSelection] = useState("");
  const [prepared, setPrepared] = useState<{ preview: TestPreview; idempotencyKey: string } | null>(null);
  const status = useQuery<TestStatus>({
    queryKey: [`${root}/status`],
    staleTime: 0,
    refetchInterval: 10_000,
  });
  const catalog = useQuery<{ packages: TestPackage[] }>({
    queryKey: [`${root}/rendering`],
    staleTime: 60_000,
  });
  const options = catalog.data?.packages.flatMap(pkg => pkg.steps.map(step => ({
    value: `${pkg.packageKey}:${step.stepOrder}`,
    label: `${pkg.vertical} · Email ${step.stepOrder}`,
    packageKey: pkg.packageKey,
    stepOrder: step.stepOrder,
  }))) ?? [];
  const activeOption = options.find(option => option.value === selection) ?? options[0];
  const activeAuthorization = status.data?.authorization && !status.data.blockedBecause
    ? status.data.authorization : null;
  const target = activeAuthorization?.mailbox ?? mailbox.trim();
  const paused = status.data?.outboundPause.reasonCode === "global_paused";
  const ready = paused && status.data?.outboundPause.seedLease.eligible && !status.data.deliveryRedirectActive;
  const receipt = status.data?.receipts.find(item => item.idempotencyKey === prepared?.idempotencyKey);

  const prepare = useMutation({
    mutationFn: async ({ email, packageKey, stepOrder }: {
      email: string; packageKey: string; stepOrder: number;
    }) => {
      const { data: current } = await status.refetch();
      if (!current || current.outboundPause.reasonCode !== "global_paused" || !current.outboundPause.seedLease.eligible) {
        throw new Error(pauseRequired);
      }
      if (current.deliveryRedirectActive) throw new Error("A delivery redirect is active. This test is blocked.");
      if (!current.authorization || current.blockedBecause) {
        await apiRequest("POST", `${root}/authorize`, { mailbox: email, expiresInHours: 1, maxMessages: 1 });
      } else if (current.authorization.mailbox.toLowerCase() !== email || current.authorization.mailbox !== activeAuthorization?.mailbox) {
        throw new Error("Another staff test is authorized. Refresh the receipt before continuing.");
      }
      const response = await apiRequest("POST", `${root}/send/preview`, { packageKey, stepOrder });
      const preview: TestPreview = await response.json();
      if (preview.mailbox.toLowerCase() !== email) throw new Error("The authorized mailbox changed. Prepare a fresh preview.");
      return { preview, idempotencyKey: crypto.randomUUID() };
    },
    onSuccess: setPrepared,
    onSettled: () => { void status.refetch(); },
  });

  const send = useMutation({
    mutationFn: async ({ preview, idempotencyKey }: NonNullable<typeof prepared>) => {
      const { data: current } = await status.refetch();
      if (!current || current.outboundPause.reasonCode !== "global_paused" || !current.outboundPause.seedLease.eligible) {
        throw new Error(pauseRequired);
      }
      if (current.deliveryRedirectActive) throw new Error("A delivery redirect is active. This test is blocked.");
      const response = await apiRequest("POST", `${root}/send`, {
        packageKey: preview.packageKey,
        stepOrder: preview.stepOrder,
        previewHash: preview.previewHash,
      }, { "Idempotency-Key": idempotencyKey });
      return (await response.json()) as { receipt: Omit<TestReceipt, "idempotencyKey"> };
    },
    onSettled: () => { void status.refetch(); },
  });

  const preview = prepared?.preview;
  const canSend = ready && preview?.outboundPause.seedLease.eligible
    && preview.outboundPause.reasonCode === "global_paused" && !preview.blockedBecause
    && preview.unresolvedPlaceholders.length === 0 && activeAuthorization?.mailbox === preview.mailbox;
  const busy = prepare.isPending || send.isPending;
  const lastAttempt = receipt ?? send.data?.receipt;

  return (
    <Card className="mb-5 border-border/70" data-testid="sfp-staff-email-test">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MailCheck aria-hidden="true" className="h-5 w-5 text-primary" />
            Staff email test
          </CardTitle>
          {paused && <Badge variant="outline">Outbound paused</Badge>}
        </div>
        <CardDescription>Preview and send one SFP email to a staff-owned mailbox, then check its reply receipt.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {(status.isError || catalog.isError) && <p role="alert" className="text-sm text-destructive">The test controls couldn’t load. Refresh the test status.</p>}
        {status.data?.deliveryRedirectActive && <p role="alert" className="text-sm">A delivery redirect is active. This test is blocked.</p>}
        {status.data && !paused && <p role="alert" className="text-sm">{pauseRequired}</p>}
        <form className="space-y-3" onSubmit={event => {
          event.preventDefault();
          if (!ready || !activeOption || !target || busy || preview) return;
          send.reset();
          prepare.mutate({ email: target.toLowerCase(), packageKey: activeOption.packageKey, stepOrder: activeOption.stepOrder });
        }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sfp-test-mailbox">Staff mailbox</Label>
              <Input id="sfp-test-mailbox" type="email" autoComplete="off" maxLength={254}
                value={target} placeholder="name@company.com" required
                readOnly={Boolean(activeAuthorization || preview)} disabled={busy}
                onChange={event => setMailbox(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sfp-test-step">Template</Label>
              <select id="sfp-test-step" value={activeOption?.value ?? ""} disabled={busy || Boolean(preview) || !options.length}
                onChange={event => setSelection(event.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {!options.length && <option value="">No current email templates</option>}
                {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="outline" disabled={busy || !ready || !activeOption || !target || Boolean(preview)}>
              {prepare.isPending ? "Preparing…" : "Prepare test preview"}
            </Button>
            <Button type="button" variant="ghost" disabled={status.isFetching} onClick={() => {
              void status.refetch();
              void catalog.refetch();
            }}>
              Refresh test status
            </Button>
          </div>
        </form>
        {prepare.error && <p role="alert" className="text-sm text-destructive">{describeError(prepare.error)}</p>}

        {preview && (
          <section aria-label="Staff test preview" className="space-y-3 rounded-lg border bg-muted/25 p-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">From and Reply-To</dt><dd className="break-all font-medium">{preview.fromAddress}</dd></div>
              <div><dt className="text-muted-foreground">To</dt><dd className="break-all font-medium">{preview.mailbox}</dd></div>
            </dl>
            <EmailPreviewContent subject={preview.subject} body={preview.html} showComplianceNotice={false} />
            <p className="text-xs text-muted-foreground">The mailer adds the compliance footer and a test unsubscribe link when you send.</p>
            {preview.unresolvedPlaceholders.length > 0 && <p role="alert" className="text-sm text-destructive">This template has unresolved fields. Choose another template.</p>}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !canSend || Boolean(lastAttempt) || send.isError}
                onClick={() => { if (prepared && canSend) send.mutate(prepared); }}>
                {send.isPending ? "Sending…" : "Send one staff email"}
              </Button>
              <Button variant="ghost" disabled={busy || send.isError || lastAttempt?.state === "uncertain"
                || lastAttempt?.state === "claimed" || lastAttempt?.state === "sending"} onClick={() => {
                setPrepared(null);
                send.reset();
              }}>Close preview</Button>
            </div>
            {send.error && <p role="alert" className="text-sm text-destructive">{describeError(send.error)} Check recent receipts for this attempt.</p>}
          </section>
        )}

        <section aria-label="Recent staff test receipts" className="space-y-2 border-t pt-4">
          <h3 className="text-sm font-semibold">Recent test receipts</h3>
          {!status.data?.receipts.length && <p className="text-sm text-muted-foreground">{status.isPending ? "Loading receipts…" : "No staff test receipts available."}</p>}
          {status.data?.receipts.slice(0, 5).map(item => (
            <div key={item.idempotencyKey} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3 text-sm">
              <div className="min-w-0 space-y-1">
                <p>{formatTime(item.finishedAt ?? item.claimedAt)} · Email {item.stepOrder}</p>
                <p className="break-all text-xs text-muted-foreground">Receipt {item.occurrenceId}</p>
                {item.replyReceivedAt && <p className="text-xs text-muted-foreground">Reply received {formatTime(item.replyReceivedAt)}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{receiptLabels[item.state]}</Badge>
                {item.replyReceivedAt && <Badge>Reply tracked</Badge>}
                {!item.replyReceivedAt && item.state === "sent" && <Badge variant="secondary">Waiting for reply</Badge>}
              </div>
            </div>
          ))}
        </section>
      </CardContent>
    </Card>
  );
}
