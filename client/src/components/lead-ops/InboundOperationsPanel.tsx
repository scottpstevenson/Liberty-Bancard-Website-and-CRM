import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useUrlParam } from "@/hooks/use-url-param";
import { useCrmQuery } from "@/hooks/use-crm-query";
import { queryClient } from "@/lib/queryClient";
import { intakeCohortLabels, intakeCohortState, typedTabUrl, workReturnFromSearch } from "@/lib/crm-destination-state";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { InboundRequestList, type InboundRequestRow } from "./InboundRequestList";
const SOURCE_CLASSES = ["all", "sales_request", "support_request", "fulfillment_request", "partner_application_request", "privacy_request", "content_reputation", "marketing_opt_in", "imported_provider_event"];
const LIFECYCLES = ["all", "claimed", "processing", "accepted", "completed", "failed", "cancelled", "review_required"];
/** Shared worklist: both intake entrances read the same retained requests and review actions. */
export function InboundOperationsPanel({basePath="/dashboard/lead-ops", enabled=true}: {basePath?: string; enabled?: boolean}) {
  const { user } = useAuth();
  const urlSearch = useSearch();
  const [,navigate] = useLocation();
  const crmFetch = async (url: string, signal?: AbortSignal) => {
    const response = await fetch(url, {credentials:"include", signal});
    if (!response.ok) throw new Error(response.status === 403 ? "You do not have permission to view these requests." : "Requests could not be loaded.");
    return response.json();
  };
  const [inboundPage, setInboundPage] = useUrlParam("formPage", 0, raw => /^\d{1,6}$/.test(raw) ? Number(raw) : undefined);
  const [inboundSourceClass, setInboundSourceClass] = useUrlParam("formType", "all", raw => SOURCE_CLASSES.includes(raw) ? raw : undefined);
  const [inboundLifecycle, setInboundLifecycle] = useUrlParam("formStatus", "all", raw => LIFECYCLES.includes(raw) ? raw : undefined);
  const INBOUND_LIMIT = 25;
  // Short-reference lookup. The reference is the one a requester sees in their confirmation; it is also carried in the
  // URL (?ref=) so a notification or a shared link opens the exact request.
  const refFromUrl = (new URLSearchParams(urlSearch).get("ref") ?? "").trim().toUpperCase().slice(0, 8);
  const [inboundRef, setInboundRef] = useState(refFromUrl);
  const [inboundRefInput, setInboundRefInput] = useState(refFromUrl);
  const [inboundRefError, setInboundRefError] = useState<string | null>(null);
  useEffect(() => {
    setInboundRef(refFromUrl);
    setInboundRefInput(refFromUrl);
    setInboundRefError(null);
  }, [refFromUrl]);
  // Registered group selector (?intake=received|needs_review|statement_attention) opened from a Today/Overview count. The server
  // filters with the predicate that produced the count; an invalid selector is reported, never widened to the full list.
  const intakeSelection = intakeCohortState(urlSearch);
  const intakeCohortKey = intakeSelection.cohort ? `${intakeSelection.cohort}:${intakeSelection.days ?? ""}` : "";
  const clearIntakeCohort = () => navigate(typedTabUrl(basePath, urlSearch, window.location.hash, { tab: basePath === "/dashboard/intake" ? "forms" : "pipeline" }));
  const applyInboundRef = (raw: string) => {
    const value = raw.trim().toUpperCase();
    if (value === "") {
      setInboundRef("");
      setInboundRefError(null);
      navigate(typedTabUrl(basePath, urlSearch, window.location.hash, { tab: basePath === "/dashboard/intake" ? "forms" : "pipeline" }));
      return;
    }
    if (!/^[0-9A-F]{4,8}$/.test(value)) {
      setInboundRefError("A reference is 4 to 8 characters using the digits 0-9 and the letters A-F.");
      return;
    }
    setInboundRefError(null);
    setInboundRef(value);
    setInboundPage(0);
    navigate(typedTabUrl(basePath, urlSearch, window.location.hash, { tab: basePath === "/dashboard/intake" ? "forms" : "pipeline", ref: value }));
  };

  const inboundParams = new URLSearchParams({
    limit: String(INBOUND_LIMIT),
    offset: String(inboundPage * INBOUND_LIMIT),
    ...(inboundSourceClass !== "all" ? { sourceClass: inboundSourceClass } : {}),
    ...(inboundLifecycle !== "all" ? { lifecycleState: inboundLifecycle } : {}),
    ...(inboundRef ? { ref: inboundRef } : {}),
    ...(intakeSelection.cohort ? { cohort: intakeSelection.cohort, ...(intakeSelection.days ? { days: String(intakeSelection.days) } : {}) } : {}),
  });
  const inboundRequestsQuery = useCrmQuery<InboundRequestRow[]>({
    queryKey: ["/api/lead-ops/inbound-requests", inboundPage, inboundSourceClass, inboundLifecycle, inboundRef, intakeCohortKey],
    queryFn: ({ signal }) => crmFetch(`/api/lead-ops/inbound-requests?${inboundParams}`, signal),
    enabled,
  });
  const inboundRequests = inboundRequestsQuery.data || [];

  return (
      <Card className="shadow-sm" data-testid="card-inbound-operations">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base">Intake: website requests</CardTitle>
              <CardDescription className="text-xs mt-1">
                Website requests from the public forms, with the review work, deadline and receipt email for each. Enter the reference from a requester's confirmation to open that request.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0 min-h-11 sm:min-h-8"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/lead-ops/inbound-requests"] })}
              disabled={inboundRequestsQuery.isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${inboundRequestsQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          <form
            className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-start"
            onSubmit={(event) => { event.preventDefault(); applyInboundRef(inboundRefInput); }}
            data-testid="form-inbound-ref-lookup"
          >
            <div className="flex-1 sm:max-w-xs">
              <label htmlFor="inbound-ref-input" className="sr-only">Request reference</label>
              <Input
                id="inbound-ref-input"
                value={inboundRefInput}
                onChange={(event) => setInboundRefInput(event.target.value)}
                placeholder="Reference, for example 269B66AF"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={8}
                className="min-h-11 sm:min-h-9 font-mono"
                aria-invalid={inboundRefError ? true : undefined}
                aria-describedby={inboundRefError ? "inbound-ref-error" : undefined}
                data-testid="input-inbound-ref"
              />
              {inboundRefError && <p id="inbound-ref-error" role="alert" className="mt-1 text-xs text-destructive" data-testid="text-inbound-ref-error">{inboundRefError}</p>}
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="min-h-11 sm:min-h-9" data-testid="button-inbound-ref-lookup">Find request</Button>
              {(inboundRef || inboundRefInput) && (
                <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => { setInboundRefInput(""); applyInboundRef(""); }} data-testid="button-inbound-ref-clear">
                  Show all
                </Button>
              )}
            </div>
          </form>
          <div className="flex flex-wrap gap-2 pt-1">
            <Select value={inboundSourceClass} onValueChange={(value) => { setInboundSourceClass(value); setInboundPage(0); }}>
              <SelectTrigger aria-label="Form request type" className="h-11 sm:h-8 w-full sm:w-48 text-xs"><SelectValue placeholder="All request types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All request types</SelectItem>
                <SelectItem value="sales_request">Sales request</SelectItem>
                <SelectItem value="support_request">Support request</SelectItem>
                <SelectItem value="fulfillment_request">Equipment order</SelectItem>
                <SelectItem value="partner_application_request">Partner application</SelectItem>
                <SelectItem value="privacy_request">Privacy request</SelectItem>
                <SelectItem value="content_reputation">Content &amp; reputation</SelectItem>
                <SelectItem value="marketing_opt_in">Marketing opt-in</SelectItem>
                <SelectItem value="imported_provider_event">Imported provider event</SelectItem>
              </SelectContent>
            </Select>
            <Select value={inboundLifecycle} onValueChange={(value) => { setInboundLifecycle(value); setInboundPage(0); }}>
              <SelectTrigger aria-label="Form request status" className="h-11 sm:h-8 w-full sm:w-48 text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="claimed">Received</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                <SelectItem value="review_required">Needs review</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {workReturnFromSearch(urlSearch) && (
            <p className="pt-1 text-xs" data-testid="inbound-work-return">
              <a className="text-blue-600 hover:underline inline-flex items-center min-h-11 lg:min-h-0" href={workReturnFromSearch(urlSearch)!}>Back to Work</a>
            </p>
          )}
          {(intakeSelection.cohort || intakeSelection.issues.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 pt-2 text-xs" data-testid="inbound-intake-cohort">
              {intakeSelection.cohort && (
                <>
                  <Badge variant="secondary" data-testid="inbound-intake-cohort-label">
                    {intakeCohortLabels[intakeSelection.cohort]}{intakeSelection.days ? ` (last ${intakeSelection.days} days)` : ""}
                  </Badge>
                  <span className="text-muted-foreground">The requests counted under this name on Today and Overview.</span>
                  <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={clearIntakeCohort} data-testid="button-inbound-intake-cohort-clear">Show all requests</Button>
                </>
              )}
              {intakeSelection.issues.length > 0 && <span role="alert" className="text-destructive" data-testid="inbound-intake-cohort-issue">{intakeSelection.issues[0].reason}</span>}
            </div>
          )}
          {inboundRef && !inboundRequestsQuery.isError && !inboundRequestsQuery.isLoading && (
            <p className="text-xs text-muted-foreground pt-1" role="status" data-testid="text-inbound-ref-result">
              {inboundRequests.length === 0
                ? `No request starts with ${inboundRef}. Check the reference exactly as shown in the confirmation.`
                : inboundRequests.length === 1
                  ? `Showing the request that starts with ${inboundRef}.`
                  : `${inboundRequests.length} requests start with ${inboundRef}. Enter more characters of the reference to narrow it to one.`}
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {inboundRequestsQuery.isError ? (
            <div className="px-4 sm:px-6 py-8 space-y-3" role="alert" data-testid="inbound-unavailable">
              <p className="text-sm text-destructive">
                Inbound requests are unavailable right now, so this is not an all-clear. {inboundRequestsQuery.error instanceof Error ? inboundRequestsQuery.error.message : ""}
              </p>
              <Button variant="outline" className="min-h-11 sm:min-h-9" onClick={() => inboundRequestsQuery.refetch()} data-testid="button-inbound-retry">Retry</Button>
            </div>
          ) : (
            <InboundRequestList requests={inboundRequests} isLoading={inboundRequestsQuery.isLoading} isAdmin={user?.role === "admin"} />
          )}
        </CardContent>
        <div className="flex flex-col gap-2 border-t px-4 sm:px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {inboundRequestsQuery.isLoading ? "Loading requests…" : `Page ${inboundPage + 1} · up to ${INBOUND_LIMIT} requests`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={inboundPage === 0 || inboundRequestsQuery.isFetching} onClick={() => setInboundPage(inboundPage - 1)}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" disabled={inboundRequests.length < INBOUND_LIMIT || inboundRequestsQuery.isFetching} onClick={() => setInboundPage(inboundPage + 1)}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </Card>

  );
}
