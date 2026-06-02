import { Component, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
  isChunkError: boolean;
}

function isChunkLoadError(error: Error): boolean {
  return (
    error.name === "ChunkLoadError" ||
    /loading chunk \d+ failed/i.test(error.message) ||
    /failed to fetch dynamically imported module/i.test(error.message) ||
    /importing a module script failed/i.test(error.message)
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, showDetails: false, isChunkError: false };
  }

  static getDerivedStateFromError(error: Error): Omit<State, "showDetails"> {
    return { hasError: true, error, isChunkError: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught an error:", error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  toggleDetails = () => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render() {
    if (this.state.hasError) {
      const { error, showDetails, isChunkError } = this.state;
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4" data-testid="error-boundary-fallback">
          <Card className="max-w-md w-full">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2" data-testid="text-error-boundary-title">
                {isChunkError ? "Page failed to load" : "Something went wrong"}
              </h2>
              <p className="text-sm text-muted-foreground mb-2" data-testid="text-error-boundary-message">
                {isChunkError
                  ? "A page chunk could not be loaded. This can happen after a deployment. Reloading will fix it."
                  : "An unexpected error occurred. You can try reloading the page or report this issue so we can look into it."}
              </p>
              <p className="text-xs text-muted-foreground mb-6 font-mono">
                Liberty Bancard
              </p>
              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <Button onClick={this.handleReload} className="gap-2" data-testid="button-reload-page">
                  <RefreshCw className="w-4 h-4" />
                  Reload page
                </Button>
                {!isChunkError && (
                  <Button
                    variant="outline"
                    asChild
                    data-testid="link-report-issue"
                  >
                    <a href="mailto:support@libertybancard.com?subject=App%20Error%20Report">
                      Report Issue
                    </a>
                  </Button>
                )}
              </div>
              {!isChunkError && error?.message && (
                <div className="w-full text-left">
                  <button
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mx-auto"
                    onClick={this.toggleDetails}
                    data-testid="button-toggle-error-details"
                  >
                    {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {showDetails ? "Hide" : "Show"} error details
                  </button>
                  {showDetails && (
                    <pre
                      className="mt-2 p-3 bg-muted rounded text-xs text-muted-foreground overflow-auto max-h-32 text-left w-full"
                      data-testid="text-error-details"
                    >
                      {error.message}
                    </pre>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
