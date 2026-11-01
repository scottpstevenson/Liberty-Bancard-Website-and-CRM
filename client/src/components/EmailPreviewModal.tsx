import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { FinalEmailPreview, type FinalMessagePreview } from "@/components/dashboard/MessageFinalPreview";

const DEFAULT_MERGE_TAG_SAMPLES: Record<string, string> = {
  firstName: "Alex",
  companyName: "Your Business",
  businessName: "Your Business",
  bookingLink: "https://calendly.com/liberty-bancard/intro",
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function substituteMergeTags(
  template: string,
  samples: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, tagName) => {
    if (Object.prototype.hasOwnProperty.call(samples, tagName)) {
      return escapeHtml(samples[tagName]);
    }
    return match;
  });
}

interface EmailPreviewContentProps {
  subject?: string;
  body: string;
  mergeTagSamples?: Record<string, string>;
  contentType?: "html" | "text";
  showComplianceNotice?: boolean;
  className?: string;
}

export function EmailPreviewContent({
  subject,
  body,
  mergeTagSamples,
  contentType = "html",
  showComplianceNotice = true,
  className = "",
}: EmailPreviewContentProps) {
  const samples = { ...DEFAULT_MERGE_TAG_SAMPLES, ...mergeTagSamples };
  const previewSubject = subject ? substituteMergeTags(subject, samples) : "";
  const previewBody = substituteMergeTags(body || "", samples);
  const isHtml = contentType === "html";

  const iframeSrcDoc = isHtml
    ? `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;font-size:14px;line-height:1.6;padding:12px;margin:0;word-break:break-word;}a{color:#2563eb;}</style></head><body>${previewBody}</body></html>`
    : "";

  const hasNoContent = !previewSubject && !previewBody;

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {previewSubject && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            Subject
          </p>
          <p
            className="text-sm font-medium border rounded px-3 py-2 bg-muted/40"
            data-testid="preview-subject"
          >
            {previewSubject}
          </p>
        </div>
      )}

      {hasNoContent ? (
        <p className="text-sm text-muted-foreground italic py-4 text-center" data-testid="preview-no-content">
          No previewable content for this step type.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {subject !== undefined && (
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
              Body
            </p>
          )}
          {isHtml ? (
            <iframe
              sandbox=""
              srcDoc={iframeSrcDoc}
              title="Email body preview"
              className="w-full rounded border bg-white min-h-[180px]"
              data-testid="preview-body-iframe"
            />
          ) : (
            <pre
              className="w-full rounded border bg-muted/40 p-3 text-sm overflow-auto whitespace-pre-wrap font-mono min-h-[80px]"
              data-testid="preview-body-text"
            >
              {escapeHtml(previewBody)}
            </pre>
          )}
        </div>
      )}

      {showComplianceNotice && !hasNoContent && (
        <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 shrink-0">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Preview only — compliance footer injected at send time. Sample
            values used: firstName=&quot;Alex&quot;,
            companyName=&quot;Your Business&quot;.
          </span>
        </div>
      )}
    </div>
  );
}

interface EmailPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: string;
  body: string;
  mergeTagSamples?: Record<string, string>;
  contentType?: "html" | "text";
  /** Identity of the stored step. When given, the modal shows the message as the real send path would assemble it. */
  asset?: { assetType: "sequence" | "campaign"; assetId: number; stepId: number };
}

interface AssetPreviewResponse {
  ok: boolean;
  error: { code: string; detail: string } | null;
  final: FinalMessagePreview | null;
  asset: { assetName: string; stepOrder: number; path: string; signature: string | null; aiPersonalization?: boolean } | null;
  warnings: string[];
}

/** Server-resolved "as sent" preview: transport, signature and substitution come from the asset, not from this screen. */
function AssetFinalPreview({ asset }: { asset: NonNullable<EmailPreviewModalProps["asset"]> }) {
  const q = useQuery<AssetPreviewResponse>({
    queryKey: ["asset-step-preview", asset.assetType, asset.assetId, asset.stepId],
    queryFn: async () => (await apiRequest("POST", "/api/message-steps/asset-preview", asset)).json(),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground" data-testid="asset-preview-loading">Building the message as it would be sent...</p>;
  if (q.isError || !q.data) return <p role="alert" className="text-sm text-destructive" data-testid="asset-preview-error">The sent-message preview could not be built. This is not a blank message.</p>;
  const d = q.data;
  return (
    <div className="space-y-2" data-testid="asset-final-preview">
      {d.asset && (
        <p className="text-xs text-muted-foreground" data-testid="asset-preview-path">
          {d.asset.assetName}, step {d.asset.stepOrder}. Path: {d.asset.path}{d.asset.signature ? `. Signature: ${d.asset.signature}` : ""}.
        </p>
      )}
      {d.warnings.map((w) => <p key={w} role="status" className="text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-2" data-testid="asset-preview-warning">{w}</p>)}
      {!d.ok && <p role="alert" className="text-sm text-destructive" data-testid="asset-preview-blocked">A real send would be blocked: {d.error?.detail}</p>}
      {d.final && <p className="text-sm font-medium rounded-md border bg-muted/40 px-3 py-2" data-testid="asset-preview-subject">Subject: {d.final.subject}</p>}
      {d.final && <FinalEmailPreview final={d.final} />}
    </div>
  );
}

export default function EmailPreviewModal({
  open,
  onOpenChange,
  subject,
  body,
  mergeTagSamples,
  contentType = "html",
  asset,
}: EmailPreviewModalProps) {
  const showAsSent = !!asset && contentType === "html";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {showAsSent ? "Message as sent" : "Email Preview"}
            <Badge variant="outline" className="text-xs font-normal">
              {showAsSent ? "Simulation, sample recipient" : "Sample data substituted"}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {showAsSent && <AssetFinalPreview asset={asset!} />}
          {showAsSent ? (
            <details className="mt-3 text-sm" data-testid="editor-sample-details">
              <summary className="cursor-pointer text-muted-foreground">Editor sample (not the sent message)</summary>
              <EmailPreviewContent
                subject={subject}
                body={body}
                mergeTagSamples={mergeTagSamples}
                contentType={contentType}
                showComplianceNotice
              />
            </details>
          ) : (
          <EmailPreviewContent
            subject={subject}
            body={body}
            mergeTagSamples={mergeTagSamples}
            contentType={contentType}
            showComplianceNotice
          />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { substituteMergeTags, escapeHtml, DEFAULT_MERGE_TAG_SAMPLES };
