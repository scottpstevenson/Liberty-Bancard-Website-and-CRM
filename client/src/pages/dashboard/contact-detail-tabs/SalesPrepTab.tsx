import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Wand2, RefreshCw, MessageSquare, Target, ShieldAlert, ArrowRight, FileText } from "lucide-react";

interface SalesPrepOutput {
  callOpener: string;
  processorAngle: string;
  likelyObjection: string;
  recommendedCta: string;
  statementAsk: string;
}

interface SalesPrepStatus {
  sdrSourced: boolean;
  cached: SalesPrepOutput | null;
  cacheKey: string | null;
  generatedAt: string | null;
  canGenerate: boolean;
}

interface SalesPrepResult {
  output: SalesPrepOutput;
  generatedAt: string;
  fromCache: boolean;
  model: string;
}

interface SalesPrepTabProps {
  contactId: number;
}

export function SalesPrepTab({ contactId }: SalesPrepTabProps) {
  const { toast } = useToast();
  const [localResult, setLocalResult] = useState<SalesPrepResult | null>(null);

  const statusQuery = useQuery<SalesPrepStatus>({
    queryKey: [`/api/contacts/${contactId}/sales-prep`],
    staleTime: Infinity,
  });

  const generateMutation = useMutation({
    mutationFn: (): Promise<SalesPrepResult> =>
      apiRequest("POST", `/api/contacts/${contactId}/sales-prep/generate`),
    onSuccess: (data) => {
      setLocalResult(data);
      statusQuery.refetch();
    },
    onError: () => {
      toast({ title: "Generation failed", description: "Could not generate sales prep. Please try again.", variant: "destructive" });
    },
  });

  if (statusQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loader-sales-prep">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const status = statusQuery.data;
  if (!status?.sdrSourced) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm" data-testid="text-not-sdr-sourced">
          Sales prep is only available for SDR-sourced contacts.
        </CardContent>
      </Card>
    );
  }

  const output: SalesPrepOutput | null = localResult?.output ?? status.cached ?? null;
  const generatedAt: string | null = localResult?.generatedAt ?? status.generatedAt ?? null;
  const model: string | null = localResult?.model ?? null;

  if (!output) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            AI Sales Prep
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground" data-testid="text-no-cache">
            Generate an AI-powered sales brief for this contact — call opener, processor angle, likely objections, CTA, and statement ask.
          </p>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            data-testid="button-generate-sales-prep"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4 mr-2" />
                Generate Sales Prep
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold" data-testid="text-sales-prep-heading">AI Sales Prep</h3>
          {generatedAt && (
            <Badge variant="secondary" className="text-xs" data-testid="badge-generated-at">
              {new Date(generatedAt).toLocaleDateString()}
            </Badge>
          )}
          {model && model !== "test-fixture" && (
            <Badge variant="outline" className="text-xs" data-testid="badge-model">{model}</Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          data-testid="button-regenerate-sales-prep"
          aria-label="Regenerate sales prep"
        >
          {generateMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <Card data-testid="card-call-opener">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-blue-500" />
            Call Opener
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm" data-testid="text-call-opener">{output.callOpener}</p>
        </CardContent>
      </Card>

      <Card data-testid="card-processor-angle">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Target className="h-4 w-4 text-green-500" />
            Processor Angle
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm" data-testid="text-processor-angle">{output.processorAngle}</p>
        </CardContent>
      </Card>

      <Card data-testid="card-likely-objection">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-500" />
            Likely Objection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm" data-testid="text-likely-objection">{output.likelyObjection}</p>
        </CardContent>
      </Card>

      <Card data-testid="card-recommended-cta">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-purple-500" />
            Recommended CTA
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm" data-testid="text-recommended-cta">{output.recommendedCta}</p>
        </CardContent>
      </Card>

      <Card data-testid="card-statement-ask">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-500" />
            Statement Ask
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm" data-testid="text-statement-ask">{output.statementAsk}</p>
        </CardContent>
      </Card>
    </div>
  );
}
