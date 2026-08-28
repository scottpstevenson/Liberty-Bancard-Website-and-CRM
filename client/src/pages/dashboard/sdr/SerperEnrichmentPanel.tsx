import { Card, CardContent } from "@/components/ui/card";
import { Globe } from "lucide-react";

export function SerperEnrichmentPanel() {
  return (
    <Card data-testid="card-serper-disabled">
      <CardContent className="p-6 text-center text-muted-foreground">
        <Globe className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <div className="font-medium">Serper enrichment is disabled</div>
        <div className="text-xs mt-1">Direct provider execution is retired. Use CRO-03 staging review; provider transport remains unavailable.</div>
      </CardContent>
    </Card>
  );
}
