import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface DashboardErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export default function DashboardErrorState({
  title = "Failed to load data",
  message = "Something went wrong while loading this page. Please try again.",
  onRetry,
}: DashboardErrorStateProps) {
  return (
    <Card data-testid="dashboard-error-state">
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <AlertTriangle className="h-10 w-10 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-1" data-testid="text-error-title">{title}</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-md" data-testid="text-error-message">{message}</p>
        {onRetry && (
          <Button onClick={onRetry} variant="outline" className="gap-2" data-testid="button-retry">
            <RefreshCw className="h-4 w-4" />
            Try Again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
