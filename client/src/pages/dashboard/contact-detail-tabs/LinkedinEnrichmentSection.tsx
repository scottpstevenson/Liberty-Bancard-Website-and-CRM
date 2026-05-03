import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Linkedin, RefreshCw, Info, ChevronDown, ChevronUp } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { Contact } from "@shared/schema";

interface Props {
  contact: Contact;
  proxycurlConfigured: boolean;
  showLinkedinHistory: boolean;
  setShowLinkedinHistory: Dispatch<SetStateAction<boolean>>;
  enrichLinkedInMutation: { mutate: () => void; isPending: boolean };
}

export function LinkedinEnrichmentSection({
  contact,
  proxycurlConfigured,
  showLinkedinHistory,
  setShowLinkedinHistory,
  enrichLinkedInMutation,
}: Props) {
  if (!contact.linkedinUrl) return null;
  const log = ((contact as any).linkedinEnrichmentLog ?? []) as Array<{
    enrichedAt: string;
    provider: string;
    fieldsUpdated: string[];
    connectionCount?: number;
    lastActivityDate?: string;
    title?: string;
    companyName?: string;
    activitySummary?: string | null;
  }>;
  const latest = log[0];
  return (
    <div className="rounded-lg border bg-card" data-testid="section-linkedin-enrichment">
      <div className="flex items-center gap-3 p-3">
        <Linkedin className="h-4 w-4 text-blue-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {(contact as any).linkedinEnrichedAt ? (
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/20 dark:text-blue-300 dark:border-blue-700" data-testid="badge-linkedin-enriched">
                Enriched {new Date((contact as any).linkedinEnrichedAt).toLocaleDateString()}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground" data-testid="badge-linkedin-never-enriched">
                Never enriched
              </Badge>
            )}
            <a
              href={contact.linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline truncate max-w-[200px]"
              data-testid="link-linkedin-url"
            >
              {contact.linkedinUrl}
            </a>
          </div>
          {latest && (
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {latest.connectionCount != null && (
                <span className="text-xs text-muted-foreground" data-testid="text-linkedin-connections">
                  {latest.connectionCount.toLocaleString()} connections
                </span>
              )}
              {latest.lastActivityDate && (
                <span className="text-xs text-muted-foreground" data-testid="text-linkedin-last-active">
                  Last active: {latest.lastActivityDate}
                </span>
              )}
              {latest.title && (
                <span className="text-xs text-muted-foreground truncate max-w-[200px]" data-testid="text-linkedin-title">
                  {latest.title}{latest.companyName ? ` · ${latest.companyName}` : ""}
                </span>
              )}
              {latest.fieldsUpdated?.length > 0 && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400" data-testid="text-linkedin-fields-updated">
                  Updated: {latest.fieldsUpdated.join(", ")}
                </span>
              )}
              {latest.activitySummary && (
                <span className="text-xs text-muted-foreground italic w-full" data-testid="text-linkedin-activity-summary">
                  Recent activity: {latest.activitySummary.slice(0, 120)}{latest.activitySummary.length > 120 ? "…" : ""}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!proxycurlConfigured && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center cursor-default" data-testid="badge-proxycurl-missing">
                    <Info className="h-4 w-4 text-amber-500" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <p className="text-xs">Proxycurl API key not configured. Go to <strong>Settings → Integrations</strong> to add your key.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => enrichLinkedInMutation.mutate()}
            disabled={enrichLinkedInMutation.isPending}
            data-testid="button-enrich-linkedin"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${enrichLinkedInMutation.isPending ? "animate-spin" : ""}`} />
            {enrichLinkedInMutation.isPending ? "Enriching..." : "Enrich from LinkedIn"}
          </Button>
        </div>
      </div>

      {/* Enrichment History Toggle */}
      <div className="border-t px-3 py-1.5">
        {log.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1" data-testid="text-linkedin-no-history">
            No enrichment history yet.
          </p>
        ) : (
          <>
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left py-1"
              onClick={() => setShowLinkedinHistory(v => !v)}
              data-testid="button-toggle-linkedin-history"
            >
              {showLinkedinHistory ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              Enrichment History ({log.length} {log.length === 1 ? "run" : "runs"})
            </button>

            {showLinkedinHistory && (
              <div className="mt-1 mb-2 space-y-2" data-testid="section-linkedin-history-list">
                {log.map((entry, idx) => (
                  <div
                    key={idx}
                    className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-1"
                    data-testid={`card-linkedin-history-${idx}`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-medium text-foreground" data-testid={`text-linkedin-history-date-${idx}`}>
                        {new Date(entry.enrichedAt).toLocaleString()}
                      </span>
                      <Badge variant="outline" className="text-[10px] py-0 h-4" data-testid={`badge-linkedin-history-provider-${idx}`}>
                        {entry.provider}
                      </Badge>
                    </div>
                    {entry.fieldsUpdated?.length > 0 ? (
                      <div className="flex flex-wrap gap-1" data-testid={`text-linkedin-history-fields-${idx}`}>
                        <span className="text-muted-foreground">Fields updated:</span>
                        {entry.fieldsUpdated.map(f => (
                          <span key={f} className="text-emerald-600 dark:text-emerald-400 font-medium">{f}</span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground italic" data-testid={`text-linkedin-history-no-fields-${idx}`}>
                        No fields updated (all already populated)
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3 text-muted-foreground">
                      {entry.title && (
                        <span data-testid={`text-linkedin-history-title-${idx}`}>
                          {entry.title}{entry.companyName ? ` · ${entry.companyName}` : ""}
                        </span>
                      )}
                      {entry.connectionCount != null && (
                        <span data-testid={`text-linkedin-history-connections-${idx}`}>
                          {entry.connectionCount.toLocaleString()} connections
                        </span>
                      )}
                      {entry.lastActivityDate && (
                        <span data-testid={`text-linkedin-history-lastactive-${idx}`}>
                          Last active: {entry.lastActivityDate}
                        </span>
                      )}
                    </div>
                    {entry.activitySummary && (
                      <p className="italic text-muted-foreground" data-testid={`text-linkedin-history-summary-${idx}`}>
                        {entry.activitySummary.slice(0, 160)}{entry.activitySummary.length > 160 ? "…" : ""}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
