import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RECORD_CLASS_LABELS } from "@/lib/record-class";

type Section<T> = ({ available: true } & T) | { available: false; reason: string };
interface ReviewCohorts {
  asOf: string; readOnly: true; sampleLimit: number; note: string;
  nonProductionRecords: Section<{
    dealsByClass: Array<{ recordClass: string; count: number }>;
    applicationsByLinkedContactClass: Array<{ recordClass: string; count: number }>;
    dealSample: Array<{ dealId: string; recordClass: string | null }>;
    applicationSample: Array<{ applicationId: string; status: string | null; contactId: number; contactRecordClass: string | null }>;
  }>;
  legacyQaSignatureInProduction: Section<{
    contactCount: number; dealsExcludedFromProductionReads: number;
    sample: Array<{ contactId: number; createdAt: string | null; archived: boolean }>;
  }>;
  directoryDomainBusinesses: Section<{
    businessCount: number;
    sample: Array<{ businessId: number; websiteDomain: string; sourceLinkCount: number; sourceTypes: string[];
      linkedProductionContacts: number; contactsWithValidEmail: number; matchBasis: string }>;
  }>;
}

const classLabel = (value: string) => value === "unlinked" ? "No linked contact" : RECORD_CLASS_LABELS[value] ?? value;

function Unavailable({ reason }: { reason: string }) {
  return <p className="text-sm text-muted-foreground" role="status">Unavailable. {reason} No count is shown.</p>;
}

/** Read-only cohorts for admins and managers. It lists records for review; it changes nothing. */
export function RecordClassReviewPanel() {
  const query = useQuery<ReviewCohorts>({
    queryKey: ["/api/admin/commercial-classification/review-cohorts"],
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/admin/commercial-classification/review-cohorts", { credentials: "include", signal });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });
  const data = query.data;
  return (
    <Card data-testid="record-class-review-panel">
      <CardHeader>
        <CardTitle className="text-base">Record class and website provenance review</CardTitle>
        <CardDescription>
          {data?.note ?? "Read-only lists of records whose class or website source needs a person to review them."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {query.isLoading && <p className="text-muted-foreground">Loading review cohorts</p>}
        {query.isError && (
          <div role="alert" className="space-y-2">
            <p>Review cohorts could not be loaded, so no counts are shown.</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Retry</Button>
          </div>
        )}
        {data && (
          <>
            <section aria-labelledby="rc-nonprod" className="space-y-2">
              <h3 id="rc-nonprod" className="font-medium">Test, demo, synthetic and unreviewed records</h3>
              {!data.nonProductionRecords.available ? <Unavailable reason={data.nonProductionRecords.reason} /> : (
                <>
                  <p>Deals outside the production class: {data.nonProductionRecords.dealsByClass.length === 0 ? "none" :
                    data.nonProductionRecords.dealsByClass.map(r => `${classLabel(r.recordClass)} ${r.count}`).join(", ")}.</p>
                  <p>Applications by linked contact class (production-linked applications are not listed): {data.nonProductionRecords.applicationsByLinkedContactClass.length === 0 ? "none" :
                    data.nonProductionRecords.applicationsByLinkedContactClass.map(r => `${classLabel(r.recordClass)} ${r.count}`).join(", ")}.</p>
                  <p className="text-xs text-muted-foreground">Applications with no linked contact stay visible and are not treated as test records.</p>
                </>
              )}
            </section>
            <section aria-labelledby="rc-qa" className="space-y-2">
              <h3 id="rc-qa" className="font-medium">Production contacts that match the legacy QA signature</h3>
              {!data.legacyQaSignatureInProduction.available ? <Unavailable reason={data.legacyQaSignatureInProduction.reason} /> : (
                <>
                  <p>{data.legacyQaSignatureInProduction.contactCount} contacts. Their deals ({data.legacyQaSignatureInProduction.dealsExcludedFromProductionReads}) are excluded from production boards and KPIs. Their class is unchanged until a reviewed classification command is approved.</p>
                  {data.legacyQaSignatureInProduction.sample.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {data.legacyQaSignatureInProduction.sample.map(r => (
                        <li key={r.contactId}><Link className="underline" href={`/dashboard/contacts/${r.contactId}`}>Contact {r.contactId}{r.archived ? " (archived)" : ""}</Link></li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
            <section aria-labelledby="rc-domain" className="space-y-2">
              <h3 id="rc-domain" className="font-medium">Businesses whose website is a directory or government host</h3>
              {!data.directoryDomainBusinesses.available ? <Unavailable reason={data.directoryDomainBusinesses.reason} /> : (
                <>
                  <p>{data.directoryDomainBusinesses.businessCount} businesses have no independent ownership evidence. They stay in review and cannot become outreach recipients; a valid email address does not change that.</p>
                  {data.directoryDomainBusinesses.sample.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead><tr><th className="py-1 pr-3">Business</th><th className="pr-3">Website</th><th className="pr-3">Source links</th><th className="pr-3">Contacts</th><th>Valid emails</th></tr></thead>
                        <tbody>
                          {data.directoryDomainBusinesses.sample.map(r => (
                            <tr key={r.businessId} className="border-t">
                              <td className="py-1 pr-3"><Link className="underline" href={`/dashboard/lead-ops/business/${r.businessId}`}>Business {r.businessId}</Link></td>
                              <td className="pr-3">{r.websiteDomain}</td>
                              <td className="pr-3" title={r.sourceTypes.join(", ")}>{r.sourceLinkCount}</td>
                              <td className="pr-3">{r.linkedProductionContacts}</td>
                              <td>{r.contactsWithValidEmail}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
            <p className="text-xs text-muted-foreground">As of {new Date(data.asOf).toLocaleString()}. Showing up to {data.sampleLimit} records per list.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
