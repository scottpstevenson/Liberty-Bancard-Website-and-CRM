import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getApiErrorMessage } from "@/lib/ghlTruth";
import { useToast } from "@/hooks/use-toast";
import { FinalEmailPreview, type FinalMessagePreview } from "./MessageFinalPreview";
import { useInlinedPreviewHtml } from "@/lib/email-preview-assets";
import type { MessageTemplate, MessageTemplateVersion } from "@shared/schema";

interface Finding { rule: string; match: string; why: string }
interface Workspace {
  template: MessageTemplate;
  draft: MessageTemplateVersion | null;
  /** Identity of the saved draft (null = none). Save, discard and publish send the one this editor last loaded. */
  draftToken: string | null;
  history: MessageTemplateVersion[];
  liveFindings: Finding[];
  draftFindings: Finding[];
}
interface Preview { subject: string; html: string; unresolved: string[]; findings: Finding[]; note: string; final?: FinalMessagePreview | null }

const LIST_KEY = ["/api/message-templates"];
const wsKey = (id: number) => [`/api/message-templates/${id}/workspace`];

function findingsFromError(e: unknown): Finding[] {
  const raw = e instanceof Error ? e.message : "";
  const start = raw.indexOf("{");
  if (start < 0) return [];
  try {
    const body = JSON.parse(raw.slice(start));
    return Array.isArray(body.findings) ? body.findings : [];
  } catch { return []; }
}

interface DraftConflict { hasDraft: boolean; draftToken: string | null; baseVersion: number | null; authorId: string | null; updatedAt: string | null; liveVersion: number }

function conflictFromError(e: unknown): DraftConflict | null {
  const raw = e instanceof Error ? e.message : "";
  if (!raw.startsWith("409")) return null;
  const start = raw.indexOf("{");
  if (start < 0) return null;
  try { return (JSON.parse(raw.slice(start)).conflict as DraftConflict | undefined) ?? null; } catch { return null; }
}

