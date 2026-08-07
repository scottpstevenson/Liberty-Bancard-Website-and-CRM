import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ShieldAlert, Send, Loader2, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { Chargeback } from "@shared/schema";

export function ContactChargebacksTab({ contactId }: { contactId: number }) {
  const queryClient = useQueryClient();
  const [expandedSubmit, setExpandedSubmit] = useState<number | null>(null);
  const [submitMid, setSubmitMid] = useState<Record<number, string>>({});
  const [submitNotes, setSubmitNotes] = useState<Record<number, string>>({});
  const [submitResult, setSubmitResult] = useState<Record<number, { success: boolean; message: string; caseId?: string }>>({});

  const { data: chargebacks = [], isLoading } = useQuery<Chargeback[]>({
    queryKey: ["/api/chargebacks/contact", contactId],
    queryFn: async () => {
      const res = await fetch(`/api/chargebacks/contact/${contactId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!contactId,
  });

  const submitMutation = useMutation({
    mutationFn: async ({ id, mid, evidenceNotes }: { id: number; mid: string; evidenceNotes?: string }) => {
      const res = await apiRequest("POST", `/api/chargebacks/${id}/submit-to-card-brand`, {
        mid,
        evidenceNotes,
      });
      return res.json();
    },
    onSuccess: (data, variables) => {
      setSubmitResult(prev => ({
        ...prev,
        [variables.id]: { success: true, message: data.message || "Submitted successfully", caseId: data.caseId },
      }));
      setExpandedSubmit(null);
      queryClient.invalidateQueries({ queryKey: ["/api/chargebacks/contact", contactId] });
    },
    onError: (err: any, variables) => {
      setSubmitResult(prev => ({
        ...prev,
        [variables.id]: { success: false, message: err?.message || "Submission failed" },
      }));
    },
  });

  const open = chargebacks.filter(c => !["Won", "Lost", "Responded"].includes(c.status));
  const responded = chargebacks.filter(c => c.status === "Responded");
  const won = chargebacks.filter(c => c.status === "Won");
  const lost = chargebacks.filter(c => c.status === "Lost");
  const totalAmount = chargebacks.reduce((sum, c) => sum + (c.amount || 0), 0);
  const winRate = (won.length + lost.length) > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : null;
  const now = new Date();
  const overdue = open.filter(c => c.responseDeadline && new Date(c.responseDeadline) < now);

  if (isLoading) {
    return <div className="py-8 text-center text-muted-foreground">Loading chargebacks...</div>;
  }

  const renderChargebackCard = (cb: Chargeback) => {
    const isOverdue = !["Won", "Lost", "Responded"].includes(cb.status) && cb.responseDeadline && new Date(cb.responseDeadline) < now;
    const isOpen = !["Won", "Lost", "Responded"].includes(cb.status);
    const isExpanded = expandedSubmit === cb.id;
    const result = submitResult[cb.id];

    return (
      <Card key={cb.id} className={isOverdue ? "border-red-300 dark:border-red-800" : ""} data-testid={`card-cb-${cb.id}`}>
        <CardContent className="py-3">
          <div className="space-y-3">
            {/* Header row */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-sm">${cb.amount.toFixed(2)}</span>
                  <Badge variant="outline">{cb.cardBrand}</Badge>
                  <Badge variant={cb.status === "Won" ? "default" : cb.status === "Lost" ? "destructive" : cb.status === "Responded" ? "secondary" : "outline"}>
                    {cb.status}
                  </Badge>
                  {isOverdue && <Badge variant="destructive">OVERDUE</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{cb.reasonCode}</p>
                {cb.responseDeadline && (
                  <p className={`text-xs ${isOverdue ? "text-red-500" : "text-muted-foreground"}`}>
                    Deadline: {new Date(cb.responseDeadline).toLocaleDateString()}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {cb.transactionDate ? new Date(cb.transactionDate).toLocaleDateString() : "—"}
                </span>
                {isOpen && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs h-7"
                    onClick={() => setExpandedSubmit(isExpanded ? null : cb.id)}
                    data-testid={`button-cb-submit-${cb.id}`}
                  >
                    <Send className="w-3 h-3" />
                    Submit Evidence
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </Button>
                )}
              </div>
            </div>

            {/* Submit form — expanded inline */}
            {isExpanded && (
              <div className="border rounded-md p-3 space-y-3 bg-muted/30" data-testid={`form-cb-submit-${cb.id}`}>
                <p className="text-xs font-medium">Submit evidence packet to card brand</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Merchant MID <span className="text-red-500">*</span></Label>
                    <Input
                      placeholder="e.g. 123456789"
                      value={submitMid[cb.id] ?? ""}
                      onChange={e => setSubmitMid(prev => ({ ...prev, [cb.id]: e.target.value }))}
                      className="h-8 text-xs"
                      data-testid={`input-cb-mid-${cb.id}`}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Case / Reference Number</Label>
                    <Input
                      placeholder="Card brand case # (optional)"
                      className="h-8 text-xs"
                      data-testid={`input-cb-case-${cb.id}`}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Evidence Notes</Label>
                  <Textarea
                    placeholder="Describe the evidence being submitted (signed receipts, delivery confirmation, customer communications, etc.)"
                    value={submitNotes[cb.id] ?? ""}
                    onChange={e => setSubmitNotes(prev => ({ ...prev, [cb.id]: e.target.value }))}
                    className="text-xs min-h-[60px] resize-none"
                    data-testid={`textarea-cb-notes-${cb.id}`}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="gap-1.5 h-7 text-xs"
                    disabled={!submitMid[cb.id]?.trim() || submitMutation.isPending}
                    onClick={() =>
                      submitMutation.mutate({
                        id: cb.id,
                        mid: submitMid[cb.id] ?? "",
                        evidenceNotes: submitNotes[cb.id],
                      })
                    }
                    data-testid={`button-cb-submit-confirm-${cb.id}`}
                  >
                    {submitMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Send className="w-3 h-3" />
                    )}
                    {submitMutation.isPending ? "Submitting..." : "Submit to Card Brand"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setExpandedSubmit(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Submission result */}
            {result && (
              <div
                className={`flex items-start gap-2 p-2 rounded text-xs ${
                  result.success
                    ? "bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-300"
                    : "bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300"
                }`}
                data-testid={`result-cb-submit-${cb.id}`}
              >
                {result.success && <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                <span>
                  {result.message}
                  {result.caseId ? ` · Case ID: ${result.caseId}` : ""}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4" data-testid="contact-chargebacks-tab">
      {chargebacks.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="py-3 text-center">
              <div className="text-xl font-bold" data-testid="text-cb-total">{chargebacks.length}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className={`text-xl font-bold ${overdue.length > 0 ? "text-red-600 dark:text-red-400" : ""}`} data-testid="text-cb-overdue">{overdue.length}</div>
              <div className="text-xs text-muted-foreground">Overdue</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className="text-xl font-bold" data-testid="text-cb-amount">${totalAmount.toFixed(0)}</div>
              <div className="text-xs text-muted-foreground">Total Disputed</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 text-center">
              <div className={`text-xl font-bold ${winRate !== null && winRate >= 50 ? "text-green-600 dark:text-green-400" : winRate !== null ? "text-red-600 dark:text-red-400" : ""}`} data-testid="text-cb-winrate">
                {winRate !== null ? `${winRate}%` : "—"}
              </div>
              <div className="text-xs text-muted-foreground">Win Rate</div>
            </CardContent>
          </Card>
        </div>
      )}

      {chargebacks.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground" data-testid="text-no-chargebacks-contact">
            <ShieldAlert className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No chargebacks for this merchant
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {open.map(renderChargebackCard)}
          {responded.map(renderChargebackCard)}
          {won.map(renderChargebackCard)}
          {lost.map(renderChargebackCard)}
        </div>
      )}
    </div>
  );
}
