import { toast as baseToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

export interface ToastErrorOptions {
  title?: string;
  retry?: () => void;
  retryLabel?: string;
}

function normalizeMessage(err: unknown): string {
  if (!err) return "Please try again or contact support if the problem persists.";
  if (err instanceof Error) {
    const msg = err.message || "";
    if (msg.startsWith("429:")) {
      return "Too many requests — please wait a moment and try again.";
    }
    if (/^5\d{2}:/.test(msg)) {
      return "Something went wrong on our end — please try again shortly.";
    }
    if (/^4\d{2}:/.test(msg)) {
      const cleaned = msg.replace(/^4\d{2}:\s*/, "").trim();
      try {
        const parsed = JSON.parse(cleaned);
        if (parsed?.message) return String(parsed.message);
      } catch {}
      return cleaned || "Request failed. Please check your input and try again.";
    }
    if (/network|fetch|failed to fetch/i.test(msg)) {
      return "Network error — please check your connection and try again.";
    }
    return msg || "Something went wrong. Please try again.";
  }
  if (typeof err === "string") return err;
  return "Something went wrong. Please try again.";
}

export function toastError(err: unknown, opts: ToastErrorOptions = {}): void {
  const description = normalizeMessage(err);
  const retry = opts.retry;
  baseToast({
    title: opts.title || "Something went wrong",
    description,
    variant: "destructive",
    action: retry ? (
      <ToastAction
        altText={opts.retryLabel || "Try again"}
        onClick={() => retry()}
        data-testid="toast-action-retry"
      >
        {opts.retryLabel || "Try again"}
      </ToastAction>
    ) : undefined,
  });
}
