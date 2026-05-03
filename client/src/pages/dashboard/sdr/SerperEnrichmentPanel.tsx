import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Globe, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function SerperEnrichmentPanel() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{
    serperConfigured: boolean;
    totalEnriched: number;
    last7Days: { totalProcessed: number; websitesFound: number; phonesFound: number; emailsFound: number; errors: number };
  }>({
    queryKey: ["/api/sdr/serper-enrichment/metrics"],
  });

  const runBatchMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/sdr/serper-enrichment/run", { limit: 50 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sdr/serper-enrichment/metrics"] });
      toast({ title: "Enrichment batch completed" });
    },
    onError: (err: any) => {
      toast({ title: "Enrichment batch failed", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  if (!data?.serperConfigured) {
    return (
      <Card data-testid="card-serper-disabled">
        <CardContent className="p-6 text-center text-muted-foreground">
          <Globe className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <div className="font-medium">Serper Enrichment Not Configured</div>
          <div className="text-xs mt-1">Set SERPER_API_KEY to enable business data enrichment</div>
        </CardContent>
      </Card>
    );
  }

  const last7 = data.last7Days;
  return (
    <div className="space-y-4" data-testid="panel-serper-enrichment">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Serper Business Enrichment</div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => runBatchMutation.mutate()}
          disabled={runBatchMutation.isPending}
          data-testid="button-run-enrichment"
        >
          {runBatchMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
          Run Batch
        </Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card data-testid="card-serper-total">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Total Enriched</div>
            <div className="text-xl font-bold">{data.totalEnriched}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-serper-7d-enriched">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">7d Processed</div>
            <div className="text-xl font-bold">{last7.totalProcessed}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-serper-websites">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">7d Websites</div>
            <div className="text-xl font-bold text-blue-600">{last7.websitesFound}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-serper-phones">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">7d Phones</div>
            <div className="text-xl font-bold text-green-600">{last7.phonesFound}</div>
          </CardContent>
        </Card>
        <Card data-testid="card-serper-emails">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">7d Emails</div>
            <div className="text-xl font-bold text-purple-600">{last7.emailsFound}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
