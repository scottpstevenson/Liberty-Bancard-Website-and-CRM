import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { getApiErrorMessage } from "@/lib/ghlTruth";
import { useToast } from "@/hooks/use-toast";
import { FinalEmailPreview, type FinalMessagePreview } from "./MessageFinalPreview";

export interface PackageEditState {
  packageKey: string; versionId: string; contentHash: string; vertical: string; campaignId: number; sequenceId: number;
  campaignStatus: string; sequenceStatus: string; startedJourneys: number; activeEnrollments: number; editable: boolean; refusals: string[];
  steps: Array<{ stepOrder: number; subject: string; body: string; delayDays: number; cumulativeDay: number }>;
}
export interface DraftFamily { family: string; vertical: string; touches: Array<{ touch: number; day: number; subject: string; body: string }> }
interface Touch { subject: string; body: string; delayDays: number }
interface ApiProblem { touch: number | null; problem: string }

const MARKER_URLS: Record<string, string> = {
  "[secure_statement_upload]": "https://libertybancard.com/upload-statement",
  "[sales_booking]": "https://libertybancard.com/book",
};
const MIN_TOUCHES = 3, MAX_TOUCHES = 5;

export function cumulative(delays: number[]): number[] {
  let total = 0;
  return delays.map((d, i) => (i === 0 ? 0 : (total += Number.isFinite(d) ? d : 0)));
}
/** Day offsets of a proposed cadence (0,3,7,...) become the relative delays a package stores. */
export function relativeFromDays(days: number[]): number[] {
  return days.map((d, i) => (i === 0 ? 0 : d - days[i - 1]));
}
function parseApiBody(e: unknown): { code?: string; message?: string; detail?: unknown } {
  const raw = e instanceof Error ? e.message : "";
  const start = raw.indexOf("{");
  if (start < 0) return {};
  try { return JSON.parse(raw.slice(start)); } catch { return {}; }
}
const draftKey = (s: PackageEditState) => `package-draft:${s.packageKey}:${s.versionId}:${s.contentHash}`;
const asTouches = (s: PackageEditState): Touch[] => s.steps.map((t) => ({ subject: t.subject, body: t.body, delayDays: t.delayDays }));

