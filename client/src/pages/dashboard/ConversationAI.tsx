import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MessageSquare,
  Bot,
  Settings,
  Zap,
  Plus,
  Pencil,
  Trash2,
  UserCheck,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface BotContext {
  id: number;
  contextId: string;
  name: string;
  systemPrompt: string;
  faqItems: { question: string; answer: string }[];
  active: boolean;
  autoReplyEnabled: boolean;
  autoReplyDelaySeconds: number;
  confidenceThreshold: number;
  channel: string;
  verticalKey?: string | null;
  updatedAt?: string;
}

interface HandoffRule {
  id: number;
  pattern: string;
  type: "explicit" | "angry" | "complex_pricing" | "low_confidence";
  description?: string;
  active: boolean;
  createdAt?: string;
}

interface LiveSession {
  contactId: number;
  contactName: string;
  companyName: string;
  email: string;
  channel: string;
  lastAt: string;
  minutesActive: number;
  messageCount: number;
  lastMessage?: string;
}

// ─── Handoff type styling ───────────────────────────────────────────────────────
const HANDOFF_TYPE_META: Record<string, { label: string; color: string }> = {
  explicit: { label: "Explicit Request", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  angry: { label: "Angry / Escalation", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  complex_pricing: { label: "Complex Pricing", color: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200" },
  low_confidence: { label: "Low Confidence", color: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200" },
};

function formatDelay(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

// ─── Bot Context Editor Dialog ─────────────────────────────────────────────────
function BotContextDialog({
  ctx,
  open,
  onClose,
}: {
  ctx: BotContext;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState(ctx.name);
  const [systemPrompt, setSystemPrompt] = useState(ctx.systemPrompt);
  const [active, setActive] = useState(ctx.active);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(ctx.autoReplyEnabled);
  const [autoReplyDelaySeconds, setAutoReplyDelaySeconds] = useState(String(ctx.autoReplyDelaySeconds));
  const [confidenceThreshold, setConfidenceThreshold] = useState(String(ctx.confidenceThreshold));
  const [channel, setChannel] = useState(ctx.channel);
  const [faqItems, setFaqItems] = useState<{ question: string; answer: string }[]>(ctx.faqItems || []);

  const mutation = useMutation({
    mutationFn: (data: Partial<BotContext>) =>
      apiRequest("PUT", `/api/bot-contexts/${ctx.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bot-contexts"] });
      toast({ title: "Saved", description: `"${name}" updated successfully.` });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    mutation.mutate({
      name,
      systemPrompt,
      active,
      autoReplyEnabled,
      autoReplyDelaySeconds: Number(autoReplyDelaySeconds),
      confidenceThreshold: Number(confidenceThreshold),
      channel: channel as any,
      faqItems,
    });
  };

  const addFaq = () => setFaqItems(prev => [...prev, { question: "", answer: "" }]);
  const updateFaq = (i: number, field: "question" | "answer", value: string) => {
    setFaqItems(prev => prev.map((item, idx) => (idx === i ? { ...item, [field]: value } : item)));
  };
  const removeFaq = (i: number) => setFaqItems(prev => prev.filter((_, idx) => idx !== i));

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="bot-context-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-blue-500" />
            Edit Bot Context: {ctx.contextId}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Basic */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Display Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} data-testid="input-bot-name" />
            </div>
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger data-testid="select-bot-channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All channels</SelectItem>
                  <SelectItem value="chat">Chat only</SelectItem>
                  <SelectItem value="sms">SMS only</SelectItem>
                  <SelectItem value="email">Email only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-2 gap-4 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Bot will respond on this context</p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} data-testid="toggle-bot-active" />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Auto-reply</p>
                <p className="text-xs text-muted-foreground">Send auto-reply after delay</p>
              </div>
              <Switch checked={autoReplyEnabled} onCheckedChange={setAutoReplyEnabled} data-testid="toggle-auto-reply" />
            </div>
          </div>

          {/* Thresholds */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Auto-reply Delay (seconds)</Label>
              <Input
                type="number"
                min={30}
                max={86400}
                value={autoReplyDelaySeconds}
                onChange={e => setAutoReplyDelaySeconds(e.target.value)}
                disabled={!autoReplyEnabled}
                data-testid="input-auto-reply-delay"
              />
              <p className="text-xs text-muted-foreground">Current: {formatDelay(Number(autoReplyDelaySeconds))}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Confidence Threshold (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={confidenceThreshold}
                onChange={e => setConfidenceThreshold(e.target.value)}
                data-testid="input-confidence-threshold"
              />
              <p className="text-xs text-muted-foreground">Below this → handoff triggered</p>
            </div>
          </div>

          {/* System Prompt */}
          <div className="space-y-1.5">
            <Label>System Prompt</Label>
            <Textarea
              rows={10}
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              className="font-mono text-sm"
              data-testid="textarea-system-prompt"
            />
          </div>

          {/* FAQ Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>FAQ Items ({faqItems.length})</Label>
              <Button variant="outline" size="sm" onClick={addFaq} data-testid="button-add-faq">
                <Plus className="h-3.5 w-3.5 mr-1" /> Add FAQ
              </Button>
            </div>
            {faqItems.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No FAQ items yet. Add common questions the bot should handle directly.</p>
            ) : (
              <div className="space-y-2">
                {faqItems.map((item, i) => (
                  <div key={i} className="flex gap-2 items-start rounded-lg border p-2">
                    <div className="flex-1 grid grid-cols-2 gap-2">
                      <Input
                        placeholder="Question"
                        value={item.question}
                        onChange={e => updateFaq(i, "question", e.target.value)}
                        data-testid={`input-faq-question-${i}`}
                      />
                      <Input
                        placeholder="Answer"
                        value={item.answer}
                        onChange={e => updateFaq(i, "answer", e.target.value)}
                        data-testid={`input-faq-answer-${i}`}
                      />
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => removeFaq(i)} data-testid={`button-remove-faq-${i}`}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={mutation.isPending} data-testid="button-save-bot-context">
            {mutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bot Contexts Tab ──────────────────────────────────────────────────────────
function BotContextsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingCtx, setEditingCtx] = useState<BotContext | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const { data: contexts = [], isLoading } = useQuery<BotContext[]>({
    queryKey: ["/api/bot-contexts"],
  });

  const seedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/bot-contexts/seed", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bot-contexts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/handoff-rules"] });
      toast({ title: "Reset complete", description: "Bot contexts and handoff rules restored to defaults." });
      setResetDialogOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Reset failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {contexts.length} bot context{contexts.length !== 1 ? "s" : ""} configured.
            Each context defines the AI's behavior, system prompt, and auto-reply settings for a specific channel or vertical.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setResetDialogOpen(true)}
          data-testid="button-reset-defaults"
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Reset to Defaults
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {contexts.map(ctx => (
          <Card key={ctx.id} className={`relative transition-opacity ${!ctx.active ? "opacity-60" : ""}`} data-testid={`card-bot-context-${ctx.id}`}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{ctx.name}</CardTitle>
                  <CardDescription className="font-mono text-xs mt-0.5">{ctx.contextId}</CardDescription>
                </div>
                <div className="flex items-center gap-1.5">
                  {ctx.active ? (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">Inactive</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setEditingCtx(ctx)}
                    data-testid={`button-edit-bot-context-${ctx.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="flex flex-col items-center justify-center rounded bg-muted/60 p-2">
                  <span className="font-semibold">{ctx.channel}</span>
                  <span className="text-muted-foreground">Channel</span>
                </div>
                <div className="flex flex-col items-center justify-center rounded bg-muted/60 p-2">
                  <span className="font-semibold">{ctx.confidenceThreshold}%</span>
                  <span className="text-muted-foreground">Confidence</span>
                </div>
                <div className="flex flex-col items-center justify-center rounded bg-muted/60 p-2">
                  <span className="font-semibold">{ctx.autoReplyEnabled ? formatDelay(ctx.autoReplyDelaySeconds) : "Off"}</span>
                  <span className="text-muted-foreground">Auto-reply</span>
                </div>
              </div>
              {ctx.verticalKey && (
                <Badge variant="secondary" className="text-xs">{ctx.verticalKey}</Badge>
              )}
              <p className="text-xs text-muted-foreground line-clamp-2">
                {ctx.systemPrompt.slice(0, 120)}…
              </p>
              {ctx.faqItems && ctx.faqItems.length > 0 && (
                <p className="text-xs text-muted-foreground">{ctx.faqItems.length} FAQ item{ctx.faqItems.length !== 1 ? "s" : ""}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {editingCtx && (
        <BotContextDialog ctx={editingCtx} open={!!editingCtx} onClose={() => setEditingCtx(null)} />
      )}

      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to Defaults?</AlertDialogTitle>
            <AlertDialogDescription>
              This will DELETE all current bot contexts and handoff rules and re-seed them with the built-in defaults.
              Any customizations will be permanently lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => seedMutation.mutate()}
              data-testid="button-confirm-reset"
            >
              {seedMutation.isPending ? "Resetting…" : "Yes, Reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Handoff Rules Tab ──────────────────────────────────────────────────────────
function HandoffRulesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [newPattern, setNewPattern] = useState("");
  const [newType, setNewType] = useState<HandoffRule["type"]>("explicit");
  const [newDescription, setNewDescription] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: rules = [], isLoading } = useQuery<HandoffRule[]>({
    queryKey: ["/api/handoff-rules"],
  });

  const addMutation = useMutation({
    mutationFn: (data: { pattern: string; type: string; description: string }) =>
      apiRequest("POST", "/api/handoff-rules", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/handoff-rules"] });
      toast({ title: "Rule added" });
      setAddOpen(false);
      setNewPattern("");
      setNewDescription("");
    },
    onError: (err: any) => {
      toast({ title: "Add failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      apiRequest("PATCH", `/api/handoff-rules/${id}`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/handoff-rules"] });
    },
    onError: (err: any) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/handoff-rules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/handoff-rules"] });
      toast({ title: "Rule deleted" });
      setDeleteId(null);
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const byType = (rules as HandoffRule[]).reduce<Record<string, HandoffRule[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {});

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Regex patterns that trigger a human handoff when matched in incoming messages.
          {(rules as HandoffRule[]).filter(r => r.active).length} of {rules.length} active.
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)} data-testid="button-add-handoff-rule">
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Rule
        </Button>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">On</TableHead>
              <TableHead>Pattern (regex)</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rules as HandoffRule[]).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                  No handoff rules. Add one to enable human-handoff triggering.
                </TableCell>
              </TableRow>
            ) : (
              Object.entries(byType).map(([type, typeRules]) =>
                typeRules.map((rule, idx) => (
                  <TableRow key={rule.id} className={!rule.active ? "opacity-50" : ""} data-testid={`row-handoff-rule-${rule.id}`}>
                    {idx === 0 && (
                      <></>
                    )}
                    <TableCell>
                      <Switch
                        checked={rule.active}
                        onCheckedChange={v => toggleMutation.mutate({ id: rule.id, active: v })}
                        data-testid={`toggle-handoff-rule-${rule.id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{rule.pattern}</code>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${HANDOFF_TYPE_META[rule.type]?.color || "bg-muted"}`}>
                        {HANDOFF_TYPE_META[rule.type]?.label || rule.type}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{rule.description || "—"}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setDeleteId(rule.id)}
                        data-testid={`button-delete-rule-${rule.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add Rule Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="dialog-add-handoff-rule">
          <DialogHeader>
            <DialogTitle>Add Handoff Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Pattern (regex)</Label>
              <Input
                placeholder="e.g. talk to (a )?person"
                value={newPattern}
                onChange={e => setNewPattern(e.target.value)}
                data-testid="input-new-handoff-pattern"
              />
              <p className="text-xs text-muted-foreground">JavaScript-compatible regex. Case-insensitive by default.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={newType} onValueChange={v => setNewType(v as any)}>
                <SelectTrigger data-testid="select-new-handoff-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(HANDOFF_TYPE_META).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Input
                placeholder="Brief description of when this triggers"
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
                data-testid="input-new-handoff-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={() => addMutation.mutate({ pattern: newPattern, type: newType, description: newDescription })}
              disabled={!newPattern || addMutation.isPending}
              data-testid="button-confirm-add-rule"
            >
              {addMutation.isPending ? "Adding…" : "Add Rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this rule?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone. Re-seed defaults to restore built-in patterns.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Live Conversations Tab ────────────────────────────────────────────────────
function LiveConversationsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [takeoverTarget, setTakeoverTarget] = useState<number | null>(null);

  const { data: sessions = [], isLoading, dataUpdatedAt } = useQuery<LiveSession[]>({
    queryKey: ["/api/bot-conversations/live"],
    refetchInterval: 30000,
  });

  const takeoverMutation = useMutation({
    mutationFn: (contactId: number) => apiRequest("POST", `/api/bot-conversations/${contactId}/takeover`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bot-conversations/live"] });
      toast({ title: "Taken over", description: "Bot disabled. Contact tagged for human follow-up in GHL." });
      setTakeoverTarget(null);
    },
    onError: (err: any) => {
      toast({ title: "Takeover failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Active bot conversations from the last 4 hours. Refreshes every 30s.
          </p>
          {dataUpdatedAt ? (
            <p className="text-xs text-muted-foreground mt-0.5">
              Last updated: {new Date(dataUpdatedAt).toLocaleTimeString()}
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/bot-conversations/live"] })}
          data-testid="button-refresh-live"
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (sessions as LiveSession[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <MessageSquare className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground font-medium">No active bot conversations</p>
          <p className="text-sm text-muted-foreground mt-1">Bot sessions from the last 4 hours will appear here.</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Messages</TableHead>
                <TableHead>Last Active</TableHead>
                <TableHead>Last Message</TableHead>
                <TableHead className="w-28"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(sessions as LiveSession[]).map(s => (
                <TableRow key={s.contactId} data-testid={`row-live-session-${s.contactId}`}>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{s.contactName}</p>
                      <p className="text-xs text-muted-foreground">{s.companyName || s.email}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">{s.channel}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">{s.messageCount}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      {s.minutesActive < 1 ? "Just now" : `${s.minutesActive}m ago`}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <p className="text-xs text-muted-foreground truncate">{s.lastMessage || "—"}</p>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTakeoverTarget(s.contactId)}
                      data-testid={`button-takeover-${s.contactId}`}
                    >
                      <UserCheck className="h-3.5 w-3.5 mr-1" />
                      Take Over
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={takeoverTarget !== null} onOpenChange={o => !o && setTakeoverTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Take Over This Conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              The AI bot will be disabled for this contact. They will be tagged as needing human follow-up in GHL.
              This cannot be undone without editing the contact in GHL.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => takeoverTarget && takeoverMutation.mutate(takeoverTarget)}
              data-testid="button-confirm-takeover"
            >
              {takeoverMutation.isPending ? "Processing…" : "Yes, Take Over"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────
export default function ConversationAI() {
  const { data: stats } = useQuery<{ total: number; active: number }>({
    queryKey: ["/api/bot-contexts"],
    select: (data: BotContext[]) => ({
      total: data.length,
      active: data.filter(d => d.active).length,
    }),
  });

  const { data: liveCount } = useQuery<number>({
    queryKey: ["/api/bot-conversations/live"],
    select: (data: LiveSession[]) => data.length,
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conversation AI"
        description="Manage GHL bot contexts, handoff rules, and monitor live AI conversations."
        icon={<MessageSquare className="h-5 w-5" />}
      />

      {/* KPI Bar */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.active ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Active Contexts</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900">
                <Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.total ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Total Contexts</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900">
                <MessageSquare className="h-4 w-4 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{liveCount ?? 0}</p>
                <p className="text-xs text-muted-foreground">Live Sessions</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <Tabs defaultValue="contexts">
            <div className="border-b px-4 pt-3">
              <TabsList className="h-auto bg-transparent p-0 gap-4">
                <TabsTrigger
                  value="contexts"
                  className="rounded-none border-b-2 border-transparent pb-3 data-[state=active]:border-primary data-[state=active]:shadow-none"
                  data-testid="tab-bot-contexts"
                >
                  <Bot className="h-4 w-4 mr-1.5" />
                  Bot Contexts
                </TabsTrigger>
                <TabsTrigger
                  value="handoff"
                  className="rounded-none border-b-2 border-transparent pb-3 data-[state=active]:border-primary data-[state=active]:shadow-none"
                  data-testid="tab-handoff-rules"
                >
                  <AlertTriangle className="h-4 w-4 mr-1.5" />
                  Handoff Rules
                </TabsTrigger>
                <TabsTrigger
                  value="live"
                  className="rounded-none border-b-2 border-transparent pb-3 data-[state=active]:border-primary data-[state=active]:shadow-none"
                  data-testid="tab-live-conversations"
                >
                  <MessageSquare className="h-4 w-4 mr-1.5" />
                  Live Conversations
                  {liveCount ? (
                    <span className="ml-1.5 bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {liveCount}
                    </span>
                  ) : null}
                </TabsTrigger>
              </TabsList>
            </div>
            <div className="p-4">
              <TabsContent value="contexts" className="mt-0">
                <BotContextsTab />
              </TabsContent>
              <TabsContent value="handoff" className="mt-0">
                <HandoffRulesTab />
              </TabsContent>
              <TabsContent value="live" className="mt-0">
                <LiveConversationsTab />
              </TabsContent>
            </div>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
