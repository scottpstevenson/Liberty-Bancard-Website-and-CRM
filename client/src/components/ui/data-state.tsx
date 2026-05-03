import { ReactNode } from "react";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface QueryLike {
  isLoading?: boolean;
  isPending?: boolean;
  isError?: boolean;
  error?: unknown;
  data?: unknown;
  refetch?: () => unknown;
}

interface DataStateProps {
  query: QueryLike;
  children: ReactNode;
  emptyMessage?: string;
  emptyTitle?: string;
  emptyAction?: ReactNode;
  errorTitle?: string;
  errorMessage?: string;
  loadingFallback?: ReactNode;
  isEmpty?: (data: unknown) => boolean;
  testId?: string;
}

function defaultIsEmpty(data: unknown): boolean {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.data)) return (d.data as unknown[]).length === 0;
    if (typeof d.total === "number") return d.total === 0;
  }
  return false;
}

export function DataState({
  query,
  children,
  emptyMessage = "There's nothing to show here yet.",
  emptyTitle = "No results",
  emptyAction,
  errorTitle = "Failed to load data",
  errorMessage,
  loadingFallback,
  isEmpty = defaultIsEmpty,
  testId,
}: DataStateProps) {
  const loading = query.isLoading ?? query.isPending ?? false;

  if (loading) {
    return (
      <div data-testid={testId ? `${testId}-loading` : "datastate-loading"}>
        {loadingFallback ?? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
      </div>
    );
  }

  if (query.isError) {
    const msg =
      errorMessage ||
      (query.error instanceof Error ? query.error.message : "Something went wrong while loading. Please try again.");
    return (
      <Alert variant="destructive" data-testid={testId ? `${testId}-error` : "datastate-error"} className="my-4">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{errorTitle}</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{msg}</span>
          {query.refetch && (
            <Button
              onClick={() => query.refetch?.()}
              variant="outline"
              size="sm"
              className="gap-2 w-fit"
              data-testid={testId ? `${testId}-retry` : "datastate-retry"}
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  if (isEmpty(query.data)) {
    return (
      <div
        className="flex flex-col items-center justify-center text-center py-10 px-4 gap-3"
        data-testid={testId ? `${testId}-empty` : "datastate-empty"}
      >
        <Inbox className="w-10 h-10 text-muted-foreground/40" />
        <div>
          <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">{emptyMessage}</p>
        </div>
        {emptyAction}
      </div>
    );
  }

  return <>{children}</>;
}

export default DataState;