/** Editor for one current package: the campaign and sequence steps are one list, published together. */
export function PackageContentEditor({ packageKey, families, canPublish, onClose }: {
  packageKey: string; families: DraftFamily[]; canPublish: boolean; onClose: () => void;
}) {
  const { toast } = useToast();
  const stateKey = [`/api/content-workspace/packages/${packageKey}`];
  const state = useQuery<PackageEditState>({ queryKey: stateKey, enabled: canPublish });
  const [touches, setTouches] = useState<Touch[]>([]);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [stale, setStale] = useState(false);
  const [problems, setProblems] = useState<ApiProblem[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [adopt, setAdopt] = useState("");

  const s = state.data;
  // Seed once per package version: restore this browser's saved draft for exactly this version, else the live steps.
  useEffect(() => {
    if (!s) return;
    const id = draftKey(s);
    if (id === seededFor) return;
    let restored: Touch[] | null = null;
    try { const raw = window.sessionStorage.getItem(id); restored = raw ? (JSON.parse(raw) as Touch[]) : null; } catch { restored = null; }
    setTouches(restored && restored.length >= MIN_TOUCHES ? restored : asTouches(s));
    setSeededFor(id); setSelected(0); setStale(false); setProblems([]); setConfirm(false);
  }, [s, seededFor]);
  useEffect(() => {
    if (!s || seededFor !== draftKey(s)) return;
    try { window.sessionStorage.setItem(seededFor, JSON.stringify(touches)); } catch { /* storage unavailable: the draft stays in memory only */ }
  }, [touches, seededFor, s]);

  const live = useMemo(() => (s ? asTouches(s) : []), [s]);
  const dirty = JSON.stringify(touches) !== JSON.stringify(live);
  const days = cumulative(touches.map((t) => t.delayDays));
  const edit = (i: number, patch: Partial<Touch>) => { setConfirm(false); setProblems([]); setTouches((cur) => cur.map((t, j) => (j === i ? { ...t, ...patch } : t))); };
  const move = (i: number, d: -1 | 1) => setTouches((cur) => {
    const j = i + d; if (j < 0 || j >= cur.length) return cur;
    const next = cur.slice(); [next[i], next[j]] = [next[j], next[i]];
    // Keep the delays in their positions so the first touch stays at delay 0.
    return next.map((t, k) => ({ ...t, delayDays: cur[k].delayDays }));
  });
  useEffect(() => { if (selected >= touches.length) setSelected(Math.max(0, touches.length - 1)); }, [touches.length, selected]);

  const matching = families.filter((f) => s && f.vertical === s.vertical);
  const adoptFamily = () => {
    const f = families.find((x) => x.family === adopt); if (!f) return;
    const rel = relativeFromDays(f.touches.map((t) => t.day));
    setTouches(f.touches.map((t, i) => ({ subject: t.subject, body: t.body, delayDays: rel[i] })));
    setSelected(0); setConfirm(false); setProblems([]);
    toast({ title: "Premium draft loaded into the editor", description: "Nothing is published. Review and edit, then publish." });
  };

  // Selected-step preview: stale responses and previews of earlier text are never shown as current.
  const generation = useRef(0);
  const [preview, setPreview] = useState<{ final: FinalMessagePreview | null; error: string | null } | null>(null);
  const t = touches[selected];
  useEffect(() => { generation.current += 1; setPreview(null); }, [t?.subject, t?.body, selected, s?.versionId]);
  const render = useMutation({
    mutationFn: async (gen: number) => {
      let body = t.body;
      for (const [m, url] of Object.entries(MARKER_URLS)) body = body.split(m).join(url);
      const res = await apiRequest("POST", "/api/message-steps/final-preview", { subject: t.subject, body, transport: "sfp_smtp" });
      return { gen, data: (await res.json()) as { ok: boolean; error: { detail: string } | null; final: FinalMessagePreview | null } };
    },
    onSuccess: ({ gen, data }) => { if (gen === generation.current) setPreview({ final: data.ok ? data.final : null, error: data.ok ? null : (data.error?.detail ?? "Preview failed") }); },
    onError: (e) => { setPreview({ final: null, error: getApiErrorMessage(e, "Could not render preview") }); },
  });

  const publish = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/content-workspace/packages/${packageKey}/publish`, {
      expectedVersionId: s!.versionId, expectedContentHash: s!.contentHash, touches,
    })).json() as Promise<{ status: "published" | "replayed"; touches: number }>,
    onSuccess: async (r) => {
      try { if (seededFor) window.sessionStorage.removeItem(seededFor); } catch { /* ignore */ }
      setSeededFor(null); setConfirm(false); setProblems([]); setStale(false);
      await Promise.all([queryClient.invalidateQueries({ queryKey: stateKey }), queryClient.invalidateQueries({ queryKey: ["/api/content-workspace/overview"] })]);
      toast({ title: r.status === "replayed" ? "Already published" : "Package content published", description: "Campaign and sequence now carry the same steps. Nothing was activated or sent; approval must be renewed." });
    },
    onError: (e) => {
      const b = parseApiBody(e);
      setConfirm(false);
      if (b.code === "PACKAGE_STALE") setStale(true);
      setProblems(Array.isArray(b.detail) && b.detail.every((d) => typeof d === "object") ? (b.detail as ApiProblem[]) : (Array.isArray(b.detail) ? (b.detail as string[]).map((p) => ({ touch: null, problem: p })) : []));
      toast({ title: "Not published", description: getApiErrorMessage(e, "Could not publish"), variant: "destructive" });
    },
  });
  const reloadLive = async () => { try { if (seededFor) window.sessionStorage.removeItem(seededFor); } catch { /* ignore */ } setSeededFor(null); await state.refetch(); };

  if (!canPublish) return <p className="text-sm text-muted-foreground" data-testid="text-package-editor-admin-only">Only administrators can edit and publish package content.</p>;
  if (state.isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />;
  if (state.isError || !s) {
    return (
      <Alert variant="destructive" data-testid="package-editor-unavailable"><AlertDescription className="flex flex-wrap items-center gap-2">
        {getApiErrorMessage(state.error, "Could not load this package")}
        <Button size="sm" variant="outline" className="min-h-11" onClick={() => state.refetch()} data-testid="button-package-retry">Retry</Button>
        <Button size="sm" variant="outline" className="min-h-11" onClick={onClose}>Close</Button>
      </AlertDescription></Alert>
    );
  }
  const blocked = !s.editable;
  const invalidLocal = touches.length < MIN_TOUCHES || touches.length > MAX_TOUCHES;
  return (
    <div className="space-y-3 rounded-md border p-3" data-testid={`package-editor-${packageKey}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{s.vertical}: campaign #{s.campaignId} and sequence #{s.sequenceId} <span className="text-xs text-muted-foreground">(published together)</span></p>
        <Badge variant="outline" className="text-xs">version {s.versionId.slice(0, 8)}</Badge>
        {dirty && <Badge variant="outline" className="text-xs" data-testid="badge-package-dirty">unpublished edits (saved in this browser)</Badge>}
        <Button variant="outline" size="sm" className="ml-auto min-h-11" onClick={onClose} data-testid="button-package-close">Close editor</Button>
      </div>
      {blocked && (
        <Alert data-testid="package-refusals"><AlertDescription>
          Publishing is unavailable now: {s.refusals.join("; ")}. You can still read and draft; steps that started journeys are never changed under them.
        </AlertDescription></Alert>
      )}
      {stale && (
        <Alert variant="destructive" data-testid="package-stale"><AlertDescription className="flex flex-wrap items-center gap-2">
          The package changed after you started this draft, so nothing was published. Your draft is still in this browser.
          <Button size="sm" variant="outline" className="min-h-11" onClick={reloadLive} data-testid="button-package-reload-live">Discard draft and load current package</Button>
        </AlertDescription></Alert>
      )}
      <div className="flex flex-wrap items-end gap-2">
        {matching.length > 0 && (
          <>
            <div className="space-y-1">
              <Label htmlFor="adopt-family" className="text-xs">Start from a premium five-touch draft</Label>
              <select id="adopt-family" className="h-11 rounded-md border bg-background px-2 text-sm" value={adopt} onChange={(e) => setAdopt(e.target.value)} data-testid="select-adopt-family">
                <option value="">Choose a draft</option>
                {matching.map((f) => <option key={f.family} value={f.family}>{f.vertical} ({f.touches.length} touches)</option>)}
              </select>
            </div>
            <Button variant="outline" className="min-h-11" disabled={!adopt} onClick={() => { if (!dirty || window.confirm("Replace your unpublished edits with this draft?")) adoptFamily(); }} data-testid="button-adopt-family">Load as editable draft</Button>
          </>
        )}
        <Button variant="outline" className="min-h-11" disabled={!dirty} onClick={() => { setTouches(live); setConfirm(false); setProblems([]); }} data-testid="button-package-reset">Reset to published steps</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
        <ol className="space-y-1" aria-label="Touches" data-testid="package-step-rail">
          {touches.map((tt, i) => (
            <li key={i}>
              <button type="button" className={`min-h-11 w-full rounded-md border px-2 py-1 text-left text-sm ${i === selected ? "border-primary bg-muted" : ""}`} onClick={() => setSelected(i)} aria-current={i === selected} data-testid={`button-step-${i + 1}`}>
                <span className="font-medium">Touch {i + 1}</span> <span className="text-xs text-muted-foreground">day {days[i]} (+{touches[i].delayDays})</span>
                <span className="block truncate text-xs">{tt.subject || "(no subject)"}</span>
              </button>
            </li>
          ))}
          <li><Button variant="outline" className="min-h-11 w-full" disabled={touches.length >= MAX_TOUCHES} onClick={() => { setTouches((c) => [...c, { subject: "", body: "Hello,\n\n", delayDays: 5 }]); setSelected(touches.length); }} data-testid="button-add-touch">Add touch</Button></li>
        </ol>

        {t && (
          <div className="space-y-2 min-w-0">
            <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
              <div className="space-y-1">
                <Label htmlFor="pkg-subject">Subject</Label>
                <Input id="pkg-subject" value={t.subject} onChange={(e) => edit(selected, { subject: e.target.value })} data-testid="input-step-subject" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pkg-delay">Days after previous touch</Label>
                <Input id="pkg-delay" type="number" min={selected === 0 ? 0 : 1} max={60} value={t.delayDays} disabled={selected === 0} onChange={(e) => edit(selected, { delayDays: Math.trunc(Number(e.target.value)) })} data-testid="input-step-delay" />
                <p className="text-xs text-muted-foreground">Sends on day {days[selected]} after the first touch; scheduling windows still apply.</p>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pkg-body">Body (plain text)</Label>
              <Textarea id="pkg-body" rows={10} value={t.body} onChange={(e) => edit(selected, { body: e.target.value })} data-testid="input-step-body" />
              <p className="text-xs text-muted-foreground">Tokens: {"{{firstName}}"}, {"{{companyName}}"}. Links: write [secure_statement_upload] or [sales_booking]; no other links. The signature and unsubscribe footer are added automatically.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="min-h-11" disabled={selected === 0} onClick={() => { move(selected, -1); setSelected(selected - 1); }} data-testid="button-move-up">Move up</Button>
              <Button variant="outline" className="min-h-11" disabled={selected === touches.length - 1} onClick={() => { move(selected, 1); setSelected(selected + 1); }} data-testid="button-move-down">Move down</Button>
              <Button variant="outline" className="min-h-11" disabled={touches.length <= MIN_TOUCHES} onClick={() => { setTouches((c) => c.filter((_, j) => j !== selected)); setConfirm(false); }} data-testid="button-remove-touch">Remove touch</Button>
              <Button variant="outline" className="min-h-11" disabled={render.isPending || !t.body.trim()} onClick={() => render.mutate(generation.current)} data-testid="button-preview-step">{render.isPending ? "Rendering..." : "Preview as SFP email"}</Button>
            </div>
            {live[selected] && (live[selected].subject !== t.subject || live[selected].body !== t.body || live[selected].delayDays !== t.delayDays) && (
              <details className="rounded-md border p-2" data-testid="details-step-diff">
                <summary className="cursor-pointer text-sm min-h-11 flex items-center">Compare with the published step</summary>
                <p className="text-xs font-medium">Published (day {cumulative(live.map((x) => x.delayDays))[selected]}): {live[selected].subject}</p>
                <pre className="whitespace-pre-wrap break-words text-xs">{live[selected].body}</pre>
              </details>
            )}
            {preview && (preview.final ? <FinalEmailPreview final={preview.final} /> : <p className="text-xs text-destructive" data-testid="text-step-preview-error">{preview.error}</p>)}
          </div>
        )}
      </div>

      {problems.length > 0 && (
        <Alert variant="destructive" data-testid="package-problems"><AlertDescription>
          <p className="font-medium">This draft cannot be published as written:</p>
          <ul className="list-disc pl-5 text-sm">{problems.map((p, i) => <li key={i}>{p.touch ? `Touch ${p.touch}: ` : ""}{p.problem}</li>)}</ul>
        </AlertDescription></Alert>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t pt-3">
        <label className="flex items-center gap-2 text-sm min-h-11">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} disabled={blocked || !dirty} data-testid="checkbox-confirm-publish" />
          Replace the steps of campaign #{s.campaignId} and sequence #{s.sequenceId} together. Approval must be renewed; nothing is activated or sent.
        </label>
        <Button className="min-h-11" disabled={blocked || !dirty || !confirm || invalidLocal || publish.isPending} onClick={() => publish.mutate()} data-testid="button-publish-package">
          {publish.isPending ? "Publishing..." : `Publish ${touches.length}-touch content`}
        </Button>
      </div>
    </div>
  );
}
