/**
 * MI-02: Source Registry Panel
 * Displayed in the Lead Ops workspace "Data Sources" tab (admin-only).
 *
 * Import flow:
 *  1. Admin clicks "Import CSV" → file picker opens (CSV only)
 *  2. File selected → confirmation dialog appears, defaulting to partial import
 *     (isFullSnapshot=false, safe, no tombstoning)
 *  3. Admin explicitly checks "Full snapshot (enables tombstoning)" to opt in
 *  4. CSV is uploaded as multipart/form-data to POST /api/admin/source-registry/:key/import
 *     with isFullSnapshot in form body. CSV is stored in DB; not embedded in BullMQ.
 *  5. Route returns 202 with import_run_id; live polling shows progress
 */

import { useRef, useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw, Database, AlertCircle, Upload } from "lucide-react";
import { getCsrfToken } from "@/lib/queryClient";

interface SourceAdapter {
  adapterKey: string;
  sourceName: string;
  sourceType: string;
  countyFips: string | null;
  active: boolean;
  scheduleDisabled: boolean;
  status: "active" | "unverified" | "failed" | "pending";
  termsUrl: string | null;
  recordCount: number;
  lastCompletedAt: string | null;
  lastImportStatus: string | null;
  activeRunId: string | null;
  canImport: boolean;
}

interface ImportRunStatus {
  id: string;
  status: string;
  records_processed: number;
  records_new: number;
  records_updated: number;
  records_tombstoned: number;
  started_at: string | null;
  completed_at: string | null;
  error_text: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    active: "bg-green-100 text-green-800 border-green-200",
    unverified: "bg-gray-100 text-gray-600 border-gray-200",
    failed: "bg-red-100 text-red-800 border-red-200",
    pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
    completed: "bg-green-100 text-green-800 border-green-200",
    running: "bg-blue-100 text-blue-800 border-blue-200",
    queued: "bg-yellow-100 text-yellow-800 border-yellow-200",
    cancelled: "bg-gray-100 text-gray-600 border-gray-200",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${variants[status] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
      {status}
    </span>
  );
}

function RunProgress({ runId, onComplete }: { runId: string; onComplete: () => void }) {
  const [run, setRun] = useState<ImportRunStatus | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      try {
        const csrfToken = getCsrfToken() ?? "";
        const res = await fetch(`/api/admin/source-registry/runs/${runId}`, {
          credentials: "include",
          headers: { "x-csrf-token": csrfToken },
        });
        if (!res.ok || cancelled) return;
        const data: ImportRunStatus = await res.json();
        if (cancelled) return;
        setRun(data);
        if (data.status === "completed" || data.status === "failed") {
          onCompleteRef.current();
          return; // stop polling
        }
      } catch {
        // ignore transient errors
      }
      if (!cancelled) {
        timer = window.setTimeout(poll, 2000) as unknown as number;
      }
    }

    let timer: number;
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [runId]);

  if (!run) return <Loader2 className="h-3 w-3 animate-spin text-blue-500" />;

  return (
    <div className="space-y-0.5 text-xs">
      <StatusBadge status={run.status} />
      {(run.records_processed ?? 0) > 0 && (
        <div className="text-muted-foreground pl-1">
          {run.records_processed} rows · {run.records_new} new · {run.records_updated} updated
          {run.records_tombstoned > 0 && ` · ${run.records_tombstoned} tombstoned`}
        </div>
      )}
      {run.error_text && (
        <div className="text-red-600 pl-1 truncate max-w-xs" title={run.error_text}>
          {run.error_text}
        </div>
      )}
    </div>
  );
}

