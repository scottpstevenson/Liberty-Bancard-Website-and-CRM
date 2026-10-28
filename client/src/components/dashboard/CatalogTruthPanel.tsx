import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CatalogClass, CatalogPackage, CatalogTruth, ReadinessFact } from "@shared/catalog-truth-contract";

export const CATALOG_TRUTH_URL = "/api/admin/catalog-truth";

export interface CatalogTruthViewProps {
  data?: CatalogTruth | null;
  error?: Error | null;
  isLoading?: boolean;
  onRetry?: () => void;
}

const CLASS_LABEL: Record<CatalogClass, string> = {
  current: "Current", template: "Template (draft)", historical: "Historical", uninstalled: "Planned, not installed", unresolved: "Unresolved",
};

function factBadge(label: string, fact: ReadinessFact) {
  const variant = fact.state === "yes" ? "secondary" : fact.state === "no" ? "destructive" : "outline";
  return (
    <Badge key={label} variant={variant} title={fact.basis} data-testid={`fact-${label}`}>
      {label}: {fact.state}
    </Badge>
  );
}

function PackageRow({ pkg }: { pkg: CatalogPackage }) {
  const r = pkg.readiness;
  return (
    <div className="rounded-md border p-3 text-sm" data-testid={`catalog-package-${pkg.packageKey}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{pkg.packageKey}</span>
        <Badge variant="outline">{pkg.vertical}</Badge>
        <Badge variant="outline">{pkg.lifecycleState}</Badge>
        {pkg.catalogClass === "unresolved" && <Badge variant="destructive">unresolved</Badge>}
      </div>
      <div className="mt-1 font-mono text-xs text-muted-foreground">
        version {pkg.packageVersionId} · campaign #{pkg.campaignId} · sequence #{pkg.sequenceId}
        {pkg.pinsResolved ? "" : " · pin does not resolve"}
      </div>
      {pkg.catalogClass === "unresolved" && <p className="mt-1 text-xs text-destructive">{pkg.classReason}</p>}
      <div className="mt-2 flex flex-wrap gap-1">
        {factBadge("installed", r.configured)}
        {factBadge("selected", r.selected)}
        {factBadge("content verified", r.contentVerified)}
        {factBadge("qualified", r.qualified)}
        {factBadge("sequence paused", r.paused)}
        {factBadge("status active", r.statusActive)}
        {factBadge("runtime selected", r.runtimeSelected)}
        {factBadge("operational evidence", r.operationalEvidence)}
        {factBadge("native effect", r.nativeEffectVerified)}
      </div>
      {r.qualified.state !== "yes" && <p className="mt-1 text-xs text-muted-foreground">Qualification: {r.qualified.basis}</p>}
    </div>
  );
}

function isDenied(error: Error) {
  return /^(401|403)\b/.test(error.message);
}

/** Pure view so every state (loading, denied, unavailable, empty, populated) can be mounted without a network. */
export function CatalogTruthView({ data, error, isLoading, onRetry }: CatalogTruthViewProps) {
  const header = (
    <CardHeader>
      <CardTitle>Campaign package catalog</CardTitle>
      <CardDescription>
        Derived from package pins and retirement, never from names or status. Installed is not qualified, and neither is permission to send.
      </CardDescription>
    </CardHeader>
  );
  if (isLoading && !data && !error) {
    return <Card data-testid="catalog-truth-loading">{header}<CardContent><p className="text-sm text-muted-foreground">Loading catalog…</p></CardContent></Card>;
  }
  if (error) {
    const denied = isDenied(error);
    return (
      <Card data-testid={denied ? "catalog-truth-denied" : "catalog-truth-unavailable"}>
        {header}
        <CardContent className="space-y-2">
          <p className="text-sm">
            {denied
              ? "Your role cannot read the package catalog. Nothing is shown; this is not an empty catalog."
              : "The package catalog could not be read. Counts and readiness are unknown, not zero."}
          </p>
          {!denied && onRetry && <Button variant="outline" size="sm" onClick={onRetry} data-testid="button-catalog-retry">Retry read</Button>}
        </CardContent>
      </Card>
    );
  }
  if (!data || !data.available || !data.counts) {
    return (
      <Card data-testid="catalog-truth-unavailable">
        {header}
        <CardContent className="space-y-2">
          <p className="text-sm">The package catalog is unavailable{data?.unavailableReason ? ` (${data.unavailableReason})` : ""}. Counts and readiness are unknown, not zero.</p>
          {onRetry && <Button variant="outline" size="sm" onClick={onRetry} data-testid="button-catalog-retry">Retry read</Button>}
        </CardContent>
      </Card>
    );
  }

  const current = data.packages.filter((p) => p.catalogClass === "current");
  const groups: Array<{ cls: CatalogClass; label: string; packages: CatalogPackage[] }> = (["template", "historical", "unresolved"] as const)
    .map((cls) => ({ cls, label: CLASS_LABEL[cls], packages: data.packages.filter((p) => p.catalogClass === cls) }));
  const c = data.counts;
  return (
    <Card data-testid="catalog-truth-ok">
      {header}
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1 text-xs" data-testid="catalog-class-counts">
          {(Object.keys(CLASS_LABEL) as CatalogClass[]).map((cls) => (
            <Badge key={cls} variant={cls === "unresolved" && c[cls] > 0 ? "destructive" : "secondary"}>{CLASS_LABEL[cls]}: {c[cls]}</Badge>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Counts are campaigns and sequences by their actual class (planned-not-installed counts package keys). As of {data.asOf}.</p>
        <div className="space-y-2" data-testid="catalog-current-packages">
          <div className="text-sm font-medium">Current SFP packages</div>
          {current.length === 0
            ? <p className="text-sm text-muted-foreground">No current SFP package version is installed.</p>
            : current.map((p) => <PackageRow key={p.packageVersionId} pkg={p} />)}
        </div>
        {groups.map((g) => g.packages.length > 0 && (
          <details key={g.cls} data-testid={`catalog-group-${g.cls}`}>
            <summary className="cursor-pointer text-sm font-medium">{g.label} package versions ({g.packages.length})</summary>
            <div className="mt-2 space-y-2">{g.packages.map((p) => <PackageRow key={p.packageVersionId} pkg={p} />)}</div>
          </details>
        ))}
        {data.uninstalledPackageKeys.length > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="catalog-uninstalled">Planned, not installed: {data.uninstalledPackageKeys.join(", ")}</p>
        )}
        <p className="text-xs text-muted-foreground" data-testid="catalog-cr06-state">
          CR-06 governed catalog: {data.cr06.state === "unavailable" ? "unavailable (not zero)" : data.cr06.state === "empty" ? "no artifacts (does not affect current SFP packages)" : `${data.cr06.governedArtifacts} artifacts`}. {data.cr06.note}
        </p>
        <p className="text-xs text-muted-foreground">{data.cro07.note}</p>
        <p className="text-xs text-muted-foreground">{data.statusActiveSequences.note}</p>
      </CardContent>
    </Card>
  );
}

export function CatalogTruthPanel() {
  const q = useQuery<CatalogTruth>({ queryKey: [CATALOG_TRUTH_URL] });
  return <CatalogTruthView data={q.data} error={q.error as Error | null} isLoading={q.isLoading} onRetry={() => { void q.refetch(); }} />;
}

/** Message for the CR-06 programs list. An empty or unreadable CR-06 never recommends installing and never changes SFP. */
export function describeCr06Programs(state: { programs: number; error?: Error | null; loading?: boolean }): string | null {
  if (state.loading) return "Loading CR-06 catalog…";
  if (state.error) return isDenied(state.error) ? "Your role cannot read the CR-06 catalog." : "The CR-06 catalog could not be read; its contents are unknown, not zero.";
  if (state.programs === 0) return "No CR-06 governed programs exist. This does not affect current SFP packages; applying the CR-06 manifest is a separate decision.";
  return null;
}

/** Counts by actual class from the CR-06 compatibility lists; unresolved items are the only review-required ones. */
export function describeCr06ObjectClasses(legacy?: { campaigns: Array<{ catalogClass?: string }>; sequences: Array<{ catalogClass?: string }> } | null): string {
  if (!legacy) return "Campaign and sequence classes are unknown (not read).";
  const tally = (list: Array<{ catalogClass?: string }>) => {
    const t: Record<string, number> = {};
    for (const x of list) t[x.catalogClass ?? "unclassified"] = (t[x.catalogClass ?? "unclassified"] ?? 0) + 1;
    return t;
  };
  const c = tally(legacy.campaigns); const s = tally(legacy.sequences);
  const part = (k: string, label: string) => `${(c[k] ?? 0)} campaigns / ${(s[k] ?? 0)} sequences ${label}`;
  return [part("current", "current SFP"), part("template", "template"), part("historical", "historical"), part("unresolved", "unresolved (review required)")].join("; ");
}
