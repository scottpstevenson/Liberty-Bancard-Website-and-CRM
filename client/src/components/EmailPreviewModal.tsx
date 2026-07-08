import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Info } from "lucide-react";

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
}

export default function EmailPreviewModal({
  open,
  onOpenChange,
  subject,
  body,
  mergeTagSamples,
  contentType = "html",
}: EmailPreviewModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Email Preview
            <Badge variant="outline" className="text-xs font-normal">
              Sample data substituted
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <EmailPreviewContent
            subject={subject}
            body={body}
            mergeTagSamples={mergeTagSamples}
            contentType={contentType}
            showComplianceNotice
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { substituteMergeTags, escapeHtml, DEFAULT_MERGE_TAG_SAMPLES };
