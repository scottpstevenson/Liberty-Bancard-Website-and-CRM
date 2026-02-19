import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Trophy, XCircle, BarChart, Users, Plus, Loader2 } from "lucide-react";
import type { DealCompetitor } from "@shared/schema";
import { WIN_LOSS_REASONS } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export default function WinLoss() {
  const [open, setOpen] = useState(false);
  const [dealId, setDealId] = useState("");
  const [competitorName, setCompetitorName] = useState("");
  const [competitorRate, setCompetitorRate] = useState("");
  const [competitorProgram, setCompetitorProgram] = useState("");
  const [result, setResult] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const { data: competitors = [], isLoading } = useQuery<DealCompetitor[]>({
    queryKey: ["/api/deal-competitors"],
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/deal-competitors", body);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/deal-competitors"] });
      setOpen(false);
      resetForm();
      toast({ title: "Competitor entry added" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function resetForm() {
    setDealId("");
    setCompetitorName("");
    setCompetitorRate("");
    setCompetitorProgram("");
    setResult("");
    setReason("");
    setNotes("");
  }

  function handleSubmit() {
    if (!dealId || !competitorName || !result || !reason) return;
    createMutation.mutate({
      dealId: Number(dealId),
      competitorName,
      competitorRate: competitorRate || null,
      competitorProgram: competitorProgram || null,
      result,
      ...(result === "Won" ? { winFactor: reason } : { lossReason: reason }),
      notes: notes || null,
    });
  }

  const totalDeals = competitors.length;
  const wins = competitors.filter((c) => c.result === "Won").length;
  const losses = competitors.filter((c) => c.result === "Lost").length;
  const winRate = totalDeals > 0 ? Math.round((wins / totalDeals) * 100) : 0;

  const competitorCounts: Record<string, number> = {};
  competitors.forEach((c) => {
    competitorCounts[c.competitorName] = (competitorCounts[c.competitorName] || 0) + 1;
  });
  const topCompetitor =
    Object.keys(competitorCounts).length > 0
      ? Object.entries(competitorCounts).sort((a, b) => b[1] - a[1])[0][0]
      : "N/A";

  const lossReasonCounts: Record<string, number> = {};
  competitors
    .filter((c) => c.result === "Lost" && c.lossReason)
    .forEach((c) => {
      lossReasonCounts[c.lossReason!] = (lossReasonCounts[c.lossReason!] || 0) + 1;
    });
  const sortedLossReasons = Object.entries(lossReasonCounts).sort((a, b) => b[1] - a[1]);
  const mostCommonLossReason = sortedLossReasons.length > 0 ? sortedLossReasons[0][0] : "N/A";
  const maxLossCount = sortedLossReasons.length > 0 ? sortedLossReasons[0][1] : 0;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="page-win-loss">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">Win/Loss Analysis</h1>
          <p className="text-sm text-muted-foreground mt-1" data-testid="text-page-subtitle">
            Track competitive outcomes and understand why deals are won or lost
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-competitor">
              <Plus className="w-4 h-4 mr-2" />
              Add Competitor Entry
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Competitor Entry</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="dealId">Deal ID</Label>
                <Input
                  id="dealId"
                  type="number"
                  value={dealId}
                  onChange={(e) => setDealId(e.target.value)}
                  placeholder="Enter deal ID"
                  data-testid="input-deal-id"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="competitorName">Competitor Name</Label>
                <Input
                  id="competitorName"
                  value={competitorName}
                  onChange={(e) => setCompetitorName(e.target.value)}
                  placeholder="e.g. Square, Stripe"
                  data-testid="input-competitor-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="competitorRate">Competitor Rate (optional)</Label>
                  <Input
                    id="competitorRate"
                    value={competitorRate}
                    onChange={(e) => setCompetitorRate(e.target.value)}
                    placeholder="e.g. 2.6%"
                    data-testid="input-competitor-rate"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="competitorProgram">Competitor Program (optional)</Label>
                  <Input
                    id="competitorProgram"
                    value={competitorProgram}
                    onChange={(e) => setCompetitorProgram(e.target.value)}
                    placeholder="e.g. Flat Rate"
                    data-testid="input-competitor-program"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Result</Label>
                <Select value={result} onValueChange={setResult}>
                  <SelectTrigger data-testid="select-result">
                    <SelectValue placeholder="Select result" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Won">Won</SelectItem>
                    <SelectItem value="Lost">Lost</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{result === "Won" ? "Win Factor" : "Loss Reason"}</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger data-testid="select-reason">
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    {WIN_LOSS_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional details..."
                  data-testid="input-notes"
                />
              </div>
              <Button
                className="w-full"
                onClick={handleSubmit}
                disabled={!dealId || !competitorName || !result || !reason || createMutation.isPending}
                data-testid="button-save-competitor"
              >
                {createMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Save Entry
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card data-testid="card-kpi-total-deals">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Tracked Deals</CardTitle>
            <BarChart className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-deals">{totalDeals}</div>
            <p className="text-xs text-muted-foreground mt-1">{wins} won / {losses} lost</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-win-rate">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Win Rate</CardTitle>
            <Trophy className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-win-rate">{winRate}%</div>
            <p className="text-xs text-muted-foreground mt-1">Based on tracked outcomes</p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-top-competitor">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Top Competitor</CardTitle>
            <Users className="w-4 h-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold truncate" data-testid="text-top-competitor">{topCompetitor}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {topCompetitor !== "N/A" ? `${competitorCounts[topCompetitor]} encounters` : "No data yet"}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="card-kpi-loss-reason">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Most Common Loss Reason</CardTitle>
            <XCircle className="w-4 h-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold truncate" data-testid="text-common-loss-reason">{mostCommonLossReason}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {mostCommonLossReason !== "N/A" ? `${lossReasonCounts[mostCommonLossReason]} occurrences` : "No losses recorded"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-results-table">
        <CardHeader>
          <CardTitle className="text-base">Results</CardTitle>
        </CardHeader>
        <CardContent>
          {competitors.length === 0 ? (
            <div className="text-center text-muted-foreground py-8" data-testid="text-no-results">
              No competitor entries yet. Add your first entry to start tracking.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Competitor</TableHead>
                    <TableHead>Deal ID</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Rate</TableHead>
                    <TableHead>Program</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {competitors.map((c) => (
                    <TableRow key={c.id} data-testid={`row-competitor-${c.id}`}>
                      <TableCell className="font-medium" data-testid={`text-competitor-name-${c.id}`}>
                        {c.competitorName}
                      </TableCell>
                      <TableCell data-testid={`text-deal-id-${c.id}`}>{c.dealId}</TableCell>
                      <TableCell>
                        <Badge
                          variant={c.result === "Won" ? "default" : "destructive"}
                          className={c.result === "Won" ? "bg-green-600 text-white border-green-700" : ""}
                          data-testid={`badge-result-${c.id}`}
                        >
                          {c.result}
                        </Badge>
                      </TableCell>
                      <TableCell data-testid={`text-reason-${c.id}`}>
                        {c.result === "Won" ? c.winFactor : c.lossReason}
                      </TableCell>
                      <TableCell data-testid={`text-rate-${c.id}`}>{c.competitorRate || "-"}</TableCell>
                      <TableCell data-testid={`text-program-${c.id}`}>{c.competitorProgram || "-"}</TableCell>
                      <TableCell className="max-w-[200px] truncate" data-testid={`text-notes-${c.id}`}>
                        {c.notes || "-"}
                      </TableCell>
                      <TableCell data-testid={`text-date-${c.id}`}>
                        {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {sortedLossReasons.length > 0 && (
        <Card data-testid="card-loss-breakdown">
          <CardHeader>
            <CardTitle className="text-base">Loss Reasons Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {sortedLossReasons.map(([reasonName, count]) => (
                <div key={reasonName} className="space-y-1" data-testid={`bar-loss-reason-${reasonName.toLowerCase().replace(/[\s/]+/g, "-")}`}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{reasonName}</span>
                    <span className="text-muted-foreground shrink-0">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-destructive transition-all"
                      style={{ width: `${maxLossCount > 0 ? (count / maxLossCount) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