/** Confirmation dialog shown after the admin selects a CSV file. */
function ImportConfirmDialog({
  adapterKey,
  sourceName,
  file,
  onConfirm,
  onCancel,
}: {
  adapterKey: string;
  sourceName: string;
  file: File;
  onConfirm: (isFullSnapshot: boolean) => void;
  onCancel: () => void;
}) {
  const [isFullSnapshot, setIsFullSnapshot] = useState(false);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Confirm Import</DialogTitle>
          <DialogDescription className="text-xs">
            Importing <span className="font-medium">{file.name}</span> ({Math.round(file.size / 1024)} KB)
            into <span className="font-mono text-xs">{adapterKey}</span> — {sourceName}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3">
            <Checkbox
              id="fullSnapshot"
              checked={isFullSnapshot}
              onCheckedChange={(v) => setIsFullSnapshot(v === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="fullSnapshot" className="text-xs font-semibold cursor-pointer">
                Full snapshot (enables tombstoning)
              </Label>
              <p className="text-xs text-muted-foreground">
                Check this <strong>only if</strong> the file is the <em>complete</em> current dataset
                from this source — not a filtered, county-only, or partial export.
                When checked, any active record absent from this file will be marked tombstoned.
                This action is irreversible.
              </p>
            </div>
          </div>
          {!isFullSnapshot && (
            <p className="text-xs text-muted-foreground pl-1">
              Without full snapshot: records are added/updated but nothing is tombstoned (safe for partial files).
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button
            size="sm"
            variant={isFullSnapshot ? "destructive" : "default"}
            onClick={() => onConfirm(isFullSnapshot)}
          >
            {isFullSnapshot ? "Import & Tombstone" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SourceRegistryPanel() {
  const qc = useQueryClient();
  const [activeRunIds, setActiveRunIds] = useState<Record<string, string>>({});
  const [uploadingKeys, setUploadingKeys] = useState<Set<string>>(new Set());
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const [pendingConfirm, setPendingConfirm] = useState<{ adapterKey: string; file: File; sourceName: string } | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["/api/admin/source-registry"],
    queryFn: async () => {
      const csrfToken = getCsrfToken() ?? "";
      const res = await fetch("/api/admin/source-registry", {
        credentials: "include",
        headers: { "x-csrf-token": csrfToken },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ adapters: SourceAdapter[] }>;
    },
    refetchInterval: 15000,
  });

  const doUpload = useCallback(async (adapterKey: string, file: File, isFullSnapshot: boolean) => {
    setPendingConfirm(null);
    setUploadingKeys((s) => new Set(s).add(adapterKey));
    setUploadErrors((e) => { const n = { ...e }; delete n[adapterKey]; return n; });

    try {
      const csrfToken = getCsrfToken() ?? "";
      const formData = new FormData();
      formData.append("csv", file);
      // Explicit opt-in only: isFullSnapshot is only true when admin checked the box
      formData.append("isFullSnapshot", isFullSnapshot ? "true" : "false");

      const res = await fetch(`/api/admin/source-registry/${adapterKey}/import`, {
        method: "POST",
        credentials: "include",
        headers: { "x-csrf-token": csrfToken },
        body: formData,
      });

      const body = await res.json();
      if (!res.ok) {
        setUploadErrors((e) => ({ ...e, [adapterKey]: body?.message ?? `HTTP ${res.status}` }));
        return;
      }
      setActiveRunIds((prev) => ({ ...prev, [adapterKey]: body.import_run_id }));
    } catch (err: any) {
      setUploadErrors((e) => ({ ...e, [adapterKey]: err?.message ?? "Upload failed" }));
    } finally {
      setUploadingKeys((s) => { const n = new Set(s); n.delete(adapterKey); return n; });
    }
  }, []);

  const handleFileSelected = useCallback((adapterKey: string, sourceName: string, file: File) => {
    setPendingConfirm({ adapterKey, file, sourceName });
  }, []);

  const handleRunComplete = useCallback((adapterKey: string) => {
    setActiveRunIds((prev) => {
      const next = { ...prev };
      delete next[adapterKey];
      return next;
    });
    refetch();
  }, [refetch]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading source registry…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-600 py-6">
        <AlertCircle className="h-4 w-4" />
        Failed to load source registry
      </div>
    );
  }

  const adapters = data?.adapters ?? [];

  return (
    <>
      {/* Full-snapshot confirmation dialog — shown after file selection */}
      {pendingConfirm && (
        <ImportConfirmDialog
          adapterKey={pendingConfirm.adapterKey}
          sourceName={pendingConfirm.sourceName}
          file={pendingConfirm.file}
          onConfirm={(isFullSnapshot) => doUpload(pendingConfirm.adapterKey, pendingConfirm.file, isFullSnapshot)}
          onCancel={() => setPendingConfirm(null)}
        />
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                South Florida Source Registry
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Government operating-merchant data sources (DBPR, county business tax).
                To import: download the CSV from the adapter's source URL, then click Import CSV and select the file.
                Schedules are disabled — imports run manually until MI-09 activates production ingestion.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-7 px-2">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead>Adapter</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Records</TableHead>
                  <TableHead>Last Import</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead className="w-28"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adapters.map((adapter) => {
                  const activeRunId = activeRunIds[adapter.adapterKey] ?? adapter.activeRunId;
                  const isRunning = !!activeRunId;
                  const isUploading = uploadingKeys.has(adapter.adapterKey);
                  const uploadError = uploadErrors[adapter.adapterKey];

                  return (
                    <TableRow key={adapter.adapterKey} className="text-xs">
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {adapter.adapterKey}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-xs">{adapter.sourceName}</div>
                        {adapter.countyFips && (
                          <div className="text-xs text-muted-foreground">FIPS {adapter.countyFips}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={adapter.status} />
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {adapter.recordCount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {adapter.lastCompletedAt
                          ? new Date(adapter.lastCompletedAt).toLocaleString()
                          : "—"}
                        {adapter.lastImportStatus && !isRunning && (
                          <div><StatusBadge status={adapter.lastImportStatus} /></div>
                        )}
                      </TableCell>
                      <TableCell>
                        {isRunning ? (
                          <RunProgress
                            runId={activeRunId}
                            onComplete={() => handleRunComplete(adapter.adapterKey)}
                          />
                        ) : uploadError ? (
                          <span className="text-red-600 text-xs" title={uploadError}>
                            {uploadError.length > 40 ? uploadError.slice(0, 40) + "…" : uploadError}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {adapter.canImport ? (
                          <>
                            {/* Hidden file input — triggered by the button below */}
                            <input
                              type="file"
                              accept=".csv,text/csv"
                              className="hidden"
                              ref={(el) => { fileInputRefs.current[adapter.adapterKey] = el; }}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleFileSelected(adapter.adapterKey, adapter.sourceName, file);
                                // Reset so same file can be re-selected
                                e.target.value = "";
                              }}
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-xs"
                              disabled={isRunning || isUploading}
                              onClick={() => fileInputRefs.current[adapter.adapterKey]?.click()}
                            >
                              {isUploading || isRunning ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Upload className="h-3 w-3 mr-1" />
                              )}
                              {isRunning ? "Running" : isUploading ? "Uploading…" : "Import CSV"}
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Unverified</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="px-4 py-2 text-xs text-muted-foreground border-t">
            Records flow into the CRO-03 source-staging system (quarantined). No outreach or enrichment spend is triggered by import.
          </div>
        </CardContent>
      </Card>
    </>
  );
}
