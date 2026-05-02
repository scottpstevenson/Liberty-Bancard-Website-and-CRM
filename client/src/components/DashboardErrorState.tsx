import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
    <Alert variant="destructive" data-testid="dashboard-error-state" className="my-4">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle data-testid="text-error-title">{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span data-testid="text-error-message">{message}</span>
        {onRetry && (
          <Button
            onClick={onRetry}
            variant="outline"
            size="sm"
            className="gap-2 w-fit"
            data-testid="button-retry"
          >
            <RefreshCw className="h-4 w-4" />
            Try Again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
