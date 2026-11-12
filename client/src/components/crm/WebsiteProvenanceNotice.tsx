import { AlertTriangle } from "lucide-react";
import {
  WEBSITE_SOURCE_REVIEW_COPY, classifyWebsiteSourceDomain, hasIndependentOwnershipEvidence,
} from "@shared/source-domain-provenance";

/**
 * Shown on a business whose website is a directory, profile or government host. The notice states what the site
 * proves (where the business was seen), what it does not prove (ownership), and that address validation does not
 * change that. It uses the same shared rule the recipient gate uses, so the page and the gate cannot disagree.
 */
export function WebsiteProvenanceNotice({ website, sourceTypes, className = "" }: {
  website: string | null | undefined; sourceTypes: ReadonlyArray<string | null | undefined>; className?: string;
}) {
  const kind = classifyWebsiteSourceDomain(website);
  if (!kind) return null;
  const independent = hasIndependentOwnershipEvidence(sourceTypes);
  return (
    <div role="note" data-testid="website-provenance-notice" data-ownership-evidence={independent ? "independent" : "none"}
      className={`flex gap-2 rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 ${className}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">{kind === "government" ? "Government website" : "Directory or profile website"}: {website}</p>
        <p>{WEBSITE_SOURCE_REVIEW_COPY[kind]}</p>
        <p>{independent
          ? "An independent registry or CRM organization link exists, so this website alone does not block the business."
          : WEBSITE_SOURCE_REVIEW_COPY.action}</p>
      </div>
    </div>
  );
}