function FindingList({ findings, testId }: { findings: Finding[]; testId: string }) {
  if (findings.length === 0) return null;
  return (
    <Alert variant="destructive" data-testid={testId}>
      <AlertDescription>
        <p className="font-medium mb-1">This wording cannot be sent as written:</p>
        <ul className="list-disc pl-5 space-y-0.5 text-sm">
          {findings.map((f) => <li key={`${f.rule}:${f.match}`}><code>{f.match}</code> - {f.why}</li>)}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function SandboxedEmail({ html, title, tall }: { html: string; title: string; tall?: boolean }) {
  // Empty sandbox: no scripts, forms, navigation or same-origin access for the previewed markup. The logo is swapped for
  // an inline copy of the same image for DISPLAY only; the HTML that is sent is not touched.
  const shown = useInlinedPreviewHtml(html);
  return (
    <iframe
      title={title}
      sandbox=""
      srcDoc={shown}
      className={`w-full rounded-md border bg-white ${tall ? "h-[70vh] min-h-[24rem]" : "h-64"}`}
      data-testid="sandboxed-email-frame"
    />
  );
}

export function MessageTemplateEditor({
  templateId, canEdit, canActivate, onClose,
}: { templateId: number | null; canEdit: boolean; canActivate: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const open = templateId !== null;
  const { data: ws, isLoading, isError, error } = useQuery<Workspace>({
    queryKey: wsKey(templateId ?? 0),
    enabled: open && canEdit,
  });

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [seeded, setSeeded] = useState<string | null>(null);
  const [publishFindings, setPublishFindings] = useState<Finding[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  // The draft identity the fields were seeded from. Commands send this, never the freshest server value, so a draft
  // saved by someone else is refused with a conflict instead of being replaced.
  const [baseToken, setBaseToken] = useState<string | null>(null);
  // Everything the fields were seeded from: the asset, the live (parent) version, the draft identity and its author. Commands
  // send these, never the freshest query values, so a parent that moved after the fields were loaded is refused rather
  // than silently rebased onto text that was written against the older version.
  const [seedParent, setSeedParent] = useState<number | null>(null);
  const [seedActor, setSeedActor] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const dirtyRef = useRef(false);
  // Counts operator edits. A save acknowledges only the revision it submitted, so text typed while it was pending is kept.
  const localRevision = useRef(0);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { localRevision.current += 1; set(v); };
  const expectReseed = useRef(false);

  useEffect(() => {
    if (!ws) return;
    const key = `${ws.template.id}:${ws.template.contentVersion}:${ws.draftToken ?? "none"}`;
    if (key === seeded) return;
    // A background refetch must never replace fields the operator has edited and not saved.
    if (seeded !== null && dirtyRef.current && !expectReseed.current && seeded.split(":")[0] === String(ws.template.id)) {
      setRemoteChanged(true);
      return;
    }
    expectReseed.current = false;
    const src = ws.draft ?? ws.template;
    setSubject(src.subject ?? "");
    setBody(src.body);
    setBaseToken(ws.draftToken);
    setSeedParent(ws.template.contentVersion);
    setSeedActor(ws.draft?.authorId ?? null);
    setSeeded(key);
    setPublishFindings([]);
    setConflict(null);
    setRemoteChanged(false);
  }, [ws, seeded]);

  useEffect(() => { if (!open) { setSeeded(null); setPreview(null); setPublishFindings([]); setConflict(null); setRemoteChanged(false); setBaseToken(null); setSeedParent(null); setSeedActor(null); } }, [open]);

  const channelForPreview = ws?.template?.channel === "email" ? "email" : ws?.template?.channel === "sms" ? "sms" : undefined;

  // Debounced server preview (sample values only; nothing is sent or stored).
  useEffect(() => {
    if (!open || !canEdit || !body.trim()) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await apiRequest("POST", "/api/message-templates/preview", { subject: subject || null, body, channel: channelForPreview }, undefined, ctl.signal);
        setPreview(await res.json());
      } catch (e) {
        if ((e as Error).name !== "AbortError") setPreview(null);
      }
    }, 400);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [open, canEdit, subject, body, channelForPreview]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: wsKey(templateId ?? 0) }),
      queryClient.invalidateQueries({ queryKey: LIST_KEY }),
    ]);
  };
  const fail = (title: string) => (e: Error) => {
    const c = conflictFromError(e);
    if (c) setConflict(c);
    setPublishFindings(findingsFromError(e));
    toast({ title, description: getApiErrorMessage(e, title), variant: "destructive" });
  };

  interface SubmittedSave { revision: number; subject: string; body: string; parent: number; token: string | null }
  const saveDraft = useMutation({
    mutationFn: async (sub: SubmittedSave) => (await apiRequest("PUT", `/api/message-templates/${templateId}/draft`, {
      subject: sub.subject.trim() === "" ? null : sub.subject, body: sub.body, baseVersion: sub.parent, expectedDraftToken: sub.token,
    })).json() as Promise<{ draftToken: string | null }>,
    onSuccess: async (saved, sub) => {
      setPublishFindings([]); setConflict(null);
      if (localRevision.current === sub.revision) {
        expectReseed.current = true;
      } else {
        // The operator kept typing while the save was pending: adopt the new draft identity but keep the newer text.
        setBaseToken(saved.draftToken);
        setSeeded(`${templateId}:${sub.parent}:${saved.draftToken ?? "none"}`);
      }
      await refresh();
      toast({
        title: "Draft saved",
        description: localRevision.current === sub.revision ? "Live wording is unchanged." : "Live wording is unchanged. Edits made while saving are still unsaved.",
      });
    },
    onError: fail("Could not save draft"),
  });
  const discard = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", `/api/message-templates/${templateId}/draft`, { expectedDraftToken: baseToken })).json(),
    onSuccess: async () => { expectReseed.current = true; setSeeded(null); await refresh(); toast({ title: "Draft discarded" }); },
    onError: fail("Could not discard draft"),
  });
  const publish = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/message-templates/${templateId}/publish`, { expectedVersion: seedParent ?? ws!.template.contentVersion, expectedDraftToken: baseToken ?? "" })).json(),
    onSuccess: async () => { setPublishFindings([]); setConflict(null); expectReseed.current = true; await refresh(); toast({ title: "Content version published", description: "Wording is now live for this template. Activation was not changed." }); },
    onError: fail("Could not publish"),
  });
  const activation = useMutation({
    mutationFn: async (active: boolean) => (await apiRequest("POST", `/api/message-templates/${templateId}/activation`, { active })).json(),
    onSuccess: async (_d, active) => { setPublishFindings([]); await refresh(); toast({ title: active ? "Campaign actions activated" : "Campaign actions deactivated" }); },
    onError: fail("Could not change activation"),
  });

  const busy = saveDraft.isPending || discard.isPending || publish.isPending || activation.isPending;
  const t = ws?.template;
  const baseline = ws?.draft ?? t;
  const dirty = useMemo(() => !!baseline && ((baseline.subject ?? "") !== subject || baseline.body !== body), [baseline, subject, body]);
  dirtyRef.current = dirty;
  const hasDraft = !!ws?.draft;
  // The live version moved after these fields were loaded: block save/publish until the operator reloads or copies their text.
  const parentChanged = !!t && seedParent !== null && t.contentVersion !== seedParent;
  const draftCurrent = hasDraft && ws!.draft!.baseVersion === t!.contentVersion;
  const canPublish = canEdit && hasDraft && draftCurrent && !dirty && !remoteChanged && !parentChanged && !conflict && baseToken !== null && baseToken === ws!.draftToken && ws!.draftFindings.length === 0;
  const canSave = canEdit && !!t && dirty && !parentChanged && seedParent !== null;
  const isActive = t?.isActive === true;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="workspace" className="max-w-5xl max-h-[90vh] overflow-y-auto overflow-x-hidden" data-testid="dialog-template-editor">
        <DialogHeader>
          <DialogTitle>{t ? t.name : "Message template"}</DialogTitle>
          <DialogDescription>
            Edit and preview wording here. Saving a draft, publishing a content version and activating campaign actions are three separate steps; none of them sends a message.
          </DialogDescription>
        </DialogHeader>
        {!canEdit ? (
          <p className="text-sm text-muted-foreground">Only an administrator or manager can edit message wording.</p>
        ) : isLoading || !t ? (
          isError ? <p className="text-sm text-destructive">{getApiErrorMessage(error, "Could not load template")}</p>
            : <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="template-status">
              <Badge variant="outline">{t.channel}</Badge>
              <Badge variant="outline" data-testid="badge-live-version">Live version {t.contentVersion}</Badge>
              <Badge variant={hasDraft ? "default" : "secondary"} data-testid="badge-draft-state">
                {hasDraft ? (draftCurrent ? "Draft saved (not live)" : "Draft is out of date") : "No draft"}
              </Badge>
              <Badge variant={isActive ? "default" : "secondary"} data-testid="badge-template-active">
                {isActive ? "Campaign actions active" : "Campaign actions not active"}
              </Badge>
            </div>

            <FindingList findings={ws!.liveFindings} testId="findings-live" />

            {(conflict || remoteChanged || parentChanged) && (
              <Alert variant="destructive" data-testid="draft-conflict">
                <AlertDescription className="space-y-2">
                  <p className="font-medium">
                    {conflict ? "This draft changed while you were editing, so your command was not applied." : parentChanged ? `Version ${t.contentVersion} was published after you opened this template (you started from version ${seedParent}). Saving is blocked so your text is not applied over it; copy your changes, then reload.` : "A newer saved draft or published version exists. Your unsaved edits are kept here."}
                  </p>
                  {conflict && (
                    <p className="text-xs">
                      {conflict.hasDraft ? `Current draft was written against version ${conflict.baseVersion}${conflict.updatedAt ? ` and saved ${new Date(conflict.updatedAt).toLocaleString()}` : ""}.` : "There is no saved draft now."} Live version is {conflict.liveVersion}.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="min-h-11" data-testid="button-copy-my-changes"
                      onClick={async () => { try { await navigator.clipboard.writeText(`${subject ? `Subject: ${subject}\n\n` : ""}${body}`); toast({ title: "Your changes were copied" }); } catch { toast({ title: "Could not copy", description: "Select the text in the editor and copy it manually.", variant: "destructive" }); } }}>
                      Copy my changes
                    </Button>
                    <Button type="button" className="min-h-11" data-testid="button-reload-current"
                      onClick={async () => { expectReseed.current = true; setSeeded(null); await refresh(); }}>
                      Reload current (discards my edits here)
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 [&>*]:min-w-0">
              <div className="space-y-3">
                {t.channel === "email" && (
                  <div className="space-y-1">
                    <Label htmlFor="tpl-subject">Subject</Label>
                    <Input id="tpl-subject" value={subject} onChange={(e) => touch(setSubject)(e.target.value)} data-testid="input-template-subject" />
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="tpl-body">{t.channel === "email" ? "Body (HTML)" : "Message"}</Label>
                  <Textarea id="tpl-body" rows={14} value={body} onChange={(e) => touch(setBody)(e.target.value)} className="font-mono text-xs" data-testid="input-template-body" />
                </div>
              </div>
              <div className="space-y-2" data-testid="template-preview">
                <Label>Preview (sample values)</Label>
                {preview ? (
                  <>
                    {t.channel === "email" && <p className="text-sm font-medium" data-testid="preview-subject">{preview.subject}</p>}
                    {t.channel === "email"
                      ? (preview.final ? <FinalEmailPreview final={preview.final} /> : <SandboxedEmail html={preview.html} title="Email preview" />)
                      : <pre className="whitespace-pre-wrap break-words text-sm rounded-md border p-3" data-testid="preview-sms">{preview.html}</pre>}
                    {preview.unresolved.length > 0 && (
                      <p className="text-xs text-destructive">Unsupported merge fields (publishing is blocked and sending would fail): {preview.unresolved.join(", ")}</p>
                    )}
                    <FindingList findings={preview.findings} testId="findings-preview" />
                  </>
                ) : <p className="text-sm text-muted-foreground">Preview appears here.</p>}
              </div>
            </div>

            <FindingList findings={publishFindings} testId="findings-action" />

            <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">1. Save draft</p>
                <p className="text-xs text-muted-foreground">Keeps your edits for review. Live wording does not change.</p>
                <div className="flex flex-wrap gap-2">
                  <Button className="min-h-11" disabled={busy || !canSave} onClick={() => saveDraft.mutate({ revision: localRevision.current, subject, body, parent: seedParent!, token: baseToken })} data-testid="button-save-draft">Save draft</Button>
                  {hasDraft && (
                    <Button className="min-h-11" variant="outline" disabled={busy} onClick={() => discard.mutate()} data-testid="button-discard-draft">Discard draft</Button>
                  )}
                </div>
              </div>
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">2. Publish content version</p>
                <p className="text-xs text-muted-foreground">Makes the saved draft the live wording as version {t.contentVersion + 1}. It does not activate the template or send anything.</p>
                <Button className="min-h-11" disabled={busy || !canPublish} onClick={() => publish.mutate()} data-testid="button-publish-content">Publish content version</Button>
                {dirty && <p className="text-xs text-muted-foreground">Save your edits first.</p>}
              </div>
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">3. Activate campaign actions</p>
                <p className="text-xs text-muted-foreground">Lets workflow and operator sends use the published wording. Receipts are enabled separately under Request receipts.</p>
                {canActivate ? (
                  <Button className="min-h-11" variant={isActive ? "outline" : "default"} disabled={busy}
                    onClick={() => activation.mutate(!isActive)} data-testid="button-activate-campaign">
                    {isActive ? "Deactivate campaign actions" : "Activate campaign actions"}
                  </Button>
                ) : <p className="text-xs text-muted-foreground">Only an administrator can change activation.</p>}
              </div>
            </div>

            {ws!.history.length > 0 && (
              <div className="space-y-1" data-testid="template-history">
                <Label>Published versions</Label>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {ws!.history.map((h) => (
                    <li key={h.id}>Version {h.version}{h.publishedAt ? ` - ${new Date(h.publishedAt).toLocaleString()}` : " - wording live before versioning"}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface ReceiptPreviewItem {
  sourceClass: string; variant: string; sourceType: string; templateKey: string; subject: string; html: string; text: string;
  sender: { name: string | null; address: string }; replyTo: string;
}
interface ReceiptPreviews { previews: ReceiptPreviewItem[]; note: string }

const RECEIPT_LABELS: Record<string, string> = {
  sales_request: "Sales requests", support_request: "Support requests", fulfillment_request: "Equipment orders",
  partner_application_request: "Partner applications", privacy_request: "Privacy requests",
};
const EXAMPLE_LABELS: Record<string, string> = {
  estimate_form: "Example: estimate request", statement_upload: "Example: statement upload", support_form: "Example: support request",
  equipment_request: "Example: equipment order", partner_application: "Example: partner application", privacy_request: "Example: privacy request",
};

/** Read-only view of the exact receipt wording. Delivery is enabled in the Request receipts card, not here. */
export function ReceiptWordingPreview({ canView }: { canView: boolean }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<ReceiptPreviewItem | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery<ReceiptPreviews>({
    queryKey: ["/api/admin/inbound-acknowledgements/preview"],
    enabled: open && canView,
  });
  if (!canView) return null;
  return (
    <div className="space-y-3 pt-4 border-t" data-testid="receipt-wording-preview">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-medium">Request receipt wording</p>
          <p className="text-xs text-muted-foreground">Fixed factual wording with a reference number and no timing promise. Turn on delivery with "Enable transactional purpose" in Request receipts below.</p>
        </div>
        <Button variant="outline" className="min-h-11" onClick={() => setOpen((v) => !v)} data-testid="button-toggle-receipt-preview">
          {open ? "Hide receipt preview" : "Preview receipts"}
        </Button>
      </div>
      {open && (isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        : isError ? (
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-sm text-destructive">{getApiErrorMessage(error, "Could not load receipt preview")}</p>
            <Button variant="outline" className="min-h-11" onClick={() => refetch()} data-testid="button-receipt-preview-retry">Retry</Button>
          </div>
        )
        : data && (
          <>
            <p className="text-xs text-muted-foreground" data-testid="text-receipt-preview-note">{data.note}</p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.previews.map((p) => (
                <div key={`${p.sourceClass}:${p.variant}`} className="space-y-2 rounded-md border p-4 min-w-0" data-testid={p.variant === "default" ? `receipt-preview-${p.sourceClass}` : `receipt-preview-${p.sourceClass}-${p.variant}`}>
                  <div>
                    <p className="text-sm font-medium">{RECEIPT_LABELS[p.sourceClass] ?? p.sourceClass}</p>
                    <p className="text-xs text-muted-foreground">{EXAMPLE_LABELS[p.sourceType] ?? p.sourceType}</p>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="font-medium">Subject</dt><dd className="min-w-0 break-words" data-testid="receipt-preview-subject">{p.subject}</dd>
                    <dt className="font-medium">From</dt><dd className="min-w-0 break-words" data-testid="receipt-preview-sender">{p.sender.name ? `${p.sender.name} <${p.sender.address}>` : p.sender.address}</dd>
                    <dt className="font-medium">Reply-To</dt><dd className="min-w-0 break-words">{p.replyTo}</dd>
                  </dl>
                  <SandboxedEmail html={p.html} title={`Receipt preview: ${p.sourceClass} (${p.variant})`} />
                  <Button variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setExpanded(p)} data-testid={`button-expand-receipt-${p.sourceClass}-${p.variant}`}>
                    Open full preview
                  </Button>
                </div>
              ))}
            </div>
          </>
        ))}
      <Dialog open={expanded !== null} onOpenChange={(next) => { if (!next) setExpanded(null); }}>
        <DialogContent className="max-w-3xl w-[calc(100vw-1rem)] max-h-[95vh] overflow-y-auto p-4 sm:p-6" data-testid="dialog-receipt-full-preview"
          // The preview frame comes first in tab order, so default auto-focus lands inside it, and keystrokes (Escape) in a
          // sandboxed frame never reach this dialog. Start on the dialog itself so Escape closes it.
          onOpenAutoFocus={(event) => { event.preventDefault(); (event.target as HTMLElement | null)?.focus?.({ preventScroll: true }); }}>
          <DialogHeader>
            <DialogTitle>{expanded ? `${RECEIPT_LABELS[expanded.sourceClass] ?? expanded.sourceClass} receipt` : "Receipt preview"}</DialogTitle>
            <DialogDescription>{expanded ? `${expanded.subject} — from ${expanded.sender.address}` : ""}</DialogDescription>
          </DialogHeader>
          {expanded && <SandboxedEmail html={expanded.html} title="Full receipt preview" tall />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
